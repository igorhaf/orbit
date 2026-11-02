import { randomBytes, createHmac } from "node:crypto";
import { Body, Controller, Delete, Get, HttpException, Inject, Injectable, OnModuleDestroy, OnModuleInit, Param, Post, Put, Req } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { AccessRequest } from "../access/access";
import { AccessService, id } from "../access/access";
import { Db } from "../db";
import { PluginRegistry } from "../execution/registries";
import { SecretVault } from "../secrets";
import type { PluginDefinition } from "./contract";
import { postSecureHttpsJson, validatePublicHttpsTarget } from "./webhooks";
import { SuindaLearningService } from "./suinda/suinda.service";

const PLUGIN_ID = "suinda-crm";
function fail(message: string, status = 400): never { throw new HttpException({ message }, status); }
function object(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Informe uma configuração válida de CRM.");
  return value as Record<string, unknown>;
}

export const suindaCrmPlugin: PluginDefinition = {
  id: PLUGIN_ID, name: "Suindá · Sincronização com CRM", version: "1.0.0", scope: "workspace",
  parentPlugin: "suinda-learning", dependencies: ["suinda-learning", "webhooks"],
  description: "Sincroniza contatos explicitamente consentidos por meio de um contrato HTTPS neutro de fornecedor.",
  capabilities: [{ id: "manage", name: "Administrar sincronização CRM", permissions: [`plugin.${PLUGIN_ID}.manage`] }],
  handlesRoute: (path) => /^\/extensions\/suinda-crm\/workspaces\/[0-9a-f-]{36}\/(?:config|status|sync)$/.test(path),
  routePermission: () => null,
};

type CrmOutboxRow = {
  id: string; workspace_id: string; contact_id: string; action: "upsert" | "delete";
  payload_encrypted: string | null; attempt_count: number;
};

@Injectable()
export class SuindaCrmService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  constructor(@Inject(Db) private readonly db: Db, @Inject(AccessService) private readonly access: AccessService,
    @Inject(PluginRegistry) private readonly registry: PluginRegistry, @Inject(SecretVault) private readonly secrets: SecretVault,
    @Inject(SuindaLearningService) private readonly learning: SuindaLearningService) {}

  onModuleInit() {
    this.access.registerPermissions([`plugin.${PLUGIN_ID}.manage`], PLUGIN_ID);
    this.timer = setInterval(() => void this.dispatch().catch(() => undefined), 5000);
    this.timer.unref();
    void this.dispatch().catch(() => undefined);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private assertAvailable() {
    if (!this.registry.isEnabled(PLUGIN_ID) || !this.registry.isEnabled("suinda-learning")) fail("A integração CRM do Suindá está desativada.", 503);
  }
  private async authorize(userId: string, workspaceInput: string) {
    const workspaceId = id(workspaceInput);
    const workspace = await this.db.one<{ id: string }>("SELECT id FROM workspaces WHERE id=$1 AND archived_at IS NULL", [workspaceId]);
    if (!workspace) fail("Workspace não encontrado.", 404);
    const allowed = await this.access.has(userId, "plugin.suinda-learning.manage", "workspace", workspaceId)
      || await this.access.has(userId, "plugin.suinda-learning.manage");
    if (!allowed) fail("Somente gestores acadêmicos do workspace podem administrar o CRM.", 403);
    return workspaceId;
  }

  async getConfig(workspaceInput: string, userId: string) {
    this.assertAvailable();
    const workspaceId = await this.authorize(userId, workspaceInput);
    const config = await this.db.one<{ endpoint: string; active: boolean; include_phone: boolean; deleting: boolean }>(
      "SELECT endpoint,active,include_phone,deleting FROM suinda_crm_integrations WHERE workspace_id=$1", [workspaceId],
    );
    return { workspace_id: workspaceId, configured: Boolean(config), endpoint: config?.endpoint || null,
      active: config?.active || false, include_phone: config?.include_phone || false, deleting: config?.deleting || false };
  }

  async saveConfig(workspaceInput: string, userId: string, input: unknown) {
    this.assertAvailable();
    const workspaceId = await this.authorize(userId, workspaceInput);
    const body = object(input);
    if (Object.keys(body).some((key) => !["endpoint", "bearer_token", "active", "include_phone"].includes(key))
      || typeof body.active !== "boolean" || typeof body.include_phone !== "boolean") fail("Informe o endpoint, o estado e os campos permitidos do CRM.");
    const previous = await this.db.one<{ endpoint: string; token_encrypted: string; contact_salt_encrypted: string; deleting: boolean }>(
      "SELECT endpoint,token_encrypted,contact_salt_encrypted,deleting FROM suinda_crm_integrations WHERE workspace_id=$1", [workspaceId],
    );
    const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
    if (!endpoint) fail("Informe o endpoint HTTPS do CRM.");
    const target = await validatePublicHttpsTarget(endpoint);
    if (target.url.search || target.url.hash) fail("O endpoint CRM não pode conter parâmetros ou fragmentos.");
    let tokenEncrypted = previous?.token_encrypted;
    if (body.bearer_token !== undefined) {
      if (typeof body.bearer_token !== "string" || body.bearer_token.length < 12 || body.bearer_token.length > 4096 || /[\r\n]/.test(body.bearer_token))
        fail("O token do CRM deve ter entre 12 e 4096 caracteres e não conter quebras de linha.");
      tokenEncrypted = this.secrets.seal({ token: body.bearer_token });
    }
    if (!tokenEncrypted) fail("Informe o token Bearer do CRM.");
    const saltEncrypted = previous?.contact_salt_encrypted || this.secrets.seal({ salt: randomBytes(32).toString("base64url") });
    await this.db.query(
      `INSERT INTO suinda_crm_integrations(workspace_id,endpoint,token_encrypted,contact_salt_encrypted,include_phone,active,deleting,created_by,updated_by)
       VALUES($1,$2,$3,$4,$5,$6,false,$7,$7) ON CONFLICT(workspace_id) DO UPDATE SET endpoint=EXCLUDED.endpoint,
       token_encrypted=EXCLUDED.token_encrypted,contact_salt_encrypted=EXCLUDED.contact_salt_encrypted,
       include_phone=EXCLUDED.include_phone,active=EXCLUDED.active,deleting=false,updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [workspaceId, endpoint, tokenEncrypted, saltEncrypted, body.include_phone, body.active, userId],
    );
    await this.db.query("UPDATE suinda_crm_outbox SET status='pending',attempt_count=0,available_at=now(),last_error=NULL,updated_at=now() WHERE workspace_id=$1 AND action='delete' AND status='dead_letter'", [workspaceId]);
    await this.access.audit(userId, `${PLUGIN_ID}.configured`, workspaceId, { type: "workspace", id: workspaceId });
    return this.getConfig(workspaceId, userId);
  }

  async removeConfig(workspaceInput: string, userId: string) {
    this.assertAvailable();
    const workspaceId = await this.authorize(userId, workspaceInput);
    const client = await this.db.pool.connect();
    try {
      await client.query("BEGIN");
      const config = (await client.query<{ workspace_id: string }>("SELECT workspace_id FROM suinda_crm_integrations WHERE workspace_id=$1 FOR UPDATE", [workspaceId])).rows[0];
      if (!config) { await client.query("COMMIT"); return { ok: true, deleting: false }; }
      await client.query("UPDATE suinda_crm_integrations SET active=false,deleting=true,updated_by=$2,updated_at=now() WHERE workspace_id=$1", [workspaceId, userId]);
      const contacts = (await client.query<{ contact_id: string }>("SELECT contact_id FROM suinda_crm_contacts WHERE workspace_id=$1 FOR UPDATE", [workspaceId])).rows;
      for (const contact of contacts) await this.enqueueDelete(client, workspaceId, contact.contact_id);
      await client.query("UPDATE suinda_crm_outbox SET status='cancelled',payload_encrypted=NULL,updated_at=now() WHERE workspace_id=$1 AND action='upsert' AND status='pending'", [workspaceId]);
      if (!contacts.length) await client.query("DELETE FROM suinda_crm_integrations WHERE workspace_id=$1", [workspaceId]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
    await this.access.audit(userId, `${PLUGIN_ID}.removal.requested`, workspaceId, { type: "workspace", id: workspaceId });
    return { ok: true, deleting: true, message: "As exclusões remotas foram enfileiradas; as credenciais serão removidas após a confirmação do receptor." };
  }

  async status(workspaceInput: string, userId: string) {
    this.assertAvailable();
    const workspaceId = await this.authorize(userId, workspaceInput);
    const config = await this.db.one<{ include_phone: boolean }>("SELECT include_phone FROM suinda_crm_integrations WHERE workspace_id=$1", [workspaceId]);
    const [eligible, deletions, last] = await Promise.all([
      config ? this.learning.crmContactCandidates(workspaceId, config.include_phone) : Promise.resolve([]),
      this.db.one<{ count: number }>("SELECT COUNT(*)::int AS count FROM suinda_crm_outbox WHERE workspace_id=$1 AND action='delete' AND status NOT IN ('delivered','cancelled')", [workspaceId]),
      this.db.one<{ last_sync_at: Date | string | null }>("SELECT MAX(updated_at) AS last_sync_at FROM suinda_crm_outbox WHERE workspace_id=$1 AND action='upsert' AND status='delivered'", [workspaceId]),
    ]);
    return { eligible_contacts: eligible.length, pending_deletions: Number(deletions?.count || 0),
      last_sync_at: last?.last_sync_at ? new Date(last.last_sync_at).toISOString() : null };
  }

  async queueSync(workspaceInput: string, userId: string) {
    this.assertAvailable();
    const workspaceId = await this.authorize(userId, workspaceInput);
    const config = await this.db.one<{ active: boolean; include_phone: boolean; deleting: boolean; contact_salt_encrypted: string }>(
      "SELECT active,include_phone,deleting,contact_salt_encrypted FROM suinda_crm_integrations WHERE workspace_id=$1", [workspaceId],
    );
    if (!config?.active || config.deleting) fail("Configure e ative um endpoint CRM antes de sincronizar.", 409);
    const candidates = await this.learning.crmContactCandidates(workspaceId, config.include_phone);
    const { salt } = this.secrets.open<{ salt: string }>(config.contact_salt_encrypted);
    const hmacKey = Buffer.from(salt, "base64url");
    let queued = 0;
    const client = await this.db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${workspaceId}:suinda-crm-sync`]);
      for (const candidate of candidates) {
        const mapping = (await client.query<{ contact_id: string }>(
          `INSERT INTO suinda_crm_contacts(workspace_id,learner_user_id) VALUES($1,$2)
           ON CONFLICT(workspace_id,learner_user_id) DO UPDATE SET learner_user_id=EXCLUDED.learner_user_id RETURNING contact_id::text`,
          [workspaceId, candidate.learner_user_id],
        )).rows[0]!;
        const contact: Record<string, unknown> = { id: mapping.contact_id, name: candidate.name, email: candidate.email };
        if (config.include_phone && candidate.phone) contact.phone = candidate.phone;
        const payloadText = JSON.stringify({ schema: "suinda.crm.contact.v1", action: "upsert", replace: true, contact });
        const digest = createHmac("sha256", hmacKey).update(payloadText).digest("hex");
        const inserted = await client.query(
          `INSERT INTO suinda_crm_outbox(workspace_id,contact_id,action,payload_encrypted,payload_sha256)
           VALUES($1,$2,'upsert',$3,$4) ON CONFLICT(workspace_id,contact_id,payload_sha256) WHERE action='upsert' DO NOTHING RETURNING id`,
          [workspaceId, mapping.contact_id, this.secrets.seal({ payload: payloadText }), digest],
        );
        queued += inserted.rowCount || 0;
      }
      await client.query("INSERT INTO access_audit(actor_id,action,target,scope_type,scope_id) VALUES($1,$2,$3,'workspace',$4)",
        [userId, `${PLUGIN_ID}.sync.queued`, workspaceId, workspaceId]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
    void this.dispatch().catch(() => undefined);
    return { queued, message: `${queued} alteração(ões) enfileirada(s); somente contatos com consentimento vigente foram incluídos.` };
  }

  private async enqueueDelete(client: PoolClient, workspaceId: string, contactId: string) {
    await client.query(
      `UPDATE suinda_crm_outbox SET status='cancelled',payload_encrypted=NULL,updated_at=now()
       WHERE workspace_id=$1 AND contact_id=$2 AND action='upsert' AND status='pending'`, [workspaceId, contactId],
    );
    await client.query(
      `INSERT INTO suinda_crm_outbox(workspace_id,contact_id,action) VALUES($1,$2,'delete')
       ON CONFLICT(workspace_id,contact_id) WHERE action='delete' AND status IN ('pending','sending') DO NOTHING`, [workspaceId, contactId],
    );
  }

  private async dispatch() {
    if (this.running || !this.registry.isEnabled(PLUGIN_ID)) return;
    this.running = true;
    try {
      const due = await this.db.query<CrmOutboxRow>(
        `WITH due AS (
          SELECT o.id FROM suinda_crm_outbox o JOIN suinda_crm_integrations i ON i.workspace_id=o.workspace_id
          WHERE ((o.status='pending' AND o.available_at<=now()) OR (o.status='sending' AND o.updated_at<now()-interval '1 minute'))
            AND o.attempt_count<8 AND (i.active OR i.deleting OR o.action='delete')
            AND NOT EXISTS (SELECT 1 FROM suinda_crm_outbox older WHERE older.workspace_id=o.workspace_id
              AND older.contact_id=o.contact_id AND older.created_at<o.created_at AND older.status IN ('pending','sending'))
          ORDER BY o.available_at,o.created_at LIMIT 20 FOR UPDATE OF o SKIP LOCKED
        ) UPDATE suinda_crm_outbox o SET status='sending',attempt_count=o.attempt_count+1,updated_at=now()
          FROM due WHERE o.id=due.id RETURNING o.id::text,o.workspace_id::text,o.contact_id::text,o.action,o.payload_encrypted,o.attempt_count`,
      );
      for (const item of due) await this.dispatchOne(item).catch(() => undefined);
      await this.reconcileRevocations();
    } finally { this.running = false; }
  }

  private async dispatchOne(item: CrmOutboxRow) {
    const client = await this.db.pool.connect();
    try {
      await client.query("BEGIN");
      const config = (await client.query<{ endpoint: string; token_encrypted: string; active: boolean; deleting: boolean; include_phone: boolean }>(
        "SELECT endpoint,token_encrypted,active,deleting,include_phone FROM suinda_crm_integrations WHERE workspace_id=$1 FOR SHARE", [item.workspace_id],
      )).rows[0];
      if (!config || !config.active && !config.deleting && item.action !== "delete") { await client.query("ROLLBACK"); return; }
      if (item.action === "upsert") {
        const contactOwner = (await client.query<{ learner_user_id: string }>(
          "SELECT learner_user_id::text FROM suinda_crm_contacts WHERE workspace_id=$1 AND contact_id=$2 FOR UPDATE", [item.workspace_id, item.contact_id],
        )).rows[0];
        if (contactOwner) await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`suinda-crm-user:${item.workspace_id}:${contactOwner.learner_user_id}`]);
        const consent = (await client.query<{ consent_id: string }>(
          `SELECT consent.id::text AS consent_id FROM suinda_crm_contacts c
           JOIN users u ON u.id=c.learner_user_id AND u.email_verified AND NOT u.disabled AND NOT u.is_root
           JOIN LATERAL (SELECT n.id,n.revision FROM extension_records n WHERE n.workspace_id=c.workspace_id AND n.plugin_id='suinda-learning'
             AND n.kind='privacy_notice' AND n.state='published' AND n.payload->>'purpose_code'='crm_contact_sync'
             AND n.payload->>'consent_required'='true' AND n.payload->'data_categories' ? 'learner_name'
             AND n.payload->'data_categories' ? 'verified_email'
             AND (NOT $3::boolean OR n.payload->'data_categories' ? 'learner_phone')
             ORDER BY (n.payload->>'version')::int DESC,n.updated_at DESC,n.id DESC LIMIT 1) n ON true
           JOIN extension_records consent ON consent.workspace_id=c.workspace_id AND consent.plugin_id='suinda-learning'
             AND consent.kind='learner_consent' AND consent.state='accepted' AND consent.payload->>'learner_user_id'=c.learner_user_id::text
             AND consent.payload->>'notice_record_id'=n.id::text AND consent.payload->>'notice_revision'=n.revision::text
             AND consent.payload->>'consent_status'='consented'
           WHERE c.workspace_id=$1 AND c.contact_id=$2 AND EXISTS(SELECT 1 FROM extension_records e WHERE e.workspace_id=c.workspace_id
             AND e.plugin_id='suinda-learning' AND e.kind='enrollment' AND e.payload->>'learner_user_id'=c.learner_user_id::text
             AND e.state=ANY(ARRAY['approved','enrolled','active','paused','completed']))
             AND NOT EXISTS(SELECT 1 FROM suinda_privacy_erasures erasure WHERE erasure.workspace_id=c.workspace_id
               AND erasure.subject_user_id=c.learner_user_id AND erasure.state='completed' AND erasure.completed_at>=consent.created_at)
           ORDER BY consent.created_at DESC,consent.id DESC LIMIT 1 FOR UPDATE OF consent,u`, [item.workspace_id, item.contact_id, config.include_phone],
        )).rows[0];
        if (!consent) {
          await client.query("UPDATE suinda_crm_outbox SET status='cancelled',payload_encrypted=NULL,last_error=NULL,updated_at=now() WHERE id=$1", [item.id]);
          await this.enqueueDelete(client, item.workspace_id, item.contact_id);
          await client.query("COMMIT");
          return;
        }
      }
      const payload = item.action === "delete"
        ? JSON.stringify({ schema: "suinda.crm.contact.v1", action: "delete", contact_id: item.contact_id })
        : this.secrets.open<{ payload: string }>(item.payload_encrypted!).payload;
      const { token } = this.secrets.open<{ token: string }>(config.token_encrypted);
      await postSecureHttpsJson(config.endpoint, payload, { authorization: `Bearer ${token}`, "idempotency-key": item.id });
      await client.query("UPDATE suinda_crm_outbox SET status='delivered',payload_encrypted=NULL,last_error=NULL,updated_at=now() WHERE id=$1", [item.id]);
      if (item.action === "delete") {
        await client.query(`DELETE FROM suinda_crm_contacts c WHERE c.workspace_id=$1 AND c.contact_id=$2
          AND NOT EXISTS(SELECT 1 FROM suinda_crm_outbox o WHERE o.workspace_id=c.workspace_id AND o.contact_id=c.contact_id
            AND o.action='upsert' AND o.status IN ('pending','sending'))`, [item.workspace_id, item.contact_id]);
      }
      const deleting = (await client.query<{ deleting: boolean }>("SELECT deleting FROM suinda_crm_integrations WHERE workspace_id=$1", [item.workspace_id])).rows[0]?.deleting;
      if (deleting) {
        const left = await client.query("SELECT 1 FROM suinda_crm_contacts WHERE workspace_id=$1 LIMIT 1", [item.workspace_id]);
        const pending = await client.query("SELECT 1 FROM suinda_crm_outbox WHERE workspace_id=$1 AND status IN ('pending','sending','dead_letter') LIMIT 1", [item.workspace_id]);
        if (!left.rowCount && !pending.rowCount) await client.query("DELETE FROM suinda_crm_integrations WHERE workspace_id=$1", [item.workspace_id]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      await this.recordFailure(item, error);
    } finally { client.release(); }
  }

  private async recordFailure(item: CrmOutboxRow, error: unknown) {
    const message = error instanceof Error ? error.message : "";
    const http = /^HTTP_(\d{3})$/.exec(message);
    const code = http ? `HTTP_${http[1]}` : message === "TIMEOUT" ? "TIMEOUT"
      : error instanceof HttpException ? "UNSAFE_DESTINATION" : "DELIVERY_ERROR";
    const terminal = item.attempt_count >= 8 || code === "UNSAFE_DESTINATION" || Boolean(http && Number(http[1]) >= 400 && Number(http[1]) < 500 && ![408,429].includes(Number(http[1])));
    const delay = Math.min(21600, 15 * 2 ** Math.min(item.attempt_count - 1, 10));
    await this.db.query(
      `UPDATE suinda_crm_outbox SET status=$2,payload_encrypted=CASE WHEN $2='dead_letter' THEN NULL ELSE payload_encrypted END,
       available_at=now()+($3::int*interval '1 second'),last_error=$4,updated_at=now() WHERE id=$1`,
      [item.id, terminal ? "dead_letter" : "pending", delay, code],
    );
  }

  private async reconcileRevocations() {
    const rows = await this.db.query<{ workspace_id: string; learner_user_id: string }>(
      `SELECT c.workspace_id::text,c.learner_user_id::text FROM suinda_crm_contacts c
       JOIN suinda_crm_integrations integration ON integration.workspace_id=c.workspace_id
       WHERE (NOT EXISTS(SELECT 1 FROM users u WHERE u.id=c.learner_user_id AND u.email_verified AND NOT u.disabled AND NOT u.is_root)
         OR NOT EXISTS(SELECT 1 FROM extension_records e WHERE e.workspace_id=c.workspace_id AND e.plugin_id='suinda-learning'
           AND e.kind='enrollment' AND e.payload->>'learner_user_id'=c.learner_user_id::text
           AND e.state=ANY(ARRAY['approved','enrolled','active','paused','completed']))
         OR NOT EXISTS(SELECT 1 FROM extension_records n JOIN extension_records consent ON consent.workspace_id=n.workspace_id
         AND consent.plugin_id='suinda-learning' AND consent.kind='learner_consent' AND consent.state='accepted'
         AND consent.payload->>'learner_user_id'=c.learner_user_id::text AND consent.payload->>'notice_record_id'=n.id::text
         AND consent.payload->>'notice_revision'=n.revision::text AND consent.payload->>'consent_status'='consented'
         WHERE n.workspace_id=c.workspace_id AND n.plugin_id='suinda-learning' AND n.kind='privacy_notice' AND n.state='published'
           AND n.payload->>'purpose_code'='crm_contact_sync' AND n.payload->>'consent_required'='true'
           AND n.payload->'data_categories' ? 'learner_name'
           AND n.payload->'data_categories' ? 'verified_email'
           AND (NOT integration.include_phone OR n.payload->'data_categories' ? 'learner_phone')
           AND NOT EXISTS(SELECT 1 FROM extension_records newer WHERE newer.workspace_id=n.workspace_id AND newer.plugin_id='suinda-learning'
             AND newer.kind='privacy_notice' AND newer.state='published' AND newer.payload->>'purpose_code'='crm_contact_sync'
             AND ((newer.payload->>'version')::int,(newer.updated_at),(newer.id))>((n.payload->>'version')::int,n.updated_at,n.id))))
       AND NOT EXISTS(SELECT 1 FROM suinda_crm_outbox o WHERE o.workspace_id=c.workspace_id AND o.contact_id=c.contact_id
         AND o.action='delete' AND o.status IN ('pending','sending')) LIMIT 100`,
    );
    if (!rows.length) return;
    const client = await this.db.pool.connect();
    try {
      await client.query("BEGIN");
      for (const row of rows) {
        const contacts = (await client.query<{ contact_id: string }>("SELECT contact_id::text FROM suinda_crm_contacts WHERE workspace_id=$1 AND learner_user_id=$2 FOR UPDATE", [row.workspace_id, row.learner_user_id])).rows;
        for (const contact of contacts) await this.enqueueDelete(client, row.workspace_id, contact.contact_id);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  }
}

@Controller("extensions/suinda-crm/workspaces/:workspaceId")
export class SuindaCrmController {
  constructor(@Inject(SuindaCrmService) private readonly crm: SuindaCrmService) {}
  @Get("config") config(@Req() req: AccessRequest, @Param("workspaceId") workspaceId: string) { return this.crm.getConfig(workspaceId, String(req.orbitUser)); }
  @Put("config") save(@Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Body() body: unknown) { return this.crm.saveConfig(workspaceId, String(req.orbitUser), body); }
  @Delete("config") remove(@Req() req: AccessRequest, @Param("workspaceId") workspaceId: string) { return this.crm.removeConfig(workspaceId, String(req.orbitUser)); }
  @Get("status") status(@Req() req: AccessRequest, @Param("workspaceId") workspaceId: string) { return this.crm.status(workspaceId, String(req.orbitUser)); }
  @Post("sync") sync(@Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Body() body: unknown) {
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length) fail("A sincronização não recebe campos no corpo.");
    return this.crm.queueSync(workspaceId, String(req.orbitUser));
  }
}

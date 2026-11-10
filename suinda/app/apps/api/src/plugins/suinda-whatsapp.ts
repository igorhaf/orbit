import { createHash } from "node:crypto";
import { Body, Controller, Get, HttpException, Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional, Param, Post, Put, Req } from "@nestjs/common";
import { AccessService, type AccessRequest } from "../access/access";
import { Db } from "../db";
import { PluginRegistry } from "../execution/registries";
import { SecretVault } from "../secrets";
import type { PublishedPluginNotification } from "./notifications";

const PLUGIN = "suinda-whatsapp";
const GRAPH_VERSION = "v22.0";
const GRAPH_HOST = "graph.facebook.com";
const CATEGORIES = new Set(["academic_reminder", "survey_reminder", "attendance_risk", "announcement", "study_group_message"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Config = { wabaId: string; phoneNumberId: string; accessToken: string };
type WhatsAppFetch = (input: URL, init: RequestInit) => Promise<Response>;

function fail(message: string, status: number): never { throw new HttpException({ message }, status); }
function workspaceId(value: string) { if (!UUID.test(value)) fail("Workspace inválido.", 400); return value; }
function e164(value: unknown): string {
  if (typeof value !== "string" || !/^\+[1-9][0-9]{7,14}$/.test(value)) fail("Número de telefone inválido.", 400);
  return value;
}
function validConfig(value: unknown): Config {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Configuração do WhatsApp inválida.", 400);
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !["waba_id", "phone_number_id", "access_token"].includes(key)) ||
    typeof row.waba_id !== "string" || !/^\d{5,30}$/.test(row.waba_id) ||
    typeof row.phone_number_id !== "string" || !/^\d{5,30}$/.test(row.phone_number_id) ||
    typeof row.access_token !== "string" || row.access_token.length < 30 || row.access_token.length > 4096 || /[\r\n]/.test(row.access_token)) {
    fail("Configuração do WhatsApp inválida.", 400);
  }
  return { wabaId: row.waba_id, phoneNumberId: row.phone_number_id, accessToken: row.access_token };
}
function validConsent(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Consentimento inválido.", 400);
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !["phone_e164", "opted_in", "categories"].includes(key)) ||
    typeof row.opted_in !== "boolean" || !Array.isArray(row.categories) || row.categories.length > CATEGORIES.size ||
    row.categories.some((category) => typeof category !== "string" || !CATEGORIES.has(category)) ||
    new Set(row.categories).size !== row.categories.length) fail("Consentimento inválido.", 400);
  return { phone: e164(row.phone_e164), optedIn: row.opted_in, categories: row.categories as string[] };
}
export function suindaWhatsAppGraphUrl(...segments: string[]) {
  const validPath = segments.length === 2 && /^\d{5,30}$/.test(segments[0]) && ["messages", "message_templates"].includes(segments[1]);
  if (!validPath) fail("Destino externo inválido.", 502);
  const url = new URL(`https://${GRAPH_HOST}/${GRAPH_VERSION}/${segments.map(encodeURIComponent).join("/")}`);
  if (url.protocol !== "https:" || url.hostname !== GRAPH_HOST || url.port || url.username || url.password) fail("Destino externo inválido.", 502);
  return url;
}
async function readBoundedJson(response: Response) {
  if (!response.body) return {} as Record<string, unknown>;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16_384) { await reader.cancel(); fail("Resposta do provedor indisponível.", 502); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>; }
  catch { return {}; }
}

@Injectable()
export class SuindaWhatsAppService implements OnModuleInit, OnModuleDestroy {
  private queueTimer?: ReturnType<typeof setInterval>;
  private queueJob?: Promise<void>;
  constructor(@Inject(Db) private readonly db: Db, @Inject(AccessService) private readonly access: AccessService,
    @Inject(PluginRegistry) private readonly registry: PluginRegistry, @Inject(SecretVault) private readonly vault: SecretVault,
    @Optional() @Inject("SUINDA_WHATSAPP_FETCH") private readonly injectedFetch?: WhatsAppFetch) {}

  private fetcher(): WhatsAppFetch { return this.injectedFetch || fetch as WhatsAppFetch; }

  onModuleInit() {
    this.queueTimer = setInterval(() => void this.processNotificationQueue().catch((error: unknown) => {
      console.error("Suindá: não foi possível processar a fila de notificações WhatsApp.", error instanceof Error ? error.name : "erro");
    }), 30_000);
    this.queueTimer.unref();
    void this.processNotificationQueue().catch((error: unknown) => {
      console.error("Suindá: não foi possível processar a fila de notificações WhatsApp.", error instanceof Error ? error.name : "erro");
    });
  }

  onModuleDestroy() { if (this.queueTimer) clearInterval(this.queueTimer); }

  private available() {
    if (!this.registry.isEnabled(PLUGIN)) fail("O WhatsApp do Suindá ou uma dependência está desativado.", 409);
  }

  isEnabled() { return this.registry.isEnabled(PLUGIN); }

  async assertReady(workspace: string) {
    this.available();
    const scope = workspaceId(workspace);
    const row = await this.db.one<{ credentials_encrypted: string; announcement_template_name: string | null; announcement_template_language: string | null }>(
      "SELECT credentials_encrypted,announcement_template_name,announcement_template_language FROM suinda_whatsapp_config WHERE workspace_id=$1", [scope]);
    if (!row?.announcement_template_name || !row.announcement_template_language) fail("Configure as credenciais e o template aprovado de comunicados WhatsApp neste workspace.", 409);
    try { this.vault.open<Config>(row.credentials_encrypted); } catch { fail("Credencial institucional indisponível. Reconfigure a integração.", 409); }
  }

  private async manager(workspace: string, user: string) {
    this.available();
    const scope = workspaceId(workspace);
    if (!await this.db.one("SELECT id FROM workspaces WHERE id=$1", [scope])) fail("Workspace não encontrado.", 404);
    if (!await this.access.has(user, "plugin.suinda-whatsapp.manage", "workspace", scope)) {
      fail("A configuração exige permissão de gestão do WhatsApp neste workspace.", 403);
    }
    return scope;
  }

  private async learnerBelongsTo(workspace: string, user: string) {
    return Boolean(await this.db.one(`SELECT id FROM extension_records WHERE workspace_id=$1 AND plugin_id='suinda-learning'
      AND kind IN ('enrollment','learner_profile') AND payload->>'learner_user_id'=$2 LIMIT 1`, [workspace, user]));
  }

  async configuration(workspace: string, user: string) {
    const scope = await this.manager(workspace, user);
    const row = await this.db.one<{ credentials_encrypted: string; announcement_template_name: string | null; announcement_template_language: string | null; updated_at: string }>(
      "SELECT credentials_encrypted,announcement_template_name,announcement_template_language,updated_at FROM suinda_whatsapp_config WHERE workspace_id=$1", [scope]);
    let config: Config | null = null;
    try { if (row) config = this.vault.open<Config>(row.credentials_encrypted); } catch { fail("Credencial institucional indisponível. Reconfigure a integração.", 409); }
    return { configured: Boolean(config), waba_id: config?.wabaId || null, phone_number_id: config?.phoneNumberId || null,
      access_token_configured: Boolean(config?.accessToken), announcement_template_name: row?.announcement_template_name || null,
      announcement_template_language: row?.announcement_template_language || null, updated_at: row?.updated_at || null };
  }

  async saveConfiguration(workspace: string, user: string, input: unknown) {
    const scope = await this.manager(workspace, user);
    if (!input || typeof input !== "object" || Array.isArray(input)) fail("Configuração do WhatsApp inválida.", 400);
    const row = input as Record<string, unknown>;
    if (Object.keys(row).some((key) => !["waba_id", "phone_number_id", "access_token", "announcement_template_name", "announcement_template_language"].includes(key))) fail("Configuração do WhatsApp inválida.", 400);
    const templateName = row.announcement_template_name === undefined ? undefined : row.announcement_template_name;
    const templateLanguage = row.announcement_template_language === undefined ? undefined : row.announcement_template_language;
    if ((templateName !== undefined && templateName !== null && (typeof templateName !== "string" || !/^[a-z0-9_]{1,128}$/.test(templateName))) ||
      (templateLanguage !== undefined && templateLanguage !== null && (typeof templateLanguage !== "string" || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(templateLanguage))) ||
      ((templateName === null || templateName === "") !== (templateLanguage === null || templateLanguage === ""))) fail("Modelo de comunicado inválido.", 400);
    const old = await this.db.one<{ credentials_encrypted: string }>("SELECT credentials_encrypted FROM suinda_whatsapp_config WHERE workspace_id=$1", [scope]);
    let previous: Config | null = null;
    try { if (old) previous = this.vault.open<Config>(old.credentials_encrypted); } catch { /* replacement can recover an unreadable credential */ }
    const merged = { waba_id: row.waba_id, phone_number_id: row.phone_number_id,
      access_token: row.access_token === undefined ? previous?.accessToken : row.access_token };
    const config = validConfig(merged);
    await this.db.query(`INSERT INTO suinda_whatsapp_config(workspace_id,credentials_encrypted,announcement_template_name,announcement_template_language,updated_by)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id) DO UPDATE SET credentials_encrypted=EXCLUDED.credentials_encrypted,
      announcement_template_name=COALESCE(EXCLUDED.announcement_template_name,suinda_whatsapp_config.announcement_template_name),
      announcement_template_language=COALESCE(EXCLUDED.announcement_template_language,suinda_whatsapp_config.announcement_template_language),
      updated_by=EXCLUDED.updated_by,updated_at=now()`, [scope, this.vault.seal(config), templateName || null, templateLanguage || null, user]);
    await this.access.audit(user, `${PLUGIN}.configuration.save`, "workspace-config", { type: "workspace", id: scope });
    return this.configuration(scope, user);
  }

  async consent(workspace: string, user: string) {
    this.available();
    const scope = workspaceId(workspace);
    if (!await this.learnerBelongsTo(scope, user)) {
      fail("Consentimento indisponível fora do workspace da matrícula.", 403);
    }
    const row = await this.db.one<{ phone_e164: string; opted_in: boolean; categories: string[]; consented_at: string | null; revoked_at: string | null }>(
      "SELECT phone_e164,opted_in,categories,consented_at,revoked_at FROM suinda_whatsapp_consents WHERE workspace_id=$1 AND user_id=$2", [scope, user]);
    if (!row) return { configured: false, opted_in: false, categories: [], consented_at: null, revoked_at: null };
    return { configured: true, phone_masked: `${row.phone_e164.slice(0, 4)}••••${row.phone_e164.slice(-3)}`,
      opted_in: row.opted_in, categories: row.categories, consented_at: row.consented_at, revoked_at: row.revoked_at };
  }

  async setConsent(workspace: string, user: string, input: unknown) {
    this.available();
    const scope = workspaceId(workspace);
    if (!await this.learnerBelongsTo(scope, user)) {
      fail("Consentimento indisponível fora do workspace da matrícula.", 403);
    }
    const consent = validConsent(input);
    if (consent.optedIn && consent.categories.length === 0) fail("Escolha ao menos uma categoria de notificação.", 400);
    await this.db.query(`INSERT INTO suinda_whatsapp_consents(workspace_id,user_id,phone_e164,opted_in,categories,consented_at,revoked_at)
      VALUES($1,$2,$3,$4,$5,CASE WHEN $4 THEN now() ELSE NULL END,CASE WHEN $4 THEN NULL ELSE now() END)
      ON CONFLICT(workspace_id,user_id) DO UPDATE SET phone_e164=EXCLUDED.phone_e164,opted_in=EXCLUDED.opted_in,
      categories=EXCLUDED.categories,consented_at=CASE WHEN EXCLUDED.opted_in THEN now() ELSE suinda_whatsapp_consents.consented_at END,
      revoked_at=CASE WHEN EXCLUDED.opted_in THEN NULL ELSE now() END,updated_at=now()`,
    [scope, user, consent.phone, consent.optedIn, consent.categories]);
    await this.access.audit(user, `${PLUGIN}.consent.${consent.optedIn ? "grant" : "revoke"}`, "self", { type: "workspace", id: scope });
    return this.consent(scope, user);
  }

  async sendTemplate(workspace: string, actor: string, input: unknown) {
    const scope = await this.manager(workspace, actor);
    return this.deliverTemplate(scope, actor, input);
  }

  async dispatchAnnouncement(workspace: string, announcementId: string) {
    this.available();
    const scope = workspaceId(workspace);
    const announcement = await this.db.one<{ id: string; title: string; payload: Record<string, unknown>; state: string }>(
      `SELECT id,title,payload,state FROM extension_records WHERE id=$1 AND workspace_id=$2
       AND plugin_id='suinda-learning' AND kind='announcement'`, [announcementId, scope]);
    if (!announcement || announcement.state !== "sent" || announcement.payload.channel !== "whatsapp" || announcement.payload.audience_type !== "cohort")
      fail("Comunicado WhatsApp não encontrado.", 404);
    const template = await this.db.one<{ announcement_template_name: string | null; announcement_template_language: string | null }>(
      "SELECT announcement_template_name,announcement_template_language FROM suinda_whatsapp_config WHERE workspace_id=$1", [scope]);
    if (!template?.announcement_template_name || !template.announcement_template_language) fail("Configure o modelo aprovado de comunicados WhatsApp neste workspace.", 409);
    const actor = await this.db.one<{ id: string }>("SELECT id FROM users WHERE email='orbit-system-actor@orbit.invalid' AND disabled");
    if (!actor) fail("O ator de sistema do Orbit não existe; execute as migrações da API.", 503);
    const title = announcement.title;
    const body = typeof announcement.payload.body === "string" ? announcement.payload.body : "";
    if ([...title].length > 500 || [...body].length > 500) fail("O comunicado excede o limite de parâmetros do template WhatsApp.", 422);
    let cursor = "";
    let recipientCount = 0;
    let sentCount = 0;
    let failedCount = 0;
    const audienceUnitId = typeof announcement.payload.audience_unit_record_id === "string"
      ? announcement.payload.audience_unit_record_id : null;
    while (true) {
      const recipients = await this.db.query<{ learner_user_id: string }>(
        `SELECT DISTINCT e.payload->>'learner_user_id' AS learner_user_id
         FROM extension_records e JOIN suinda_whatsapp_consents c ON c.user_id=(e.payload->>'learner_user_id')::uuid AND c.workspace_id=e.workspace_id
         JOIN users u ON u.id=c.user_id
         LEFT JOIN extension_records co ON co.id::text=e.payload->>'cohort_record_id' AND co.workspace_id=e.workspace_id
           AND co.plugin_id='suinda-learning' AND co.kind='cohort'
         LEFT JOIN extension_records course ON course.id::text=e.payload->>'course_record_id' AND course.workspace_id=e.workspace_id
           AND course.plugin_id='suinda-learning' AND course.kind='course'
         WHERE e.workspace_id=$1 AND e.plugin_id='suinda-learning' AND e.kind='enrollment'
           AND e.payload->>'cohort_record_id'=$2 AND e.payload->>'learner_user_id'>$3
           AND e.state=ANY(ARRAY['enrolled','active','paused'])
           AND (e.payload->>'payment_status'=ANY(ARRAY['not_required','paid','waived']) OR COALESCE(NULLIF(e.payload->>'amount_due','')::numeric,0)<=0)
           AND c.opted_in=true AND c.revoked_at IS NULL AND 'announcement'=ANY(c.categories)
           AND COALESCE((u.preferences->>'notifications')::boolean,true)
           AND ($4::text IS NULL OR COALESCE(NULLIF(e.payload->>'institution_unit_record_id',''),
             NULLIF(co.payload->>'institution_unit_record_id',''),NULLIF(course.payload->>'institution_unit_record_id',''))=$4::text)
         ORDER BY e.payload->>'learner_user_id' LIMIT 500`, [scope, announcement.payload.audience_record_id, cursor, audienceUnitId]);
      if (!recipients.length) break;
      for (const recipient of recipients) {
        cursor = recipient.learner_user_id;
        recipientCount++;
        try {
          const result = await this.deliverTemplate(scope, actor.id, {
            user_id: recipient.learner_user_id, category: "announcement", template_name: template.announcement_template_name,
            language: template.announcement_template_language, parameters: [title, body],
            idempotency_key: `announce:${announcement.id}:${recipient.learner_user_id}`,
          });
          if ((result as { accepted?: boolean }).accepted) sentCount++; else failedCount++;
        } catch { failedCount++; }
      }
    }
    return { recipient_count: recipientCount, sent_count: sentCount, failed_count: failedCount };
  }

  async enqueueNotification(notification: PublishedPluginNotification) {
    if (!this.registry.isEnabled(PLUGIN) || notification.plugin_id !== "suinda-learning" || !notification.workspace_id) return;
    const category = notification.kind === "survey_reminder" ? "survey_reminder"
      : notification.kind === "academic_reminder" ? "academic_reminder"
      : notification.kind === "attendance_risk" ? "attendance_risk"
        : notification.kind === "study_group_message" ? "study_group_message" : null;
    if (!category) return;
    const eligible = await this.db.one(`SELECT c.user_id FROM suinda_whatsapp_consents c JOIN users u ON u.id=c.user_id
      WHERE c.workspace_id=$1 AND c.user_id=$2 AND c.opted_in=true AND c.revoked_at IS NULL
        AND $3=ANY(c.categories) AND COALESCE((u.preferences->>'notifications')::boolean,true)`,
    [notification.workspace_id, notification.user_id, category]);
    if (!eligible) return;
    await this.db.query(`INSERT INTO suinda_whatsapp_notification_queue(notification_id,workspace_id,user_id,category)
      VALUES($1,$2,$3,$4) ON CONFLICT(notification_id) DO NOTHING`,
    [notification.id, notification.workspace_id, notification.user_id, category]);
  }

  async processNotificationQueue() {
    if (!this.registry.isEnabled(PLUGIN)) return;
    if (this.queueJob) return this.queueJob;
    const job = this.deliverQueuedNotifications();
    this.queueJob = job;
    void job.finally(() => { if (this.queueJob === job) this.queueJob = undefined; }).catch(() => undefined);
    return job;
  }

  private async deliverQueuedNotifications() {
    const pending = await this.db.query<{ notification_id: string; workspace_id: string; user_id: string; category: string; title: string; body: string }>(
      `WITH selected AS (
         SELECT q.notification_id FROM suinda_whatsapp_notification_queue q
         WHERE q.state='pending' OR (q.state='sending' AND q.updated_at<=now()-INTERVAL '5 minutes')
         ORDER BY q.created_at,q.notification_id LIMIT 50 FOR UPDATE SKIP LOCKED
       )
       UPDATE suinda_whatsapp_notification_queue q SET state='sending',updated_at=now()
       FROM selected s JOIN notifications n ON n.id=s.notification_id
       WHERE q.notification_id=s.notification_id
       RETURNING q.notification_id,q.workspace_id,q.user_id,q.category,n.title,n.body`,
    );
    const actor = pending.length ? await this.db.one<{ id: string }>("SELECT id FROM users WHERE email='orbit-system-actor@orbit.invalid' AND disabled") : null;
    if (pending.length && !actor) {
      await this.db.query("UPDATE suinda_whatsapp_notification_queue SET state='pending',updated_at=now() WHERE notification_id=ANY($1::uuid[])", [pending.map((item) => item.notification_id)]);
      throw new Error("O ator de sistema do Orbit não existe; execute as migrações da API.");
    }
    for (const item of pending) {
      try {
        this.available();
        const consent = await this.db.one<{ eligible: boolean }>(
          `SELECT EXISTS(SELECT 1 FROM suinda_whatsapp_consents c JOIN users u ON u.id=c.user_id
            WHERE c.workspace_id=$1 AND c.user_id=$2 AND c.opted_in=true AND c.revoked_at IS NULL
              AND $3=ANY(c.categories) AND COALESCE((u.preferences->>'notifications')::boolean,true)) AS eligible`,
          [item.workspace_id, item.user_id, item.category]);
        if (!consent?.eligible) {
          await this.db.query("UPDATE suinda_whatsapp_notification_queue SET state=$2,updated_at=now() WHERE notification_id=$1", [item.notification_id, "skipped"]);
          continue;
        }
        if (item.category === "academic_reminder" || item.category === "survey_reminder") {
          const learningPreference = await this.db.one<{ enabled: boolean }>(
            `SELECT COALESCE((payload->>'academic_reminders_enabled')::boolean,true) AS enabled FROM extension_records
             WHERE workspace_id=$1 AND plugin_id='suinda-learning' AND kind='learner_profile'
               AND payload->>'learner_user_id'=$2 AND state<>'archived'`, [item.workspace_id, item.user_id]);
          if (learningPreference?.enabled === false) {
            await this.db.query("UPDATE suinda_whatsapp_notification_queue SET state=$2,updated_at=now() WHERE notification_id=$1", [item.notification_id, "skipped"]);
            continue;
          }
        }
        if ([...item.title].length > 500 || [...item.body].length > 500) {
          await this.db.query("UPDATE suinda_whatsapp_notification_queue SET state='failed',updated_at=now() WHERE notification_id=$1", [item.notification_id]);
          continue;
        }
        const config = await this.db.one<{ announcement_template_name: string; announcement_template_language: string }>(
          "SELECT announcement_template_name,announcement_template_language FROM suinda_whatsapp_config WHERE workspace_id=$1", [item.workspace_id]);
        if (!config?.announcement_template_name || !config.announcement_template_language) {
          await this.db.query("UPDATE suinda_whatsapp_notification_queue SET state=$2,updated_at=now() WHERE notification_id=$1", [item.notification_id, "pending"]);
          break;
        }
        const result = await this.deliverTemplate(item.workspace_id, actor!.id, {
          user_id: item.user_id, category: item.category, template_name: config.announcement_template_name,
          language: config.announcement_template_language, parameters: [item.title, item.body],
          idempotency_key: `notice:${item.notification_id}:${item.user_id}`,
        }) as { accepted?: boolean };
        await this.db.query("UPDATE suinda_whatsapp_notification_queue SET state=$2,updated_at=now() WHERE notification_id=$1",
          [item.notification_id, result.accepted ? "sent" : "failed"]);
      } catch (error) {
        if (error instanceof HttpException && error.getStatus() === 409) {
          const consent = await this.db.one<{ eligible: boolean }>(
            `SELECT EXISTS(SELECT 1 FROM suinda_whatsapp_consents c JOIN users u ON u.id=c.user_id
              WHERE c.workspace_id=$1 AND c.user_id=$2 AND c.opted_in=true AND c.revoked_at IS NULL
                AND $3=ANY(c.categories) AND COALESCE((u.preferences->>'notifications')::boolean,true)) AS eligible`,
            [item.workspace_id, item.user_id, item.category]);
          if (!consent?.eligible) {
            await this.db.query("UPDATE suinda_whatsapp_notification_queue SET state=$2,updated_at=now() WHERE notification_id=$1", [item.notification_id, "skipped"]);
            continue;
          }
          await this.db.query("UPDATE suinda_whatsapp_notification_queue SET state=$2,updated_at=now() WHERE notification_id=$1", [item.notification_id, "pending"]);
          break;
        }
        await this.db.query("UPDATE suinda_whatsapp_notification_queue SET state='failed',updated_at=now() WHERE notification_id=$1", [item.notification_id]);
      }
    }
  }

  private async deliverTemplate(scope: string, actor: string, input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input)) fail("Solicitação de envio inválida.", 400);
    const row = input as Record<string, unknown>;
    if (Object.keys(row).some((key) => !["user_id", "category", "template_name", "language", "parameters", "idempotency_key"].includes(key)) ||
      typeof row.user_id !== "string" || !UUID.test(row.user_id) || typeof row.category !== "string" || !CATEGORIES.has(row.category) ||
      typeof row.template_name !== "string" || !/^[a-z0-9_]{1,128}$/.test(row.template_name) || typeof row.language !== "string" ||
      !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(row.language) || !Array.isArray(row.parameters) || row.parameters.length > 10 ||
      row.parameters.some((value) => typeof value !== "string" || value.length > 500 ||
        [...value].some((character) => (character.charCodeAt(0) < 32 && !["\t", "\n", "\r"].includes(character)) || character.charCodeAt(0) === 127)) ||
      typeof row.idempotency_key !== "string" || !/^[A-Za-z0-9._:-]{8,100}$/.test(row.idempotency_key)) fail("Solicitação de envio inválida.", 400);

    const recipient = await this.db.one<{ phone_e164: string }>(`SELECT c.phone_e164 FROM suinda_whatsapp_consents c
      JOIN users u ON u.id=c.user_id WHERE c.workspace_id=$1 AND c.user_id=$2 AND c.opted_in=true
        AND c.revoked_at IS NULL AND $3=ANY(c.categories)
        AND COALESCE((u.preferences->>'notifications')::boolean,true)`, [scope, row.user_id, row.category]);
    if (!recipient) fail("O destinatário não autorizou esta categoria de notificação.", 409);
    const configRow = await this.db.one<{ credentials_encrypted: string }>("SELECT credentials_encrypted FROM suinda_whatsapp_config WHERE workspace_id=$1", [scope]);
    if (!configRow) fail("O canal WhatsApp deste workspace não está configurado.", 409);
    let config: Config;
    try { config = this.vault.open<Config>(configRow.credentials_encrypted); } catch { fail("Credencial institucional indisponível.", 409); }
    const templateUrl = suindaWhatsAppGraphUrl(config.wabaId, "message_templates");
    templateUrl.search = new URLSearchParams({ name: row.template_name as string, fields: "name,status,language" }).toString();
    const hash = createHash("sha256").update(JSON.stringify([row.user_id, row.category, row.template_name, row.language, row.parameters])).digest("hex");
    const reserved = await this.db.one<{ idempotency_key: string }>(`INSERT INTO suinda_whatsapp_deliveries
      (workspace_id,idempotency_key,request_hash,user_id,category,state) VALUES($1,$2,$3,$4,$5,'sending')
      ON CONFLICT(workspace_id,idempotency_key) DO NOTHING RETURNING idempotency_key`,
    [scope, row.idempotency_key, hash, row.user_id, row.category]);
    if (!reserved) {
      const existing = await this.db.one<{ request_hash: string; state: string; provider_message_id: string | null }>(
        "SELECT request_hash,state,provider_message_id FROM suinda_whatsapp_deliveries WHERE workspace_id=$1 AND idempotency_key=$2", [scope, row.idempotency_key]);
      if (!existing || existing.request_hash !== hash) fail("Chave de idempotência já utilizada para outra solicitação.", 409);
      return { accepted: existing.state === "sent", state: existing.state, message_id: existing.provider_message_id };
    }

    try {
      const templateResponse = await this.fetcher()(templateUrl, { method: "GET", redirect: "error", signal: AbortSignal.timeout(8_000),
        headers: { Authorization: `Bearer ${config.accessToken}`, Accept: "application/json" } });
      const templates = await readBoundedJson(templateResponse);
      if (!templateResponse.ok || !Array.isArray(templates.data) || !templates.data.some((item) => item && typeof item === "object" &&
        (item as Record<string, unknown>).name === row.template_name && (item as Record<string, unknown>).status === "APPROVED" &&
        (item as Record<string, unknown>).language === row.language)) throw new Error("template");

      const sendUrl = suindaWhatsAppGraphUrl(config.phoneNumberId, "messages");
      const sendResponse = await this.fetcher()(sendUrl, { method: "POST", redirect: "error", signal: AbortSignal.timeout(8_000),
        headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: recipient.phone_e164.slice(1),
          type: "template", template: { name: row.template_name, language: { code: row.language },
            ...(row.parameters.length ? { components: [{ type: "body", parameters: (row.parameters as string[]).map((text) => ({ type: "text", text })) }] } : {}) } }) });
      const result = await readBoundedJson(sendResponse);
      const messages = result.messages;
      const messageId = sendResponse.ok && Array.isArray(messages) && typeof messages[0]?.id === "string" ? messages[0].id as string : null;
      if (!messageId) throw new Error("send");
      await this.db.query("UPDATE suinda_whatsapp_deliveries SET state='sent',provider_message_id=$3,updated_at=now() WHERE workspace_id=$1 AND idempotency_key=$2",
        [scope, row.idempotency_key, messageId]);
      await this.access.audit(actor, `${PLUGIN}.template.send`, row.category as string, { type: "workspace", id: scope });
      return { accepted: true, state: "sent", message_id: messageId };
    } catch {
      await this.db.query("UPDATE suinda_whatsapp_deliveries SET state='failed',updated_at=now() WHERE workspace_id=$1 AND idempotency_key=$2", [scope, row.idempotency_key]);
      fail("Não foi possível enviar a notificação WhatsApp. Verifique a configuração e tente com uma nova chave.", 502);
    }
  }
}

@Controller("extensions/suinda-whatsapp/workspaces/:workspaceId")
export class SuindaWhatsAppController {
  constructor(@Inject(SuindaWhatsAppService) private readonly service: SuindaWhatsAppService) {}
  @Get("configuration") configuration(@Req() req: AccessRequest, @Param("workspaceId") workspace: string) {
    return this.service.configuration(workspace, String(req.orbitUser));
  }
  @Put("configuration") saveConfiguration(@Req() req: AccessRequest, @Param("workspaceId") workspace: string, @Body() body: unknown) {
    return this.service.saveConfiguration(workspace, String(req.orbitUser), body);
  }
  @Get("consent") consent(@Req() req: AccessRequest, @Param("workspaceId") workspace: string) {
    return this.service.consent(workspace, String(req.orbitUser));
  }
  @Put("consent") setConsent(@Req() req: AccessRequest, @Param("workspaceId") workspace: string, @Body() body: unknown) {
    return this.service.setConsent(workspace, String(req.orbitUser), body);
  }
  @Post("deliveries") send(@Req() req: AccessRequest, @Param("workspaceId") workspace: string, @Body() body: unknown) {
    return this.service.sendTemplate(workspace, String(req.orbitUser), body);
  }
}

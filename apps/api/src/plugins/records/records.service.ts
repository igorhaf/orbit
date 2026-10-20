import { createHash } from "node:crypto";
import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import type { PoolClient } from "pg";
import { AccessService, id, text } from "../../access/access";
import { Db } from "../../db";
import { PluginRegistry } from "../../execution/registries";
import { recordPlugin, recordPlugins } from "./catalog";
import { decodeDocument, DocumentScanner } from "./documents";
import {
  deadlineDueAt,
  deadlineTransition,
  invalid,
  nextWorkflowState,
  only,
  Payload,
  validate,
  validateDefinition,
} from "./rules";

export type ExtensionRecord = {
  id: string;
  workspace_id: string;
  plugin_id: string;
  kind: string;
  title: string;
  state: string;
  revision: number;
  payload: Payload;
  created_by: string;
  updated_by: string;
};
type Version = ExtensionRecord & { actor_id: string };
const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Every leaf plugin uses its own schema and permissions over a shared, immutable history. */
@Injectable()
export class ExtensionRecords implements OnModuleInit {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(PluginRegistry) private readonly registry: PluginRegistry,
    @Inject(DocumentScanner) private readonly scanner: DocumentScanner,
  ) {}

  onModuleInit() {
    this.access.registerRoutes("/extensions");
  }

  async catalog(user: string) {
    const root = (await this.access.account(user)).is_root;
    const workspaces = root
      ? []
      : await this.db.query<{ workspace_id: string }>(
          "SELECT m.workspace_id FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=$1 AND w.archived_at IS NULL",
          [user],
        );
    const available = [];
    for (const { plugin, kinds } of recordPlugins) {
      let authorized =
        root || (await this.access.has(user, `plugin.${plugin.id}.read`));
      if (!authorized)
        for (const workspace of workspaces)
          if (
            await this.access.has(
              user,
              `plugin.${plugin.id}.read`,
              "workspace",
              workspace.workspace_id,
            )
          ) {
            authorized = true;
            break;
          }
      if (!authorized) continue;
      available.push({
        id: plugin.id,
        name: plugin.name,
        description: plugin.description,
        enabled: this.registry.isEnabled(plugin.id),
        kinds: Object.entries(kinds).map(([id, definition]) => ({
          id,
          ...definition,
        })),
      });
    }
    if (root || (await this.access.has(user, "access.audit.read"))) {
      const audit = this.registry.getById("audit-history");
      available.push({
        id: audit.id,
        name: audit.name,
        description: audit.description,
        enabled: this.registry.isEnabled(audit.id),
        kinds: [],
      });
    }
    return available;
  }

  private definition(plugin: string, kind: string) {
    const definition = recordPlugin(plugin)?.kinds[kind];
    if (!definition)
      invalid("Tipo de registro não encontrado neste plugin.", 404);
    return definition;
  }

  private async authorize(
    plugin: string,
    workspace: string,
    user: string,
    action = "read",
  ) {
    if (!recordPlugin(plugin) || !this.registry.isEnabled(plugin))
      invalid("Plugin ou dependência desativada.", 409);
    if (
      !(await this.db.one(
        "SELECT id FROM workspaces WHERE id=$1 AND archived_at IS NULL",
        [id(workspace)],
      ))
    )
      invalid("Workspace não encontrado ou arquivado.", 404);
    await this.access.require(
      user,
      `plugin.${plugin}.${action}`,
      "workspace",
      workspace,
    );
  }

  async list(plugin: string, workspace: string, user: string) {
    await this.authorize(plugin, workspace, user);
    return this.db.query<ExtensionRecord>(
      "SELECT * FROM extension_records WHERE workspace_id=$1 AND plugin_id=$2 ORDER BY updated_at DESC,id LIMIT 100",
      [workspace, plugin],
    );
  }

  async permissions(plugin: string, workspace: string, user: string) {
    await this.authorize(plugin, workspace, user);
    return {
      write: await this.access.has(
        user,
        `plugin.${plugin}.write`,
        "workspace",
        workspace,
      ),
      publish: await this.access.has(
        user,
        `plugin.${plugin}.publish`,
        "workspace",
        workspace,
      ),
    };
  }

  private async record(
    plugin: string,
    recordId: string,
    user: string,
    action = "read",
  ) {
    const record = await this.db.one<ExtensionRecord>(
      "SELECT * FROM extension_records WHERE id=$1 AND plugin_id=$2",
      [id(recordId), plugin],
    );
    if (!record) invalid("Registro não encontrado.", 404);
    await this.authorize(plugin, record.workspace_id, user, action);
    return record;
  }

  async detail(plugin: string, recordId: string, user: string) {
    const record = await this.record(plugin, recordId, user);
    const versions = await this.db.query(
      "SELECT * FROM extension_record_versions WHERE record_id=$1 ORDER BY revision DESC LIMIT 100",
      [record.id],
    );
    const links = await this.db.query(
      "SELECT * FROM extension_record_links WHERE record_id=$1 ORDER BY created_at",
      [record.id],
    );
    const acceptances =
      plugin === "terms"
        ? await this.db.query(
            "SELECT revision,user_id,content_sha256,accepted_at FROM extension_term_acceptances WHERE record_id=$1 AND user_id=$2 ORDER BY revision DESC",
            [record.id, user],
          )
        : [];
    const definition = this.definition(plugin, record.kind);
    let nextStates = definition.transitions[record.state] || [];
    if (plugin === "workflows" && record.kind === "process") {
      const flow = await this.db.one<{ payload: Payload }>(
        "SELECT payload FROM extension_record_versions WHERE record_id=$1 AND revision=$2",
        [record.payload.definition_id, record.payload.definition_revision],
      );
      nextStates = (
        (flow?.payload.transitions as Array<{ from: string; to: string }>) || []
      )
        .filter((edge) => edge.from === record.payload.current_state)
        .map((edge) => edge.to);
    }
    return { ...record, versions, links, acceptances, next_states: nextStates };
  }

  private async mutation<T>(
    plugin: string,
    workspace: string,
    user: string,
    key: unknown,
    input: unknown,
    callback: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const operation = id(key),
      hash = fingerprint(input);
    const client = await this.db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`${workspace}:${plugin}:${user}:${operation}`],
      );
      const prior = (
        await client.query<{ request_hash: string; response: T }>(
          "SELECT request_hash,response FROM extension_operations WHERE workspace_id=$1 AND plugin_id=$2 AND actor_id=$3 AND operation_key=$4",
          [workspace, plugin, user, operation],
        )
      ).rows[0];
      if (prior) {
        if (prior.request_hash !== hash)
          invalid("A chave de operação já foi usada com outro conteúdo.", 409);
        await client.query("COMMIT");
        return prior.response;
      }
      const response = await callback(client);
      if (!this.registry.isEnabled(plugin))
        invalid("Plugin desativado durante a operação.", 409);
      await client.query(
        "INSERT INTO extension_operations(workspace_id,plugin_id,actor_id,operation_key,request_hash,response) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
        [workspace, plugin, user, operation, hash, JSON.stringify(response)],
      );
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async snapshot(
    client: PoolClient,
    record: ExtensionRecord,
    user: string,
    reason: string,
  ) {
    await client.query(
      "INSERT INTO extension_record_versions(record_id,revision,title,state,payload,reason,actor_id) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)",
      [
        record.id,
        record.revision,
        record.title,
        record.state,
        JSON.stringify(record.payload),
        reason,
        user,
      ],
    );
    await client.query(
      "INSERT INTO access_audit(actor_id,action,target,scope_type,scope_id) VALUES($1,$2,$3,$4,$5)",
      [
        user,
        record.plugin_id + ".record." + record.state,
        record.id,
        "workspace",
        record.workspace_id,
      ],
    );
    return record;
  }

  private async pinned(
    client: PoolClient,
    recordId: unknown,
    revision: unknown,
    workspace: string,
    user: string,
    published = true,
  ): Promise<Version> {
    if (!Number.isInteger(revision) || Number(revision) < 1)
      invalid("Versão da referência inválida.");
    const row = (
      await client.query<Version>(
        `SELECT r.id,r.workspace_id,r.plugin_id,r.kind,r.created_by,r.updated_by,v.*
      FROM extension_records r JOIN extension_record_versions v ON v.record_id=r.id WHERE r.id=$1 AND v.revision=$2`,
        [id(recordId), revision],
      )
    ).rows[0];
    if (!row || row.workspace_id !== workspace)
      invalid("A referência precisa existir no mesmo workspace.", 404);
    await this.authorize(row.plugin_id, workspace, user);
    if (
      published &&
      !["published", "submitted", "completed", "resolved"].includes(row.state)
    )
      invalid(
        "A referência deve apontar para uma versão publicada ou concluída.",
        409,
      );
    return row;
  }

  private async payload(
    client: PoolClient,
    plugin: string,
    kind: string,
    input: Payload,
    workspace: string,
    user: string,
    prior?: ExtensionRecord,
  ) {
    const definition = this.definition(plugin, kind);
    validate(definition.schema, input);
    validateDefinition(plugin, kind, input);
    const payload = JSON.parse(JSON.stringify(input)) as Payload;
    if (plugin === "forms" && kind === "submission") {
      const form = await this.pinned(
        client,
        payload.form_id,
        payload.form_revision,
        workspace,
        user,
      );
      if (form.plugin_id !== "forms" || form.kind !== "form")
        invalid("A resposta deve se vincular a um formulário publicado.");
      validate(form.payload.schema as Payload, payload.answers);
      if (
        prior &&
        (payload.form_id !== prior.payload.form_id ||
          payload.form_revision !== prior.payload.form_revision)
      )
        invalid(
          "A versão do formulário não pode ser alterada no rascunho.",
          409,
        );
    }
    if (plugin === "workflows" && kind === "process") {
      const flow = await this.pinned(
        client,
        payload.definition_id,
        payload.definition_revision,
        workspace,
        user,
      );
      if (flow.plugin_id !== "workflows" || flow.kind !== "definition")
        invalid("Definição de fluxo inválida.");
      if (prior) {
        for (const field of [
          "definition_id",
          "definition_revision",
          "current_state",
          "protocol",
        ])
          if (payload[field] !== prior.payload[field])
            invalid(
              "O fluxo e seu estado só podem mudar por uma transição autorizada.",
              409,
            );
      } else {
        if (
          payload.current_state !== undefined ||
          payload.protocol !== undefined
        )
          invalid("Estado e protocolo são calculados pelo sistema.");
        payload.current_state = flow.payload.initial_state;
        const sequence = (
          await client.query<{ value: string }>(
            "SELECT nextval('extension_protocol_seq')::text AS value",
          )
        ).rows[0].value;
        payload.protocol = `ORB-${new Date().getUTCFullYear()}-${sequence.padStart(8, "0")}`;
      }
    }
    if (plugin === "workflows" && ["review", "followup"].includes(kind)) {
      const process = (
        await client.query<ExtensionRecord>(
          "SELECT * FROM extension_records WHERE id=$1 AND workspace_id=$2 AND plugin_id=$3 AND kind=$4",
          [id(payload.process_id), workspace, "workflows", "process"],
        )
      ).rows[0];
      if (!process) invalid("Processo não encontrado no workspace.", 404);
      if (kind === "followup") {
        const member = await this.db.one(
          "SELECT id FROM users WHERE id=$1 AND NOT disabled",
          [id(payload.responsible_user_id)],
        );
        if (
          !member ||
          !(await this.access.has(
            String(payload.responsible_user_id),
            "plugin.workflows.read",
            "workspace",
            workspace,
          ))
        )
          invalid("O responsável precisa ter acesso ao processo.");
      }
    }
    if (plugin === "compliance" && kind === "case" && payload.disclosure_id) {
      const disclosure = (
        await client.query<ExtensionRecord>(
          "SELECT * FROM extension_records WHERE id=$1 AND workspace_id=$2 AND plugin_id=$3 AND kind=$4",
          [id(payload.disclosure_id), workspace, "compliance", "disclosure"],
        )
      ).rows[0];
      if (!disclosure) invalid("Declaração não encontrada no workspace.", 404);
    }
    if (plugin === "deadlines") {
      if (prior) invalid("Use eventos para modificar o relógio.", 409);
      if (
        payload.started_at !== undefined ||
        payload.due_at !== undefined ||
        payload.paused_at !== undefined
      )
        invalid("Datas do relógio são calculadas pelo sistema.");
      const now = new Date();
      payload.started_at = now.toISOString();
      payload.due_at = deadlineDueAt(now, Number(payload.duration_days));
      payload.paused_at = null;
    }
    if (plugin === "documents" && kind === "review")
      await this.independentReview(client, payload, workspace, user);
    return payload;
  }

  private async independentReview(
    client: PoolClient,
    payload: Payload,
    workspace: string,
    user: string,
  ) {
    const document = await this.pinned(
      client,
      payload.document_id,
      payload.document_revision,
      workspace,
      user,
      false,
    );
    if (
      document.plugin_id !== "documents" ||
      document.kind !== "document" ||
      document.payload.variant !== "anonymized"
    )
      invalid("A revisão deve apontar para uma cópia anonimizada.");
    const current = (
      await client.query<ExtensionRecord>(
        "SELECT * FROM extension_records WHERE id=$1 FOR UPDATE",
        [document.id],
      )
    ).rows[0];
    if (
      current.payload.sha256 !== document.payload.sha256 ||
      current.payload.file_revision !== document.payload.file_revision
    )
      invalid("Existe uma versão mais recente do documento.", 409);
    const source = await this.pinned(
      client,
      document.payload.source_id,
      document.payload.source_revision,
      workspace,
      user,
      false,
    );
    const authors = await client.query(
      "SELECT uploaded_by FROM extension_files WHERE (record_id=$1 AND revision=$2) OR (record_id=$3 AND revision=$4)",
      [
        document.id,
        document.payload.file_revision,
        source.id,
        source.payload.file_revision,
      ],
    );
    if (authors.rows.some((row) => row.uploaded_by === user))
      invalid("A revisão precisa ser feita por outra pessoa.", 409);
    const checks = payload.checks as Record<string, boolean>;
    if (
      payload.decision === "approved" &&
      Object.values(checks).some((value) => value !== true)
    )
      invalid("A aprovação exige todas as verificações concluídas.");
  }

  async create(plugin: string, workspace: string, user: string, body: Payload) {
    only(body, ["kind", "title", "payload", "operation_key"]);
    await this.authorize(plugin, workspace, user, "write");
    const kind = text(body.kind, 80),
      title = text(body.title, 240),
      definition = this.definition(plugin, kind);
    if (plugin === "documents" && kind === "document")
      invalid("Use o envio de arquivo para criar documentos.");
    return this.mutation(
      plugin,
      workspace,
      user,
      body.operation_key,
      body,
      async (client) => {
        const payload = await this.payload(
          client,
          plugin,
          kind,
          body.payload as Payload,
          workspace,
          user,
        );
        const row = (
          await client.query<ExtensionRecord>(
            "INSERT INTO extension_records(workspace_id,plugin_id,kind,title,state,payload,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$7) RETURNING *",
            [
              workspace,
              plugin,
              kind,
              title,
              definition.initial,
              JSON.stringify(payload),
              user,
            ],
          )
        ).rows[0];
        return this.snapshot(client, row, user, "Registro criado");
      },
    );
  }

  async version(plugin: string, recordId: string, user: string, body: Payload) {
    only(body, [
      "title",
      "payload",
      "expected_revision",
      "reason",
      "operation_key",
    ]);
    const record = await this.record(plugin, recordId, user, "write");
    if (plugin === "documents" && record.kind === "document")
      invalid("Use o envio de arquivo para criar uma versão documental.");
    return this.mutation(
      plugin,
      record.workspace_id,
      user,
      body.operation_key,
      { recordId, ...body },
      async (client) => {
        const current = await this.lock(
          client,
          record.id,
          body.expected_revision,
        );
        const definition = this.definition(plugin, current.kind);
        if (
          definition.immutable?.includes(current.state) &&
          current.state !== "published"
        )
          invalid("Registro concluído e imutável.", 409);
        const payload = await this.payload(
          client,
          plugin,
          current.kind,
          body.payload as Payload,
          current.workspace_id,
          user,
          current,
        );
        const title = text(body.title, 240),
          reason = text(body.reason, 2000);
        return this.save(
          client,
          current,
          user,
          title,
          payload,
          current.state === "published" ? definition.initial : current.state,
          reason,
        );
      },
    );
  }

  private async lock(client: PoolClient, recordId: string, revision: unknown) {
    const current = (
      await client.query<ExtensionRecord>(
        "SELECT * FROM extension_records WHERE id=$1 FOR UPDATE",
        [recordId],
      )
    ).rows[0];
    if (!current || current.revision !== revision)
      invalid("O registro mudou; recarregue antes de tentar novamente.", 409);
    return current;
  }

  private async save(
    client: PoolClient,
    current: ExtensionRecord,
    user: string,
    title: string,
    payload: Payload,
    state: string,
    reason: string,
  ) {
    validate(this.definition(current.plugin_id, current.kind).schema, payload);
    const updated = (
      await client.query<ExtensionRecord>(
        "UPDATE extension_records SET title=$2,payload=$3::jsonb,state=$4,revision=revision+1,updated_by=$5,updated_at=now() WHERE id=$1 RETURNING *",
        [current.id, title, JSON.stringify(payload), state, user],
      )
    ).rows[0];
    return this.snapshot(client, updated, user, reason);
  }

  async transition(
    plugin: string,
    recordId: string,
    user: string,
    body: Payload,
  ) {
    only(body, [
      "state",
      "next_state",
      "event",
      "extension_days",
      "expected_revision",
      "reason",
      "operation_key",
    ]);
    const record = await this.record(plugin, recordId, user, "publish");
    return this.mutation(
      plugin,
      record.workspace_id,
      user,
      body.operation_key,
      { recordId, ...body },
      async (client) => {
        const current = await this.lock(
            client,
            record.id,
            body.expected_revision,
          ),
          definition = this.definition(plugin, current.kind);
        let state = text(body.state ?? current.state, 80),
          payload = { ...current.payload };
        const reason = text(body.reason, 2000);
        if (definition.immutable?.includes(current.state))
          invalid(
            "Registro concluído; crie uma nova versão quando permitido.",
            409,
          );
        if (plugin === "deadlines")
          ({ state, payload } = deadlineTransition(
            current.state,
            payload,
            text(body.event, 20),
            new Date(),
            body.extension_days,
          ));
        else if (plugin === "workflows" && current.kind === "process") {
          const flow = await this.pinned(
            client,
            payload.definition_id,
            payload.definition_revision,
            current.workspace_id,
            user,
          );
          payload.current_state = nextWorkflowState(
            flow.payload,
            String(payload.current_state),
            text(body.next_state, 80),
          );
          const edges = flow.payload.transitions as Array<{ from: string }>;
          state = edges.some((edge) => edge.from === payload.current_state)
            ? "active"
            : "completed";
        } else if (
          !(definition.transitions[current.state] || []).includes(state)
        )
          invalid("Transição não permitida.", 409);
        if (
          plugin === "privacy" &&
          state === "completed" &&
          !payload.response_reference
        )
          invalid("Registre a referência da resposta antes de concluir.");
        if (
          plugin === "compliance" &&
          current.kind === "case" &&
          state === "resolved" &&
          (!payload.resolution || !payload.decision_reference)
        )
          invalid("Registre a decisão e sua referência antes de concluir.");
        if (
          plugin === "workflows" &&
          current.kind === "followup" &&
          ["responded", "resolved"].includes(state) &&
          !payload.response
        )
          invalid("Registre a resposta antes de concluir esta etapa.");
        if (plugin === "documents" && current.kind === "review")
          await this.independentReview(
            client,
            payload,
            current.workspace_id,
            user,
          );
        if (
          plugin === "documents" &&
          current.kind === "document" &&
          payload.variant === "anonymized"
        ) {
          const review = (
            await client.query(
              `SELECT id FROM extension_records WHERE workspace_id=$1 AND plugin_id='documents' AND kind='review' AND state='published'
          AND payload->>'document_id'=$2 AND payload->>'decision'='approved'
          AND (payload->>'document_revision')::integer IN (SELECT revision FROM extension_record_versions WHERE record_id=$2::uuid AND payload->>'sha256'=$3 AND payload->>'file_revision'=$4) LIMIT 1`,
              [
                current.workspace_id,
                current.id,
                payload.sha256,
                String(payload.file_revision),
              ],
            )
          ).rows[0];
          if (!review)
            invalid(
              "Publique uma revisão independente aprovada desta versão antes de divulgar a cópia anonimizada.",
              409,
            );
        }
        return this.save(
          client,
          current,
          user,
          current.title,
          payload,
          state,
          reason,
        );
      },
    );
  }

  async link(plugin: string, recordId: string, user: string, body: Payload) {
    only(body, ["target_id", "target_revision", "relation", "operation_key"]);
    const current = await this.record(plugin, recordId, user, "write");
    return this.mutation(
      plugin,
      current.workspace_id,
      user,
      body.operation_key,
      { recordId, ...body },
      async (client) => {
        const target = await this.pinned(
          client,
          body.target_id,
          body.target_revision,
          current.workspace_id,
          user,
        );
        if (target.id === current.id)
          invalid("Um registro não pode ser referência de si mesmo.");
        const relation = text(body.relation, 80);
        const row = (
          await client.query(
            "INSERT INTO extension_record_links(record_id,target_record_id,target_revision,relation,actor_id,workspace_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING *",
            [
              current.id,
              target.id,
              target.revision,
              relation,
              user,
              current.workspace_id,
            ],
          )
        ).rows[0];
        if (row)
          await client.query(
            "INSERT INTO access_audit(actor_id,action,target,scope_type,scope_id) VALUES($1,$2,$3,$4,$5)",
            [
              user,
              plugin + ".reference.pinned",
              current.id,
              "workspace",
              current.workspace_id,
            ],
          );
        return row || { already_linked: true };
      },
    );
  }

  async accept(recordId: string, user: string, body: Payload) {
    only(body, ["revision", "accepted", "operation_key"]);
    const current = await this.record("terms", recordId, user);
    if (body.accepted !== true) invalid("O aceite deve ser explícito.");
    return this.mutation(
      "terms",
      current.workspace_id,
      user,
      body.operation_key,
      { recordId, ...body },
      async (client) => {
        const term = await this.pinned(
          client,
          current.id,
          body.revision,
          current.workspace_id,
          user,
        );
        const hash = fingerprint(term.payload);
        await client.query(
          "INSERT INTO extension_term_acceptances(record_id,revision,user_id,content_sha256) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
          [current.id, term.revision, user, hash],
        );
        await client.query(
          "INSERT INTO access_audit(actor_id,action,target,scope_type,scope_id) VALUES($1,$2,$3,$4,$5)",
          [
            user,
            "terms.accepted",
            current.id,
            "workspace",
            current.workspace_id,
          ],
        );
        return {
          record_id: current.id,
          revision: term.revision,
          user_id: user,
          content_sha256: hash,
        };
      },
    );
  }

  async upload(workspace: string, user: string, body: Payload) {
    only(body, [
      "title",
      "file_name",
      "mime_type",
      "data_base64",
      "record_id",
      "expected_revision",
      "variant",
      "source_id",
      "source_revision",
      "operation_key",
      "reason",
    ]);
    await this.authorize("documents", workspace, user, "write");
    const file = decodeDocument(
        body.data_base64,
        body.mime_type,
        body.file_name,
      ),
      scan = await this.scanner.scan(file.data);
    return this.mutation(
      "documents",
      workspace,
      user,
      body.operation_key,
      body,
      async (client) => {
        const current = body.record_id
          ? await this.lock(client, id(body.record_id), body.expected_revision)
          : undefined;
        if (
          current &&
          (current.workspace_id !== workspace ||
            current.plugin_id !== "documents" ||
            current.kind !== "document")
        )
          invalid("Documento não encontrado no workspace.", 404);
        const revision = current ? current.revision + 1 : 1;
        const payload: Payload = {
          file_name: file.file_name,
          mime_type: file.mime_type,
          size_bytes: file.size_bytes,
          sha256: file.sha256,
          variant: body.variant || "original",
          file_revision: revision,
          scan_status: scan,
        };
        if (current && payload.variant !== current.payload.variant)
          invalid(
            "Crie um documento separado para uma variante diferente.",
            409,
          );
        if (
          payload.variant === "original" &&
          (body.source_id !== undefined || body.source_revision !== undefined)
        )
          invalid("Um original não pode referenciar outra origem.");
        if (payload.variant === "anonymized") {
          const source = await this.pinned(
            client,
            body.source_id,
            body.source_revision,
            workspace,
            user,
            false,
          );
          if (
            source.plugin_id !== "documents" ||
            source.kind !== "document" ||
            source.payload.variant !== "original"
          )
            invalid(
              "A cópia anonimizada deve referenciar uma versão original.",
            );
          if (source.id === current?.id)
            invalid("A cópia deve ser um documento separado do original.");
          payload.source_id = source.id;
          payload.source_revision = source.revision;
        }
        validate(this.definition("documents", "document").schema, payload);
        const title = text(body.title, 240),
          reason = body.reason ? text(body.reason, 2000) : "Documento enviado";
        const record = current
          ? await this.save(
              client,
              current,
              user,
              title,
              payload,
              "draft",
              reason,
            )
          : await this.snapshot(
              client,
              (
                await client.query<ExtensionRecord>(
                  "INSERT INTO extension_records(workspace_id,plugin_id,kind,title,state,payload,created_by,updated_by) VALUES($1,'documents','document',$2,'draft',$3::jsonb,$4,$4) RETURNING *",
                  [workspace, title, JSON.stringify(payload), user],
                )
              ).rows[0],
              user,
              reason,
            );
        await client.query(
          "INSERT INTO extension_files(record_id,revision,data,sha256,uploaded_by) VALUES($1,$2,$3,$4,$5)",
          [record.id, revision, file.data, file.sha256, user],
        );
        return record;
      },
    );
  }

  async download(recordId: string, revision: number, user: string) {
    const record = await this.record("documents", recordId, user);
    const version = await this.db.one<{ payload: Payload }>(
      "SELECT payload FROM extension_record_versions WHERE record_id=$1 AND revision=$2",
      [record.id, revision],
    );
    if (!version || record.kind !== "document")
      invalid("Versão de documento não encontrada.", 404);
    const file = await this.db.one<{ data: Buffer; sha256: string }>(
      "SELECT data,sha256 FROM extension_files WHERE record_id=$1 AND revision=$2",
      [record.id, version.payload.file_revision],
    );
    if (
      !file ||
      createHash("sha256").update(file.data).digest("hex") !== file.sha256 ||
      file.sha256 !== version.payload.sha256
    )
      invalid("Falha de integridade do arquivo.", 409);
    await this.access.audit(
      user,
      "documents.file.read." + String(version.payload.variant),
      record.id,
      { type: "workspace", id: record.workspace_id },
    );
    return {
      data: file.data,
      file_name: String(version.payload.file_name),
      mime_type: String(version.payload.mime_type),
    };
  }
}

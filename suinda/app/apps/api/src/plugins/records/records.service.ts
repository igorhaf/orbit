import { createHash, randomUUID } from "node:crypto";
import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import type { PoolClient } from "pg";
import { AccessService, id, text } from "../../access/access";
import { Db } from "../../db";
import { PluginRegistry } from "../../execution/registries";
import { assertNoProtectedFieldEnvelope, isProtectedAttachmentEnvelope, openProtectedAttachment, protectRecordPayload, protectedProjectionFields, redactProtectedPaths, sealProtectedAttachment, unprotectRecordPayload } from "../../data-protector";
import type { PluginDefinition, RecordAccessPolicy, RecordKindContribution, RecordTransitionEffect, RecordValidationContext, RecordValidationIssue, ResolvedRecordReference } from "../contract";
import { decodeDocument, DocumentScanner } from "./documents";
import { enqueueWebhookEvent } from "../webhooks";
import {
  assertSemanticValidation,
  assertPayloadFieldsImmutable,
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
  created_at?: string;
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
    @Inject(Db) protected readonly db: Db,
    @Inject(AccessService) protected readonly access: AccessService,
    @Inject(PluginRegistry) protected readonly registry: PluginRegistry,
    @Inject(DocumentScanner) protected readonly scanner: DocumentScanner,
  ) {}

  onModuleInit() {
    this.access.registerRoutes("/extensions");
    this.access.registerScope("extension_record", async (scope) => {
      const record = await this.db.one<{ plugin_id: string; kind: string }>(
        "SELECT plugin_id,kind FROM extension_records WHERE id=$1",
        [id(scope)],
      );
      if (!record || !this.registry.isEnabled(record.plugin_id)) return false;
      try {
        return this.definition(record.plugin_id, record.kind).resourceScoped === true;
      } catch {
        return false;
      }
    });
    this.access.registerMembership("extension_record", async (user, scope) => {
      const owner = await this.db.one<{ created_by: string }>(
        "SELECT created_by FROM extension_records WHERE id=$1",
        [id(scope)],
      );
      if (!owner) return false;
      if (owner.created_by === user) return true;
      return Boolean(await this.db.one(
        "SELECT user_id FROM access_grants WHERE user_id=$1 AND scope_type='extension_record' AND scope_id=$2",
        [user, scope],
      ));
    });
  }

  async catalog(user: string) {
    const root = await this.access.isRoot(user);
    const workspaces = root
      ? []
      : await this.db.query<{ workspace_id: string }>(
          "SELECT m.workspace_id FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=$1 AND w.archived_at IS NULL",
          [user],
        );
    const available = [];
    for (const plugin of this.registry.list()) {
      const kinds = plugin.contributions?.recordKinds;
      if (!kinds) continue;
      let authorized =
        root || (await this.access.has(user, `plugin.${plugin.id}.read`));
      if (!authorized)
        for (const definition of Object.values(kinds)) {
          const permissions = [
            definition.resourceScoped ? `plugin.${plugin.id}.write` : "",
            definition.managePermission || "",
          ].filter(Boolean);
          for (const permission of permissions)
            if (await this.access.has(user, permission)) {
              authorized = true;
              break;
            }
          if (authorized) break;
        }
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
      if (!authorized && Object.values(kinds).some((definition) => definition.resourceScoped)) {
        const records = await this.db.query<{ id: string; workspace_id: string; kind: string }>(
          "SELECT id,workspace_id,kind FROM extension_records WHERE plugin_id=$1 AND kind=ANY($2::text[]) ORDER BY updated_at DESC LIMIT 200",
          [plugin.id, Object.entries(kinds).filter(([, definition]) => definition.resourceScoped).map(([kind]) => kind)],
        );
        for (const record of records)
          if (await this.canRecord(user, plugin.id, record.kind, record.id, "read")) {
            authorized = true;
            break;
          }
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

  protected definition(plugin: string, kind: string) {
    let registered: PluginDefinition;
    try {
      registered = this.registry.getById(plugin);
    } catch {
      invalid("Tipo de registro não encontrado neste plugin.", 404);
    }
    const definition = registered.contributions?.recordKinds?.[kind] as RecordKindContribution | undefined;
    if (!definition)
      invalid("Tipo de registro não encontrado neste plugin.", 404);
    return definition;
  }

  protected sensitivePaths(plugin: string, kind: string) {
    const definition = this.definition(plugin, kind);
    const paths = definition.sensitiveFields || [];
    const controls = [...(definition.uniqueFields || []), ...(definition.personalOwnerField ? [definition.personalOwnerField] : [])];
    if (controls.some((control) => paths.some((path) => path === control || path.startsWith(`${control}.`) || control.startsWith(`${path}.`))))
      throw new Error("Protected record fields cannot overlap ownership or unique query fields.");
    return paths;
  }

  protected storedPayload(plugin: string, kind: string, recordId: string, revision: number, payload: Payload) {
    return protectRecordPayload(payload, this.sensitivePaths(plugin, kind), { pluginId: plugin, kind, recordId, revision }) as Payload;
  }

  protected readablePayload(plugin: string, kind: string, recordId: string, revision: number, payload: Payload) {
    const readable = unprotectRecordPayload(payload, this.sensitivePaths(plugin, kind), { pluginId: plugin, kind, recordId, revision }) as Payload;
    assertNoProtectedFieldEnvelope(readable);
    return readable;
  }

  protected publicPayload(plugin: string, kind: string, payload: Payload) {
    const sensitive = this.sensitivePaths(plugin, kind);
    const fields = this.definition(plugin, kind).publicRead?.fields || [];
    const projected = Object.fromEntries(protectedProjectionFields(fields, sensitive)
      .filter((field) => Object.hasOwn(payload, field))
      .map((field) => [field, payload[field]])) as Payload;
    assertNoProtectedFieldEnvelope(projected);
    return projected;
  }

  protected readableRecord<T extends ExtensionRecord>(record: T): T {
    return { ...record, payload: this.readablePayload(record.plugin_id, record.kind, record.id, record.revision, record.payload) };
  }

  private readableReference<T extends ResolvedRecordReference>(record: T): T {
    return { ...record, payload: this.readablePayload(record.pluginId, record.kind, record.id, record.revision, record.payload as Payload) };
  }

  private operationValue(plugin: string, value: unknown, action: "seal" | "open"): unknown {
    if (Array.isArray(value)) return value.map((entry) => this.operationValue(plugin, entry, action));
    if (!value || typeof value !== "object" || Buffer.isBuffer(value)) return value;
    const object = value as Record<string, unknown>;
    const idValue = typeof object.id === "string" ? object.id : null;
    const kindValue = typeof object.kind === "string" ? object.kind : null;
    const pluginValue = object.plugin_id === plugin ? plugin : object.pluginId === plugin ? plugin : null;
    const revision = Number(object.revision);
    const payload = object.payload;
    const next = Object.fromEntries(Object.entries(object).map(([key, entry]) => [key, this.operationValue(plugin, entry, action)]));
    if (pluginValue && kindValue && idValue && Number.isInteger(revision) && revision > 0
      && payload && typeof payload === "object" && !Array.isArray(payload)) {
      next.payload = action === "seal"
        ? this.storedPayload(plugin, kindValue, idValue, revision, payload as Payload)
        : this.readablePayload(plugin, kindValue, idValue, revision, payload as Payload);
    }
    return next;
  }

  protected async canRecord(user: string, plugin: string, kind: string, recordId: string, action: string) {
    const delegated = await this.access.authorizeRecord?.(user, plugin, kind, recordId, action) ?? null;
    if (delegated !== null) return delegated;
    const definition = this.definition(plugin, kind);
    if (!definition.resourceScoped)
      return this.access.has(user, `plugin.${plugin}.${action}`, "workspace", (await this.db.one<{ workspace_id: string }>("SELECT workspace_id FROM extension_records WHERE id=$1", [id(recordId)]))?.workspace_id || "");
    if (definition.managePermission && await this.access.has(user, definition.managePermission)) return true;
    if (definition.authorizeRecord) {
      const record = await this.db.one<{ workspace_id: string; state: string; payload: Payload }>(
        "SELECT workspace_id,state,payload FROM extension_records WHERE id=$1 AND plugin_id=$2 AND kind=$3",
        [id(recordId), plugin, kind],
      );
      if (!record) return false;
      return definition.authorizeRecord(
        user,
        action,
        record.state,
        record.payload,
        this.validationContext(record.workspace_id, user, undefined, recordId),
      );
    }
    const record = await this.db.one<{ created_by: string }>(
      "SELECT created_by FROM extension_records WHERE id=$1 AND plugin_id=$2 AND kind=$3",
      [id(recordId), plugin, kind],
    );
    if (!record) return false;
    if (record.created_by === user && await this.access.has(user, `plugin.${plugin}.${action}`)) return true;
    return this.access.hasScoped(user, `plugin.${plugin}.${action}`, "extension_record", recordId);
  }

  protected validationContext(workspace: string, user: string, client?: PoolClient, recordId?: string,
    policyReadTargets: Array<{ pluginId: string; kind: string }> = []): RecordValidationContext {
    return {
      actorId: user,
      recordId,
      nextSequence: async () => {
        if (client)
          return (await client.query<{ value: string }>("SELECT nextval('extension_protocol_seq')::text AS value")).rows[0].value;
        return (await this.db.query<{ value: string }>("SELECT nextval('extension_protocol_seq')::text AS value"))[0].value;
      },
      hasPermission: (permission) => recordId
        ? this.access.has(user, permission, "extension_record", recordId)
        : this.access.has(user, permission),
      hasGlobalPermission: (permission) => this.access.has(user, permission),
      hasWorkspacePermission: (permission) => this.access.has(user, permission, "workspace", workspace),
      hasPermissionOnResource: (permission, targetId) => this.access.hasScoped(user, permission, "extension_record", targetId),
      hasAcceptedTerm: async (termRecordId, revision, acceptedUserId) => {
        if (!Number.isInteger(revision) || revision < 1) return false;
        const sql = "SELECT 1 FROM extension_term_acceptances WHERE record_id=$1 AND revision=$2 AND user_id=$3 LIMIT 1";
        const rows = client
          ? (await client.query(sql, [id(termRecordId), revision, id(acceptedUserId)])).rows
          : await this.db.query(sql, [id(termRecordId), revision, id(acceptedUserId)]);
        return rows.length > 0;
      },
      resolveRecord: async (recordId, revision) => {
        if (!Number.isInteger(revision) || revision < 1) return null;
        const sql = `SELECT r.id,r.plugin_id AS "pluginId",r.kind,v.state,v.revision,v.payload
          FROM extension_records r JOIN extension_record_versions v ON v.record_id=r.id
          WHERE r.id=$1 AND r.workspace_id=$2 AND v.revision=$3`;
        const rows = client
          ? (await client.query<ResolvedRecordReference>(sql, [id(recordId), workspace, revision])).rows
          : await this.db.query<ResolvedRecordReference>(sql, [id(recordId), workspace, revision]);
        const reference = rows[0];
        if (!reference) return null;
        try {
          await this.authorize(reference.pluginId, workspace, user, "read", reference.kind, reference.id);
        } catch {
          const publicRead = this.definition(reference.pluginId, reference.kind).publicRead;
          if (!publicRead?.states.includes(reference.state)) return null;
          return { ...reference, payload: this.publicPayload(reference.pluginId, reference.kind, reference.payload as Payload) };
        }
        return this.readableReference(reference);
      },
      listCurrentRecordAttachments: async () => {
        if (!recordId) return null;
        const availableSql = "SELECT to_regclass('extension_record_attachments') IS NOT NULL AS available";
        const available = client
          ? (await client.query<{ available: boolean }>(availableSql)).rows[0]?.available
          : (await this.db.one<{ available: boolean }>(availableSql))?.available;
        if (!available) return null;
        const sql = `SELECT a.mime_type FROM extension_record_attachments a
          JOIN extension_records r ON r.id=a.record_id
          WHERE r.id=$1 AND r.workspace_id=$2
            AND a.revision=(SELECT max(v.revision) FROM extension_record_versions v WHERE v.record_id=r.id)
          ORDER BY a.created_at,a.id`;
        return client
          ? (await client.query<{ mime_type: string }>(sql, [recordId, workspace])).rows
          : await this.db.query<{ mime_type: string }>(sql, [recordId, workspace]);
      },
      resolveLatestRecord: async (recordId) => {
        const sql = `SELECT r.id,r.plugin_id AS "pluginId",r.kind,v.state,v.revision,v.payload
          FROM extension_records r JOIN extension_record_versions v ON v.record_id=r.id
          WHERE r.id=$1 AND r.workspace_id=$2
          ORDER BY v.revision DESC LIMIT 1`;
        const rows = client
          ? (await client.query<ResolvedRecordReference>(sql, [id(recordId), workspace])).rows
          : await this.db.query<ResolvedRecordReference>(sql, [id(recordId), workspace]);
        const reference = rows[0];
        if (!reference) return null;
        try {
          await this.authorize(reference.pluginId, workspace, user, "read", reference.kind, reference.id);
        } catch {
          const publicRead = this.definition(reference.pluginId, reference.kind).publicRead;
          if (!publicRead?.states.includes(reference.state)) return null;
          return { ...reference, payload: this.publicPayload(reference.pluginId, reference.kind, reference.payload as Payload) };
        }
        return this.readableReference(reference);
      },
      countLatestRecordsByPayloadValue: async (pluginId, kind, state, field, value, lockScope, excludeRecordId) => {
        if (!this.registry.isEnabled(pluginId) || !/^[a-z][a-z0-9_]{0,79}$/.test(field) || !/^[a-fA-F0-9-]{36}$/.test(value)) return null;
        if (lockScope) {
          const lockSql = "SELECT pg_advisory_xact_lock(hashtextextended($1::text || ':' || $2::text, 0))";
          if (client) await client.query(lockSql, [workspace, lockScope]);
          else await this.db.query(lockSql, [workspace, lockScope]);
        }
        const sql = `WITH latest AS (
          SELECT DISTINCT ON (r.id) v.state,v.payload
          FROM extension_records r JOIN extension_record_versions v ON v.record_id=r.id
          WHERE r.workspace_id=$1 AND r.plugin_id=$2 AND r.kind=$3 AND ($7::uuid IS NULL OR r.id<>$7::uuid)
          ORDER BY r.id,v.revision DESC
        )
        SELECT COUNT(*)::int AS count FROM latest
        WHERE state=$4 AND (payload->$5=to_jsonb($6::text) OR payload->$5 @> jsonb_build_array($6::text))`;
        const rows = client
          ? (await client.query<{ count: number }>(sql, [workspace, pluginId, kind, state, field, id(value), excludeRecordId ? id(excludeRecordId) : null])).rows
          : await this.db.query<{ count: number }>(sql, [workspace, pluginId, kind, state, field, id(value), excludeRecordId ? id(excludeRecordId) : null]);
        return Number(rows[0]?.count ?? 0);
      },
      countLatestRecordsMatchingPayload: async (pluginId, kind, state, match, lockScope, excludeRecordId) => {
        if (!this.registry.isEnabled(pluginId) || !Object.keys(match).length
          || Object.keys(match).some((field) => !/^[a-z][a-z0-9_]{0,79}$/.test(field))
          || Object.values(match).some((value) => typeof value !== "string")) return null;
        if (lockScope) {
          const lockSql = "SELECT pg_advisory_xact_lock(hashtextextended($1::text || ':' || $2::text, 0))";
          if (client) await client.query(lockSql, [workspace, lockScope]);
          else await this.db.query(lockSql, [workspace, lockScope]);
        }
        const sql = `WITH latest AS (
          SELECT DISTINCT ON (r.id) v.state,v.payload
          FROM extension_records r JOIN extension_record_versions v ON v.record_id=r.id
          WHERE r.workspace_id=$1 AND r.plugin_id=$2 AND r.kind=$3 AND ($6::uuid IS NULL OR r.id<>$6::uuid)
          ORDER BY r.id,v.revision DESC
        ) SELECT COUNT(*)::int AS count FROM latest WHERE state=$4 AND payload @> $5::jsonb`;
        const matchJson = JSON.stringify(match);
        const rows = client
          ? (await client.query<{ count: number }>(sql, [workspace, pluginId, kind, state, matchJson, excludeRecordId ? id(excludeRecordId) : null])).rows
          : await this.db.query<{ count: number }>(sql, [workspace, pluginId, kind, state, matchJson, excludeRecordId ? id(excludeRecordId) : null]);
        return Number(rows[0]?.count ?? 0);
      },
      aggregateLatestNumericArrayValues: async (pluginId, kind, state, parentField, parentId, arrayField, keyField, valueField) => {
        const fields = [parentField, arrayField, keyField, valueField];
        if (!this.registry.isEnabled(pluginId) || !/^[a-z][a-z0-9_-]{0,79}$/.test(kind)
          || typeof state !== "string" || !state || state.length > 80
          || fields.some((field) => !/^[a-z][a-z0-9_]{0,79}$/.test(field))) return null;
        const targetId = id(parentId);
        const values = [workspace, pluginId, kind, state, parentField, targetId, arrayField, keyField, valueField];
        const countSql = `SELECT COUNT(*)::int AS count FROM extension_records
          WHERE workspace_id=$1 AND plugin_id=$2 AND kind=$3 AND state=$4 AND payload->$5=to_jsonb($6::text)`;
        const groupsSql = `SELECT answer.item->>$8 AS key,COUNT(*)::int AS count,
            AVG((answer.item->>$9)::numeric)::float8 AS average
          FROM extension_records r
          CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.payload->$7)='array'
            THEN r.payload->$7 ELSE '[]'::jsonb END) AS answer(item)
          WHERE r.workspace_id=$1 AND r.plugin_id=$2 AND r.kind=$3 AND r.state=$4
            AND r.payload->$5=to_jsonb($6::text) AND jsonb_typeof(answer.item->$9)='number'
            AND answer.item->>$8 IS NOT NULL
          GROUP BY answer.item->>$8 ORDER BY answer.item->>$8`;
        const [counts, groups] = client
          ? await Promise.all([
            client.query<{ count: number }>(countSql, values.slice(0, 6)).then((result) => result.rows),
            client.query<{ key: string; count: number; average: number }>(groupsSql, values).then((result) => result.rows),
          ])
          : await Promise.all([
            this.db.query<{ count: number }>(countSql, values.slice(0, 6)),
            this.db.query<{ key: string; count: number; average: number }>(groupsSql, values),
          ]);
        return { recordCount: Number(counts[0]?.count || 0),
          groups: groups.map((group) => ({ key: String(group.key), count: Number(group.count), average: Number(group.average) })) };
      },
      listLatestRecords: async (pluginId, kind, match, state, limit = 500, lockScope) => {
        if (!this.registry.isEnabled(pluginId) || !/^[a-z][a-z0-9_-]{0,79}$/.test(kind)
          || Object.keys(match).some((field) => !/^[a-z][a-z0-9_]{0,79}$/.test(field))
          || Object.values(match).some((value) => typeof value !== "string")
          || state !== undefined && (typeof state !== "string" || state.length > 80)
          || !Number.isInteger(limit) || limit < 1 || lockScope !== undefined && (typeof lockScope !== "string" || lockScope.length > 200)) return null;
        if (lockScope) {
          const lockSql = "SELECT pg_advisory_xact_lock(hashtextextended($1::text || ':' || $2::text, 0))";
          if (client) await client.query(lockSql, [workspace, lockScope]);
          else await this.db.query(lockSql, [workspace, lockScope]);
        }
        const rows = client
          ? (await client.query<ResolvedRecordReference>(
            `SELECT id,plugin_id AS "pluginId",kind,state,revision,payload FROM extension_records
             WHERE workspace_id=$1 AND plugin_id=$2 AND kind=$3 AND ($4::text IS NULL OR state=$4)
               AND payload @> $5::jsonb ORDER BY updated_at,id LIMIT $6`,
            [workspace, pluginId, kind, state ?? null, JSON.stringify(match), Math.min(limit, 1000)],
          )).rows
          : await this.db.query<ResolvedRecordReference>(
            `SELECT id,plugin_id AS "pluginId",kind,state,revision,payload FROM extension_records
             WHERE workspace_id=$1 AND plugin_id=$2 AND kind=$3 AND ($4::text IS NULL OR state=$4)
               AND payload @> $5::jsonb ORDER BY updated_at,id LIMIT $6`,
            [workspace, pluginId, kind, state ?? null, JSON.stringify(match), Math.min(limit, 1000)],
          );
        const readable: ResolvedRecordReference[] = [];
        for (const row of rows) {
          if (await this.canRecord(user, pluginId, row.kind, row.id, "read")) readable.push(this.readableReference(row));
          else {
            const redacted = redactProtectedPaths(row.payload as Payload, this.sensitivePaths(pluginId, row.kind));
            assertNoProtectedFieldEnvelope(redacted);
            readable.push({ ...row, payload: redacted });
          }
        }
        return readable;
      },
      listPolicyLinkedRecords: async (pluginId, kind, match, state, limit = 500, lockScope) => {
        if (!policyReadTargets.some((target) => target.pluginId === pluginId && target.kind === kind)
          || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(pluginId)
          || !/^[a-z][a-z0-9_-]{0,79}$/.test(kind)
          || Object.keys(match).some((field) => !/^[a-z][a-z0-9_]{0,79}$/.test(field))
          || Object.values(match).some((value) => typeof value !== "string")
          || state !== undefined && (typeof state !== "string" || state.length > 80)
          || !Number.isInteger(limit) || limit < 1 || lockScope !== undefined && (typeof lockScope !== "string" || lockScope.length > 200)) return null;
        if (lockScope) {
          const lockSql = "SELECT pg_advisory_xact_lock(hashtextextended($1::text || ':' || $2::text, 0))";
          if (client) await client.query(lockSql, [workspace, lockScope]);
          else await this.db.query(lockSql, [workspace, lockScope]);
        }
        const sql = `SELECT id,plugin_id AS "pluginId",kind,state,revision,'{}'::jsonb AS payload FROM extension_records
          WHERE workspace_id=$1 AND plugin_id=$2 AND kind=$3 AND ($4::text IS NULL OR state=$4)
            AND payload @> $5::jsonb ORDER BY updated_at,id LIMIT $6`;
        return client
          ? (await client.query<ResolvedRecordReference>(sql, [workspace, pluginId, kind, state ?? null, JSON.stringify(match), Math.min(limit, 1000)])).rows
          : await this.db.query<ResolvedRecordReference>(sql, [workspace, pluginId, kind, state ?? null, JSON.stringify(match), Math.min(limit, 1000)]);
      },
      nextLatestRecordOrdinal: async (pluginId, kind, state, field, match, lockScope, excludeRecordId) => {
        if (!this.registry.isEnabled(pluginId) || !/^[a-z][a-z0-9_]{0,79}$/.test(field) || !Object.keys(match).length
          || Object.keys(match).some((key) => !/^[a-z][a-z0-9_]{0,79}$/.test(key))
          || Object.values(match).some((value) => typeof value !== "string")) return null;
        if (lockScope) {
          const lockSql = "SELECT pg_advisory_xact_lock(hashtextextended($1::text || ':' || $2::text, 0))";
          if (client) await client.query(lockSql, [workspace, lockScope]);
          else await this.db.query(lockSql, [workspace, lockScope]);
        }
        const sql = `WITH latest AS (
          SELECT DISTINCT ON (r.id) v.state,v.payload
          FROM extension_records r JOIN extension_record_versions v ON v.record_id=r.id
          WHERE r.workspace_id=$1 AND r.plugin_id=$2 AND r.kind=$3 AND ($7::uuid IS NULL OR r.id<>$7::uuid)
          ORDER BY r.id,v.revision DESC
        ) SELECT COALESCE(MAX(CASE WHEN jsonb_typeof(payload->$5)='number' AND (payload->>$5) ~ '^[0-9]{1,9}$'
          THEN (payload->>$5)::integer ELSE NULL END),0)+1 AS next
          FROM latest WHERE state=$4 AND payload @> $6::jsonb`;
        const rows = client
          ? (await client.query<{ next: number }>(sql, [workspace, pluginId, kind, state, field, JSON.stringify(match), excludeRecordId ? id(excludeRecordId) : null])).rows
          : await this.db.query<{ next: number }>(sql, [workspace, pluginId, kind, state, field, JSON.stringify(match), excludeRecordId ? id(excludeRecordId) : null]);
        return Number(rows[0]?.next ?? 1);
      },
      isRecordOwner: async (targetId, ownerId) => {
        const sql = "SELECT created_by FROM extension_records WHERE id=$1 AND workspace_id=$2 LIMIT 1";
        const rows = client
          ? (await client.query<{ created_by: string }>(sql, [id(targetId), workspace])).rows
          : await this.db.query<{ created_by: string }>(sql, [id(targetId), workspace]);
        return rows[0]?.created_by === id(ownerId);
      },
    };
  }

  private selfServiceAccessPolicies(plugin: string, kind: string): RecordAccessPolicy[] {
    return this.registry.list().flatMap((owner) => (owner.recordAccessPolicies || []).filter((policy) =>
      policy.targetPluginId === plugin && policy.targetKind === kind
      && (this.registry.isEnabled(owner.id) || policy.enforceWhenDisabled === true)));
  }

  protected async validateSelfServiceSubmitPolicies(plugin: string, kind: string, payload: Payload,
    workspace: string, user: string, client: PoolClient, required = false) {
    const policies = this.selfServiceAccessPolicies(plugin, kind).filter((policy) => policy.validateSelfServiceSubmit);
    if (required && !policies.length) invalid("Não foi possível verificar as regras de autoinscrição desta turma.", 503);
    for (const policy of policies) {
      let issues: RecordValidationIssue[];
      try {
        issues = await policy.validateSelfServiceSubmit!(payload,
          this.validationContext(workspace, user, client, undefined, policy.policyReadTargets || []));
      } catch {
        invalid("Não foi possível verificar as regras de autoinscrição desta turma.", 503);
      }
      if (!Array.isArray(issues) || issues.some((issue) => !issue || !["error", "warning"].includes(issue.severity)
        || typeof issue.path !== "string" || typeof issue.message !== "string" || typeof issue.code !== "string"))
        invalid("A política de autoinscrição retornou uma resposta inválida.", 503);
      assertSemanticValidation(issues);
    }
  }

  protected async authorize(
    plugin: string,
    workspace: string,
    user: string,
    action = "read",
    kind?: string,
    recordId?: string,
    createPayload?: Payload,
  ) {
    let registered: PluginDefinition;
    try {
      registered = this.registry.getById(plugin);
    } catch {
      invalid("Plugin ou dependência desativada.", 409);
    }
    if (!registered.contributions?.recordKinds || !this.registry.isEnabled(plugin))
      invalid("Plugin ou dependência desativada.", 409);
    if (
      !(await this.db.one(
        "SELECT id FROM workspaces WHERE id=$1 AND archived_at IS NULL",
        [id(workspace)],
      ))
    )
      invalid("Workspace não encontrado ou arquivado.", 404);
    const definition = kind ? this.definition(plugin, kind) : undefined;
    if (definition?.resourceScoped) {
      if (recordId) {
        if (await this.canRecord(user, plugin, kind!, recordId, action)) return;
        if (definition.authorizeRecord) {
          await this.access.audit(user, "access.denied", `plugin.${plugin}.${action}`, { type: "extension_record", id: recordId });
          invalid("Acesso não autorizado a este registro.", 403);
        }
        await this.access.requireScoped(user, `plugin.${plugin}.${action}`, "extension_record", recordId);
        return;
      }
      if (definition.managePermission && await this.access.has(user, definition.managePermission)) return;
      if (createPayload && definition.authorizeCreate) {
        if (await definition.authorizeCreate(user, createPayload, this.validationContext(workspace, user))) return;
        invalid("Acesso não autorizado para criar este registro.", 403);
      }
      await this.access.require(user, `plugin.${plugin}.write`);
      return;
    }
    await this.access.require(
      user,
      `plugin.${plugin}.${action}`,
      "workspace",
      workspace,
    );
  }

  async list(plugin: string, workspace: string, user: string) {
    const registered = this.registry.getById(plugin);
    if (!registered.contributions?.recordKinds || !this.registry.isEnabled(plugin))
      invalid("Plugin ou dependência desativada.", 409);
    if (!(await this.db.one("SELECT id FROM workspaces WHERE id=$1 AND archived_at IS NULL", [id(workspace)])))
      invalid("Workspace não encontrado ou arquivado.", 404);
    const visible: ExtensionRecord[] = [];
    let cursorUpdatedAt: string | null = null;
    let cursorId: string | null = null;
    const pageSize = 100;
    while (visible.length < pageSize) {
      const records: Array<ExtensionRecord & { cursor_updated_at: string }> = await this.db.query<ExtensionRecord & { cursor_updated_at: string }>(
        `SELECT extension_records.*,extension_records.updated_at::text AS cursor_updated_at FROM extension_records
         WHERE workspace_id=$1 AND plugin_id=$2
           AND ($3::timestamptz IS NULL OR (extension_records.updated_at,extension_records.id)<($3::timestamptz,$4::uuid))
         ORDER BY extension_records.updated_at DESC,extension_records.id DESC LIMIT $5`,
        [workspace, plugin, cursorUpdatedAt, cursorId, pageSize],
      );
      for (const row of records) {
        const record = { ...row } as ExtensionRecord & { cursor_updated_at?: string };
        delete record.cursor_updated_at;
        if (await this.canRecord(user, plugin, record.kind, record.id, "read")) {
          visible.push(this.readableRecord(record));
          if (this.definition(plugin, record.kind).resourceScoped)
            await this.access.audit(user, `${plugin}.record.read`, record.id, { type: "extension_record", id: record.id });
          if (visible.length === pageSize) break;
        }
      }
      if (records.length < pageSize || visible.length === pageSize) break;
      const last = records[records.length - 1]!;
      cursorUpdatedAt = last.cursor_updated_at;
      cursorId = last.id;
    }
    return visible;
  }

  async mine(plugin: string, kind: string, user: string) {
    const registered = this.registry.getById(plugin);
    if (!registered.contributions?.recordKinds || !this.registry.isEnabled(plugin))
      invalid("Plugin ou dependência desativada.", 409);
    const definition = this.definition(plugin, kind);
    const ownerField = definition.personalOwnerField;
    if (!definition.resourceScoped || !ownerField || !/^[a-z][a-z0-9_]{0,79}$/.test(ownerField)
      || !Object.hasOwn((definition.schema.properties || {}) as object, ownerField))
      invalid("Este tipo não possui registros pessoais.", 404);
    const records = await this.db.query<ExtensionRecord>(
      "SELECT * FROM extension_records WHERE plugin_id=$1 AND kind=$2 AND payload->>$3=$4 ORDER BY updated_at DESC,id",
      [plugin, kind, ownerField, id(user)],
    );
    const visible: ExtensionRecord[] = [];
    for (const record of records) {
      if (record.payload[ownerField] !== user || !(await this.canRecord(user, plugin, kind, record.id, "read"))) continue;
      visible.push(this.readableRecord(record));
      await this.access.audit(user, `${plugin}.record.read`, record.id, { type: "extension_record", id: record.id });
    }
    return visible;
  }

  protected async storeRecordAttachments(client: PoolClient, recordId: string, revision: number, user: string,
    files: Array<ReturnType<typeof decodeDocument> & { id: string; scan_status: "clean" | "not_configured"; alt_text?: string }>) {
    const owner = (await client.query<{ plugin_id: string; kind: string }>(
      "SELECT plugin_id,kind FROM extension_records WHERE id=$1 FOR SHARE", [recordId],
    )).rows[0];
    if (!owner) throw new Error("Attachment owner record is missing.");
    const protect = this.definition(owner.plugin_id, owner.kind).sensitiveAttachments === true;
    for (const file of files) {
      const data = protect ? sealProtectedAttachment(file.data, {
        pluginId: owner.plugin_id, kind: owner.kind, recordId, revision, attachmentId: file.id,
        fileName: file.file_name, mimeType: file.mime_type, sha256: file.sha256,
      }) : file.data;
      await client.query(
        "INSERT INTO extension_record_attachments(id,record_id,revision,file_name,mime_type,size_bytes,sha256,scan_status,data,uploaded_by,alt_text) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [file.id, recordId, revision, file.file_name, file.mime_type, file.size_bytes, file.sha256, file.scan_status, data, user, file.alt_text || ""],
      );
    }
  }

  protected async carryRecordAttachments(client: PoolClient, recordId: string, fromRevision: number, toRevision: number, altTextOverride?: { attachmentId: string; altText: string }) {
    const owner = (await client.query<{ plugin_id: string; kind: string }>(
      "SELECT plugin_id,kind FROM extension_records WHERE id=$1 FOR SHARE", [recordId],
    )).rows[0];
    if (!owner) throw new Error("Attachment owner record is missing.");
    const protect = this.definition(owner.plugin_id, owner.kind).sensitiveAttachments === true;
    const files = await client.query<{ id: string; file_name: string; mime_type: string; size_bytes: number; sha256: string; scan_status: string; data: Buffer; uploaded_by: string; alt_text: string }>(
      "SELECT id,file_name,mime_type,size_bytes,sha256,scan_status,data,uploaded_by,alt_text FROM extension_record_attachments WHERE record_id=$1 AND revision=$2 ORDER BY created_at,id",
      [recordId, fromRevision],
    );
    const copiedIds = new Map<string, string>();
    for (const file of files.rows) {
      const sourceContext = { pluginId: owner.plugin_id, kind: owner.kind, recordId, revision: fromRevision,
        attachmentId: file.id, fileName: file.file_name, mimeType: file.mime_type, sha256: file.sha256 };
      const plain = protect || isProtectedAttachmentEnvelope(file.data) ? openProtectedAttachment(file.data, sourceContext) : file.data;
      const attachmentId = randomUUID();
      const data = protect ? sealProtectedAttachment(plain, { ...sourceContext, revision: toRevision, attachmentId }) : plain;
      await client.query(
        "INSERT INTO extension_record_attachments(id,record_id,revision,file_name,mime_type,size_bytes,sha256,scan_status,data,uploaded_by,alt_text) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [attachmentId, recordId, toRevision, file.file_name, file.mime_type, file.size_bytes, file.sha256, file.scan_status, data, file.uploaded_by, file.id === altTextOverride?.attachmentId ? altTextOverride.altText : file.alt_text || ""],
      );
      copiedIds.set(file.id, attachmentId);
    }
    return copiedIds;
  }

  async downloadRecordAttachment(plugin: string, recordId: string, revision: number, attachmentId: string, user: string, action: "read" | "preview" = "read") {
    if (!Number.isInteger(revision) || revision < 1) invalid("Versão de registro inválida.", 400);
    const record = await this.db.one<ExtensionRecord>("SELECT * FROM extension_records WHERE id=$1 AND plugin_id=$2", [id(recordId), plugin]);
    if (!record) invalid("Registro não encontrado.", 404);
    if (!this.registry.isEnabled(plugin)) invalid("Plugin ou dependência desativada.", 409);
    if (!(await this.db.one("SELECT id FROM workspaces WHERE id=$1 AND archived_at IS NULL", [record.workspace_id])) && record.workspace_id)
      invalid("Workspace não encontrado ou arquivado.", 404);
    const definition = this.definition(record.plugin_id, record.kind);
    const version = await this.db.one<{ state: string; payload: Payload }>(
      "SELECT state,payload FROM extension_record_versions WHERE record_id=$1 AND revision=$2",
      [record.id, revision],
    );
    if (!version) invalid("Versão de registro não encontrada.", 404);
    const context = this.validationContext(record.workspace_id, user, undefined, record.id);
    const permitted = definition.authorizeAttachment
      ? await definition.authorizeAttachment(user, action, version.state, version.payload, context)
      : (await this.authorize(plugin, record.workspace_id, user, "read", record.kind, record.id), action === "read");
    if (!permitted) {
      await this.access.audit(user, "access.denied", `${plugin}.attachment.read`, { type: "extension_record", id: record.id });
      invalid("Acesso não autorizado a este anexo.", 403);
    }
    const file = await this.db.one<{ data: Buffer; sha256: string; file_name: string; mime_type: string }>(
      "SELECT data,sha256,file_name,mime_type FROM extension_record_attachments WHERE record_id=$1 AND revision=$2 AND id=$3",
      [record.id, revision, id(attachmentId)],
    );
    if (!file)
      invalid("Anexo não encontrado ou com falha de integridade.", 404);
    const attachmentContext = { pluginId: record.plugin_id, kind: record.kind, recordId: record.id, revision,
      attachmentId: id(attachmentId), fileName: file.file_name, mimeType: file.mime_type, sha256: file.sha256 };
    const data = isProtectedAttachmentEnvelope(file.data) ? openProtectedAttachment(file.data, attachmentContext) : file.data;
    if (createHash("sha256").update(data).digest("hex") !== file.sha256)
      invalid("Anexo não encontrado ou com falha de integridade.", 404);
    await this.access.audit(user, `${plugin}.attachment.read`, record.id, { type: "extension_record", id: record.id });
    return { data, file_name: file.file_name, mime_type: file.mime_type };
  }

  async publicList(plugin: string, kind: string) {
    const registered = this.registry.getById(plugin);
    if (!registered.contributions?.recordKinds || !this.registry.isEnabled(plugin))
      invalid("Plugin ou dependência desativada.", 409);
    const publicRead = this.definition(plugin, kind).publicRead;
    if (!publicRead || !publicRead.states.length || !publicRead.fields.length)
      invalid("Este tipo de registro não possui uma projeção pública.", 404);
    const rows = await this.db.query<ExtensionRecord & { workspace_name: string }>(
      `SELECT r.*,w.name AS workspace_name FROM extension_records r
       JOIN workspaces w ON w.id=r.workspace_id AND w.archived_at IS NULL
       WHERE r.plugin_id=$1 AND r.kind=$2 AND r.state=ANY($3::text[])
       ORDER BY r.updated_at DESC,r.id LIMIT 500`,
      [plugin, kind, publicRead.states],
    );
    const visibleRows = await this.applyPublicRecordPolicies(plugin, kind, rows);
    return visibleRows.map((record) => ({
      id: record.id,
      workspace_id: record.workspace_id,
      workspace_name: record.workspace_name,
      kind: record.kind,
      title: record.title,
      state: record.state,
      revision: record.revision,
      payload: this.publicPayload(plugin, kind, record.payload),
    }));
  }

  async publicDetail(plugin: string, kind: string, recordId: string) {
    const registered = this.registry.getById(plugin);
    if (!registered.contributions?.recordKinds || !this.registry.isEnabled(plugin))
      invalid("Plugin ou dependência desativada.", 409);
    const publicRead = this.definition(plugin, kind).publicRead;
    if (!publicRead || !publicRead.states.length || !publicRead.fields.length)
      invalid("Este tipo de registro não possui uma projeção pública.", 404);
    const record = await this.db.one<ExtensionRecord & { workspace_name: string }>(
      `SELECT r.*,w.name AS workspace_name FROM extension_records r
       JOIN workspaces w ON w.id=r.workspace_id AND w.archived_at IS NULL
       WHERE r.id=$1 AND r.plugin_id=$2 AND r.kind=$3 AND r.state=ANY($4::text[])`,
      [id(recordId), plugin, kind, publicRead.states],
    );
    if (!record) invalid("Curso não encontrado ou indisponível.", 404);
    return {
      id: record.id,
      workspace_id: record.workspace_id,
      workspace_name: record.workspace_name,
      kind: record.kind,
      title: record.title,
      state: record.state,
      revision: record.revision,
      payload: this.publicPayload(plugin, kind, record.payload),
    };
  }

  async publicRelatedList(plugin: string, parentKind: string, parentId: string, kind: string, relationField: string) {
    const registered = this.registry.getById(plugin);
    const kinds = registered.contributions?.recordKinds;
    if (!kinds || !this.registry.isEnabled(plugin)) invalid("Plugin ou dependência desativada.", 409);
    const parentDefinition = this.definition(plugin, parentKind);
    const childDefinition = this.definition(plugin, kind);
    const parentPublicRead = parentDefinition.publicRead;
    const childPublicRead = childDefinition.publicRead;
    const relation = (childDefinition.schema.properties as Record<string, Record<string, unknown>> | undefined)?.[relationField];
    if (!parentPublicRead?.states.length || !childPublicRead?.states.length || relation?.recordKind !== parentKind
      || !/^[a-z][a-z0-9_]{0,79}$/.test(relationField))
      invalid("A relação não possui uma projeção pública válida.", 404);
    const parent = await this.db.one<{ workspace_id: string; revision: number; workspace_name: string }>(
      `SELECT r.workspace_id,r.revision,w.name AS workspace_name FROM extension_records r
       JOIN workspaces w ON w.id=r.workspace_id AND w.archived_at IS NULL
       WHERE r.id=$1 AND r.plugin_id=$2 AND r.kind=$3 AND r.state=ANY($4::text[])`,
      [id(parentId), plugin, parentKind, parentPublicRead.states],
    );
    if (!parent) invalid("Registro relacionado não encontrado ou indisponível.", 404);
    const revisionField = typeof relation.recordRevisionField === "string" ? relation.recordRevisionField : null;
    const seatAvailability = childDefinition.seatAvailability;
    const reservationDefinition = seatAvailability ? kinds[seatAvailability.reservationKind] : null;
    const reservationRelation = seatAvailability
      ? (reservationDefinition?.schema.properties as Record<string, Record<string, unknown>> | undefined)?.[seatAvailability.relationField]
      : null;
    const capacityProperty = seatAvailability
      ? (childDefinition.schema.properties as Record<string, Record<string, unknown>> | undefined)?.[seatAvailability.capacityField]
      : null;
    if (seatAvailability && (!reservationDefinition || !reservationDefinition.resourceScoped
      || reservationRelation?.recordKind !== kind
      || !capacityProperty
      || childPublicRead.fields.includes(seatAvailability.outputField)
      || !seatAvailability.reservedStates.every((state) => Object.hasOwn(reservationDefinition.transitions, state))
      || !/^[a-z][a-z0-9_]{0,79}$/.test(seatAvailability.capacityField)
      || !/^[a-z][a-z0-9_]{0,79}$/.test(seatAvailability.relationField)
      || !/^[a-z][a-z0-9_]{0,79}$/.test(seatAvailability.outputField)))
      invalid("A disponibilidade de vagas não possui uma definição válida.", 409);
    let capacityProjection = "";
    const values: unknown[] = [parent.workspace_id, plugin, kind, childPublicRead.states, relationField, parentId];
    if (revisionField) {
      const revisionPlaceholder = values.length + 1;
      values.push(revisionField, parent.revision);
      capacityProjection = `AND r.payload->>$${revisionPlaceholder}=($${revisionPlaceholder + 1}::integer)::text`;
    }
    const seatProjection = seatAvailability ? (() => {
      const capFieldParam = values.push(seatAvailability.capacityField);
      const reservationKindParam = values.push(seatAvailability.reservationKind);
      const reservedStatesParam = values.push(seatAvailability.reservedStates);
      const reservationRelationParam = values.push(seatAvailability.relationField);
      return `,GREATEST(COALESCE(NULLIF(r.payload->>$${capFieldParam},'')::integer,0)-COALESCE((
        SELECT COUNT(*)::integer FROM extension_records e
        WHERE e.workspace_id=r.workspace_id AND e.plugin_id=$2 AND e.kind=$${reservationKindParam}
          AND e.state=ANY($${reservedStatesParam}::text[]) AND e.payload->>$${reservationRelationParam}=r.id::text
      ),0),0)::integer AS seats_remaining`;
    })() : "";
    const rows = await this.db.query<ExtensionRecord & { seats_remaining?: number }>(
      `SELECT r.*${seatProjection} FROM extension_records r
       WHERE r.workspace_id=$1 AND r.plugin_id=$2 AND r.kind=$3 AND r.state=ANY($4::text[])
         AND r.payload->>$5=$6 ${capacityProjection}
       ORDER BY r.updated_at,r.id LIMIT 100`,
      values,
    );
    const visibleRows = await this.applyPublicRecordPolicies(plugin, kind, rows, parent.workspace_id);
    return visibleRows.map((record) => ({
      id: record.id,
      workspace_id: record.workspace_id,
      workspace_name: parent.workspace_name,
      kind: record.kind,
      title: record.title,
      state: record.state,
      revision: record.revision,
      payload: {
        ...this.publicPayload(plugin, kind, record.payload),
        ...(seatAvailability ? { [seatAvailability.outputField]: record.seats_remaining ?? 0 } : {}),
      },
    }));
  }

  private async applyPublicRecordPolicies<T extends ExtensionRecord>(plugin: string, kind: string, rows: T[], workspace?: string): Promise<T[]> {
    const policies = this.selfServiceAccessPolicies(plugin, kind).filter((policy) => policy.isPubliclyAvailable);
    if (!policies.length || !rows.length) return rows;
    const result: T[] = [];
    for (const row of rows) {
      const reference: ResolvedRecordReference = { id: row.id, pluginId: row.plugin_id, kind: row.kind,
        state: row.state, revision: row.revision, payload: row.payload };
      let visible = true;
      for (const policy of policies) {
        const context = this.validationContext(workspace || row.workspace_id, "", undefined, undefined, policy.policyReadTargets || []);
        try { if (!await policy.isPubliclyAvailable!(reference, context)) { visible = false; break; } }
        catch { visible = false; break; }
      }
      if (visible) result.push(row);
    }
    return result;
  }

  async summary(plugin: string, workspace: string, user: string) {
    const registered = this.registry.getById(plugin);
    if (!registered.contributions?.recordKinds || !this.registry.isEnabled(plugin))
      invalid("Plugin ou dependência desativada.", 409);
    if (!(await this.db.one("SELECT id FROM workspaces WHERE id=$1 AND archived_at IS NULL", [id(workspace)])))
      invalid("Workspace não encontrado ou arquivado.", 404);
    const counts = new Map<string, { kind: string; state: string; count: number }>();
    const kinds = registered.contributions.recordKinds;
    const workspaceRead = await this.access.has(user, `plugin.${plugin}.read`, "workspace", workspace)
      || await this.access.has(user, `plugin.${plugin}.read`);
    const ordinaryKinds = Object.entries(kinds).filter(([, definition]) => !definition.resourceScoped).map(([kind]) => kind);
    if (workspaceRead && ordinaryKinds.length) {
      const grouped = await this.db.query<{ kind: string; state: string; count: string }>(
        "SELECT kind,state,count(*)::text AS count FROM extension_records WHERE workspace_id=$1 AND plugin_id=$2 AND kind=ANY($3::text[]) GROUP BY kind,state",
        [workspace, plugin, ordinaryKinds],
      );
      for (const row of grouped) counts.set(`${row.kind}:${row.state}`, { kind: row.kind, state: row.state, count: Number(row.count) });
    }
    const privateKinds = Object.entries(kinds).filter(([, definition]) => definition.resourceScoped).map(([kind]) => kind);
    if (!privateKinds.length) return { counts: [...counts.values()] };
    const records = await this.db.query<{ id: string; kind: string; state: string }>(
      "SELECT id,kind,state FROM extension_records WHERE workspace_id=$1 AND plugin_id=$2 AND kind=ANY($3::text[]) ORDER BY kind,state,id",
      [workspace, plugin, privateKinds],
    );
    for (const record of records) {
      if (!(await this.canRecord(user, plugin, record.kind, record.id, "read"))) continue;
      const key = `${record.kind}:${record.state}`;
      const row = counts.get(key) || { kind: record.kind, state: record.state, count: 0 };
      row.count += 1;
      counts.set(key, row);
    }
    return { counts: [...counts.values()] };
  }

  async permissions(plugin: string, workspace: string, user: string) {
    const registered = this.registry.getById(plugin);
    if (!registered.contributions?.recordKinds || !this.registry.isEnabled(plugin))
      invalid("Plugin ou dependência desativada.", 409);
    if (!(await this.db.one("SELECT id FROM workspaces WHERE id=$1 AND archived_at IS NULL", [id(workspace)])))
      invalid("Workspace não encontrado ou arquivado.", 404);
    const kinds = Object.values(registered.contributions.recordKinds);
    const recordScopedOnly = kinds.length > 0 && kinds.every((definition) => definition.resourceScoped);
    const scopeType = recordScopedOnly ? "global" : "workspace";
    const scopeId = recordScopedOnly ? "*" : workspace;
    const managesRecords = (await Promise.all(kinds.map((definition) =>
      definition.managePermission ? this.access.has(user, definition.managePermission) : false,
    ))).some(Boolean);
    return {
      write: managesRecords || await this.access.has(
        user,
        `plugin.${plugin}.write`,
        scopeType,
        scopeId,
      ),
      publish: managesRecords || await this.access.has(
        user,
        `plugin.${plugin}.publish`,
        scopeType,
        scopeId,
      ),
    };
  }

  protected async record(
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
    await this.authorize(plugin, record.workspace_id, user, action, record.kind, record.id);
    if (action === "read" && this.definition(plugin, record.kind).resourceScoped)
      await this.access.audit(user, `${plugin}.record.read`, record.id, { type: "extension_record", id: record.id });
    return this.readableRecord(record);
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
    const context = this.validationContext(record.workspace_id, user, undefined, record.id);
    const validationIssues = await definition.validate?.(record.payload, context) || [];
    const recordPermissions = {
      write: await this.canRecord(user, plugin, record.kind, record.id, "write"),
      publish: await this.canRecord(user, plugin, record.kind, record.id, "publish"),
    };
    let nextStates = definition.availableTransitions
      ? await definition.availableTransitions(record.state, record.payload, context)
      : definition.transitions[record.state] || [];
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
    const readableVersions = versions.map((version) => ({
      ...version,
      payload: this.readablePayload(plugin, record.kind, record.id, Number(version.revision), version.payload as Payload),
    }));
    return { ...record, versions: readableVersions, links, acceptances, next_states: nextStates, validation_issues: validationIssues, record_permissions: recordPermissions };
  }

  /** Reads one exact immutable snapshot after applying the current record's access policy. */
  async versionSnapshot(plugin: string, recordId: string, revision: number, user: string) {
    if (!Number.isInteger(revision) || revision < 1)
      invalid("Versão de registro inválida.", 400);
    const current = await this.record(plugin, recordId, user);
    const version = await this.db.one<{
      revision: number;
      state: string;
      payload: Payload;
      created_at: string;
      actor_id: string;
    }>(
      "SELECT revision,state,payload,created_at,actor_id FROM extension_record_versions WHERE record_id=$1 AND revision=$2",
      [current.id, revision],
    );
    if (!version) invalid("Versão de registro não encontrada.", 404);
    return {
      id: current.id,
      workspace_id: current.workspace_id,
      plugin_id: current.plugin_id,
      kind: current.kind,
      title: current.title,
      ...version,
      payload: this.readablePayload(plugin, current.kind, current.id, revision, version.payload),
    };
  }

  protected async mutation<T>(
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
        return this.operationValue(plugin, prior.response, "open") as T;
      }
      const response = await callback(client);
      if (!this.registry.isEnabled(plugin))
        invalid("Plugin desativado durante a operação.", 409);
      await client.query(
        "INSERT INTO extension_operations(workspace_id,plugin_id,actor_id,operation_key,request_hash,response) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
        [workspace, plugin, user, operation, hash, JSON.stringify(this.operationValue(plugin, response, "seal"))],
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

  protected async snapshot(
    client: PoolClient,
    record: ExtensionRecord,
    user: string,
    reason: string,
  ) {
    const resourceScoped = this.definition(record.plugin_id, record.kind).resourceScoped === true;
    const previousState = record.revision > 1
      ? (await client.query<{ state: string }>(
        "SELECT state FROM extension_record_versions WHERE record_id=$1 AND revision=$2",
        [record.id, record.revision - 1],
      )).rows[0]?.state
      : undefined;
    const storedPayload = this.storedPayload(record.plugin_id, record.kind, record.id, record.revision, record.payload);
    if (JSON.stringify(storedPayload) !== JSON.stringify(record.payload)) {
      await client.query("UPDATE extension_records SET payload=$2::jsonb WHERE id=$1 AND revision=$3", [record.id, JSON.stringify(storedPayload), record.revision]);
      record = { ...record, payload: storedPayload };
    }
    await client.query(
      "INSERT INTO extension_record_versions(record_id,revision,title,state,payload,reason,actor_id) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)",
      [
        record.id,
        record.revision,
        record.title,
        record.state,
        JSON.stringify(storedPayload),
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
        resourceScoped ? "extension_record" : "workspace",
        resourceScoped ? record.id : record.workspace_id,
      ],
    );
    await enqueueWebhookEvent(client, record, record.revision === 1 ? "record.created" : "record.updated");
    for (const plugin of this.registry.list()) {
      const contribution = plugin.recordEvents;
      if (!contribution || contribution.sourcePluginId !== record.plugin_id || !this.registry.isEnabled(plugin.id)) continue;
      const declaredEvents = new Map(contribution.events.map((event) => [event.type, event]));
      const events = contribution.onSnapshot(record, previousState);
      for (const eventType of events) {
        const definition = declaredEvents.get(eventType);
        if (!definition) throw new Error(`Plugin ${plugin.id} emitiu evento não declarado: ${eventType}`);
        await enqueueWebhookEvent(client, record, eventType, definition.version);
      }
    }
    return this.readableRecord(record);
  }

  protected async pinned(
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
    await this.authorize(row.plugin_id, workspace, user, "read", row.kind, row.id);
    row.payload = this.readablePayload(row.plugin_id, row.kind, row.id, row.revision, row.payload);
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

  protected async payload(
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
    if (prior) assertPayloadFieldsImmutable(definition.initial, prior.state, prior.payload, payload, definition.immutablePayloadFieldsAfterInitial || []);
    const validationIssues: RecordValidationIssue[] = await definition.validate?.(payload, this.validationContext(workspace, user, client, prior?.id)) || [];
    assertSemanticValidation(validationIssues);
    for (const field of definition.uniqueFields || []) {
      const value = payload[field];
      if (value === null || value === undefined || value === "") continue;
      const uniqueValue = String(value);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`unique:${workspace}:${plugin}:${kind}:${field}:${uniqueValue}`]);
      const duplicate = await client.query("SELECT id FROM extension_records WHERE workspace_id=$1 AND plugin_id=$2 AND kind=$3 AND payload->>$4=$5 AND ($6::uuid IS NULL OR id<>$6::uuid) LIMIT 1", [workspace, plugin, kind, field, uniqueValue, prior?.id || null]);
      if (duplicate.rows.length) invalid(`Já existe um registro ${kind} com o valor ${field} informado.`, 409);
    }
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

  protected async independentReview(
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
    return this.createWithOrigin(plugin, workspace, user, body, false);
  }

  async createGenerated(plugin: string, workspace: string, user: string, body: Payload) {
    return this.createWithOrigin(plugin, workspace, user, body, true);
  }

  private async createWithOrigin(plugin: string, workspace: string, user: string, body: Payload, generated: boolean) {
    only(body, generated ? ["kind", "title", "payload", "operation_key", "initial_state"] : ["kind", "title", "payload", "operation_key"]);
    const kind = text(body.kind, 80),
      title = text(body.title, 240),
      definition = this.definition(plugin, kind);
    if (Boolean(definition.serverCreated) !== generated)
      invalid(generated ? "Este tipo de registro não aceita criação pelo plugin." : "Este registro é criado por uma operação do plugin.", 403);
    const createPayload = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
      ? body.payload as Payload
      : {};
    const initialState = generated && typeof body.initial_state === "string"
      ? text(body.initial_state, 80)
      : definition.initial;
    if (initialState !== definition.initial && !Object.hasOwn(definition.transitions, initialState))
      invalid("Estado inicial de registro inválido.", 400);
    await this.authorize(plugin, workspace, user, "write", kind, undefined, createPayload);
    if (plugin === "documents" && kind === "document")
      invalid("Use o envio de arquivo para criar documentos.");
    return this.mutation(
      plugin,
      workspace,
      user,
      body.operation_key,
      body,
      async (client) => {
        const defaults = definition.defaultsForCreate
          ? await definition.defaultsForCreate(createPayload, this.validationContext(workspace, user, client))
          : {};
        const payload = await this.payload(
          client,
          plugin,
          kind,
          { ...defaults, ...createPayload },
          workspace,
          user,
        );
        if (!generated && definition.selfServiceCreate && definition.personalOwnerField
          && payload[definition.personalOwnerField] === user) {
          const policies = this.selfServiceAccessPolicies(plugin, kind).filter((policy) => policy.validateSelfServiceCreate);
          for (const policy of policies) {
            let issues: RecordValidationIssue[];
            try {
              issues = await policy.validateSelfServiceCreate!(payload,
                this.validationContext(workspace, user, client, undefined, policy.policyReadTargets || []));
            } catch {
              invalid("Não foi possível verificar as regras de criação deste registro.", 503);
            }
            if (!Array.isArray(issues) || issues.some((issue) => !issue || !["error", "warning"].includes(issue.severity)
              || typeof issue.path !== "string" || typeof issue.message !== "string" || typeof issue.code !== "string"))
              invalid("A política de criação retornou uma resposta inválida.", 503);
            assertSemanticValidation(issues);
          }
        }
        const recordId = randomUUID();
        const storedPayload = this.storedPayload(plugin, kind, recordId, 1, payload);
        const row = (
          await client.query<ExtensionRecord>(
            "INSERT INTO extension_records(id,workspace_id,plugin_id,kind,title,state,payload,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$8) RETURNING *",
            [
              recordId,
              workspace,
              plugin,
              kind,
              title,
              initialState,
              JSON.stringify(storedPayload),
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
        const saved = await this.save(
          client,
          current,
          user,
          title,
          payload,
          current.state === "published" ? definition.initial : current.state,
          reason,
        );
        if (definition.carryAttachmentsOnVersion) await this.carryRecordAttachments(client, current.id, current.revision, saved.revision);
        return saved;
      },
    );
  }

  protected async lock(client: PoolClient, recordId: string, revision: unknown) {
    const current = (
      await client.query<ExtensionRecord>(
        "SELECT * FROM extension_records WHERE id=$1 FOR UPDATE",
        [recordId],
      )
    ).rows[0];
    if (!current || current.revision !== revision)
      invalid("O registro mudou; recarregue antes de tentar novamente.", 409);
    return this.readableRecord(current);
  }

  protected async save(
    client: PoolClient,
    current: ExtensionRecord,
    user: string,
    title: string,
    payload: Payload,
    state: string,
    reason: string,
  ) {
    validate(this.definition(current.plugin_id, current.kind).schema, payload);
    const nextRevision = current.revision + 1;
    const storedPayload = this.storedPayload(current.plugin_id, current.kind, current.id, nextRevision, payload);
    const updated = (
      await client.query<ExtensionRecord>(
        "UPDATE extension_records SET title=$2,payload=$3::jsonb,state=$4,revision=revision+1,updated_by=$5,updated_at=now() WHERE id=$1 RETURNING *",
        [current.id, title, JSON.stringify(storedPayload), state, user],
      )
    ).rows[0];
    return this.snapshot(client, updated, user, reason);
  }

  protected async applyTransitionEffects(
    client: PoolClient,
    definition: RecordKindContribution,
    previous: ExtensionRecord,
    updated: ExtensionRecord,
    actor: string,
  ) {
    if (!definition.transitionEffects) return;
    const context = this.validationContext(previous.workspace_id, actor, client, previous.id);
    const effects = await definition.transitionEffects(previous.state, updated.state, updated.payload, context);
    if (effects.length > 1000) invalid("O limite de transições relacionadas foi excedido.", 409);
    for (const effect of effects as RecordTransitionEffect[]) {
      const targetId = id(effect.recordId);
      if (targetId === previous.id || !Number.isInteger(effect.expectedRevision) || effect.expectedRevision < 1)
        invalid("Efeito de transição relacionado inválido.", 409);
      const target = await this.lock(client, targetId, effect.expectedRevision);
      if (target.workspace_id !== previous.workspace_id || target.plugin_id !== previous.plugin_id || target.kind !== previous.kind)
        invalid("A transição relacionada precisa apontar para um registro do mesmo tipo e workspace.", 409);
      if (target.state !== effect.expectedState) invalid("O estado do registro relacionado mudou; tente novamente.", 409);
      const targetDefinition = this.definition(target.plugin_id, target.kind);
      const nextState = text(effect.nextState, 80);
      const nextPayload = { ...target.payload, ...(effect.payload || {}) };
      const targetContext = this.validationContext(target.workspace_id, actor, client, target.id);
      let allowed = targetDefinition.transitions[target.state] || [];
      if (targetDefinition.availableTransitions) allowed = await targetDefinition.availableTransitions(target.state, target.payload, targetContext);
      if (!allowed.includes(nextState)) invalid("O efeito relacionado solicitou uma transição não permitida.", 409);
      let prepared = nextPayload;
      if (targetDefinition.prepareTransition) prepared = await targetDefinition.prepareTransition(target.state, nextState, nextPayload, targetContext);
      const normalized = await this.payload(client, target.plugin_id, target.kind, prepared, target.workspace_id, actor, target);
      validate(targetDefinition.schema, normalized);
      validateDefinition(target.plugin_id, target.kind, normalized);
      assertPayloadFieldsImmutable(targetDefinition.initial, target.state, target.payload, normalized, targetDefinition.immutablePayloadFieldsAfterInitial || []);
      assertSemanticValidation(await targetDefinition.validate?.(normalized, targetContext) || []);
      const reason = text(effect.reason, 2000);
      const saved = await this.save(client, target, actor, target.title, normalized, nextState, reason);
      await client.query(
        "INSERT INTO access_audit(actor_id,action,target,scope_type,scope_id) VALUES($1,$2,$3,'extension_record',$4)",
        [actor, `${target.plugin_id}.${target.kind}.transition_effect`, target.id, target.id],
      );
      if (targetDefinition.carryAttachmentsOnVersion) await this.carryRecordAttachments(client, target.id, target.revision, saved.revision);
    }
  }

  protected async applyDeadlineEffects(
    client: PoolClient,
    workspace: string,
    user: string,
    effects: Array<{ recordId: string; event: "pause" | "resume"; reason: string }>,
  ) {
    if (!this.registry.isEnabled("deadlines")) invalid("O plugin de prazos está desativado.", 409);
    for (const effect of effects) {
      const deadline = (
        await client.query<ExtensionRecord>(
          "SELECT * FROM extension_records WHERE id=$1 FOR UPDATE",
          [id(effect.recordId)],
        )
      ).rows[0];
      if (!deadline || deadline.workspace_id !== workspace || deadline.plugin_id !== "deadlines" || deadline.kind !== "clock")
        invalid("O relógio de prazo vinculado não existe neste workspace.", 409);
      const targetState = effect.event === "pause" ? "paused" : "running";
      if (deadline.state === targetState) continue;
      if (!((effect.event === "pause" && deadline.state === "running") || (effect.event === "resume" && deadline.state === "paused")))
        invalid("O relógio de prazo não está em um estado compatível com a transição.", 409);
      const deadlineState = deadlineTransition(deadline.state, deadline.payload, effect.event, new Date());
      await this.save(client, deadline, user, deadline.title, deadlineState.payload, deadlineState.state, text(effect.reason, 2000));
    }
  }

  protected async applyRecordRoleEffects(client: PoolClient, workspace: string, actor: string, effects: Array<{ userId: string; roleId: string; recordId: string; effect: "grant" | "revoke" }>) {
    for (const effect of effects) {
      const userId = id(effect.userId), recordId = id(effect.recordId), roleId = text(effect.roleId, 80);
      if (!/^[a-z][a-z0-9_-]{1,79}$/.test(roleId) || !["grant", "revoke"].includes(effect.effect)) invalid("Efeito de papel de registro inválido.");
      const [target, role, resource] = await Promise.all([
        client.query<{ id: string; is_root: boolean }>("SELECT id,is_root FROM users WHERE id=$1 AND NOT disabled", [userId]),
        client.query("SELECT id FROM access_roles WHERE id=$1", [roleId]),
        client.query<{ id: string; plugin_id: string; kind: string }>(`SELECT r.id,r.plugin_id,r.kind FROM extension_records r JOIN extension_record_versions v ON v.record_id=r.id
          WHERE r.id=$1 AND r.workspace_id=$2 AND v.revision=r.revision`, [recordId, workspace]),
      ]);
      if (!target.rows[0] || target.rows[0].is_root || !role.rows[0] || !resource.rows[0]) invalid("O destino, o papel ou o registro do acesso não está disponível.", 409);
      if (!this.registry.isEnabled(resource.rows[0].plugin_id) || this.definition(resource.rows[0].plugin_id, resource.rows[0].kind).resourceScoped !== true)
        invalid("O acesso automático só pode ser aplicado a um registro com escopo individual habilitado.", 409);
      if (effect.effect === "grant") {
        await client.query("INSERT INTO access_grants(user_id,role_id,scope_type,scope_id) VALUES($1,$2,'extension_record',$3) ON CONFLICT DO NOTHING", [userId, roleId, recordId]);
      } else {
        await client.query("DELETE FROM access_grants WHERE user_id=$1 AND role_id=$2 AND scope_type='extension_record' AND scope_id=$3", [userId, roleId, recordId]);
      }
      await client.query("UPDATE users SET session_version=session_version+1 WHERE id=$1", [userId]);
      await client.query("INSERT INTO access_audit(actor_id,action,target,scope_type,scope_id) VALUES($1,$2,$3,'extension_record',$4)", [actor, `role.scope.${effect.effect}`, `${roleId}:${userId}`, recordId]);
    }
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
        if (definition.immutable?.includes(current.state) && !definition.availableTransitions
          && !(definition.transitions[current.state] || []).length)
          invalid("Registro concluído; crie uma nova versão quando permitido.", 409);
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
        } else if (definition.availableTransitions) {
          const context = this.validationContext(current.workspace_id, user, client, current.id);
          const allowed = await definition.availableTransitions(current.state, current.payload, context);
          if (!allowed.includes(state)) invalid("Transição não permitida.", 409);
        } else if (!(definition.transitions[current.state] || []).includes(state))
          invalid("Transição não permitida.", 409);
        if (definition.authorizeTransition && !(await definition.authorizeTransition(current.state, state, current.payload,
          this.validationContext(current.workspace_id, user, client, current.id))))
          invalid("Seu perfil não está autorizado a realizar esta transição.", 403);
        if (definition.prepareTransition) {
          const context = this.validationContext(current.workspace_id, user, client, current.id);
          try {
            payload = await definition.prepareTransition(current.state, state, payload, context);
          } catch (error) {
            invalid(error instanceof Error ? error.message : "Não foi possível preparar esta transição.", 409);
          }
          payload = await this.payload(client, plugin, current.kind, payload, current.workspace_id, user, current);
        }
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
        if (definition.immutable?.includes(current.state) && fingerprint(current.payload) !== fingerprint(payload))
          invalid("Uma transição de registro finalizado não pode modificar seu conteúdo.", 409);
        assertPayloadFieldsImmutable(definition.initial, current.state, current.payload, payload, definition.immutablePayloadFieldsAfterInitial || []);
        const transitionContext = this.validationContext(current.workspace_id, user, client, current.id);
        transitionContext.transition = { from: current.state, to: state };
        assertSemanticValidation(await definition.validate?.(payload, transitionContext) || []);
        const roleEffects = definition.recordRoleEffects
          ? await definition.recordRoleEffects(current.state, state, payload, this.validationContext(current.workspace_id, user, client, current.id))
          : [];
        if (roleEffects.length) await this.applyRecordRoleEffects(client, current.workspace_id, user, roleEffects);
        const updated = await this.save(
          client,
          current,
          user,
          current.title,
          payload,
          state,
          reason,
        );
        await this.applyTransitionEffects(client, definition, current, updated, user);
        if (definition.carryAttachmentsOnVersion) await this.carryRecordAttachments(client, current.id, current.revision, updated.revision);
        if (definition.deadlineEffects) {
          const context = this.validationContext(current.workspace_id, user, client, current.id);
          const effects = await definition.deadlineEffects(current.state, state, current.payload, context);
          await this.applyDeadlineEffects(client, current.workspace_id, user, effects);
        }
        return updated;
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
      "related_record_id",
      "related_record_revision",
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
        const relatedId = body.related_record_id ?? current?.payload.related_record_id;
        const relatedRevision = body.related_record_revision ?? current?.payload.related_record_revision;
        if ((relatedId !== undefined) !== (relatedRevision !== undefined))
          invalid("Informe o registro relacionado e sua versão juntos.");
        if (relatedId !== undefined) {
          const related = await this.pinned(client, relatedId, relatedRevision, workspace, user, false);
          if (related.id === current?.id) invalid("Um documento não pode ser relacionado a si mesmo.");
          payload.related_record_id = related.id;
          payload.related_record_revision = related.revision;
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
        const storedFile = this.definition("documents", "document").sensitiveAttachments
          ? sealProtectedAttachment(file.data, { pluginId: "documents", kind: "document", recordId: record.id,
            revision, attachmentId: "extension_file", fileName: file.file_name, mimeType: file.mime_type, sha256: file.sha256 })
          : file.data;
        await client.query(
          "INSERT INTO extension_files(record_id,revision,data,sha256,uploaded_by) VALUES($1,$2,$3,$4,$5)",
          [record.id, revision, storedFile, file.sha256, user],
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
    if (!file)
      invalid("Falha de integridade do arquivo.", 409);
    const fileRevision = Number(version.payload.file_revision);
    const fileContext = { pluginId: "documents", kind: "document", recordId: record.id, revision: fileRevision,
      attachmentId: "extension_file", fileName: String(version.payload.file_name),
      mimeType: String(version.payload.mime_type), sha256: String(version.payload.sha256) };
    const data = isProtectedAttachmentEnvelope(file.data) ? openProtectedAttachment(file.data, fileContext) : file.data;
    if (createHash("sha256").update(data).digest("hex") !== file.sha256 || file.sha256 !== version.payload.sha256)
      invalid("Falha de integridade do arquivo.", 409);
    await this.access.audit(
      user,
      "documents.file.read." + String(version.payload.variant),
      record.id,
      { type: "workspace", id: record.workspace_id },
    );
    return {
      data,
      file_name: String(version.payload.file_name),
      mime_type: String(version.payload.mime_type),
    };
  }
}

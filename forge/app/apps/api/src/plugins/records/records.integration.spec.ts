import {seedCollections} from "../collections/collections.seed";
import { collectionsPlugin, installCollectionsAccess } from "../collections/collections.plugin";
import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { Db } from "../../db";
import { AccessService } from "../../access/access";
import {
  WorkspacesService,
  workspacesPlugin,
} from "../../workspaces/workspaces.plugin";
import { PluginRegistry } from "../../execution/registries";
import { migrateVersions } from "../../migrations";
import { genericPlugins, recordPlugins } from "./catalog";
import { ExtensionRecords, ExtensionRecord } from "./records.service";
import { DocumentScanner } from "./documents";
import { AuditHistoryController, auditHistoryPlugin } from "./audit";

test(
  "fresh migrations and independent plugin journeys preserve authorization, history and transactional idempotency",
  { timeout: 120000 },
  async () => {
    if (!process.env.DATABASE_URL)
      throw new Error(
        "Configure the DEV database URL before running integration tests.",
      );
    const target = new URL(process.env.DATABASE_URL);
    target.hostname = process.env.ORBIT_TEST_DB_HOST || target.hostname;
    const adminUrl = new URL(target);
    adminUrl.username = execFileSync(
      "docker",
      ["exec", "orbit-db-dev", "printenv", "POSTGRES_USER"],
      { encoding: "utf8" },
    ).trim();
    adminUrl.password = execFileSync(
      "docker",
      ["exec", "orbit-db-dev", "printenv", "POSTGRES_PASSWORD"],
      { encoding: "utf8" },
    ).trim();
    const schema = "extensions_test_" + randomUUID().replaceAll("-", ""),
      admin = new Pool({ connectionString: adminUrl.toString() });
    const pool = new Pool({
      connectionString: target.toString(),
      options: `-c search_path=${schema}`,
    });
    const db = new Db();
    await db.pool.end();
    db.pool = pool;
    try {
      await admin.query(
        `CREATE SCHEMA ${schema} AUTHORIZATION ${target.username}`,
      );
      await pool.query(
        await readFile(resolve(__dirname, "../../../sql/schema.sql"), "utf8"),
      );
      await pool.query(
        await readFile(
          resolve(__dirname, "../../../sql/pre-022-compat.sql"),
          "utf8",
        ),
      );
      await migrateVersions(pool);
      const owner = randomUUID(),
        reviewer = randomUUID(),
        outsider = randomUUID(),
        workspace = randomUUID(),
        other = randomUUID();
      for (const [key, root] of [
        [owner, true],
        [reviewer, false],
        [outsider, false],
      ] as const)
        await pool.query(
          "INSERT INTO users(id,name,email,password_hash,is_root) VALUES($1,$2,$3,$4,$5)",
          [key, "Example", key + "@example.test", "not-a-login", root],
        );
      await pool.query(
        "INSERT INTO workspaces(id,name,owner_id) VALUES($1,$2,$3),($4,$5,$3)",
        [workspace, "Generic demo", owner, other, "Other workspace"],
      );
      await pool.query(
        "INSERT INTO workspace_members(workspace_id,user_id) VALUES($1,$2),($1,$3)",
        [workspace, owner, reviewer],
      );
      const registry = new PluginRegistry();
      registry.register(workspacesPlugin); registry.register(collectionsPlugin);
      for (const plugin of [...genericPlugins, auditHistoryPlugin])
        registry.register(plugin);
      const access = new AccessService(db);
      access.registerPlugins(registry.list());
      new WorkspacesService(db, access).onModuleInit();
      installCollectionsAccess(db,registry,access);
      const collectionBoard = (await pool.query("INSERT INTO boards(title,owner_id,workspace_id,is_collection) VALUES('Preserved collection',$1,$2,true) RETURNING id", [owner,workspace])).rows[0].id;
      await pool.query("INSERT INTO access_roles(id,name,permissions) VALUES('collections_fixture','Collection reader',ARRAY['plugin.collections.read','boards.read'])");
      await pool.query("INSERT INTO access_grants(user_id,role_id) VALUES($1,'collections_fixture')",[reviewer]);
      assert.equal((await pool.query('SELECT * FROM authorized_board_members WHERE board_id=$1 AND user_id=$2',[collectionBoard,reviewer])).rowCount,1);
      await pool.query("INSERT INTO access_user_exceptions(user_id,permission_id,effect) VALUES($1,'plugin.collections.read','deny')",[reviewer]);
      assert.equal((await pool.query('SELECT * FROM authorized_board_members WHERE board_id=$1 AND user_id=$2',[collectionBoard,reviewer])).rowCount,0);
      await pool.query("DELETE FROM access_user_exceptions WHERE user_id=$1 AND permission_id='plugin.collections.read'",[reviewer]);
      await pool.query("UPDATE plugin_settings SET enabled=false WHERE plugin_id='collections'");registry.setEnabled('collections',false);
      assert.equal((await pool.query('SELECT * FROM authorized_board_members WHERE board_id=$1',[collectionBoard])).rowCount,0);
      assert.equal(await access.boardPermission(collectionBoard,owner),false);
      await seedCollections(pool,owner);
      assert.equal((await pool.query('SELECT id FROM lists WHERE board_id=$1',[collectionBoard])).rowCount,0, 'disabled plugin must not seed categories');
      assert.equal((await pool.query('SELECT id FROM boards WHERE id=$1',[collectionBoard])).rowCount,1);
      await pool.query("UPDATE plugin_settings SET enabled=true WHERE plugin_id='collections'");registry.setEnabled('collections',true);
      assert.equal(await access.boardPermission(collectionBoard,owner),true);

      const permissions = recordPlugins.flatMap(({ plugin }) =>
        ["read", "write", "publish"].map(
          (action) => `plugin.${plugin.id}.${action}`,
        ),
      );
      await pool.query(
        "INSERT INTO access_roles(id,name,permissions) VALUES($1,$2,$3)",
        ["demo_reviewer", "Generic reviewer", permissions],
      );
      await pool.query(
        "INSERT INTO access_grants(user_id,role_id) VALUES($1,$2),($3,$2)",
        [reviewer, "demo_reviewer", outsider],
      );
      const service = new ExtensionRecords(
        db,
        access,
        registry,
        new DocumentScanner(),
      );
      service.onModuleInit();
      const create = async (
        plugin: string,
        kind: string,
        payload: Record<string, unknown>,
        actor = owner,
        space = workspace,
      ) =>
        service.create(plugin, space, actor, {
          kind,
          title: "Generic example",
          payload,
          operation_key: randomUUID(),
        });
      const publish = async (record: ExtensionRecord, actor = owner) =>
        service.transition(record.plugin_id, record.id, actor, {
          state: "published",
          expected_revision: record.revision,
          reason: "Publish generic example",
          operation_key: randomUUID(),
        });
      let lifecycleAllowed = false;
      registry.register({ id: "lifecycle-example", name: "Lifecycle example", version: "1.0.0", contributions: { recordKinds: { record: {
        label: "Lifecycle record", schema: { type: "object", properties: { content: { type: "string" } }, required: ["content"], additionalProperties: false },
        initial: "draft", transitions: { draft: ["published"], published: ["withdrawn"], withdrawn: [] }, immutable: ["published", "withdrawn"],
        authorizeTransition: async () => lifecycleAllowed, example: { content: "Protected content" },
      } } } });
      const protectedRecord = await create("lifecycle-example", "record", { content: "Protected content" });
      await assert.rejects(() => publish(protectedRecord), /não está autorizado/);
      lifecycleAllowed = true;
      const protectedPublished = await publish(protectedRecord);
      const withdrawn = await service.transition("lifecycle-example", protectedPublished.id, owner, {
        state: "withdrawn", expected_revision: protectedPublished.revision, reason: "Withdraw without changing published content", operation_key: randomUUID(),
      });
      assert.deepEqual(withdrawn.payload, protectedPublished.payload);
      assert.equal(withdrawn.state, "withdrawn");
      assert.equal((await service.versionSnapshot("lifecycle-example", protectedPublished.id, protectedPublished.revision, owner)).state, "published");
      const form = await publish(
        await create("forms", "form", {
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["message"],
            properties: { message: { type: "string", minLength: 1 } },
          },
        }),
      );
      await assert.rejects(() =>
        create("forms", "submission", {
          form_id: form.id,
          form_revision: form.revision,
          answers: { invented: true },
        }),
      );
      const response = await create("forms", "submission", {
        form_id: form.id,
        form_revision: form.revision,
        answers: { message: "Hello" },
      });
      const submitted = await service.transition("forms", response.id, owner, {
        state: "submitted",
        expected_revision: response.revision,
        reason: "Send response",
        operation_key: randomUUID(),
      });
      await assert.rejects(
        () =>
          service.version("forms", submitted.id, owner, {
            title: "Changed",
            payload: submitted.payload,
            reason: "Forbidden edit",
            expected_revision: submitted.revision,
            operation_key: randomUUID(),
          }),
        /imutável/,
      );
      assert.deepEqual(await service.list("forms", workspace, outsider), []);
      await assert.rejects(() => service.detail("forms", form.id, outsider), /autorizado/);
      await assert.rejects(() => service.detail("forms", response.id, reviewer), /autorizado/);
      await assert.rejects(
        () =>
          create(
            "forms",
            "submission",
            {
              form_id: form.id,
              form_revision: form.revision,
              answers: { message: "Cross scope" },
            },
            owner,
            other,
          ),
        /mesmo workspace|não autorizado/,
      );
      const key = randomUUID(),
        input = {
          kind: "term",
          title: "Example terms",
          payload: { content: "Generic terms" },
          operation_key: key,
        };
      const [first, duplicate] = await Promise.all([
        service.create("terms", workspace, owner, input),
        service.create("terms", workspace, owner, input),
      ]);
      assert.equal(first.id, duplicate.id);
      await assert.rejects(
        () =>
          service.create("terms", workspace, owner, {
            ...input,
            title: "Other content",
          }),
        /outro conteúdo/,
      );
      const term = await publish(first);
      await service.accept(term.id, reviewer, {
        revision: term.revision,
        accepted: true,
        operation_key: randomUUID(),
      });
      const revised = await service.version("terms", term.id, owner, {
        title: "Example terms",
        payload: { content: "Updated generic terms" },
        reason: "New policy",
        expected_revision: term.revision,
        operation_key: randomUUID(),
      });
      assert.equal(revised.state, "draft");
      assert.equal(
        (await service.detail("terms", term.id, reviewer)).acceptances.length,
        1,
      );
      for (const pluginId of [
        "reference-library",
        "policy-parameters",
        "assessments",
      ]) {
        const plugin = recordPlugins.find(
          (item) => item.plugin.id === pluginId,
        )!;
        for (const [kind, definition] of Object.entries(plugin.kinds)) {
          const published = await publish(
            await create(pluginId, kind, definition.example),
          );
          assert.equal(published.state, "published");
        }
      }
      const privacy = recordPlugins.find(
        (item) => item.plugin.id === "privacy",
      )!;
      await publish(
        await create("privacy", "activity", privacy.kinds.activity.example),
      );
      let privacyRequest = await create(
        "privacy",
        "request",
        privacy.kinds.request.example,
      );
      privacyRequest = await service.version(
        "privacy",
        privacyRequest.id,
        owner,
        {
          title: privacyRequest.title,
          payload: {
            ...privacyRequest.payload,
            response_reference: "RESPONSE-000001",
          },
          reason: "Register response reference",
          expected_revision: privacyRequest.revision,
          operation_key: randomUUID(),
        },
      );
      for (const state of [
        "triage",
        "in_review",
        "response_ready",
        "completed",
      ])
        privacyRequest = await service.transition(
          "privacy",
          privacyRequest.id,
          owner,
          {
            state,
            expected_revision: privacyRequest.revision,
            reason: "Process data subject request",
            operation_key: randomUUID(),
          },
        );
      assert.equal(privacyRequest.state, "completed");
      const compliance = recordPlugins.find(
        (item) => item.plugin.id === "compliance",
      )!;
      const disclosure = await publish(
        await create(
          "compliance",
          "disclosure",
          compliance.kinds.disclosure.example,
        ),
      );
      let conflict = await create("compliance", "case", {
        reason: "Review disclosed relationship",
        disclosure_id: disclosure.id,
        resolution: "No conflict found",
        decision_reference: "DECISION-000001",
      });
      for (const state of ["in_review", "resolved"])
        conflict = await service.transition("compliance", conflict.id, owner, {
          state,
          expected_revision: conflict.revision,
          reason: "Review generic disclosure",
          operation_key: randomUUID(),
        });
      assert.equal(conflict.state, "resolved");
      const definition = recordPlugins.find(
        (item) => item.plugin.id === "workflows",
      )!.kinds.definition.example;
      const workflow = await publish(
        await create("workflows", "definition", definition),
      );
      let process = await create("workflows", "process", {
        definition_id: workflow.id,
        definition_revision: workflow.revision,
      });
      assert.match(String(process.payload.protocol), /^ORB-/);
      await publish(
        await create("workflows", "review", {
          process_id: process.id,
          outcome: "ready",
          reason: "Generic documents checked",
          checks: { complete: true },
        }),
      );
      let followup = await create("workflows", "followup", {
        process_id: process.id,
        reason: "Please clarify the request",
        responsible_user_id: reviewer,
        due_at: "2030-01-01T12:00:00Z",
        response: "Information provided",
      });
      for (const state of ["responded", "resolved"])
        followup = await service.transition("workflows", followup.id, owner, {
          state,
          expected_revision: followup.revision,
          reason: "Process additional information",
          operation_key: randomUUID(),
        });
      assert.equal(followup.state, "resolved");
      await assert.rejects(
        () =>
          service.transition("workflows", process.id, owner, {
            next_state: "completed",
            expected_revision: process.revision,
            reason: "Skip step",
            operation_key: randomUUID(),
          }),
        /não prevista/,
      );
      for (const next_state of ["in_review", "completed"])
        process = await service.transition("workflows", process.id, owner, {
          next_state,
          expected_revision: process.revision,
          reason: "Advance workflow",
          operation_key: randomUUID(),
        });
      assert.equal(process.state, "completed");
      const clock = await create("deadlines", "clock", { duration_days: 5 });
      const paused = await service.transition("deadlines", clock.id, owner, {
        event: "pause",
        expected_revision: clock.revision,
        reason: "Waiting for a response",
        operation_key: randomUUID(),
      });
      assert.equal(paused.state, "paused");
      await assert.rejects(
        () =>
          service.transition("deadlines", clock.id, owner, {
            event: "resume",
            expected_revision: clock.revision,
            reason: "Stale version",
            operation_key: randomUUID(),
          }),
        /recarregue/,
      );
      let clockState = paused;
      for (const event of ["resume", "extend", "complete"])
        clockState = await service.transition("deadlines", clock.id, owner, {
          event,
          ...(event === "extend" ? { extension_days: 2 } : {}),
          expected_revision: clockState.revision,
          reason: "Manage example deadline",
          operation_key: randomUUID(),
        });
      assert.equal(clockState.state, "completed");
      const bytes = Buffer.from("%PDF-1.7\nexample").toString("base64");
      const original = await service.upload(workspace, owner, {
        title: "Original example",
        file_name: "example.pdf",
        mime_type: "application/pdf",
        data_base64: bytes,
        operation_key: randomUUID(),
      });
      const receipt = await service.upload(workspace, owner, {
        title: "Receipt bound to a preserved workflow", file_name: "receipt.pdf", mime_type: "application/pdf", data_base64: bytes,
        related_record_id: process.id, related_record_revision: process.revision, operation_key: randomUUID(),
      });
      assert.equal(receipt.payload.variant, "original");
      assert.equal(receipt.payload.related_record_id, process.id);
      assert.equal(receipt.payload.related_record_revision, process.revision);
      await assert.rejects(() => service.upload(workspace, owner, {
        title: "Unpaired receipt", file_name: "receipt.pdf", mime_type: "application/pdf", data_base64: bytes,
        related_record_id: process.id, operation_key: randomUUID(),
      }), /registro relacionado e sua versão/);
      await assert.rejects(() => service.upload(workspace, owner, {
        title: "Unknown process", file_name: "receipt.pdf", mime_type: "application/pdf", data_base64: bytes,
        related_record_id: randomUUID(), related_record_revision: 1, operation_key: randomUUID(),
      }), /mesmo workspace/i);
      const copy = await service.upload(workspace, owner, {
        title: "Anonymized example",
        file_name: "anonymous.pdf",
        mime_type: "application/pdf",
        data_base64: bytes,
        variant: "anonymized",
        source_id: original.id,
        source_revision: original.revision,
        operation_key: randomUUID(),
      });
      await assert.rejects(() => publish(copy), /revisão independente/);
      await pool.query("INSERT INTO access_roles(id,name,permissions) VALUES('demo_document_scope','Independent document review',ARRAY['plugin.documents.read'])");
      for (const recordId of [original.id, copy.id])
        await pool.query("INSERT INTO access_grants(user_id,role_id,scope_type,scope_id) VALUES($1,'demo_document_scope','extension_record',$2)", [reviewer, recordId]);
      const reviewPayload = {
        document_id: copy.id,
        document_revision: copy.revision,
        decision: "approved",
        checks: { personal_data_removed: true },
        reason: "Independent review",
      };
      await assert.rejects(
        () => create("documents", "review", reviewPayload),
        /outra pessoa/,
      );
      await publish(
        await create("documents", "review", reviewPayload, reviewer),
        reviewer,
      );
      const released = await publish(copy);
      assert.equal(
        (
          await service.download(released.id, released.revision, owner)
        ).data.toString(),
        "%PDF-1.7\nexample",
      );
      await service.link("forms", response.id, owner, {
        target_id: term.id,
        target_revision: term.revision,
        relation: "terms",
        operation_key: randomUUID(),
      });
      const count = (
        await pool.query(
          "SELECT count(*)::integer AS count FROM extension_records",
        )
      ).rows[0].count;
      registry.setEnabled("versioned-records", false);
      await assert.rejects(
        () => service.list("forms", workspace, owner),
        /desativada/,
      );
      registry.setEnabled("versioned-records", true);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::integer AS count FROM extension_records",
          )
        ).rows[0].count,
        count,
      );
      await assert.rejects(
        () =>
          pool.query(
            "UPDATE extension_record_versions SET reason=$1 WHERE record_id=$2",
            ["tampered", term.id],
          ),
        /append-only/,
      );
      await assert.rejects(
        () =>
          pool.query(
            "DELETE FROM extension_term_acceptances WHERE record_id=$1",
            [term.id],
          ),
        /append-only/,
      );
      const protectedAudit = (
        await pool.query(
          "SELECT source_audit_id FROM immutable_audit_events LIMIT 1",
        )
      ).rows[0].source_audit_id;
      await assert.rejects(
        () =>
          pool.query("UPDATE access_audit SET target=$1 WHERE id=$2", [
            "tampered",
            protectedAudit,
          ]),
        /protected/,
      );
      await assert.rejects(
        () => pool.query("TRUNCATE immutable_audit_events"),
        /append-only/,
      );
      const audit = await new AuditHistoryController(
        db,
        access,
        registry,
      ).integrity({ orbitUser: owner } as never);
      assert.equal(audit.valid, true);
      assert.ok(Number(audit.events) > 0);
      await migrateVersions(pool); // Applied checksums and migrations remain stable on a second pass.
    } finally {
      await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  },
);

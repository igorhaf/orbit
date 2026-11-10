import "reflect-metadata";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { suindaCrmPlugin, SuindaCrmService } from "./suinda-crm";

const workspace = "00000000-0000-4000-8000-000000000101";

test("migration 200 stores encrypted consent-gated CRM outbox and redacts payloads at terminal states", () => {
  const migration = readFileSync(resolve(__dirname, "../../sql/migrations/200_suinda_crm_sync.sql"), "utf8");
  const schema = readFileSync(resolve(__dirname, "../../sql/schema.sql"), "utf8");
  const bootstrap = readFileSync(resolve(__dirname, "../migrate.ts"), "utf8");
  assert.match(bootstrap, /sql\/schema\.sql/);
  assert.match(bootstrap, /migrateVersions\(pool\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS suinda_crm_integrations/);
  assert.match(migration, /token_encrypted/);
  assert.match(migration, /contact_salt_encrypted/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS suinda_crm_contacts/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS suinda_crm_outbox/);
  assert.match(migration, /payload_encrypted/);
  assert.match(migration, /action IN \('upsert','delete'\)/);
  assert.match(migration, /NEW.status IN \('delivered','cancelled','dead_letter'\)/);
  assert.doesNotMatch(migration.match(/CREATE TABLE IF NOT EXISTS suinda_crm_outbox \(([\s\S]*?)\n\);/)?.[1] || "", /learner_user_id|email|phone|name/);
  assert.doesNotMatch(schema, /CREATE TABLE IF NOT EXISTS suinda_crm_(integrations|contacts|outbox)/);
});

test("CRM is an optional child plugin and owns only its workspace integration routes", () => {
  assert.equal(suindaCrmPlugin.parentPlugin, "suinda-learning");
  assert.deepEqual(suindaCrmPlugin.dependencies, ["suinda-learning", "webhooks"]);
  assert.equal(suindaCrmPlugin.handlesRoute?.(`/extensions/suinda-crm/workspaces/${workspace}/config`), true);
  assert.equal(suindaCrmPlugin.handlesRoute?.(`/extensions/suinda-crm/workspaces/${workspace}/status`), true);
  assert.equal(suindaCrmPlugin.handlesRoute?.(`/extensions/suinda-crm/workspaces/${workspace}/sync`), true);
  assert.equal(suindaCrmPlugin.handlesRoute?.(`/extensions/suinda-crm/workspaces/${workspace}/contacts`), false);
});

test("CRM revalidates exact privacy categories for configured fields both before queueing and delivery", () => {
  const learning = readFileSync(resolve(__dirname, "suinda/suinda.service.ts"), "utf8");
  const crm = readFileSync(resolve(__dirname, "suinda-crm.ts"), "utf8");
  const noticeValidator = readFileSync(resolve(__dirname, "suinda/suinda.plugin.ts"), "utf8");
  for (const source of [learning, crm]) {
    assert.match(source, /data_categories' \? 'learner_name'/);
    assert.match(source, /data_categories' \? 'verified_email'/);
    assert.match(source, /data_categories' \? 'learner_phone'/);
  }
  assert.match(noticeValidator, /\["learner_name", "verified_email"\]\.every/);
});

test("CRM status reports only workspace-scoped counts and never returns credentials", async () => {
  const db = {
    async one(sql: string) {
      if (sql.includes("FROM workspaces")) return { id: workspace };
      if (sql.includes("suinda_crm_integrations")) return { include_phone: false, endpoint: "https://crm.example.test/receiver", token_encrypted: "ciphertext" };
      if (sql.includes("COUNT(*)")) return { count: 2 };
      if (sql.includes("MAX(updated_at)")) return { last_sync_at: null };
      return null;
    },
  };
  const service = new SuindaCrmService(db as never,
    { async has() { return true; }, registerPermissions() {} } as never,
    { isEnabled() { return true; } } as never,
    {} as never,
    { async crmContactCandidates() { return [{ learner_user_id: "private-id", name: "Pessoa", email: "pessoa@example.test", phone: null }]; } } as never,
  );
  const status = await service.status(workspace, "manager");
  assert.deepEqual(status, { eligible_contacts: 1, pending_deletions: 2, last_sync_at: null });
  assert.equal(JSON.stringify(status).includes("pessoa@example.test"), false);
  assert.equal(JSON.stringify(status).includes("ciphertext"), false);
});

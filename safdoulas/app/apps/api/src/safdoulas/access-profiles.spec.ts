import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { PluginRegistry } from "../execution/registries";
import { genericPlugins } from "../plugins/records/catalog";
import { safdoulasAccreditationPlugin } from "./accreditation.plugin";
import { safdoulasAccreditorsPlugin } from "./accreditors.plugin";
import { safdoulasAssessmentsPlugin } from "./assessments.plugin";
import { safdoulasBlindingPlugin } from "./blinding.plugin";
import { safdoulasDataProtectionPlugin } from "./data-protection.plugin";
import { safdoulasDecisionsPlugin } from "./decisions.plugin";
import { safdoulasDiligencesPlugin } from "./diligences.plugin";
import { safdoulasGovernancePlugin } from "./governance.plugin";
import { safdoulasProcessesPlugin } from "./processes.plugin";
import { safdoulasPublicPortalPlugin } from "./public-portal.plugin";
import { safdoulasRegistryPlugin } from "./registry.plugin";
import { safdoulasReportingPlugin } from "./reporting.plugin";
import { safdoulasTriagePlugin } from "./triage.plugin";

const migration = readFileSync(resolve(__dirname, "../../sql/migrations/125_safdoulas_access_profiles.sql"), "utf8");
const concessionAccessMigration = readFileSync(resolve(__dirname, "../../sql/migrations/126_safdoulas_concession_document_access.sql"), "utf8");
const dataProtectionAccessMigration = readFileSync(resolve(__dirname, "../../sql/migrations/127_safdoulas_data_protection_permissions.sql"), "utf8");
const safdoulasPlugins = [
  safdoulasGovernancePlugin,
  safdoulasRegistryPlugin,
  safdoulasProcessesPlugin,
  safdoulasAccreditorsPlugin,
  safdoulasTriagePlugin,
  safdoulasBlindingPlugin,
  safdoulasAssessmentsPlugin,
  safdoulasDiligencesPlugin,
  safdoulasDecisionsPlugin,
  safdoulasAccreditationPlugin,
  safdoulasDataProtectionPlugin,
  safdoulasReportingPlugin,
  safdoulasPublicPortalPlugin,
];

test("SafDoulas role templates are isolated, reference declared permissions and keep the public profile empty", () => {
  const registry = new PluginRegistry();
  for (const plugin of [...genericPlugins, ...safdoulasPlugins]) registry.register(plugin);
  const permissionCatalog = new Set(registry.list().flatMap((plugin) => [
    ...["read", "write", "manage"].map((action) => `plugin.${plugin.id}.${action}`),
    ...(plugin.capabilities || []).flatMap((capability) => capability.permissions || []),
    ...(plugin.actions || []).flatMap((action) => action.permissions || []),
  ]));
  const roles = [...migration.matchAll(/\('([^']+)',\s*'[^']+',\s*ARRAY\[([^\]]*)\](?:::\w+\[\])?\)/gs)];
  assert.equal(roles.length, 9);
  for (const [, id, permissionsSql] of roles) {
    assert.match(id, /^safdoulas_[a-z_]+$/);
    for (const [, permission] of permissionsSql.matchAll(/'([^']+)'/g))
      assert.equal(permissionCatalog.has(permission), true, `permissão não declarada: ${permission}`);
  }
  const publicRole = roles.find(([, id]) => id === "safdoulas_public_user");
  assert.ok(publicRole);
  assert.equal(publicRole[2].trim(), "");
  assert.doesNotMatch(migration, /access\.manage|plugins\.manage|platform_admin|administrator/);
});

test("SAFDOULAS extension navigation opens the plugin's own record workspace", () => {
  for (const plugin of safdoulasPlugins) {
    const expected = plugin.id === "safdoulas-reporting" ? "/safdoulas/reports"
      : plugin.id === "safdoulas-assessments" ? "/safdoulas/assessments"
      : `/extensions/${plugin.id}`;
    for (const item of plugin.contributions?.navigation || [])
      assert.equal(item.href, expected, `${plugin.id} should open ${expected}`);
  }
});

test("federation governance can generate and retrieve concession drafts through shared document permissions", () => {
  assert.ok(genericPlugins.some((plugin) => plugin.id === "documents"));
  assert.match(concessionAccessMigration, /'plugin\.documents\.read'/);
  assert.match(concessionAccessMigration, /'plugin\.documents\.write'/);
  assert.match(concessionAccessMigration, /safdoulas_federation_governance/);
});

test("data-protection permissions are declared by its plugin and limited to governance and directorate", () => {
  const registry = new PluginRegistry();
  for (const plugin of [...genericPlugins, ...safdoulasPlugins]) registry.register(plugin);
  const permissions = new Set(registry.list().flatMap((plugin) => (plugin.capabilities || []).flatMap((capability) => capability.permissions || [])));
  assert.equal(permissions.has("plugin.safdoulas-data-protection.read"), true);
  assert.equal(permissions.has("plugin.safdoulas-data-protection.manage"), true);
  assert.match(dataProtectionAccessMigration, /WHERE id = 'safdoulas_federation_governance'/);
  assert.match(dataProtectionAccessMigration, /WHERE id = 'safdoulas_directorate'/);
  assert.equal((dataProtectionAccessMigration.match(/'plugin\.safdoulas-data-protection\.manage'/g) || []).length, 1);
});

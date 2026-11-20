import assert from "node:assert/strict";
import test from "node:test";
import { profileSimulationPluginExamples } from "../access/profile-simulation-plugins";
import { safdoulasGovernancePlugin } from "./governance.plugin";
import { safdoulasProcessesPlugin } from "./processes.plugin";
import { safdoulasRegistryPlugin } from "./registry.plugin";

test("SAFDOULAS profile simulation contributes only synthetic accreditation examples to authorized readers", () => {
  const examples = profileSimulationPluginExamples([safdoulasProcessesPlugin], {
    roleId: "accreditation-reader", roleName: "Leitura de processos", permissions: ["plugin.safdoulas-processes.read"],
  });
  assert.deepEqual(examples.map(({ id, type, is_demo }) => ({ id, type, is_demo })), [
    { id: "safdoulas-processes:accreditation-review", type: "accreditation_process", is_demo: true },
    { id: "safdoulas-processes:evidence-check", type: "review_task", is_demo: true },
  ]);
  assert.ok(examples.every(({ description }) => description.includes("fictício") || description.includes("Exercício")));
});

test("SAFDOULAS profile simulation hides accreditation examples without process read permission", () => {
  assert.deepEqual(profileSimulationPluginExamples([safdoulasProcessesPlugin], {
    roleId: "other-role", roleName: "Outro perfil", permissions: ["boards.read"],
  }), []);
});

test("SAFDOULAS registry and governance examples follow their own read permissions", () => {
  const examples = profileSimulationPluginExamples([safdoulasRegistryPlugin, safdoulasGovernancePlugin], {
    roleId: "registry-reviewer", roleName: "Revisão de cadastro e governança",
    permissions: ["plugin.safdoulas-registry.read", "plugin.safdoulas-governance.read"],
  });
  assert.deepEqual(examples.map(({ id, type }) => ({ id, type })), [
    { id: "safdoulas-registry:institution-record", type: "institution_record" },
    { id: "safdoulas-governance:requirement-review", type: "governance_requirement" },
  ]);
  assert.deepEqual(profileSimulationPluginExamples([safdoulasRegistryPlugin, safdoulasGovernancePlugin], {
    roleId: "process-only", roleName: "Processos", permissions: ["plugin.safdoulas-processes.read"],
  }), []);
});

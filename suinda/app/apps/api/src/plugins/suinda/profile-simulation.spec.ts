import assert from "node:assert/strict";
import test from "node:test";
import { profileSimulationPluginExamples } from "../../access/profile-simulation-plugins";
import { suindaPlugin } from "./suinda.plugin";

test("Suindá contributes learning, teaching and management examples according to effective permissions", () => {
  const examples = profileSimulationPluginExamples([suindaPlugin], {
    roleId: "teacher-manager", roleName: "Docente e gestão",
    permissions: ["plugin.suinda-learning.read", "plugin.suinda-learning.write", "plugin.suinda-learning.manage"],
  });
  assert.deepEqual(examples.map(({ id, type, is_demo }) => ({ id, type, is_demo })), [
    { id: "suinda-learning:learning-path", type: "course_progress", is_demo: true },
    { id: "suinda-learning:teaching-review", type: "teaching_task", is_demo: true },
    { id: "suinda-learning:academic-operations", type: "academic_operation", is_demo: true },
  ]);
});

test("Suindá student profiles do not receive teacher or management examples", () => {
  const examples = profileSimulationPluginExamples([suindaPlugin], {
    roleId: "learner", roleName: "Aprendiz", permissions: ["plugin.suinda-learning.read"],
  });
  assert.deepEqual(examples.map(({ id }) => id), ["suinda-learning:learning-path"]);
  assert.deepEqual(profileSimulationPluginExamples([suindaPlugin], {
    roleId: "unrelated", roleName: "Outro perfil", permissions: ["boards.read"],
  }), []);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertOrbitFields, orbitArchitecture } from './orbit-architecture';

test('card mutation rejects invented and legacy fields instead of silently accepting them', () => {
  for (const field of ['status', 'priority', 'commit_type', 'checklists', 'ai_prompt']) {
    assert.throws(() => assertOrbitFields({ title: 'Task', [field]: 'invented' }, orbitArchitecture.cardCreate), /Campos fora da arquitetura/);
    assert.throws(() => assertOrbitFields({ [field]: 'invented' }, orbitArchitecture.cardUpdate), /Campos fora da arquitetura/);
  }
  assert.doesNotThrow(() => assertOrbitFields({ title: 'Task', position: 0 }, orbitArchitecture.cardCreate));
  assert.doesNotThrow(() => assertOrbitFields({ description: 'Validated requirements' }, orbitArchitecture.cardUpdate));
});

test('checklist conversion and references cannot embed arbitrary execution configuration', () => {
  assert.throws(() => assertOrbitFields({ list_id: 'list', custom_fields: [] }, orbitArchitecture.checklistConvert), /Campos fora da arquitetura/);
  assert.throws(() => assertOrbitFields({ ids: [], prompt: 'override' }, orbitArchitecture.contexts), /Campos fora da arquitetura/);
  assert.throws(() => assertOrbitFields([], orbitArchitecture.cardCreate), /objeto válido/);
});

test('prompt-run contract accepts only the instruction and per-run multi-agent option', () => {
  assert.doesNotThrow(() => assertOrbitFields({ instruction: 'Implementar', multiple_agents: false }, orbitArchitecture.promptRunExecute));
  assert.doesNotThrow(() => assertOrbitFields({ multiple_agents: 'true' }, orbitArchitecture.promptRunExecute));
  assert.throws(() => assertOrbitFields({ instruction: 'Implementar', model: 'inventado' }, orbitArchitecture.promptRunExecute), /Campos fora da arquitetura/);
});

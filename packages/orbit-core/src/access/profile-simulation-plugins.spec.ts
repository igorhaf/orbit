import test from 'node:test';
import assert from 'node:assert/strict';
import { profileSimulationPluginExamples } from './profile-simulation-plugins';

test('collects only bounded, marked domain examples without persisting or authorizing them', () => {
  const examples = profileSimulationPluginExamples([{
    id: 'clinic-demo', name: 'Clinic demo', version: '1.0.0',
    contributions: { profileSimulationExamples: context => [
      { id: context.roleId, title: 'Agendamento ilustrativo', type: 'appointment', state: 'scheduled', description: 'Dados sintéticos.', is_demo: true },
      { id: 'unsafe', title: 'Invalido', type: 'sample', state: 'sample', description: 'Must not pass', is_demo: false as true },
    ] },
  }], { roleId: 'student', roleName: 'Estudante', permissions: ['boards.read'] });
  assert.deepEqual(examples, [{
    id: 'clinic-demo:student', title: 'Agendamento ilustrativo', type: 'appointment',
    state: 'scheduled', description: 'Dados sintéticos.', is_demo: true,
  }]);
});

test('skips a failed plugin and caps example count and field lengths', () => {
  const examples = profileSimulationPluginExamples([
    { id: 'broken', name: 'Broken', version: '1.0.0', contributions: { profileSimulationExamples: () => { throw new Error('ignored'); } } },
    { id: 'many', name: 'Many', version: '1.0.0', contributions: { profileSimulationExamples: () => Array.from({length: 30}, (_, i) => ({ id: String(i), title: 'T'.repeat(200), type: 'task', state: 'open', description: 'D'.repeat(600), is_demo: true as const })) } },
  ], { roleId: 'root-view', roleName: 'Root view', permissions: [] });
  assert.equal(examples.length, 12);
  assert.equal(examples[0].title.length, 160);
  assert.equal(examples[0].description.length, 500);
  assert.ok(examples.every(example => example.id.startsWith('many:') && example.is_demo));
});

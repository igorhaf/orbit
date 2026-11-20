import test from 'node:test';
import assert from 'node:assert/strict';
import { withProfileSimulationPluginExamples } from '../../access/profile-simulation-plugins';
import { projectBoardsPlugin } from './project-boards.plugin';

test('contributes synthetic project and board examples to ROOT profile simulations with board read access', () => {
  const provide = projectBoardsPlugin.contributions?.profileSimulationExamples;
  assert.ok(provide);
  const examples = provide({ roleId: 'project-reader', roleName: 'Leitor de projetos', permissions: ['boards.read'] });

  assert.deepEqual(examples.map(({ id, type, state, is_demo }) => ({ id, type, state, is_demo })), [
    { id: 'project-planning', type: 'project', state: 'planning', is_demo: true },
    { id: 'delivery-board', type: 'board', state: 'active', is_demo: true },
    { id: 'blocked-task', type: 'task', state: 'blocked', is_demo: true },
  ]);
  assert.ok(examples.every(({ description }) => description.includes('Exemplo') || description.includes('fictício')));
  const context = withProfileSimulationPluginExamples({ records: [] }, [projectBoardsPlugin], {
    roleId: 'project-reader', roleName: 'Leitor de projetos', permissions: ['boards.read'],
  });
  assert.equal(context.records.length, 3);
  assert.ok(context.records.every(({ id }) => id.startsWith('project-boards:')));
});

test('does not expose board examples to profiles without boards.read', () => {
  const provide = projectBoardsPlugin.contributions?.profileSimulationExamples;
  assert.ok(provide);
  assert.deepEqual(provide({ roleId: 'observer', roleName: 'Observador', permissions: ['profile.read'] }), []);
  assert.deepEqual(provide({ roleId: 'creator', roleName: 'Criador', permissions: ['boards.write'] }), []);
});

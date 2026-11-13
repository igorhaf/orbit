import test from 'node:test';
import assert from 'node:assert/strict';
import { planDemand } from './plan.mjs';

const task = (id, file, dependsOn = []) => ({ id, files: [file], dependsOn, minutes: 30, tokens: 100 });
test('parallel recommendation requires savings in time and tokens, and honors the toggle', () => {
  const spec = { tasks: [task('a', 'src/a.ts'), task('b', 'src/b.ts')], singleAgentTokens: 300, coordinationMinutes: 5, coordinationTokens: 20 };
  assert.equal(planDemand(spec).recommendation, 'multiple_agents');
  assert.equal(planDemand({ ...spec, multipleAgents: false }).recommendation, 'single_agent');
  assert.equal(planDemand({ ...spec, singleAgentTokens: 200 }).recommendation, 'single_agent');
  assert.equal(planDemand({ ...spec, singleAgentTokens: undefined }).recommendation, 'single_agent');
  const three = planDemand({ ...spec, tasks: [...spec.tasks, task('c', 'src/c.ts')], singleAgentTokens: 500 });
  assert.equal(three.maxConcurrentWorkers, 2, 'Use the fewest workers that improve both estimates.');
});
test('overlapping writes and dependencies prevent unsafe parallel editing', () => {
  const overlap = planDemand({ tasks: [task('a', 'src/a.ts'), task('b', 'src/a.ts')], singleAgentTokens: 300 });
  assert.equal(overlap.recommendation, 'single_agent');
  assert.equal(overlap.collisions.length, 1);
  assert.throws(() => planDemand({ tasks: [task('a', 'a', ['b']), task('b', 'b', ['a'])] }), /cycle/);
  assert.throws(() => planDemand({ tasks: [task('a', 'src/a.ts')], writeScope: ['src/b.ts'] }), /write_scope/);
  assert.deepEqual(planDemand({ tasks: [task('child', 'child', ['parent']), task('parent', 'parent')], multipleAgents: false }).waves, [['parent'], ['child']]);
});

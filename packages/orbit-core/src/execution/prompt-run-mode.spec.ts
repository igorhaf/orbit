import assert from 'node:assert/strict';
import test from 'node:test';
import { promptRunMultipleAgents } from './prompt-run-mode';

test('new prompt runs enable multiple agents unless explicitly disabled', () => {
  assert.equal(promptRunMultipleAgents(), true);
  assert.equal(promptRunMultipleAgents({ multiple_agents: true }), true);
  assert.equal(promptRunMultipleAgents({ multiple_agents: false }), false);
});

test('comment replies stay single-agent unless they resume a persisted run', () => {
  assert.equal(promptRunMultipleAgents({}, { comment_id: 'comment' }), false);
  assert.equal(promptRunMultipleAgents({}, { comment_id: 'comment' }, { multiple_agents: true }), true);
});

test('resumes use only the persisted mode; legacy rows without a value stay single-agent', () => {
  assert.equal(promptRunMultipleAgents({ multiple_agents: true }, undefined, { multiple_agents: true }), true);
  assert.equal(promptRunMultipleAgents({ multiple_agents: true }, undefined, { multiple_agents: false }), false);
  assert.equal(promptRunMultipleAgents({ multiple_agents: true }, undefined, {}), false);
});

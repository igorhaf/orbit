import test from 'node:test';
import assert from 'node:assert/strict';
import { canUseAiCodeDevelopment, assertAiCodeDevelopmentAllowed, assertAiCodeDevelopmentPluginCanBeEnabled } from './runtime-code-policy';

test('allows AI code development only in the Forge and Workspace runtime identities', () => {
  for (const runtime of ['dev', 'prod', 'forge', 'workspace']) {
    assert.equal(canUseAiCodeDevelopment(runtime), true, runtime);
    assert.doesNotThrow(() => assertAiCodeDevelopmentAllowed(runtime), runtime);
  }
  for (const runtime of ['safdoulas', 'suinda', 'rumo', 'gastro-oceanica', 'unknown']) {
    assert.equal(canUseAiCodeDevelopment(runtime), false, runtime);
    assert.throws(() => assertAiCodeDevelopmentAllowed(runtime), /Forge e no Workspace/);
    assert.throws(() => assertAiCodeDevelopmentPluginCanBeEnabled(runtime, 'software-development', true), /Forge e no Workspace/);
    assert.doesNotThrow(() => assertAiCodeDevelopmentPluginCanBeEnabled(runtime, 'software-development', false));
  }
  assert.doesNotThrow(() => assertAiCodeDevelopmentPluginCanBeEnabled('dev', 'software-development', true));
});

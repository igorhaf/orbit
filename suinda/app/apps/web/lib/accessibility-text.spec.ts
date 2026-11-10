import assert from 'node:assert/strict';
import test from 'node:test';
import { hasAccessibleText } from './accessibility-text';

test('identifies visible alternative text without discarding visible emoji sequences', () => {
  assert.equal(hasAccessibleText(null), false);
  assert.equal(hasAccessibleText('   '), false);
  assert.equal(hasAccessibleText('\u200b\u2066\u2069\ufeff'), false);
  assert.equal(hasAccessibleText('🧑‍🚀'), true);
  assert.equal(hasAccessibleText('Mapa da aula'), true);
});

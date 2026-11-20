import test from 'node:test';
import assert from 'node:assert/strict';
import { skipToMain } from './skip-to-main';

test('keeps the anchor fallback when the main landmark has not mounted', () => {
  let prevented = false;
  const handled = skipToMain({ preventDefault: () => { prevented = true; } }, {
    querySelector: () => null,
  });

  assert.equal(handled, false);
  assert.equal(prevented, false);
});

test('moves focus to the main landmark when it exists', () => {
  let prevented = false;
  const calls: unknown[][] = [];
  const main = {
    id: '',
    tabIndex: 0,
    focus: (options: unknown) => calls.push(['focus', options]),
    scrollIntoView: (options: unknown) => calls.push(['scrollIntoView', options]),
  };
  const handled = skipToMain({ preventDefault: () => { prevented = true; } }, {
    querySelector: () => main,
  });

  assert.equal(handled, true);
  assert.equal(prevented, true);
  assert.equal(main.id, 'main-content');
  assert.equal(main.tabIndex, -1);
  assert.deepEqual(calls, [
    ['focus', { preventScroll: true }],
    ['scrollIntoView', { block: 'start' }],
  ]);
});

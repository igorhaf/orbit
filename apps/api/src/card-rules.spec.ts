import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardKindFromTitle, dueDateFromTitle, labelColorOptions, nextOccurrence, reminderOptions } from './card-rules';

test('recognizes valid dates in titles without accepting impossible dates', () => {
  assert.equal(dueDateFromTitle('Entrega 25/12/2026')?.toISOString(),'2026-12-26T02:59:00.000Z');
  assert.equal(dueDateFromTitle('Entrega 2028-02-29')?.toISOString(),'2028-03-01T02:59:00.000Z');
  assert.equal(dueDateFromTitle('Entrega 31/02/2026'),null);
});

test('advances recurring due dates past the current time', () => {
  assert.equal(nextOccurrence(new Date('2026-09-01T10:00:00Z'),'daily',new Date('2026-09-03T09:00:00Z')).toISOString(),'2026-09-03T10:00:00.000Z');
  assert.equal(nextOccurrence(new Date('2026-01-31T10:00:00Z'),'monthly',new Date('2026-02-01T10:00:00Z')).toISOString(),'2026-02-28T10:00:00.000Z');
  assert.equal(nextOccurrence(new Date('2028-02-29T10:00:00Z'),'yearly',new Date('2028-03-01T10:00:00Z')).toISOString(),'2029-02-28T10:00:00.000Z');
});

test('supports thirty label colors, no color, and explicit reminder intervals', () => {
  assert.equal(labelColorOptions.size,31);
  assert.ok(labelColorOptions.has('none'));
  assert.ok(reminderOptions.has(0));
  assert.ok(reminderOptions.has(10080));
  assert.ok(!reminderOptions.has(-1));
});

test('classifies separators, board links, external links and ordinary titles',()=>{
  const origin='http://localhost:3000';
  const board='8a624f24-03a6-4580-bbde-da7d6c984abd';
  assert.equal(cardKindFromTitle('---',origin).kind,'separator');
  assert.deepEqual(cardKindFromTitle(`${origin}/board/${board}`,origin),{kind:'board',targetBoardId:board,linkUrl:null});
  assert.equal(cardKindFromTitle('https://github.com/igorhaf/orbit',origin).kind,'link');
  assert.equal(cardKindFromTitle('Revisar https://example.com',origin).kind,'normal');
  assert.equal(cardKindFromTitle('https://example.com/board/'+board,origin).kind,'link');
});

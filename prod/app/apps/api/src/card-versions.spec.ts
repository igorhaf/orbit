import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {
  CardRevisionConflict, assertCardRevision, cardRevisionFields,
  cardRevisionFreshnessSql, isCardRevision, revisionFreshness, finishedRevisionFreshness,
} from './card-versions';

test('base revisions are positive PostgreSQL integers and never inferred for legacy runs', () => {
  for (const value of [1, 2, 2_147_483_647]) assert.equal(isCardRevision(value), true);
  for (const value of [null, undefined, '1', 0, -1, 1.5, NaN, Infinity, 2_147_483_648]) {
    assert.equal(isCardRevision(value), false);
    assert.equal(revisionFreshness(value, 1, 'success'), 'unversioned');
  }
});

test('freshness distinguishes running current work, terminal current output and older demand', () => {
  for (const status of ['queued', 'running', 'waiting_answer']) {
    assert.equal(revisionFreshness(2, 2, status), 'pending');
    assert.equal(revisionFreshness(1, 2, status), 'stale');
  }
  for (const status of ['success', 'failed', 'error', 'cancelled']) assert.equal(revisionFreshness(2, 2, status), 'current');
  assert.equal(revisionFreshness(2, 2), 'current');
  assert.equal(revisionFreshness(3, 2, 'success'), 'stale');
  assert.equal(revisionFreshness(1, undefined), 'unversioned');
});

test('preparing input for an older card fails explicitly instead of silently rebinding', () => {
  assert.doesNotThrow(() => assertCardRevision(4, 4));
  for (const [captured, current] of [[3, 4], [null, 4], [4, null], ['4', 4]]) {
    assert.throws(() => assertCardRevision(captured, current), (error: unknown) => {
      assert.ok(error instanceof CardRevisionConflict);
      assert.equal(error.code, 'CARD_REVISION_CONFLICT');
      assert.equal(error.captured, captured);
      assert.equal(error.current, current);
      return true;
    });
  }
});

test('freshness SQL permits trusted aliases and rejects SQL injection', () => {
  const sql = cardRevisionFreshnessSql('run', 'card');
  assert.match(sql, /run.card_revision IS NULL OR card.card_revision IS NULL/);
  assert.match(sql, /THEN 'stale'/);
  assert.match(sql, /'queued','running','waiting_answer'/);
  assert.match(sql, /ELSE 'current'/);
  for (const alias of ['r;DELETE', 'schema.table', '', 'r--', 'r x']) assert.throws(() => cardRevisionFreshnessSql(alias), /Alias SQL/);
});

test('migration declares exactly the base snapshot fields and excludes operational card state', () => {
  const sql = readFileSync(resolve(__dirname, '../sql/migrations/157_card_revisions.sql'), 'utf8');
  const snapshot = sql.slice(sql.indexOf('SELECT jsonb_build_object('), sql.indexOf(');\n$$;'));
  for (const field of cardRevisionFields) assert.ok(snapshot.includes(`'${field}'`), field);
  for (const field of ['position', 'list_id', 'completed', 'updated_at', 'archived_at', 'mirror_expanded']) {
    assert.ok(!snapshot.includes(`'${field}'`), field);
  }
  assert.match(sql, /FOR SHARE/);
  assert.match(sql, /SET TimeZone = 'UTC'/);
  assert.match(sql, /A new run must capture its card revision/);
  assert.match(sql, /A run cannot change its captured card revision/);
});

test('completion freshness remains historical while current freshness can change later', () => {
  assert.equal(finishedRevisionFreshness(2, 2), 'current');
  assert.equal(revisionFreshness(2, 3, 'success'), 'stale');
  assert.equal(finishedRevisionFreshness(1, 2), 'stale');
  assert.equal(finishedRevisionFreshness(null, 2), 'unversioned');
  assert.equal(finishedRevisionFreshness(1, null), 'unversioned');
});

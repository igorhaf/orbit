import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { auditProductReconciliation, classifyReconciliationFile } from './reconcile.mjs';

test('three-way product reconciliation distinguishes safe upstream updates from overlapping edits', () => {
  const old = 'a'.repeat(64), upstream = 'b'.repeat(64), local = 'c'.repeat(64);
  assert.equal(classifyReconciliationFile({ baselineHash: old, targetHash: old, sourceHash: upstream }), 'upstream-change');
  assert.equal(classifyReconciliationFile({ baselineHash: old, targetHash: local, sourceHash: old }), 'target-change');
  assert.equal(classifyReconciliationFile({ baselineHash: old, targetHash: local, sourceHash: upstream }), 'conflict');
  assert.equal(classifyReconciliationFile({ baselineHash: old, targetHash: upstream, sourceHash: upstream }), 'aligned');
});

test('reconciliation never silently deletes product files or restores target deletions', () => {
  const old = 'a'.repeat(64), upstream = 'b'.repeat(64), local = 'c'.repeat(64);
  assert.equal(classifyReconciliationFile({ baselineHash: old, targetHash: old, sourceHash: null }), 'target-only');
  assert.equal(classifyReconciliationFile({ baselineHash: old, targetHash: null, sourceHash: upstream }), 'target-deleted');
  assert.equal(classifyReconciliationFile({ baselineHash: null, targetHash: null, sourceHash: upstream }), 'source-only');
  assert.equal(classifyReconciliationFile({ baselineHash: old, targetHash: old, sourceHash: upstream, transformed: true }), 'generated-transformation');
  assert.equal(classifyReconciliationFile({ baselineHash: old, targetHash: local, sourceHash: upstream, productManaged: true }), 'product-managed');
  assert.equal(classifyReconciliationFile({ baselineHash: old, targetHash: old, sourceHash: upstream, migration: true }), 'migration-review');
});

test('product reconciliation audit is read-only and excludes environment secrets', () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-product-reconcile-'));
  const targetRoot = resolve(root, 'products/demo/app'), baseRoot = resolve(root, 'forge/app');
  const write = (path, value) => { const full = resolve(root, path); mkdirSync(full.slice(0, full.lastIndexOf('/')), { recursive: true }); writeFileSync(full, value); };
  const digest = value => createHash('sha256').update(value).digest('hex');
  try {
    write('products/demo/app/aligned.txt', 'same'); write('forge/app/aligned.txt', 'same');
    write('products/demo/app/upstream.txt', 'old'); write('forge/app/upstream.txt', 'new');
    write('products/demo/app/conflict.txt', 'local'); write('forge/app/conflict.txt', 'upstream');
    write('products/demo/app/removed-upstream.txt', 'old'); write('products/demo/app/.env', 'never read'); write('forge/app/.env', 'never read'); write('forge/app/source-new.txt', 'new source file');
    const profile = { id: 'demo', app: 'products/demo/app', basedOn: 'forge' };
    write('products/demo/product.profile.json', JSON.stringify(profile));
    write('products/demo/generation.manifest.json', JSON.stringify({
      generator: 'orbit.generate.product', source: { app: 'forge/app', mode: 'working-tree', dirty: false },
      transformations: [{ path: 'app/transformed.txt' }],
      files: [
        { path: 'app/aligned.txt', sha256: digest('same') },
        { path: 'app/upstream.txt', sha256: digest('old') },
        { path: 'app/conflict.txt', sha256: digest('baseline') },
        { path: 'app/removed-upstream.txt', sha256: digest('old') },
        { path: 'app/transformed.txt', sha256: digest('old') },
      ],
    }));
    write('products/demo/app/transformed.txt', 'local'); write('forge/app/transformed.txt', 'upstream');
    const result = auditProductReconciliation({
      root,
      runtime: { id: 'demo', app: 'products/demo/app' },
      baseRuntime: { id: 'forge', app: 'forge/app' },
    });
    assert.equal(result.mode, 'read-only-audit');
    assert.equal(result.counts.aligned, 1);
    assert.equal(result.counts['upstream-change'], 1);
    assert.equal(result.counts.conflict, 1);
    assert.equal(result.counts['target-only'], 1);
    assert.equal(result.counts['generated-transformation'], 1);
    assert.equal(result.counts['source-only'], 1);
    assert.deepEqual(result.writes, []);
    assert.equal(readFileSync(resolve(targetRoot, 'upstream.txt'), 'utf8'), 'old');
    assert.ok(!Object.values(result.samples).flat().some(path => path.endsWith('.env')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

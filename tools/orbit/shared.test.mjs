import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execute, persistSharedPlan, reconcileShared, safePath } from './shared.mjs';

function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'orbit-shared-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(resolve(root, 'packages/core/src'), { recursive: true });
  mkdirSync(resolve(root, 'dev/app/src'), { recursive: true });
  writeFileSync(resolve(root, 'packages/core/src/example.ts'), 'export const value = 1;\n');
  writeFileSync(resolve(root, 'dev/app/src/example.ts'), 'export const value = 1;\n');
  const pkg = { id: '@orbit/test', path: 'packages/core', version: '1.0.0', files: [{ source: 'src/example.ts', target: 'src/example.ts' }] };
  const metadata = () => writeFileSync(resolve(root, 'packages/core/package.json'), JSON.stringify({ name: pkg.id, version: pkg.version, orbit: { files: pkg.files } }));
  metadata();
  return { root, config: { runtimes: [{ id: 'dev', app: 'dev/app' }], sharedPackages: [pkg] }, metadata, pkg };
}

test('shared source lock is reproducible and changes require a version bump', async t => {
  const context = fixture(t);
  assert.equal((await execute('shared', ['check'], context)).ok, false);
  await execute('shared', ['sync', '--write'], context);
  assert.equal((await execute('shared', ['check'], context)).ok, true);
  writeFileSync(resolve(context.root, 'packages/core/src/example.ts'), 'export const value = 2;\n');
  await assert.rejects(execute('shared', ['sync', '--write'], context), /Bump/);
  context.pkg.version = '1.0.1'; context.metadata();
  await execute('shared', ['sync', '--write'], context);
  assert.match(readFileSync(resolve(context.root, 'dev/app/src/example.ts'), 'utf8'), /value = 2/);
});

test('shared sync preflights all files and rejects an independently edited projection', async t => {
  const context = fixture(t);
  await execute('shared', ['sync', '--write'], context);
  writeFileSync(resolve(context.root, 'dev/app/src/example.ts'), 'local edit');
  await assert.rejects(execute('shared', ['sync', '--write'], context), /independent changes/);
  assert.equal(readFileSync(resolve(context.root, 'dev/app/src/example.ts'), 'utf8'), 'local edit');
  assert.throws(() => safePath(context.root, '../escape'), /Unsafe/);
  assert.throws(() => safePath(context.root, '.git/config'), /Unsafe/);
});

test('version bump updates package and workspace together only on explicit write', async t => {
  const context = fixture(t);
  writeFileSync(resolve(context.root, 'orbit.workspace.json'), JSON.stringify(context.config));
  const planned = await execute('shared', ['bump', '@orbit/test', 'minor'], context);
  assert.equal(planned.next, '1.1.0');
  assert.equal(JSON.parse(readFileSync(resolve(context.root, 'packages/core/package.json'))).version, '1.0.0');
  await execute('shared', ['bump', '@orbit/test', 'minor', '--write'], context);
  assert.equal(JSON.parse(readFileSync(resolve(context.root, 'packages/core/package.json'))).version, '1.1.0');
  assert.equal(JSON.parse(readFileSync(resolve(context.root, 'orbit.workspace.json'))).sharedPackages[0].version, '1.1.0');
});

const sourcePath = 'packages/core/src/example.ts';
const read = (context, path) => readFileSync(resolve(context.root, path), 'utf8');
const write = (context, path, contents) => writeFileSync(resolve(context.root, path), contents);
const hash = contents => createHash('sha256').update(contents).digest('hex');

async function initialized(t) {
  const context = fixture(t);
  context.config.runtimes.push({ id: 'prod', app: 'prod/app' });
  mkdirSync(resolve(context.root, 'prod/app/src'), { recursive: true });
  write(context, 'prod/app/src/example.ts', read(context, sourcePath));
  write(context, 'orbit.workspace.json', JSON.stringify(context.config));
  await execute('shared', ['sync', '--write'], context);
  return context;
}

test('automatic reconciliation bumps once and publishes every runtime projection and lock', async t => {
  const context = await initialized(t);
  write(context, sourcePath, 'export const value = 2;\n');
  const result = await reconcileShared(context, { changedFiles: [sourcePath], allowWrite: true });
  assert.equal(result.ok, true); assert.equal(result.written, true);
  assert.deepEqual(result.releases, [{ id: '@orbit/test', previous: '1.0.0', next: '1.0.1', increment: 'patch', automatic: true }]);
  assert.equal(JSON.parse(read(context, 'packages/core/package.json')).version, '1.0.1');
  assert.equal(JSON.parse(read(context, 'orbit.workspace.json')).sharedPackages[0].version, '1.0.1');
  for (const runtime of context.config.runtimes) {
    assert.equal(read(context, `${runtime.app}/src/example.ts`), 'export const value = 2;\n');
    assert.equal(JSON.parse(read(context, `${runtime.app}/orbit.shared-lock.json`)).packages[0].version, '1.0.1');
  }
  const repeated = await reconcileShared(context, { changedFiles: [sourcePath], allowWrite: true });
  assert.equal(repeated.ok, true); assert.equal(repeated.written, false);
  assert.deepEqual(repeated.releases, []); assert.deepEqual(repeated.changedPaths, []);
});

test('read-only reconciliation plans a release without writing metadata, locks or projections', async t => {
  const context = await initialized(t);
  const oldMetadata = read(context, 'packages/core/package.json'), oldLock = read(context, 'dev/app/orbit.shared-lock.json');
  write(context, sourcePath, 'export const value = 2;\n');
  const result = await reconcileShared(context, { changedFiles: [sourcePath], allowWrite: false });
  assert.equal(result.ok, true); assert.equal(result.written, false); assert.equal(result.requiresWrite, true);
  assert.equal(result.releases[0].next, '1.0.1');
  assert.equal(read(context, 'packages/core/package.json'), oldMetadata);
  assert.equal(read(context, 'dev/app/orbit.shared-lock.json'), oldLock);
  assert.equal(read(context, 'dev/app/src/example.ts'), 'export const value = 1;\n');
});

test('scope and project boundaries are checked for the entire release before any write', async t => {
  const context = await initialized(t);
  write(context, sourcePath, 'export const value = 2;\n');
  const metadata = read(context, 'packages/core/package.json'), workspace = read(context, 'orbit.workspace.json');
  const denied = await reconcileShared(context, { changedFiles: [sourcePath], writeScope: [sourcePath], allowWrite: true });
  assert.equal(denied.ok, false); assert.equal(denied.blocked, 'write-scope');
  assert.ok(denied.requiredScope.includes('orbit.workspace.json'));
  assert.ok(denied.requiredScope.includes('prod/app/src/example.ts'));
  const narrowProject = await reconcileShared(context, { changedFiles: [sourcePath], projectRoot: resolve(context.root, 'dev/app'), allowWrite: true });
  assert.equal(narrowProject.ok, false); assert.ok(narrowProject.requiredScope.includes('packages/core/package.json'));
  assert.equal(read(context, 'packages/core/package.json'), metadata);
  assert.equal(read(context, 'orbit.workspace.json'), workspace);
  assert.equal(read(context, 'prod/app/src/example.ts'), 'export const value = 1;\n');
  const plan = await reconcileShared(context, { changedFiles: [sourcePath], allowWrite: false });
  const allowed = await reconcileShared(context, { changedFiles: [sourcePath], writeScope: plan.changedPaths, projectRoot: context.root, allowWrite: true });
  assert.equal(allowed.ok, true); assert.equal(allowed.written, true);
});

test('a preexisting canonical change not attributed to this execution is preserved without a release', async t => {
  const context = await initialized(t);
  write(context, sourcePath, 'export const preexisting = true;\n');
  const metadata = read(context, 'packages/core/package.json');
  const result = await reconcileShared(context, { changedFiles: ['dev/app/src/unrelated.ts'], allowWrite: true });
  assert.equal(result.ok, false); assert.ok(result.diagnostics.some(item => item.code === 'unattributed-source-change'));
  assert.equal(read(context, sourcePath), 'export const preexisting = true;\n');
  assert.equal(read(context, 'packages/core/package.json'), metadata);
  assert.equal(read(context, 'dev/app/src/example.ts'), 'export const value = 1;\n');
});

test('a preexisting partial release is not propagated to other runtimes without attribution', async t => {
  const context = await initialized(t);
  write(context, sourcePath, 'export const value = 2;\n');
  context.pkg.version = '1.0.1'; context.metadata();
  write(context, 'orbit.workspace.json', JSON.stringify(context.config));
  await execute('shared', ['sync', '--runtime', 'dev', '--write'], context);
  const result = await reconcileShared(context, { changedFiles: [], allowWrite: true });
  assert.equal(result.ok, false); assert.ok(result.diagnostics.some(item => item.code === 'unattributed-pending-release'));
  assert.equal(read(context, 'prod/app/src/example.ts'), 'export const value = 1;\n');
});

test('independent edits and deletions in a projection block the whole release', async t => {
  const context = await initialized(t);
  write(context, sourcePath, 'export const value = 2;\n');
  write(context, 'prod/app/src/example.ts', 'independent local edit\n');
  const result = await reconcileShared(context, { changedFiles: [sourcePath], allowWrite: true });
  assert.equal(result.ok, false); assert.ok(result.diagnostics.some(item => item.code === 'local-drift'));
  assert.equal(read(context, 'prod/app/src/example.ts'), 'independent local edit\n');
  assert.equal(JSON.parse(read(context, 'packages/core/package.json')).version, '1.0.0');
  rmSync(resolve(context.root, 'prod/app/src/example.ts'));
  const deletion = await reconcileShared(context, { changedFiles: [sourcePath], allowWrite: true });
  assert.ok(deletion.diagnostics.some(item => item.code === 'local-drift'));
});

test('an explicitly versioned source is not bumped again and explicit minor releases are supported', async t => {
  const context = await initialized(t);
  write(context, sourcePath, 'export const value = 2;\n');
  context.pkg.version = '1.2.0'; context.metadata();
  write(context, 'orbit.workspace.json', JSON.stringify(context.config));
  const result = await reconcileShared(context, { changedFiles: [sourcePath], allowWrite: true, release: 'major' });
  assert.equal(result.ok, true); assert.equal(result.releases[0].next, '1.2.0'); assert.equal(result.releases[0].automatic, false);
  assert.equal(JSON.parse(read(context, 'packages/core/package.json')).version, '1.2.0');
  write(context, sourcePath, 'export const value = 3;\n');
  const minor = await reconcileShared(context, { changedFiles: [sourcePath], allowWrite: true, release: 'minor' });
  assert.equal(minor.ok, true); assert.equal(minor.releases[0].next, '1.3.0');
});

test('version regression and removed ownership are diagnosed without deleting projected code', async t => {
  const context = await initialized(t);
  context.pkg.version = '0.9.0'; context.metadata();
  write(context, 'orbit.workspace.json', JSON.stringify(context.config));
  const regression = await reconcileShared(context, { changedFiles: [sourcePath], allowWrite: true });
  assert.ok(regression.diagnostics.some(item => item.code === 'version-regression'));
  context.pkg.version = '1.0.0'; context.pkg.files = []; context.metadata();
  write(context, 'orbit.workspace.json', JSON.stringify(context.config));
  const removal = await reconcileShared(context, { changedFiles: ['orbit.workspace.json'], allowWrite: true });
  assert.ok(removal.diagnostics.some(item => item.code === 'removed-projection'));
  assert.equal(read(context, 'dev/app/src/example.ts'), 'export const value = 1;\n');
});

test('discovered products receive the release without being persisted as raw runtimes', async t => {
  const context = await initialized(t);
  mkdirSync(resolve(context.root, 'products/academy/app/src'), { recursive: true });
  write(context, 'products/academy/app/src/example.ts', read(context, sourcePath));
  const lock = JSON.parse(read(context, 'dev/app/orbit.shared-lock.json')); lock.runtime = 'academy';
  write(context, 'products/academy/app/orbit.shared-lock.json', JSON.stringify(lock));
  context.config.runtimes.push({ id: 'academy', app: 'products/academy/app' });
  write(context, sourcePath, 'export const value = 2;\n');
  const result = await reconcileShared(context, { changedFiles: [sourcePath], allowWrite: true });
  assert.equal(result.ok, true);
  assert.equal(read(context, 'products/academy/app/src/example.ts'), 'export const value = 2;\n');
  assert.deepEqual(JSON.parse(read(context, 'orbit.workspace.json')).runtimes.map(item => item.id), ['dev', 'prod']);
});

test('transaction persistence restores both metadata files even after a late write failure', t => {
  const context = fixture(t);
  write(context, 'orbit.workspace.json', JSON.stringify(context.config));
  const paths = ['packages/core/package.json', 'orbit.workspace.json'];
  const originals = new Map(paths.map(path => [path, read(context, path)]));
  const entries = paths.map(path => ({ path, before: hash(originals.get(path)), contents: 'changed\n' }));
  let writes = 0;
  assert.throws(() => persistSharedPlan(context.root, entries, { atomicWrite(path, contents) { writeFileSync(path, contents); if (++writes === 2) throw new Error('simulated write failure'); } }), /original destinations restored/);
  for (const path of paths) assert.equal(read(context, path), originals.get(path));
});

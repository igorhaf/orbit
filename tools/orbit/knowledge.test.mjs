import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import test from 'node:test';
import { execute, importVerificationChecks } from './knowledge.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'orbit-knowledge-'));
  execFileSync('git', ['init', '-q', root]);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = { runtimes: ['dev', 'prod', 'safdoulas', 'suinda'].map((id) => ({ id, app: `${id}/app` })) };
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const track = () => execFileSync('git', ['add', '.'], { cwd: root });
  return { root, config, put, track };
}

test('index excludes secret paths and actual tokens, reuses unchanged chunks and isolates runtime queries', async (t) => {
  const context = fixture(t);
  context.put('dev/app/apps/api/src/plugins/contract.ts', 'export type PluginDefinition = { dependencies: string[] }; // moonstone shared contract');
  context.put('suinda/app/apps/api/src/course.ts', 'moonstone exclusive academic course access');
  context.put('docs/architecture.md', 'moonstone architecture permissions');
  context.put('dev/app/.env', 'moonstone password=actual');
  context.put('dev/app/.env.example', 'moonstone PASSWORD=sample');
  context.put('dev/app/data/records.json', '{"moonstone":"private records"}');
  context.put('dev/app/credentials/access.json', '{"moonstone":"private credentials"}');
  context.put('dev/app/config.json', `{"moonstone":"ghp_${'A'.repeat(35)}"}`);
  context.put('dev/app/.orbit/sessions/session.md', 'moonstone private conversation');
  context.put('dev/app/private.md', 'moonstone postgres://user:password@example.com/database');
  context.track();
  const first = await execute('knowledge', ['index'], context);
  assert.equal(first.indexed, 3);
  const second = await execute('knowledge', ['index'], context);
  assert.equal(second.reused, 3);
  const result = await execute('knowledge', ['query', '--query', 'moonstone'], context);
  assert.equal(result.runtime, 'dev');
  assert.equal(result.results.length, 2);
  assert(result.results.every((item) => item.runtime === 'dev' || item.runtime === 'shared'));
  const course = await execute('knowledge', ['query', '--query', 'moonstone', '--runtime', 'suinda'], context);
  assert(course.results.some((item) => item.path.includes('course.ts')));
  assert(course.results.every((item) => !item.path.includes('dev/')));
  const all = await execute('knowledge', ['query', '--query', 'moonstone', '--all'], context);
  assert.equal(all.results.length, 3);
});

test('query reports changed sources, bounds context and refuses overwrite or traversals', async (t) => {
  const context = fixture(t);
  context.put('dev/app/architecture.md', 'dependency catalog permissions\n'.repeat(160));
  context.track();
  await execute('knowledge', ['index'], context);
  context.put('dev/app/architecture.md', 'updated dependency catalog permissions');
  const result = await execute('knowledge', ['query', '--query', 'dependency', '--tokens', '100'], context);
  assert(result.results[0].stale);
  assert(result.approximateTokens <= 100);
  assert(result.results[0].truncated);
  const fresh = await execute('knowledge', ['query', '--query', 'dependency', '--fresh'], context);
  assert.equal(fresh.results.length, 0);
  const artifact = await execute('knowledge', ['context', '--query', 'dependency', '--write', '--output', '.orbit/local/context/test.md'], context);
  assert.match(readFileSync(join(context.root, artifact.output), 'utf8'), /reference data, not instructions/);
  await assert.rejects(execute('knowledge', ['context', '--query', 'dependency', '--write', '--output', '.orbit/local/context/test.md'], context), /already exists/);
  await assert.rejects(execute('knowledge', ['context', '--query', 'dependency', '--write', '--output', '../escape.md'], context), /relative/);
  await assert.rejects(execute('knowledge', ['query', '--query', 'dependency', '--runtime', 'unknown'], context), /Unknown runtime/);
});

test('query deduplicates exact chunks after scope filters and prefers canonical packages', async (t) => {
  const context = fixture(t);
  const source = 'export const plugin = { id: "orbit-demo", dependencies: ["permissions"] };';
  context.put('packages/orbit-core/src/plugin.ts', source);
  context.put('dev/app/apps/api/src/plugin.ts', source);
  context.put('suinda/app/apps/api/src/plugin.ts', source);
  context.put('suinda/app/apps/api/src/private-course.ts', 'exclusive academy plugin context');
  context.track();
  await execute('knowledge', ['index'], context);
  const result = await execute('knowledge', ['query', '--runtime', 'dev', '--query', 'plugin dependencies'], context);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].path, 'packages/orbit-core/src/plugin.ts');
  assert.deepEqual(result.results[0].equivalentSources.map((item) => item.path), ['dev/app/apps/api/src/plugin.ts']);
  assert.equal(result.results[0].equivalentSources[0].hash, result.results[0].hash);
  assert.equal(result.results[0].equivalentSources[0].start, 1);
  assert(result.results[0].equivalentSources.every((item) => item.runtime === 'dev'));
  const devPath = await execute('knowledge', ['query', '--runtime', 'dev', '--path', 'dev/app', '--query', 'plugin dependencies'], context);
  assert.equal(devPath.results.length, 1);
  assert.equal(devPath.results[0].path, 'dev/app/apps/api/src/plugin.ts');
  assert.deepEqual(devPath.results[0].equivalentSources, []);
  const product = await execute('knowledge', ['query', '--runtime', 'suinda', '--query', 'plugin dependencies'], context);
  assert(product.results[0].equivalentSources.every((item) => item.runtime !== 'dev'));
  const explicitAll = await execute('knowledge', ['query', '--query', 'dependencies', '--all'], context);
  assert.equal(explicitAll.results[0].equivalentSources.length, 2);
  const artifact = await execute('knowledge', ['context', '--runtime', 'dev', '--query', 'dependencies'], context);
  assert.match(artifact.markdown, /Equivalent scoped sources: dev\/app/);
  assert.doesNotMatch(artifact.markdown, /suinda\/app/);
});

test('product-root docs and generated profiles remain scoped even with legacy cached classification', async (t) => {
  const context = fixture(t);
  context.config.runtimes.push({ id: 'foo', app: 'products/foo/app' });
  context.config.runtimes.push({ id: 'bar', app: 'products/bar/server', root: 'products/bar' });
  context.put('README.md', 'isolationbridge shared platform architecture');
  context.put('suinda/README.md', 'isolationbridge private institution documentation');
  context.put('suinda/compose.yml', 'name: isolationbridge-suinda');
  context.put('products/foo/product.profile.json', '{"description":"isolationbridge foo profile"}');
  context.put('products/bar/README.md', 'isolationbridge bar product-root document');
  context.track();
  await execute('knowledge', ['index'], context);
  const cachedPath = '.orbit/cache/knowledge/index.json';
  const legacy = JSON.parse(readFileSync(join(context.root, cachedPath), 'utf8'));
  legacy.documents.forEach((doc) => { doc.runtime = 'shared'; });
  context.put(cachedPath, JSON.stringify(legacy));
  const dev = await execute('knowledge', ['query', '--runtime', 'dev', '--query', 'isolationbridge'], context);
  assert.deepEqual(dev.results.map((item) => item.path), ['README.md']);
  const foo = await execute('knowledge', ['query', '--runtime', 'foo', '--query', 'isolationbridge'], context);
  assert(foo.results.some((item) => item.path === 'products/foo/product.profile.json' && item.runtime === 'foo'));
  assert(foo.results.every((item) => !item.path.startsWith('suinda/') && !item.path.startsWith('products/bar/')));
  const bar = await execute('knowledge', ['query', '--runtime', 'bar', '--query', 'isolationbridge'], context);
  assert(bar.results.some((item) => item.path === 'products/bar/README.md' && item.runtime === 'bar'));
  const updated = await execute('knowledge', ['index'], context);
  assert.equal(updated.reused, 5);
  const current = JSON.parse(readFileSync(join(context.root, cachedPath), 'utf8'));
  assert.equal(current.documents.find((doc) => doc.path === 'suinda/README.md').runtime, 'suinda');
  assert.equal(current.documents.find((doc) => doc.path === 'products/foo/product.profile.json').runtime, 'foo');
});

test('explicit includes reject symbolic-link sources and permit safe untracked contracts', async (t) => {
  const context = fixture(t);
  context.put('README.md', 'reference architecture');
  context.track();
  context.put('draft/new-plugin.ts', 'const plugin = {id: "new-plugin", dependencies: []};');
  const result = await execute('knowledge', ['index', '--include', 'draft'], context);
  assert.equal(result.indexed, 2);
  symlinkSync(tmpdir(), join(context.root, 'escape'));
  await assert.rejects(execute('knowledge', ['index', '--include', 'escape'], context), /Symbolic links/);
});

test('metrics serializes competing writes, measures completed sessions and rejects duplicates', async (t) => {
  const context = fixture(t);
  const sessions = await Promise.all(['setup', 'implementation'].map((phase) => execute('metrics', ['start', '--milestone', 'first', '--phase', phase], context)));
  assert.notEqual(sessions[0].session.id, sessions[1].session.id);
  await assert.rejects(execute('metrics', ['start', '--milestone', 'first', '--phase', 'setup'], context), /active session/);
  await assert.rejects(execute('metrics', ['stop'], context), /exactly one/);
  await Promise.all(sessions.map(({ session }) => execute('metrics', ['stop', '--id', session.id], context)));
  const report = await execute('metrics', ['report', '--milestone', 'first'], context);
  assert.equal(report.completedSessions, 2);
  assert.equal(report.active.length, 0);
  assert.equal(Object.keys(report.byPhase).length, 2);
  assert(report.totalRecordedSeconds >= 0);
  await assert.rejects(execute('metrics', ['start', '--milestone', '../wrong', '--phase', 'setup'], context), /Invalid milestone/);
});

test('delivery reports actual command evidence separately from functional acceptance', async (t) => {
  const context = fixture(t);
  await execute('delivery', ['init', '--milestone', 'alpha', '--requirement', 'Reusable contracts', '--acceptance', 'Verify dependency handling'], context);
  let report = await execute('delivery', ['report', '--milestone', 'alpha'], context);
  assert.equal(report.status, 'pending');
  const passed = await execute('delivery', ['check', '--milestone', 'alpha', '--name', 'node-check', '--', process.execPath, '-e', 'process.stdout.write("verified")'], context);
  assert.equal(passed.check.status, 'passed');
  report = await execute('delivery', ['report', '--milestone', 'alpha'], context);
  assert.equal(report.status, 'requirements_pending');
  assert.equal(report.manifest.requirements[0].status, 'pending');
  assert.equal(report.manifest.review, 'pending');
  context.put('docs/evidence.md', 'Contract review');
  await execute('delivery', ['evidence', '--milestone', 'alpha', '--requirement', 'R1', '--file', 'docs/evidence.md'], context);
  report = await execute('delivery', ['report', '--milestone', 'alpha'], context);
  assert.equal(report.manifest.requirements[0].status, 'evidenced');
  context.put(passed.check.evidence, '{}');
  report = await execute('delivery', ['report', '--milestone', 'alpha'], context);
  assert.equal(report.manifest.checks[0].status, 'unverified');
  const failed = await execute('delivery', ['check', '--milestone', 'alpha', '--', process.execPath, '-e', 'process.exit(2)'], context);
  assert.equal(failed.check.status, 'failed');
  report = await execute('delivery', ['report', '--milestone', 'alpha'], context);
  assert.equal(report.status, 'checks_failed');
});

test('delivery captures missing executables and enforces command timeout', async (t) => {
  const context = fixture(t);
  await execute('delivery', ['init', '--milestone', 'alpha'], context);
  const missing = await execute('delivery', ['check', '--milestone', 'alpha', '--', 'orbit-impossible-command-3476234'], context);
  assert.equal(missing.check.status, 'failed');
  const slow = await execute('delivery', ['check', '--milestone', 'alpha', '--timeout', '100', '--', process.execPath, '-e', 'setTimeout(()=>{},5000)'], context);
  assert.equal(slow.check.status, 'failed');
  assert.equal(slow.check.timedOut, true);
});

test('functional review requires explicit write, current evidence and actual passing checks', async (t) => {
  const context = fixture(t);
  context.put('dev/app/contract.ts', 'export const contract = "initial";');
  context.put('docs/review.md', 'Functional acceptance reviewed with a fixture.');
  context.track();
  await execute('delivery', ['init', '--milestone', 'reviewable', '--requirement', 'Preserve contract'], context);
  const review = ['review', '--milestone', 'reviewable', '--reviewer', 'Integrator', '--note', 'Checked contract behavior with local fixtures.'];
  await assert.rejects(execute('delivery', review, context), /explicit --write/);
  await assert.rejects(execute('delivery', [...review, '--write'], context), /blocked/);
  await execute('delivery', ['evidence', '--milestone', 'reviewable', '--requirement', 'R1', '--file', 'docs/review.md'], context);
  await assert.rejects(execute('delivery', [...review, '--write'], context), /No checks/);
  await execute('delivery', ['check', '--milestone', 'reviewable', '--name', 'contract', '--', process.execPath, '-e', 'process.exit(1)'], context);
  await assert.rejects(execute('delivery', [...review, '--write'], context), /check is failed/);
  await execute('delivery', ['check', '--milestone', 'reviewable', '--name', 'contract', '--', process.execPath, '-e', 'process.exit(0)'], context);
  let report = await execute('delivery', ['report', '--milestone', 'reviewable'], context);
  assert.equal(report.status, 'checks_passed_review_pending');
  assert.equal(report.manifest.checks[0].superseded, true);
  report = await execute('delivery', [...review, '--write'], context);
  assert.equal(report.status, 'completed');
  assert.equal(report.manifest.review, 'approved');
  assert.equal(report.manifest.functionalReview.reviewer, 'Integrator');
  context.put('docs/review.md', 'Acceptance document changed after review.');
  report = await execute('delivery', ['report', '--milestone', 'reviewable'], context);
  assert.equal(report.status, 'checks_stale');
  assert.equal(report.manifest.requirements[0].status, 'stale');
  assert.equal(report.manifest.review, 'pending');
  await assert.rejects(execute('delivery', [...review, '--write'], context), /blocked/);
  await execute('delivery', ['evidence', '--milestone', 'reviewable', '--requirement', 'R1', '--file', 'docs/review.md'], context);
  await execute('delivery', ['check', '--milestone', 'reviewable', '--name', 'contract', '--', process.execPath, '-e', 'process.exit(0)'], context);
  report = await execute('delivery', ['report', '--milestone', 'reviewable'], context);
  assert.equal(report.status, 'review_stale');
  report = await execute('delivery', [...review, '--write'], context);
  assert.equal(report.status, 'completed');
});

test('source fingerprints cover new allowlisted files and invalidate source mutation during execution', async (t) => {
  const context = fixture(t);
  context.put('dev/app/contract.ts', 'const contract = "first";');
  context.track();
  await execute('delivery', ['init', '--milestone', 'sources', '--requirement', 'Keep sources checked'], context);
  const first = await execute('delivery', ['check', '--milestone', 'sources', '--name', 'stable', '--', process.execPath, '-e', 'process.exit(0)'], context);
  assert.equal(first.check.status, 'passed');
  context.put('packages/contract/new.ts', 'const added = true;');
  let report = await execute('delivery', ['report', '--milestone', 'sources'], context);
  assert.equal(report.manifest.checks[0].status, 'stale');
  const mutation = await execute('delivery', ['check', '--milestone', 'sources', '--name', 'mutating', '--', process.execPath, '-e', 'require("node:fs").writeFileSync("dev/app/contract.ts", "changed by check");'], context);
  assert.equal(mutation.check.status, 'stale');
  assert.notEqual(mutation.check.sourcesAtStart.fingerprint, mutation.check.sourcesAtEnd.fingerprint);
  report = await execute('delivery', ['report', '--milestone', 'sources'], context);
  assert.equal(report.status, 'checks_stale');
});

test('explicit source scopes isolate independent changes and refuse sensitive scope paths', async (t) => {
  const context = fixture(t);
  context.put('dev/app/contract.ts', 'const contract = true;');
  context.put('prod/app/unrelated.ts', 'const unrelated = false;');
  context.put('dev/app/.env', 'PASSWORD=private');
  context.put('dev/app/package-lock.json', '{"lockfileVersion":3}');
  context.put('dev/app/data/package-lock.json', '{"private":"never snapshot"}');
  context.track();
  await execute('delivery', ['init', '--milestone', 'scoped'], context);
  const result = await execute('delivery', ['check', '--milestone', 'scoped', '--scope', 'dev/app', '--', process.execPath, '-e', 'process.exit(0)'], context);
  assert.equal(result.check.sourcesAtStart.fileCount, 2);
  context.put('prod/app/unrelated.ts', 'const unrelated = true;');
  const report = await execute('delivery', ['report', '--milestone', 'scoped'], context);
  assert.equal(report.manifest.checks[0].status, 'passed');
  context.put('dev/app/package-lock.json', '{"lockfileVersion":4}');
  const changedLock = await execute('delivery', ['report', '--milestone', 'scoped'], context);
  assert.equal(changedLock.manifest.checks[0].status, 'stale');
  await assert.rejects(execute('delivery', ['check', '--milestone', 'scoped', '--scope', 'dev/app/.env', '--', process.execPath, '-e', 'process.exit(0)'], context), /Sensitive/);
});

test('default delivery snapshots ignore tracked links without ever reading their external targets', async (t) => {
  const context = fixture(t);
  const external = mkdtempSync(join(tmpdir(), 'orbit-external-source-'));
  t.after(() => rmSync(external, { recursive: true, force: true }));
  const externalFile = join(external, 'outside.md');
  writeFileSync(externalFile, 'PRIVATE_EXTERNAL_CONTENT');
  context.put('dev/app/contract.ts', 'export const safe = true;');
  context.put('linked-docs/outside.md', 'Initially local tracked source.');
  symlinkSync(externalFile, join(context.root, 'external-link.md'));
  symlinkSync('dev/app/contract.ts', join(context.root, 'internal-link.md'));
  symlinkSync(join(external, 'missing.md'), join(context.root, 'dangling-link.md'));
  context.track();
  rmSync(join(context.root, 'linked-docs'), { recursive: true });
  symlinkSync(external, join(context.root, 'linked-docs'));
  const originalRead = fs.readFileSync;
  let externalReads = 0;
  fs.readFileSync = function (path, ...args) {
    const requested = String(path);
    if (requested.startsWith(external) || requested === join(context.root, 'external-link.md') || requested.startsWith(join(context.root, 'linked-docs'))) {
      externalReads++;
      throw new Error('An external linked target must never be read.');
    }
    return originalRead.call(this, path, ...args);
  };
  syncBuiltinESMExports();
  try {
    await execute('delivery', ['init', '--milestone', 'linked'], context);
    const checked = await execute('delivery', ['check', '--milestone', 'linked', '--', process.execPath, '-e', 'process.exit(0)'], context);
    assert.equal(checked.check.status, 'passed');
    assert.equal(checked.check.sourcesAtStart.fileCount, 1);
    writeFileSync(externalFile, 'Changed external content remains outside the snapshot.');
    const report = await execute('delivery', ['report', '--milestone', 'linked'], context);
    assert.equal(report.manifest.checks[0].status, 'passed');
    assert.equal(externalReads, 0);
    await assert.rejects(execute('delivery', ['check', '--milestone', 'linked', '--scope', 'external-link.md', '--', process.execPath, '-e', 'process.exit(0)'], context), /Symbolic links/);
    assert.equal(externalReads, 0);
  } finally {
    fs.readFileSync = originalRead;
    syncBuiltinESMExports();
  }
});

test('verification import consumes real executed and cached evidence without rerunning commands', async (t) => {
  const context = fixture(t);
  context.config.sharedPackages = [];
  for (const runtime of context.config.runtimes) context.put(`${runtime.app}/orbit.shared-lock.json`, `${JSON.stringify({ schemaVersion: 1, runtime: runtime.id, packages: [] }, null, 2)}\n`);
  context.put('scripts/verify-plugin-compatibility.mjs', 'import {mkdirSync,appendFileSync} from "node:fs";mkdirSync(".orbit/local",{recursive:true});appendFileSync(".orbit/local/executions.txt","executed\\n");');
  context.put('docs/check.md', 'Contract evidence from actual execution.');
  context.track();
  const { execute: verify } = await import('./verify.mjs');
  const verified = await verify('check', ['--files', 'docs/check.md', '--run'], context);
  assert.equal(verified.verificationStatus, 'passed');
  assert.equal(verified.checks[0].status, 'passed');
  context.put('.orbit/local/verification.json', JSON.stringify(verified));
  await execute('delivery', ['init', '--milestone', 'imported', '--requirement', 'Contract verified'], context);
  const imported = await importVerificationChecks(context, { milestone: 'imported', reportPath: '.orbit/local/verification.json' });
  assert.equal(imported.imported, 1);
  assert.equal(imported.checks[0].provenance.mode, 'executed');
  assert.equal(imported.checks[0].finishedAt, verified.checks[0].executedAt);
  assert.equal(readFileSync(join(context.root, '.orbit/local/executions.txt'), 'utf8'), 'executed\n');
  let report = await execute('delivery', ['report', '--milestone', 'imported'], context);
  assert.equal(report.manifest.checks[0].status, 'passed');
  const cached = await verify('check', ['--files', 'docs/check.md', '--run'], context);
  assert.equal(cached.checks[0].status, 'cached');
  context.put('.orbit/local/cached.json', JSON.stringify(cached));
  const cachedImport = await execute('delivery', ['import-check', '--milestone', 'imported', '--report', '.orbit/local/cached.json'], context);
  assert.equal(cachedImport.checks[0].provenance.mode, 'cached');
  assert.equal(cachedImport.checks[0].executedAt, verified.checks[0].executedAt);
  assert.equal(readFileSync(join(context.root, '.orbit/local/executions.txt'), 'utf8'), 'executed\n');
  context.put('scripts/verify-plugin-compatibility.mjs', '// Sources changed after execution.\nprocess.exit(0);');
  report = await execute('delivery', ['report', '--milestone', 'imported'], context);
  assert.equal(report.manifest.checks.at(-1).status, 'stale');
  await assert.rejects(importVerificationChecks(context, { milestone: 'imported', reportPath: '.orbit/local/cached.json' }), /stale/);
  const fake = { ok: true, verificationStatus: 'passed', checks: [{ id: 'invented', status: 'passed' }] };
  context.put('.orbit/local/fake.json', JSON.stringify(fake));
  await assert.rejects(importVerificationChecks(context, { milestone: 'imported', reportPath: '.orbit/local/fake.json' }), /provenance/);
  context.put(cached.checks[0].evidence, '{"exitCode":0,"sourcesStable":true}');
  await assert.rejects(importVerificationChecks(context, { milestone: 'imported', reportPath: '.orbit/local/cached.json' }), /Invalid or altered/);
});

test('read-only delivery explicitly declares verification not applicable and blocks source mutations', async (t) => {
  const context = fixture(t);
  context.put('dev/app/contract.ts', 'const contract = true;');
  context.put('docs/acceptance.md', 'Read-only findings reviewed.');
  context.track();
  await execute('delivery', ['init', '--milestone', 'readonly', '--mode', 'read-only', '--requirement', 'Inspect contract'], context);
  await execute('delivery', ['evidence', '--milestone', 'readonly', '--requirement', 'R1', '--file', 'docs/acceptance.md'], context);
  let report = await execute('delivery', ['report', '--milestone', 'readonly'], context);
  assert.equal(report.verification, 'not-applicable');
  assert.equal(report.status, 'read_only_review_pending');
  assert.equal(report.readyForReview, true);
  report = await execute('delivery', ['review', '--milestone', 'readonly', '--reviewer', 'orbit-ai-executor', '--note', 'Reviewed current references without editing code.', '--write'], context);
  assert.equal(report.status, 'completed');
  assert.equal(report.verification, 'not-applicable');
  context.put('dev/app/contract.ts', 'const contract = false;');
  report = await execute('delivery', ['report', '--milestone', 'readonly'], context);
  assert.equal(report.status, 'read_only_sources_changed');
  assert.equal(report.readyForReview, false);
  assert.equal(report.manifest.review, 'pending');
  await assert.rejects(execute('delivery', ['review', '--milestone', 'readonly', '--reviewer', 'integrator', '--note', 'Try to accept changed code.', '--write'], context), /Read-only sources changed/);
});

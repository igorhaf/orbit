import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { preflight, aggregate, formatText, execute } from './preflight.mjs';
import { execute as shared } from './shared.mjs';

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'orbit-preflight-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, content) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
  const pkg = { id: '@orbit/fixture', version: '1.0.0', path: 'packages/core', files: [{ source: 'src/test.ts', target: 'apps/api/src/test.ts' }] };
  const config = { runtimes: [{ id: 'dev', app: 'dev/app' }], sharedPackages: [pkg] };
  write('packages/core/src/test.ts', 'export const test = true;');
  write('packages/core/package.json', JSON.stringify({ name: pkg.id, version: pkg.version, orbit: { files: pkg.files } }));
  write('dev/app/apps/api/core-version.json', JSON.stringify({ version: '1.0.0', pluginApiVersion: 1 }));
  write('dev/app/apps/api/src/plugins/ai/ai.plugin.ts', "export const aiPlugin={id:'ai',version:'1.0.0',dependencies:[],capabilities:[],actions:[]};");
  write('dev/app/apps/api/src/plugins/feature.ts', "import {aiPlugin} from './ai/ai.plugin'; export const featurePlugin={id:'feature',version:'1.0.0',dependencies:['ai']};");
  await shared('shared', ['sync', '--write'], { root, config });
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe', env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
  git('init', '--quiet'); git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture');
  return { root, config, write };
}
function tree(root, prefix = '') {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap(item => {
    const path = join(prefix, item.name);
    return item.isDirectory() ? tree(root, path) : [[path, readFileSync(join(root, path)).toString('base64'), statSync(join(root, path)).mtimeMs]];
  }).sort(([a], [b]) => a.localeCompare(b));
}

test('synchronized sources pass statically; full readiness remains explicitly unverified', async t => {
  const f = await fixture(t), result = preflight(f, 'dev');
  assert.equal(result.projections[0].status, 'PASS');
  assert.ok(result.findings.some(item => item.code === 'shared-integrity' && item.status === 'PASS'));
  assert.equal(result.status, 'NOT_VERIFIED');
  assert.equal(result.ok, false); assert.equal(result.promotionReady, false);
  assert.ok(result.imports.some(item => item.kind === 'direct-ai-import'));
  assert.ok(result.runtimes[0].plugins.find(item => item.id === 'feature').dependencies.includes('ai'));
});
test('divergent projection is blocked and local edits survive without any persistent cache', async t => {
  const f = await fixture(t);
  f.write('dev/app/apps/api/src/test.ts', 'independent product code');
  const before = tree(f.root);
  const first = preflight(f), second = preflight(f);
  assert.equal(first.status, 'BLOCK'); assert.deepEqual(first, second);
  assert.ok(first.findings.some(item => item.code === 'local-drift' && item.status === 'BLOCK'));
  assert.equal(first.projections[0].classification, 'independent-change-unclassified');
  assert.deepEqual(tree(f.root), before);
});
test('source edits without bump, stale locks and missing sources remain detectable', async t => {
  const f = await fixture(t);
  f.write('packages/core/src/test.ts', 'updated canonical');
  let result = preflight(f);
  for (const code of ['version-not-bumped', 'stale-projection', 'stale-lock']) assert.ok(result.findings.some(item => item.code === code && item.status === 'BLOCK'), code);
  rmSync(join(f.root, 'packages/core/src/test.ts'));
  result = preflight(f);
  assert.ok(result.findings.some(item => item.code === 'shared-inspection-failed' && item.status === 'BLOCK'));
});
test('existing catalog detects missing, circular and incompatible dependencies through preflight', async t => {
  const f = await fixture(t);
  f.write('dev/app/apps/api/src/plugins/feature.ts', "export const featurePlugin={id:'feature',version:'1.0.0',dependencies:['other','missing'],coreCompatibility:{minVersion:'9.0.0'}}; export const otherPlugin={id:'other',version:'1.0.0',dependencies:['feature']};");
  const result = preflight(f);
  for (const code of ['missing-dependency', 'dependency-cycle', 'incompatible-core']) assert.ok(result.findings.some(item => item.code === code && item.status === 'BLOCK'), code);
});
test('classification, formatter and argument contracts are deterministic and reject writes', async t => {
  assert.equal(aggregate([]), 'PASS');
  assert.equal(aggregate([{ status: 'WARN' }]), 'WARN');
  assert.equal(aggregate([{ status: 'NOT_VERIFIED' }, { status: 'BLOCK' }]), 'BLOCK');
  const f = await fixture(t);
  assert.match(formatText(preflight(f)), /Checks recommended \(not executed\)/);
  await assert.rejects(execute('preflight', ['--write'], f), /requires a value/);
  await assert.rejects(execute('preflight', ['--runtime', 'absent'], f), /Unknown runtime/);
  await assert.rejects(execute('preflight', ['--format', 'yaml'], f), /Unknown preflight argument/);
});

test('static schemas and capability references are checked without invoking plugin actions', async t => {
  const f = await fixture(t);
  const localRequire = createRequire(fileURLToPath(new URL('../../dev/app/package.json', import.meta.url)));
  const ajvRoot = dirname(localRequire.resolve('ajv/package.json'));
  f.write('dev/app/package.json', '{}');
  mkdirSync(join(f.root, 'dev/app/node_modules'), { recursive: true });
  symlinkSync(ajvRoot, join(f.root, 'dev/app/node_modules/ajv'), 'dir');
  f.write('dev/app/apps/api/src/plugins/feature.ts', `
    throw new Error('Never evaluate plugin code');
    export const featurePlugin={id:'feature',version:'1.0.0',dependencies:['ai'],capabilities:[],
      actions:[{id:'broken',requiredCapabilities:['undeclared'],inputSchema:{type:'invented'},execute:()=>{throw new Error('Never invoke')}}],
      contributions:{recordKinds:{example:{schema:{type:'invented'}}}}};`);
  const result=preflight(f);
  for (const code of ['invalid-action-schema','missing-action-capability','invalid-record-schema']) assert.ok(result.findings.some(item=>item.code===code && item.status==='BLOCK'),code);
});

test('partially unresolved nested schema is reported instead of accepted as complete', async t => {
  const f=await fixture(t);
  f.write('dev/app/apps/api/src/plugins/feature.ts', "export const featurePlugin={id:'feature',version:'1.0.0',dependencies:['ai'],actions:[{id:'dynamic',inputSchema:{type:'object',properties:unknownProperties()}}]};");
  const result=preflight(f);
  assert.ok(result.findings.some(item=>item.code==='unresolved-contract-fields' && item.fields.includes('actions.0.inputSchema.properties') && item.status==='NOT_VERIFIED'));
});

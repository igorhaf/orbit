import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execute } from './verify.mjs';

function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'orbit-check-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  mkdirSync(resolve(root, 'scripts'));
  mkdirSync(resolve(root, 'forge/app/apps/api/src'), { recursive: true });
  writeFileSync(resolve(root, 'forge/app/apps/api/core-version.json'), JSON.stringify({ version: '1.0.0', pluginApiVersion: 1 }));
  writeFileSync(resolve(root, 'forge/app/apps/api/src/main.ts'), 'export const value = 1;\n');
  writeFileSync(resolve(root, 'forge/app/apps/api/package.json'), JSON.stringify({ scripts: {} }));
  writeFileSync(resolve(root, 'forge/app/orbit.shared-lock.json'), JSON.stringify({ schemaVersion: 1, runtime: 'dev', packages: [] }, null, 2) + '\n');
  writeFileSync(resolve(root, '.gitignore'), '.orbit/\n');
  const source = resolve(root, 'scripts/verify-plugin-compatibility.mjs');
  writeFileSync(source, `import fs from 'node:fs'; fs.mkdirSync('.orbit/local',{recursive:true}); const p='.orbit/local/counter'; fs.writeFileSync(p,String(fs.existsSync(p)?Number(fs.readFileSync(p))+1:1));\n`);
  return { root, config: { runtimes: [{ id: 'dev', app: 'forge/app' }], sharedPackages: [] }, source };
}

test('verification plans commands, caches only success and invalidates changed sources', async t => {
  const context = fixture(t);
  const args = ['--files', 'scripts/verify-plugin-compatibility.mjs'];
  const planned = await execute('check', args, context);
  assert.equal(planned.verificationStatus, 'planned');
  assert.equal(planned.checks[0].status, 'planned');
  const first = await execute('check', [...args, '--run'], context);
  assert.equal(first.checks[0].status, 'passed');
  const second = await execute('check', [...args, '--run'], context);
  assert.equal(second.checks[0].status, 'cached');
  assert.equal(readFileSync(resolve(context.root, '.orbit/local/counter'), 'utf8'), '1');
  writeFileSync(context.source, readFileSync(context.source, 'utf8') + '\n// new source version\n');
  const changed = await execute('check', [...args, '--run'], context);
  assert.equal(changed.checks[0].status, 'passed');
  assert.equal(readFileSync(resolve(context.root, '.orbit/local/counter'), 'utf8'), '2');
  const previous = process.env.ORBIT_TEST_CACHE_CASE;
  try {
    process.env.ORBIT_TEST_CACHE_CASE = 'changed-environment';
    const environmentChanged = await execute('check', [...args, '--run'], context);
    assert.equal(environmentChanged.checks[0].status, 'passed');
    assert.equal(readFileSync(resolve(context.root, '.orbit/local/counter'), 'utf8'), '3');
  } finally {
    if (previous === undefined) delete process.env.ORBIT_TEST_CACHE_CASE;
    else process.env.ORBIT_TEST_CACHE_CASE = previous;
  }
});

test('a failed command is reported with actual evidence and never reused as a pass', async t => {
  const context = fixture(t);
  writeFileSync(context.source, "process.stderr.write('expected failure');process.exit(2);\n");
  for (let i = 0; i < 2; i++) {
    const result = await execute('check', ['--files', 'scripts/verify-plugin-compatibility.mjs', '--run'], context);
    assert.equal(result.ok, false);
    assert.equal(result.verificationStatus, 'failed');
    assert.equal(result.checks[0].status, 'failed');
    assert.match(result.checks[0].error, /expected failure/);
    const evidence = JSON.parse(readFileSync(resolve(context.root, result.checks[0].evidence), 'utf8'));
    assert.equal(evidence.exitCode, 2);
  }
});

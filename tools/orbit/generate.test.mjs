import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { dependencyClosure, execute, isReusableFile, rewriteImportSpecifiers, safePath } from './generate.mjs';
import { inspectShared } from './shared.mjs';

const repository = resolve(import.meta.dirname, '../..');
const require = createRequire(resolve(repository, 'dev/app/package.json'));
const ts = require('typescript');

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'orbit-generator-'));
  const write = (path, contents) => { mkdirSync(dirname(resolve(root, path)), { recursive: true }); writeFileSync(resolve(root, path), contents); };
  write('dev/app/package.json', JSON.stringify({ name: 'orbit', private: true, scripts: { 'orbit:rebuild-dev': 'node scripts/orbit-rebuild-dev.mjs' }, workspaces: ['apps/*'] }));
  write('dev/app/package-lock.json', JSON.stringify({ name: 'orbit', lockfileVersion: 3, packages: { '': { name: 'orbit', workspaces: ['apps/*'] } } }));
  write('dev/app/orbit.shared-lock.json', JSON.stringify({ schemaVersion: 1, runtime: 'dev', packages: [] }));
  write('dev/app/apps/api/core-version.json', JSON.stringify({ version: '1.0.0', pluginApiVersion: 1 }));
  write('dev/app/apps/api/sql/migrations/065_rbac_core.sql', "ALTER TABLE users ADD COLUMN is_root boolean NOT NULL DEFAULT false;\nUPDATE users SET is_root=true WHERE email='example@example.test';\nCREATE TABLE access_roles(id text PRIMARY KEY);\n");
  write('dev/app/apps/api/src/plugins/example.ts', `import type { PluginDefinition } from './contract';
export const boardView: PluginDefinition = {id:'board-view', name:'Board', version:'1.0.0'};
export const workspaces: PluginDefinition = {id:'workspaces', name:'Workspaces', version:'1.0.0', dependencies:['board-view']};
export const external: PluginDefinition = {id:'external', name:'External', version:'1.0.0'};
`);
  write('dev/app/apps/api/src/plugins/contract.ts', 'export type PluginDefinition = Record<string, unknown>;');
  write('dev/app/apps/api/src/orbit-architecture.ts', "export const orbitContextRuntime='dev';\nexport const policy='fixture';\n");
  write('dev/app/apps/api/src/main.ts', "import { boardView, workspaces, external } from './plugins/example'; const registry = { register(plugin:unknown) {} }; registry.register(boardView); registry.register(workspaces); registry.register(external);");
  write('dev/app/.env.example', 'DATABASE_URL=old\nAPI_PORT=4001\nJWT_SECRET=\n');
  write('dev/app/.env', 'SECRET=do-not-copy');
  write('dev/app/data/secret.json', 'do-not-copy');
  write('dev/app/tools/dev-runtime/runtime/suinda.compose.yml', 'do-not-copy');
  write('dev/app/docs/PLANO-SAFDOULAS.md', 'do-not-copy');
  write('dev/app/apps/web/components/shared.tsx', 'export const Original = true;');
  write('canonical/ui.tsx', 'export const Canonical = true;');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'fixture'], { cwd: root });
  mkdirSync(resolve(root, 'dev/app/node_modules'), { recursive: true });
  symlinkSync(dirname(require.resolve('typescript/package.json')), resolve(root, 'dev/app/node_modules/typescript'), 'dir');
  const config = { runtimes: [{ id: 'dev', app: 'dev/app', webPort: 3001, apiPort: 4001 }], sharedPackages: [{ id: 'ui', path: 'canonical', version: '1.0.0', files: [{ source: 'ui.tsx', target: 'apps/web/components/shared.tsx' }] }] };
  write('canonical/package.json', JSON.stringify({ name: 'ui', version: '1.0.0', orbit: { files: config.sharedPackages[0].files } }));
  return { root, config, write, cleanup() { rmSync(root, { recursive: true, force: true }); } };
}

test('dependency closure orders parents, rejects unknown references and cycles', () => {
  assert.deepEqual(dependencyClosure(['child'], [{ id: 'base' }, { id: 'child', dependencies: ['base'] }]), ['base', 'child']);
  assert.throws(() => dependencyClosure(['missing'], []), /inexistente/);
  assert.throws(() => dependencyClosure(['a'], [{ id: 'a', dependencies: ['b'] }, { id: 'b', dependencies: ['a'] }]), /Ciclo/);
});

test('reusable source excludes runtime data, secrets and client-specific artifacts', () => {
  for (const path of ['.env', '.env.local', 'apps/api/.env.production', 'data/a.json', 'node_modules/a.js', 'tools/dev-runtime/runtime/orbit.yml', 'apps/web/.next/a.js', 'docs/PLANO-SAFDOULAS.md', '.orbit/sessions/session.json']) assert.equal(isReusableFile(path), false, path);
  assert.equal(isReusableFile('.env.example'), true);
  assert.equal(isReusableFile('apps/web/components/ui.tsx'), true);
});

test('safe paths reject traversal, absolute destinations and symlink ancestors', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'orbit-paths-'));
  try {
    symlinkSync(tmpdir(), resolve(root, 'link'), 'dir');
    for (const path of ['../escape', '/tmp/escape', '.git/config', 'link/escape']) assert.throws(() => safePath(root, path));
    assert.equal(safePath(root, 'products/demo'), resolve(root, 'products/demo'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('product generation uses canonical source, isolated profile and explicit writes', async () => {
  const context = fixture();
  try {
    const plan = await execute('generate', ['product', 'academy'], context);
    assert.equal(plan.mode, 'plan');
    assert.equal(existsSync(resolve(context.root, plan.destination)), false);
    const result = await execute('generate', ['product', 'academy', '--write'], context);
    const base = resolve(context.root, result.destination);
    const profile = JSON.parse(readFileSync(resolve(base, 'product.profile.json'), 'utf8'));
    assert.deepEqual(profile.plugins.enabled, ['board-view', 'workspaces']);
    assert.deepEqual(profile.plugins.disabled, ['external']);
    assert.equal(profile.database.name, 'orbit_academy');
    assert.match(readFileSync(resolve(base,'app/apps/api/src/orbit-architecture.ts'),'utf8'),/orbitContextRuntime="academy"/);
    assert.match(readFileSync(resolve(context.root,'dev/app/apps/api/src/orbit-architecture.ts'),'utf8'),/orbitContextRuntime='dev'/);
    assert.notEqual(profile.ports.web, context.config.runtimes[0].webPort);
    assert.equal(readFileSync(resolve(base, 'app/apps/web/components/shared.tsx'), 'utf8'), 'export const Canonical = true;');
    const shared = inspectShared({ root: context.root, config: { ...context.config, runtimes: [{ id: 'academy', app: 'products/academy/app' }] } });
    assert.deepEqual(shared.diagnostics, []); assert.deepEqual(shared.projections, []); assert.deepEqual(shared.locks, []);
    const lock = JSON.parse(readFileSync(resolve(base, 'app/orbit.shared-lock.json'), 'utf8'));
    assert.equal(lock.runtime, 'academy'); assert.equal(lock.packages[0].id, 'ui');
    const dependencyLock = JSON.parse(readFileSync(resolve(base, 'app/package-lock.json'), 'utf8'));
    assert.equal(dependencyLock.name, 'orbit-academy'); assert.equal(dependencyLock.packages[''].name, 'orbit-academy');
    assert.match(readFileSync(resolve(base, 'AGENTS.md'), 'utf8'), /branch ativa é unicamente main/);
    const migrationPath = 'apps/api/sql/migrations/065_rbac_core.sql';
    const sourceMigration = readFileSync(resolve(context.root, 'dev/app', migrationPath), 'utf8');
    const generatedMigration = readFileSync(resolve(base, 'app', migrationPath), 'utf8');
    assert.match(sourceMigration, /WHERE email='example@example.test'/);
    assert.doesNotMatch(generatedMigration, /example@example.test|UPDATE users SET is_root/);
    assert.match(generatedMigration, /ensureBootstrapRoot/);
    assert.match(generatedMigration, /CREATE TABLE access_roles\(id text PRIMARY KEY\);/);
    assert.match(generatedMigration, /ALTER TABLE users ADD COLUMN is_root boolean NOT NULL DEFAULT false;/);
    const provenance = JSON.parse(readFileSync(resolve(base, 'generation.manifest.json'), 'utf8'));
    assert.equal(provenance.source.mode, 'working-tree');
    assert.ok(provenance.transformations.some(item=>item.id==='context-runtime-identity'));
    assert.equal(provenance.transformations[0].source.sha256, createHash('sha256').update(sourceMigration).digest('hex'));
    assert.equal(provenance.transformations[0].result.sha256, createHash('sha256').update(generatedMigration).digest('hex'));
    for (const script of ['runtime.mjs', 'apply-profile.mjs', 'database.mjs']) execFileSync(process.execPath, ['--check', resolve(base, script)]);
    const wrongDatabase = { ...process.env, DATABASE_URL: 'postgresql://example:example@localhost:5432/another_product' };
    assert.throws(() => execFileSync(process.execPath, [resolve(base, 'database.mjs'), 'migrate'], { env: wrongDatabase, stdio: 'pipe' }), /banco isolado/);
    assert.equal(existsSync(resolve(base, 'app/.env')), false);
    assert.equal(existsSync(resolve(base, 'app/data')), false);
    assert.equal(existsSync(resolve(base, 'app/node_modules')), false);
    assert.equal(existsSync(resolve(base, 'app/docs/PLANO-SAFDOULAS.md')), false);
    assert.equal(existsSync(resolve(base, 'app/.git')), false);
    assert.match(readFileSync(resolve(base, '.env.example'), 'utf8'), /orbit_academy/);
    await assert.rejects(() => execute('generate', ['product', 'academy', '--write'], context), /já existe/);
  } finally { context.cleanup(); }
});

test('product generator rejects unsafe target, duplicate ports and empty view profile', async () => {
  const context = fixture();
  try {
    await assert.rejects(() => execute('generate', ['product', 'academy', '--target', '../escape'], context), /Caminho/);
    await assert.rejects(() => execute('generate', ['product', 'academy', '--web-port', '3001'], context), /Porta/);
    await assert.rejects(() => execute('generate', ['product', 'academy', '--plugins', 'external'], context), /board-view/);
  } finally { context.cleanup(); }
});

test('product generator rejects configured identities and destinations within runtime or tooling roots', async () => {
  const context = fixture();
  try {
    context.config.products = [{ id: 'existing-product', app: 'products/existing-product/app' }];
    for (const id of ['dev', 'existing-product']) await assert.rejects(() => execute('generate', ['product', id], context), /ID de produto já configurado/);
    for (const target of ['dev/app/generated-product', 'canonical/generated-product', '.orbit/generated-product', 'control/generated-product', 'tools/generated-product', 'products/existing-product/app/generated-product']) {
      await assert.rejects(() => execute('generate', ['product', 'academy', '--target', target], context), /Destino reservado/);
      assert.equal(existsSync(resolve(context.root, target)), false);
    }
  } finally { context.cleanup(); }
});

test('child plugin declares parent dependency and stub rejects production', async () => {
  const context = fixture();
  try {
    const result = await execute('generate', ['plugin', 'academy-extension', '--extends', 'workspaces', '--write'], context);
    assert.deepEqual(result.dependencies, ['workspaces']);
    const definition = readFileSync(resolve(context.root, result.destination, 'definition.ts'), 'utf8');
    assert.match(definition, /parentPlugin: "workspaces"/);
    const source = readFileSync(resolve(context.root, result.destination, 'adapter.ts'), 'utf8');
    // Check the generated plugin against the actual Orbit SDK without writing into an app.
    const virtualDirectory = resolve(repository, 'dev/app/apps/api/src/plugins/__generator_contract__');
    const virtualFiles = new Map([[resolve(virtualDirectory, 'definition.ts'), definition], [resolve(virtualDirectory, 'adapter.ts'), source]]);
    const configPath = resolve(repository, 'dev/app/apps/api/tsconfig.json');
    const config = ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, dirname(configPath));
    const compilerOptions = { ...config.options, incremental: false, noEmit: true };
    const host = ts.createCompilerHost(compilerOptions);
    const originalRead = host.readFile.bind(host), originalExists = host.fileExists.bind(host), originalSource = host.getSourceFile.bind(host), originalDirectoryExists = host.directoryExists.bind(host);
    host.fileExists = path => virtualFiles.has(path) || originalExists(path);
    host.readFile = path => virtualFiles.get(path) ?? originalRead(path);
    host.directoryExists = path => path === virtualDirectory || originalDirectoryExists(path);
    host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) => virtualFiles.has(path) ? ts.createSourceFile(path, virtualFiles.get(path), languageVersion, true) : originalSource(path, languageVersion, onError, shouldCreateNewSourceFile);
    const program = ts.createProgram([resolve(virtualDirectory, 'definition.ts')], compilerOptions, host);
    const diagnostics = ts.getPreEmitDiagnostics(program).filter(diagnostic => diagnostic.file && virtualFiles.has(diagnostic.file.fileName));
    assert.deepEqual(diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')), []);
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const exports = {};
    new Function('exports', 'process', js)(exports, { env: {} });
    assert.deepEqual(exports.exampleAdapter({ mode: 'example', text: 'hello' }), { example: true, text: 'hello' });
    assert.throws(() => exports.exampleAdapter({ text: 'hello' }), /mode=example/);
    const production = {};
    new Function('exports', 'process', js)(production, { env: { NODE_ENV: 'production' } });
    assert.throws(() => production.exampleAdapter({ mode: 'example', text: 'hello' }), /produção/);
    assert.equal(result.registered, false);
  } finally { context.cleanup(); }
});

test('import codemod changes module positions while preserving text and supports safe rollback', async () => {
  const context = fixture();
  try {
    const path = 'dev/app/apps/api/src/consumer.ts';
    const original = `import { x } from 'old-module';\nexport { x } from 'old-module';\nconst text = 'old-module';\nconst lazy = import('old-module');\n// old-module\n`;
    context.write(path, original);
    const result = await execute('migrate', ['imports', '--from', 'old-module', '--to', 'new-module', '--files', path, '--write'], context);
    assert.equal(result.changes[0].replacements, 3);
    const modified = readFileSync(resolve(context.root, path), 'utf8');
    assert.match(modified, /const text = 'old-module'/);
    assert.match(modified, /from 'new-module'/);
    const id = result.backup.split('/').at(-1);
    await execute('migrate', ['rollback', '--id', id, '--write'], context);
    assert.equal(readFileSync(resolve(context.root, path), 'utf8'), original);
    await assert.rejects(() => execute('migrate', ['rollback', '--id', id, '--write'], context), /hash mudou/);
  } finally { context.cleanup(); }
});

test('import parser refuses syntax errors and does not rewrite ordinary literals', () => {
  assert.throws(() => rewriteImportSpecifiers(ts, 'import {', 'bad.ts', 'a', 'b'), /segurança/);
  const { contents, count } = rewriteImportSpecifiers(ts, "const x = 'a';", 'ok.ts', 'a', 'b');
  assert.equal(count, 0); assert.equal(contents, "const x = 'a';");
});

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { packageSnapshot } from './shared.mjs';

const identifier = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const slugPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';

function options(args) {
  const positionals = [], flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) { positionals.push(arg); continue; }
    const [key, ...inline] = arg.slice(2).split('=');
    if (['write', 'dry-run'].includes(key)) flags[key] = true;
    else {
      const value = inline.length ? inline.join('=') : args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Valor obrigatório para --${key}.`);
      flags[key] = value;
    }
  }
  if (flags.write && flags['dry-run']) throw new Error('Escolha --write ou --dry-run.');
  return { positionals, flags };
}

function assertFlags(flags, allowed) {
  for (const key of Object.keys(flags)) if (!['write', 'dry-run', ...allowed].includes(key)) throw new Error(`Opção desconhecida: --${key}.`);
}

export function safePath(root, path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\\') || path.split('/').some(part => part === '..' || part === '.git')) throw new Error(`Caminho relativo inválido: ${path}`);
  const base = realpathSync(root), target = resolve(base, path);
  if (target === base || !target.startsWith(base + sep)) throw new Error('O destino precisa estar dentro do repositório.');
  let part = base;
  for (const segment of relative(base, target).split(sep)) {
    part = resolve(part, segment);
    if (existsSync(part) && lstatSync(part).isSymbolicLink()) throw new Error(`Links simbólicos não são destinos/fontes autorizados: ${path}`);
  }
  return target;
}

async function runtimeCatalog(context, runtime) {
  const { catalogRuntime } = await import('./catalog.mjs');
  const entry = await catalogRuntime(context.root, runtime);
  if (!Array.isArray(entry.plugins) || !entry.plugins.length) throw new Error(`Catálogo de plugins vazio em ${runtime.id}.`);
  const fatal = (entry.diagnostics || []).filter(item => item.severity === 'error');
  if (fatal.length) throw new Error(`Catálogo inválido em ${runtime.id}: ${fatal.map(item => item.message || item.code).join('; ')}`);
  return entry;
}

export function dependencyClosure(selected, plugins) {
  const byId = new Map(plugins.map(plugin => [plugin.id, plugin]));
  const active = new Set(), done = new Set();
  function visit(id) {
    if (done.has(id)) return;
    if (active.has(id)) throw new Error(`Ciclo de dependências envolvendo ${id}.`);
    const plugin = byId.get(id);
    if (!plugin) throw new Error(`Plugin/dependência inexistente: ${id}.`);
    active.add(id);
    for (const dependency of plugin.dependencies || []) visit(typeof dependency === 'string' ? dependency : dependency.id);
    active.delete(id); done.add(id);
  }
  selected.forEach(visit);
  return [...done];
}

export function isReusableFile(path) {
  const parts = path.split('/');
  if (parts.some(part => ['node_modules', 'data', '.git', '.next', 'dist', 'backups', '__pycache__'].includes(part))) return false;
  if (parts.some(part => /safdoulas|suinda/i.test(part))) return false;
  if (path.startsWith('.orbit/sessions/') || path.startsWith('.orbit/validations/') || path.startsWith('tools/dev-runtime/') || path.startsWith('tools/orbit-control/')) return false;
  if (path === 'orbit.shared-lock.json') return false;
  if (/^scripts\/(?:orbit-dev-manager|orbit-rebuild-dev|migrate-dev-host)\.mjs$/.test(path)) return false;
  if (/\.(?:tsbuildinfo|log|pid|backup|enc)$/.test(path) || /\.orbit-(?:dev-)?(?:restart|manager)/.test(path)) return false;
  return parts.every(part => !/^\.env(?:\.|$)/.test(part) || part === '.env.example');
}

function trackedSource(root, app) {
  safePath(root, app);
  const prefix = app.replace(/\/$/, '') + '/';
  const entries = execFileSync('git', ['ls-files', '-s', '-z', '--', prefix], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const files = new Map();
  for (const entry of entries) {
    const [metadata, fullPath] = entry.split('\t');
    if (!fullPath?.startsWith(prefix)) continue;
    const path = fullPath.slice(prefix.length);
    if (!isReusableFile(path)) continue;
    if (metadata.split(' ')[0] === '120000') throw new Error(`Fonte rastreada contém link simbólico: ${fullPath}`);
    const absolute = safePath(root, fullPath);
    if (!lstatSync(absolute).isFile()) throw new Error(`Fonte não é arquivo regular: ${fullPath}`);
    files.set(path, readFileSync(absolute));
  }
  if (!files.has('package.json')) throw new Error('A base DEV precisa ter package.json rastreado no Git.');
  return files;
}

function adaptBootstrapMigration(files, sourceApp) {
  const path = 'apps/api/sql/migrations/065_rbac_core.sql';
  if (!files.has(path)) return [];
  const original = files.get(path).toString();
  // Only this proven legacy statement is adapted, in a new product's copy.
  const legacyPromotion = /^UPDATE users SET is_root=true WHERE email='[^'\r\n]+@[^'\r\n]+';[ \t]*(?=\r?$)/gm;
  const matches = [...original.matchAll(legacyPromotion)];
  if (matches.length > 1) throw new Error('Migration de bootstrap contém múltiplas promoções literais; revise a base antes de gerar o produto.');
  if (!matches.length) return [];
  const replacement = original.replace(legacyPromotion, '-- ROOT is initialized explicitly by ensureBootstrapRoot; no account is promoted by this migration.');
  files.set(path, replacement);
  return [{ id: 'explicit-bootstrap-root', path: `app/${path}`, source: { path: `${sourceApp}/${path}`, sha256: sha(original) }, result: { sha256: sha(replacement) }, reason: 'New products initialize ROOT from explicit credentials through ensureBootstrapRoot.' }];
}

function reservePorts(root, config, flags) {
  const used = new Set();
  const existing = [];
  const products = resolve(root, 'products');
  if (existsSync(products) && !lstatSync(products).isSymbolicLink()) {
    for (const entry of readdirSync(products, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const profile = resolve(products, entry.name, 'product.profile.json');
      if (existsSync(profile)) {
        if (lstatSync(profile).isSymbolicLink()) throw new Error('Perfil de produto por link simbólico não é autorizado.');
        existing.push(JSON.parse(readFileSync(profile, 'utf8')));
      }
    }
  }
  for (const item of [...(config.runtimes || []), ...(config.products || []), ...existing]) {
    for (const value of [item.webPort, item.apiPort, item.ports?.web, item.ports?.api]) if (value) used.add(Number(value));
  }
  const take = (flag, first) => {
    let value = flag === undefined ? first : Number(flag);
    if (flag === undefined) while (used.has(value)) value++;
    if (!Number.isInteger(value) || value < 1024 || value > 65535 || used.has(value)) throw new Error(`Porta inválida ou reservada: ${flag ?? value}.`);
    used.add(value); return value;
  };
  return { web: take(flags['web-port'], 3010), api: take(flags['api-port'], 4010) };
}

function productEnvironment(source, profile, destination) {
  const values = {
    DATABASE_URL: `postgresql://${profile.database.name}:CHANGE_ME@127.0.0.1:5432/${profile.database.name}`,
    API_PORT: profile.ports.api, PORT: profile.ports.web,
    WEB_ORIGIN: `http://localhost:${profile.ports.web}`,
    ORBIT_API_PROXY_URL: `http://127.0.0.1:${profile.ports.api}`,
    ORBIT_NATIVE_ROOT: resolve(destination, 'app'), ORBIT_DEVELOPMENT_ROOT: resolve(destination, 'app'),
    NEXT_PUBLIC_API_URL: '', THEME: profile.theme, NEXT_PUBLIC_ORBIT_THEME: profile.theme,
  };
  let content = source || '';
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    content = pattern.test(content) ? content.replace(pattern, line) : content + '\n' + line;
  }
  return content.replace(/^# Instância de desenvolvimento:.*\n# A cópia principal.*\n/m, '') + '\n';
}

function nativeRunner() {
  return `import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
const profile = JSON.parse(readFileSync(new URL('./product.profile.json', import.meta.url), 'utf8'));
if (!process.env.DATABASE_URL || !process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('Configure DATABASE_URL e JWT_SECRET com pelo menos 32 caracteres em .env antes de iniciar.');
const database = new URL(process.env.DATABASE_URL);
if (decodeURIComponent(database.pathname.slice(1)) !== profile.database.name) throw new Error('DATABASE_URL aponta para outro produto.');
if (database.password === 'CHANGE_ME') throw new Error('Configure credenciais próprias do banco.');
const cwd = new URL('./app/', import.meta.url);
const children = [];
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; for (const child of children) { try { if (process.platform === 'win32') child.kill('SIGTERM'); else if (child.pid) process.kill(-child.pid, 'SIGTERM'); } catch { /* O processo pode ter encerrado. */ } } process.exitCode = code; }
for (const name of ['api', 'web']) {
  const env = { ...process.env, API_PORT: String(profile.ports.api), PORT: String(profile.ports.web), WEB_ORIGIN: 'http://localhost:' + profile.ports.web, ORBIT_API_PROXY_URL: 'http://127.0.0.1:' + profile.ports.api, THEME: profile.theme, NEXT_PUBLIC_ORBIT_THEME: profile.theme };
  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev', '-w', 'apps/' + name], { cwd, env, stdio: 'inherit', detached: process.platform !== 'win32' });
  children.push(child);
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code || 1); });
}
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
`;
}

function applyProfileScript() {
  return `import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const profile = JSON.parse(readFileSync(new URL('./product.profile.json', import.meta.url), 'utf8'));
if (!process.argv.includes('--write')) { console.log(JSON.stringify({database:profile.database.name, enabled:profile.plugins.enabled, disabled:profile.plugins.disabled}, null, 2)); process.exit(0); }
if (!process.env.DATABASE_URL || decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1)) !== profile.database.name) throw new Error('DATABASE_URL precisa apontar para o banco isolado declarado no perfil.');
const require = createRequire(new URL('./app/package.json', import.meta.url));
const { Client } = require('pg');
const client = new Client({connectionString:process.env.DATABASE_URL});
await client.connect();
try {
  await client.query('BEGIN');
  for (const [enabled, ids] of [[true, profile.plugins.enabled], [false, profile.plugins.disabled]]) for (const id of ids) await client.query('INSERT INTO plugin_settings(plugin_id,enabled) VALUES($1,$2) ON CONFLICT(plugin_id) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now()', [id, enabled]);
  await client.query('COMMIT'); console.log('Perfil aplicado. Inicie a aplicação após configurar o banco.');
} catch (error) { await client.query('ROLLBACK'); throw error; } finally { await client.end(); }
`;
}

function databaseScript() {
  return `import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const profile = JSON.parse(readFileSync(new URL('./product.profile.json', import.meta.url), 'utf8'));
const operation = process.argv[2];
if (!['migrate', 'seed', 'prepare'].includes(operation)) throw new Error('Use database.mjs migrate, seed ou prepare.');
if (!process.env.DATABASE_URL || decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1)) !== profile.database.name) throw new Error('DATABASE_URL precisa apontar para o banco isolado declarado no perfil.');
for (const step of operation === 'prepare' ? ['migrate', 'seed'] : [operation]) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'db:' + step, '-w', 'apps/api'], { cwd: new URL('./app/', import.meta.url), env: process.env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
`;
}

function writeNewTree(destination, files) {
  if (existsSync(destination)) throw new Error(`Destino já existe; nenhum arquivo sobrescrito: ${destination}`);
  const temporary = destination + `.generating-${process.pid}-${Date.now()}`;
  mkdirSync(dirname(destination), { recursive: true });
  mkdirSync(temporary);
  try {
    for (const [path, value] of files) {
      const target = safePath(temporary, path);
      mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, value, { flag: 'wx' });
    }
    if (existsSync(destination)) throw new Error('Destino foi criado durante a geração.');
    renameSync(temporary, destination);
  } catch (error) { rmSync(temporary, { recursive: true, force: true }); throw error; }
}

async function product(args, context) {
  const { positionals, flags } = options(args);
  assertFlags(flags, ['target', 'plugins', 'web-port', 'api-port', 'theme']);
  const [id] = positionals;
  if (positionals.length !== 1 || !slugPattern.test(id || '')) throw new Error('Use generate product <slug> [--plugins id,id] [--write].');
  const configuredProducts = [...(context.config.runtimes || []), ...(context.config.products || [])];
  if (configuredProducts.some(item => item.id === id)) throw new Error(`ID de produto já configurado no workspace: ${id}.`);
  const runtime = context.config.runtimes?.find(item => item.id === 'dev');
  if (!runtime) throw new Error('Runtime dev não configurado.');
  const destinationPath = flags.target || `products/${id}`;
  const destination = safePath(context.root, destinationPath);
  const normalizedDestination = relative(realpathSync(context.root), destination).split(sep).join('/');
  const reservedPaths = ['.orbit', 'control', 'tools', ...configuredProducts.map(item => item.app).filter(Boolean), ...(context.config.sharedPackages || []).map(item => item.path)];
  for (const path of reservedPaths) {
    const reserved = relative(realpathSync(context.root), safePath(context.root, path)).split(sep).join('/');
    if (normalizedDestination === reserved || normalizedDestination.startsWith(reserved + '/')) throw new Error(`Destino reservado para runtime, pacote ou ferramentas do workspace: ${destinationPath}.`);
  }
  if (existsSync(destination)) throw new Error(`Destino já existe: ${destinationPath}.`);
  const catalog = await runtimeCatalog(context, runtime);
  const selected = flags.plugins ? flags.plugins.split(',').filter(Boolean) : ['board-view', 'workspaces'];
  const enabled = dependencyClosure(selected, catalog.plugins);
  if (!enabled.some(plugin => ['board-view', 'structured-view'].includes(plugin))) throw new Error('Selecione pelo menos board-view ou structured-view.');
  const ports = reservePorts(context.root, context.config, flags);
  const theme = flags.theme || 'dark';
  if (!['dark', 'light'].includes(theme)) throw new Error('--theme precisa ser dark ou light.');
  const appFiles = trackedSource(context.root, runtime.app);
  const sharedPackages = [], sharedLocks = [];
  for (const pkg of context.config.sharedPackages || []) {
    const snapshot = packageSnapshot(context.root, pkg), projections = [];
    for (const file of snapshot.files) {
      safePath(context.root, `${destinationPath}/app/${file.target}`);
      appFiles.set(file.target, file.contents);
      projections.push({ path: file.target, sha256: file.sha256 });
    }
    sharedPackages.push({ id: snapshot.id, version: snapshot.version, integrity: snapshot.integrity, files: projections });
    sharedLocks.push({ id: snapshot.id, version: snapshot.version, integrity: snapshot.integrity, files: Object.fromEntries(snapshot.files.map(file => [file.target, file.sha256])) });
  }
  const transformations = adaptBootstrapMigration(appFiles, runtime.app);
  const profile = { schemaVersion: 1, id, name: id, app: `${destinationPath}/app`, basedOn: runtime.id, theme, ports,
    database: { name: `orbit_${id.replaceAll('-', '_')}` },
    plugins: { requested: selected, enabled, disabled: catalog.plugins.map(plugin => plugin.id).filter(plugin => !enabled.includes(plugin)).sort() }, sharedPackages };
  const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: context.root, encoding: 'utf8' }).trim();
  const sourceDirty = Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', runtime.app, 'orbit.workspace.json', ...(context.config.sharedPackages || []).map(pkg => pkg.path)], { cwd: context.root, encoding: 'utf8' }).trim());
  const files = new Map([...appFiles].map(([path, value]) => ['app/' + path, value]));
  const appPackage = JSON.parse(appFiles.get('package.json').toString());
  appPackage.name = `orbit-${id}`;
  appPackage.scripts ||= {};
  appPackage.scripts['orbit:dev'] = 'node --env-file=../.env ../runtime.mjs';
  appPackage.scripts['orbit:serve'] = 'node --env-file=../.env ../runtime.mjs';
  delete appPackage.scripts['orbit:rebuild-dev']; delete appPackage.scripts['db:migrate:dev-host'];
  files.set('app/package.json', json(appPackage));
  const lock = appFiles.get('package-lock.json');
  if (lock) { const value = JSON.parse(lock.toString()); value.name = appPackage.name; if (value.packages?.['']) value.packages[''].name = appPackage.name; files.set('app/package-lock.json', json(value)); }
  const environment = productEnvironment(appFiles.get('.env.example')?.toString(), profile, destination);
  files.set('app/.env.example', environment); files.set('.env.example', environment);
  files.set('app/orbit.shared-lock.json', json({ schemaVersion: 1, runtime: id, packages: sharedLocks }));
  const runtimeMetadata = { environment: id, host: { repository: resolve(destination, 'app'), web: `http://127.0.0.1:${ports.web}`, api: `http://127.0.0.1:${ports.api}` }, executor: { repository: context.root, web: `http://127.0.0.1:${ports.web}`, api: `http://127.0.0.1:${ports.api}` }, portMappings: { [ports.web]: `${id} web`, [ports.api]: `${id} API` }, rules: ['Use somente os endpoints e o banco deste produto.', 'Operações de ciclo de vida e deploy exigem pedido explícito.', 'Compatibilidade entre plugins e isolamento dos ambientes são obrigatórios.'] };
  files.set('app/.orbit/runtime.json', json(runtimeMetadata));
  const orbitYaml = appFiles.get('.orbit/orbit.yaml')?.toString();
  if (orbitYaml) files.set('app/.orbit/orbit.yaml', orbitYaml.replace(/^(\s{2}name:)\s*Orbit\s*$/m, `$1 ${id}`));
  files.set('docs/profile-simulation.md', [
    '# Simulação ROOT de perfis',
    '',
    'Todo papel global registrado em `access_roles` recebe persona e contexto demonstrativo; não mantenha uma lista fixa de papéis. Inclua papéis genéricos e papéis definidos pelos plugins do produto.',
    '',
    '## Regras',
    '',
    '- Preserve o token/sessão e o ator ROOT para auditoria; aplique as permissões do papel selecionado à persona demonstrativa.',
    '- Mantenha exemplos sintéticos no banco/workspace deste produto e nunca reutilize cadastros reais ou dados de outro ambiente.',
    '- Cada perfil deve ver tarefas, registros e fluxos coerentes com suas permissões; plugins de domínio contribuem fixtures compatíveis sem duplicar o core.',
    '- Faça rotas sem fixtures isoladas falharem fechadas. Mantenha a simulação somente leitura até que qualquer escrita esteja limitada às próprias fixtures.',
    '- Não dispare integrações, notificações, envios ou efeitos externos. Personas de demonstração não autenticam nem aparecem como usuários reais.',
    '',
    '## Critério de revisão',
    '',
    'Percorra todos os papéis do catálogo, confirme que cada um recebe contexto e que fluxos indisponíveis seguem as permissões efetivas. Registre fixtures e limitações específicas do produto aqui. Atualize os contratos de plugins e o `orbitArchitecturePrompt` quando uma regra persistente mudar.',
    '',
  ].join('\n'));
  files.set('AGENTS.md', `# Produto Orbit: ${id}

Este diretório pertence ao monorepo Orbit. A branch ativa é unicamente main; não inicialize um repositório dentro deste produto nem crie branches por ambiente. Siga também as instruções da raiz do monorepo.

Edite capacidades comuns nas fontes canônicas em packages e sincronize as projeções pelo comando shared. Regras exclusivas deste produto pertencem a plugins próprios ou filhos com dependências explícitas. Preserve compatibilidade entre plugins e o isolamento de banco, dados, portas e configuração.

A simulação ROOT precisa oferecer contexto demonstrativo para cada papel global do catálogo, inclusive papéis novos e papéis de plugins. Use fixtures de domínio próprias, mantenha sessão e auditoria do ROOT, não consulte dados reais e faça rotas sem fixtures falharem fechadas; até a escrita segura existir, a simulação é somente leitura. Consulte docs/profile-simulation.md e inclua essa cobertura na revisão do produto.

Não inicie, pare ou reinicie serviços automaticamente; operações de ciclo de vida e deploy dependem de pedido explícito. Use o perfil e app/.orbit/runtime.json deste produto para selecionar endpoints de validação.
`);
  files.set('runtime.mjs', nativeRunner()); files.set('apply-profile.mjs', applyProfileScript()); files.set('database.mjs', databaseScript());
  files.set('package.json', json({ name: `orbit-product-${id}`, private: true, scripts: { dev: 'node --env-file=.env runtime.mjs', build: 'npm --prefix app run build', check: 'npm --prefix app run lint', 'db:migrate': 'node --env-file=.env database.mjs migrate', 'db:seed': 'node --env-file=.env database.mjs seed', 'db:prepare': 'node --env-file=.env database.mjs prepare', 'profile:plan': 'node apply-profile.mjs', 'profile:apply': 'node --env-file=.env apply-profile.mjs --write' } }));
  files.set('README.md', `# ${id}

Gerado da base Orbit DEV no commit ${sourceHead}. Interface, permissões e lógica vêm da base existente.

Execute os comandos abaixo na raiz deste produto.

1. Revise product.profile.json, copie .env.example para .env e configure os segredos próprios. JWT_SECRET precisa de pelo menos 32 caracteres. Em banco novo, configure ORBIT_BOOTSTRAP_ROOT_NAME, ORBIT_BOOTSTRAP_ROOT_EMAIL e ORBIT_BOOTSTRAP_ROOT_PASSWORD (mínimo 12 caracteres; máximo 72 bytes UTF-8). Contas ROOT existentes são preservadas.
2. Provisione o banco PostgreSQL isolado ${profile.database.name}; nenhum banco foi criado pelo gerador.
3. Instale dependências com npm --prefix app ci.
4. Execute npm run db:prepare para aplicar migrations e seed somente no banco declarado no perfil.
5. Execute npm run profile:plan e npm run profile:apply para configurar os plugins.
6. Revise o resultado e inicie explicitamente com npm run dev. Web: ${ports.web}; API: ${ports.api}.

Os comandos db:migrate e db:seed também podem ser usados separadamente. O runner carrega .env e encaminha ORBIT_NATIVE_ROOT para a aplicação; o exemplo já aponta para app deste produto.

## Simulação de perfis ROOT

A simulação preserva a sessão e o ator de auditoria ROOT e apresenta contexto fictício para todos os papéis do catálogo, incluindo papéis de plugins. Mantenha personas e fixtures isoladas por produto. Rotas ainda ligadas aos dados normais devem falhar fechadas; o modo permanece somente leitura até que as escritas estejam restritas às fixtures. Siga \`docs/profile-simulation.md\` ao acrescentar fluxos de domínio.

O gerador não inicia serviços. Não copie .env, dados ou credenciais de outros produtos. Plugins filhos devem declarar parentPlugin e dependencies; regras específicas deste produto ficam em plugins próprios. As capacidades não selecionadas continuam no código reutilizável e são desativadas pelo perfil no banco isolado.
`);
  const manifest = { schemaVersion: 1, generator: 'orbit.generate.product', source: { app: runtime.app, commit: sourceHead, mode: 'working-tree', dirty: sourceDirty, sharedPackages: sharedPackages.map(({ id, version, integrity }) => ({ id, version, integrity })) }, transformations, profile: 'product.profile.json', files: [...files].map(([path, value]) => ({ path, sha256: sha(value) })) };
  files.set('generation.manifest.json', json(manifest));
  if (flags.write) writeNewTree(destination, files);
  return { command: 'generate product', mode: flags.write ? 'written' : 'plan', destination: destinationPath, profile, writePaths: [...files.keys()].map(path => `${destinationPath}/${path}`), files: files.size, manifest: `${destinationPath}/generation.manifest.json`, next: ['Revisar perfil e configuração', 'Provisionar banco isolado', 'Instalar dependências, migrar e aplicar perfil explicitamente', 'Verificar contexto demonstrativo de todos os papéis', 'Executar verificação por impacto antes da entrega'] };
}

function pluginFiles(id, dependencies, parent, core) {
  const variable = id.replace(/[^a-z0-9]/g, '_') + 'Plugin';
  const rule = { minVersion: core.version, maxExclusive: `${Number(core.version.split('.')[0]) + 1}.0.0`, pluginApiVersion: core.pluginApiVersion };
  const permission = `${id}.example`;
  const definition = `import { definePlugin } from '../sdk';
import { exampleAdapter } from './adapter';

export const ${variable} = definePlugin({
  id: ${JSON.stringify(id)}, name: ${JSON.stringify(id)}, version: '0.1.0', scope: 'workspace',
  coreCompatibility: ${JSON.stringify(rule)},
  ${parent ? `parentPlugin: ${JSON.stringify(parent)},
  ` : ''}dependencies: ${JSON.stringify(dependencies)},
  capabilities: [{ id: ${JSON.stringify(permission)}, name: 'Exemplo local explícito', permissions: [${JSON.stringify(permission)}] }],
  actions: [{ id: 'example', name: 'Executar exemplo local', permissions: [${JSON.stringify(permission)}], requiredCapabilities: [${JSON.stringify(permission)}],
    inputSchema: { type: 'object', additionalProperties: false, properties: { mode: { const: 'example' }, text: { type: 'string', maxLength: 200 } }, required: ['mode', 'text'] },
    outputSchema: { type: 'object', properties: { example: { const: true }, text: { type: 'string' } }, required: ['example', 'text'], additionalProperties: false },
    execute: async (input) => ({ type: 'json', label: 'Dados de exemplo', value: exampleAdapter(input) }),
  }],
});
`;
  const adapter = `/** Stub local: substitua por adaptador real e mantenha este contrato para testes. */
export function exampleAdapter(input: Record<string, unknown>): { example: true; text: string } {
  if (process.env.NODE_ENV === 'production') throw new Error('Stub de exemplo não pode executar em produção.');
  if (input.mode !== 'example' || typeof input.text !== 'string' || input.text.length > 200 || Object.keys(input).some(key => !['mode','text'].includes(key))) throw new Error('Stub exige mode=example e payload de contrato válido.');
  return { example: true, text: input.text };
}
`;
  return new Map([['definition.ts', definition], ['adapter.ts', adapter], ['contract.fixture.json', json({ input: { mode: 'example', text: 'Exemplo Orbit' }, output: { example: true, text: 'Exemplo Orbit' } })], ['plugin.manifest.json', json({ schemaVersion: 1, id, version: '0.1.0', parentPlugin: parent || null, dependencies, coreCompatibility: rule, permissions: [permission], registration: { export: variable, module: './definition', automatic: false }, adapter: { mode: 'example', production: false } })], ['README.md', `# ${id}

Plugin ${parent ? `filho de ${parent}` : 'independente'} com contrato Orbit existente. O pai permanece desacoplado.

O gerador cria o esqueleto e não altera o registry. Importe ${variable} de ./definition no bootstrap do runtime e registre pelo PluginRegistry existente. Declare e conceda ${permission} pelo RBAC antes de expor a action. Acrescente migrations próprias quando houver persistência.

O adaptador só aceita mode=example e bloqueia NODE_ENV=production. A fixture é um contrato de desenvolvimento; implemente o adaptador real antes de ativar em produção. Registre e verifique dependências nos runtimes aplicáveis via catálogo/compatibilidade antes da entrega.
`]]);
}

async function plugin(args, context) {
  const { positionals, flags } = options(args);
  assertFlags(flags, ['runtime', 'extends', 'dependencies']);
  const [id] = positionals;
  if (positionals.length !== 1 || !identifier.test(id || '')) throw new Error('Use generate plugin <id> [--runtime dev] [--extends pai] [--write].');
  const runtimeId = flags.runtime || 'dev';
  let runtime = [...(context.config.runtimes || []), ...(context.config.products || [])].find(item => item.id === runtimeId);
  if (!runtime && slugPattern.test(runtimeId)) {
    const profilePath = safePath(context.root, `products/${runtimeId}/product.profile.json`);
    if (existsSync(profilePath)) {
      const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
      if (profile.id !== runtimeId || typeof profile.app !== 'string') throw new Error('Perfil de produto inválido.');
      safePath(context.root, profile.app);
      runtime = { id: profile.id, app: profile.app };
    }
  }
  if (!runtime) throw new Error('Runtime desconhecido.');
  const catalog = await runtimeCatalog(context, runtime);
  if (catalog.plugins.some(item => item.id === id)) throw new Error(`Plugin já existe no runtime: ${id}.`);
  const parent = flags.extends;
  const dependencies = [...new Set([...(flags.dependencies || '').split(',').filter(Boolean), ...(parent ? [parent] : [])])];
  if (dependencies.includes(id)) throw new Error('Plugin não pode depender de si mesmo.');
  dependencyClosure(dependencies, catalog.plugins);
  const destinationPath = `${runtime.app}/apps/api/src/plugins/${id}`;
  const destination = safePath(context.root, destinationPath);
  if (existsSync(destination)) throw new Error(`Destino já existe: ${destinationPath}.`);
  const core = JSON.parse(readFileSync(safePath(context.root, `${runtime.app}/apps/api/core-version.json`), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(core.version) || !Number.isInteger(core.pluginApiVersion)) throw new Error('Contrato de core inválido.');
  const files = pluginFiles(id, dependencies, parent, core);
  if (flags.write) writeNewTree(destination, files);
  return { command: 'generate plugin', mode: flags.write ? 'written' : 'plan', runtime: runtime.id, destination: destinationPath, id, parentPlugin: parent || null, dependencies, writePaths: [...files.keys()].map(path => `${destinationPath}/${path}`), files: [...files.keys()], registered: false };
}

function typescript(root) {
  const require = createRequire(resolve(root, 'dev/app/package.json'));
  try { return require('typescript'); } catch { throw new Error('O codemod exige TypeScript instalado na base dev/app.'); }
}

export function rewriteImportSpecifiers(ts, source, filename, from, to) {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, extname(filename) === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  if (tree.parseDiagnostics?.length) throw new Error(`Fonte não pôde ser analisada com segurança: ${filename}`);
  const edits = [];
  const add = node => { if (node && ts.isStringLiteral(node) && node.text === from) edits.push({ start: node.getStart(tree) + 1, end: node.getEnd() - 1 }); };
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require') && node.arguments.length === 1) add(node.arguments[0]);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  let output = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + to + output.slice(edit.end);
  return { contents: output, count: edits.length };
}

async function migrate(args, context) {
  const [operation, ...rest] = args;
  if (operation === 'rollback') {
    const { positionals, flags } = options(rest);
    assertFlags(flags, ['id']);
    if (positionals.length || !/^[A-Za-z0-9-]+$/.test(flags.id || '')) throw new Error('Use migrate rollback --id <id-do-backup> [--write].');
    const directory = `.orbit/cache/migrations/${flags.id}`;
    const manifest = JSON.parse(readFileSync(safePath(context.root, `${directory}/migration.manifest.json`), 'utf8'));
    if (manifest.id !== flags.id || !Array.isArray(manifest.changes)) throw new Error('Manifesto de rollback inválido.');
    const changes = manifest.changes.map(change => {
      const target = safePath(context.root, change.path);
      const original = readFileSync(safePath(context.root, `${directory}/${change.path}`));
      const current = readFileSync(target);
      if (sha(original) !== change.before || sha(current) !== change.after) throw new Error(`Rollback recusado: hash mudou em ${change.path}.`);
      return { ...change, target, original, current };
    });
    if (flags.write) {
      const written = [];
      try {
        for (const change of changes) {
          if (sha(readFileSync(change.target)) !== change.after) throw new Error(`Fonte mudou antes do rollback: ${change.path}.`);
          writeFileSync(change.target, change.original); written.push(change);
        }
      } catch (error) {
        for (const change of written) if (sha(readFileSync(change.target)) === change.before) writeFileSync(change.target, change.current);
        throw error;
      }
    }
    return { command: 'migrate rollback', mode: flags.write ? 'written' : 'plan', id: flags.id, writePaths: changes.map(change => change.path), files: changes.map(change => change.path) };
  }
  if (operation !== 'imports') throw new Error('Use migrate imports --from módulo --to módulo --files caminho,caminho [--write].');
  const { positionals, flags } = options(rest);
  assertFlags(flags, ['from', 'to', 'files']);
  if (positionals.length || !flags.from || !flags.to || !flags.files) throw new Error('--from, --to e --files são obrigatórios.');
  if (flags.from === flags.to || /['"\r\n\\]/.test(flags.to)) throw new Error('Mapeamento de import inválido.');
  const paths = [...new Set(flags.files.split(',').filter(Boolean))];
  const ts = typescript(context.root), changes = [];
  for (const path of paths) {
    const fullPath = safePath(context.root, path);
    if (!/\.[cm]?[jt]sx?$/.test(path) || !lstatSync(fullPath).isFile()) throw new Error(`Fonte JS/TS inválida: ${path}.`);
    const original = readFileSync(fullPath, 'utf8');
    const { contents, count } = rewriteImportSpecifiers(ts, original, path, flags.from, flags.to);
    if (count) changes.push({ path, fullPath, original, contents, replacements: count, before: sha(original), after: sha(contents) });
  }
  const id = `imports-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
  const backupPath = `.orbit/cache/migrations/${id}`;
  if (flags.write && changes.length) {
    // Revalidate every precondition before touching any source.
    for (const change of changes) if (sha(readFileSync(change.fullPath)) !== change.before) throw new Error(`Fonte mudou durante o plano: ${change.path}.`);
    const backup = safePath(context.root, backupPath);
    const backups = new Map(changes.map(change => [change.path, change.original]));
    backups.set('migration.manifest.json', json({ id, command: 'imports', from: flags.from, to: flags.to, changes: changes.map(({ path, before, after, replacements }) => ({ path, before, after, replacements })) }));
    writeNewTree(backup, backups);
    const written = [];
    try {
      for (const change of changes) { if (sha(readFileSync(change.fullPath)) !== change.before) throw new Error(`Fonte mudou antes da escrita: ${change.path}.`); writeFileSync(change.fullPath, change.contents); written.push(change); }
    } catch (error) { for (const change of written) if (sha(readFileSync(change.fullPath)) === change.after) writeFileSync(change.fullPath, change.original); throw error; }
  }
  return { command: 'migrate imports', mode: flags.write ? 'written' : 'plan', writePaths: changes.map(change => change.path), changes: changes.map(({ path, before, after, replacements }) => ({ path, before, after, replacements })), backup: flags.write && changes.length ? backupPath : null, next: 'Revise diff, execute verificação por impacto e preserve o backup para rollback.' };
}

export async function execute(command, args, context) {
  if (command === 'migrate') return migrate(args, context);
  if (command !== 'generate') throw new Error(`Comando não suportado: ${command}.`);
  const [kind, ...rest] = args;
  if (kind === 'product') return product(rest, context);
  if (kind === 'plugin') return plugin(rest, context);
  throw new Error('Use generate product <slug> ou generate plugin <id>.');
}

import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { execute as catalogCommand } from './catalog.mjs';
import { execute as sharedCommand, safePath } from './shared.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const ignored = /(?:^|\/)(?:node_modules|data|backups?|sessions?|\.git|\.next[^/]*|dist|coverage|\.orbit\/(?:local|cache))(?:\/|$)|(?:^|\/)\.env(?:\.|$)|\.(?:pem|key|enc)$/;

export function getVerificationSnapshot(root, scopes) {
  const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\0').filter(path => path && !ignored.test(path) && scopes.some(scope => path === scope || path.startsWith(`${scope}/`)));
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:ORBIT_|TEST_|SMTP_|NODE_ENV$|TZ$|LANG$|CI$|DATABASE_URL$|JWT_SECRET$)/.test(key)).sort(([a], [b]) => a.localeCompare(b)));
  const state = createHash('sha256').update(JSON.stringify({ node: process.version, platform: process.platform, architecture: process.arch, environment: hash(JSON.stringify(environment)) }));
  for (const path of [...new Set(paths)].sort()) {
    state.update(path);
    try { state.update(readFileSync(safePath(root, path))); } catch (error) { if (error.code !== 'ENOENT') throw error; state.update('<deleted>'); }
  }
  return state.digest('hex');
}

export function verificationCommand(check, root, config) {
  const command = [...check.command];
  // npm exec may fetch a missing executable. Resolve the installed compiler only.
  if (command[0] === 'npm' && command[1] === 'exec' && command.includes('tsc')) {
    const runtime = config.runtimes.find(item => check.cwd === item.app || check.cwd.startsWith(`${item.app}/`));
    if (!runtime) throw new Error(`No runtime for compiler check ${check.id}`);
    const require = createRequire(resolve(root, runtime.app, 'package.json'));
    return [process.execPath, require.resolve('typescript/bin/tsc'), ...command.slice(command.indexOf('tsc') + 1)];
  }
  if (command[0] === 'node') command[0] = process.execPath;
  return command;
}

export function verificationScopes(config, check) {
  const runtime = config.runtimes.find(item => check.id.startsWith(`${item.id}:`));
  return runtime ? [runtime.app, 'packages', 'orbit.workspace.json', 'tools/orbit/verify.mjs'] : ['tools/orbit', 'scripts', 'packages', 'orbit.workspace.json', 'package.json', ...config.runtimes.map(item => item.app)];
}

function run(command, cwd, timeout = 300_000) {
  return new Promise(done => {
    const start = Date.now();
    const child = spawn(command[0], command.slice(1), { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let output = '', timedOut = false, finished = false;
    const finish = (exitCode, error) => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      done({ exitCode, elapsedMs: Date.now() - start, timedOut, ...(error ? { error } : {}), output });
    };
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }, timeout);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { if (output.length < 300_000) output += data.toString().slice(0, 300_000 - output.length); });
    child.on('error', error => finish(null, error.message));
    child.on('close', code => finish(code));
  });
}

export async function execute(command, args, context) {
  const { root, config } = context;
  const index = args.indexOf('--runtime');
  const selected = index < 0 ? null : args[index + 1];
  if (index >= 0 && !config.runtimes.some(item => item.id === selected)) throw new Error(`Unknown runtime: ${selected}`);
  const shared = await sharedCommand('shared', ['check', ...(selected ? ['--runtime', selected] : [])], context);
  const catalog = await catalogCommand('catalog', selected ? ['--runtime', selected] : [], context);
  const impact = await catalogCommand('impact', args, context);
  let checks = [...impact.checks];
  const milestone = args.includes('--milestone');
  if (milestone) {
    const runtimes = config.runtimes.filter(item => !selected || item.id === selected);
    checks = checks.filter(check => !check.id.includes(':api:unit') && !check.id.includes(':unit:affected'));
    for (const runtime of runtimes) {
      const app = runtime.app;
      checks.push({ id: `${runtime.id}:api:unit`, cwd: `${app}/apps/api`, command: ['npm', 'test'], reason: 'Milestone: API unit and plugin contract suite.' });
      for (const part of ['api', 'web']) checks.push({ id: `${runtime.id}:${part}:typecheck`, cwd: `${app}/apps/${part}`, command: ['npm', 'exec', '--', 'tsc', '--noEmit', '--incremental', 'false', '-p', 'tsconfig.json'], reason: 'Milestone: isolated runtime compilation.' });
      checks.push({ id: `${runtime.id}:lint`, cwd: app, command: ['npm', 'run', 'lint'], reason: 'Milestone: source conventions and zero warnings.' });
    }
  }
  checks = [...new Map(checks.filter(check => !selected || !config.runtimes.some(item => check.id.startsWith(`${item.id}:`)) || check.id.startsWith(`${selected}:`)).map(check => [check.id, check])).values()];
  const result = { ok: shared.ok && catalog.ok, verificationStatus: 'planned', mode: milestone ? 'milestone' : 'impact', shared, catalog: { ok: catalog.ok, diagnostics: catalog.diagnostics, runtimes: catalog.runtimes.map(item => ({ id: item.id, pluginCount: item.plugins.length })) }, changedFiles: impact.files, conservative: impact.conservative, checks: checks.map(check => ({ ...check, status: 'planned' })), functionalReview: 'pending', note: 'Commands run sequentially with --run. No application lifecycle, database mutation or browser startup is part of these checks.' };
  if (!args.includes('--run') || !result.ok) return result;
  const cacheDirectory = resolve(root, '.orbit/cache/checks');
  mkdirSync(cacheDirectory, { recursive: true });
  for (const check of result.checks) {
    const scopes = verificationScopes(config, check);
    const before = getVerificationSnapshot(root, scopes);
    const actual = verificationCommand(check, root, config);
    const key = hash(JSON.stringify({ id: check.id, command: actual, cwd: check.cwd, snapshot: before }));
    const path = resolve(cacheDirectory, `${key}.json`);
    if (!milestone && !args.includes('--no-cache') && existsSync(path)) {
      const raw = readFileSync(path, 'utf8');
      const cached = JSON.parse(raw);
      if (cached.exitCode === 0 && cached.sourcesStable === true && !cached.timedOut && cached.key === key) { check.status = 'cached'; check.evidence = relative(root, path); check.executedAt = cached.executedAt; check.key = key; check.evidenceHash = hash(raw); continue; }
    }
    process.stderr.write(`Orbit check: ${check.id}\n`);
    const execution = await run(actual, check.cwd === '.' ? root : safePath(root, check.cwd));
    const after = getVerificationSnapshot(root, scopes);
    const stable = before === after;
    const evidence = { ...execution, id: check.id, key, command: actual, cwd: check.cwd, sourceHash: before, sourcesStable: stable, executedAt: new Date().toISOString() };
    const temporary = `${path}.${randomUUID()}.tmp`;
    const raw = `${JSON.stringify(evidence, null, 2)}\n`;
    writeFileSync(temporary, raw); renameSync(temporary, path);
    check.status = execution.exitCode === 0 && !execution.timedOut && stable ? 'passed' : 'failed';
    check.elapsedMs = execution.elapsedMs;
    check.evidence = relative(root, path);
    check.key = key;
    check.evidenceHash = hash(raw);
    check.executedAt = evidence.executedAt;
    if (check.status === 'failed') {
      result.ok = false;
      check.error = !stable ? 'Sources changed during verification; run again after integration.' : execution.error || execution.output.slice(-8_000);
      break;
    }
  }
  result.verificationStatus = result.ok ? 'passed' : 'failed';
  return result;
}

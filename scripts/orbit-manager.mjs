import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const developmentRoot = resolve(process.env.ORBIT_DEVELOPMENT_ROOT || join(root, '../orbit-dev'));
const request = resolve(root, '.orbit-deploy-request');
const heartbeat = resolve(root, '.orbit-deploy-manager');
const status = resolve(root, '.orbit-deploy-status.json');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let children = [];
let deploying = false;

const run = (binary, args, options = {}) => new Promise((resolveRun, reject) => {
  const child = spawn(binary, args, { cwd: root, stdio: 'inherit', detached: process.platform !== 'win32', ...options });
  child.on('error', reject);
  child.on('close', code => code === 0 ? resolveRun() : reject(new Error(`Comando terminou com código ${code}.`)));
});

const git = (directory, args) => run('git', args, { cwd: directory });
const gitOutput = (directory, args) => new Promise((resolveOutput, reject) => {
  const child = spawn('git', args, { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', error = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { error = (error + chunk).slice(-2000); });
  child.on('error', reject);
  child.on('close', code => code === 0 ? resolveOutput(output) : reject(new Error(error || `git ${args.join(' ')} terminou com código ${code}.`)));
});

async function publishDevelopment() {
  await git(developmentRoot, ['add', '-A']);
  if ((await gitOutput(developmentRoot, ['status', '--porcelain'])).trim()) await git(developmentRoot, ['commit', '-m', 'chore: deploy Orbit development changes']);
  await git(developmentRoot, ['push', 'origin', 'develop']);
}

async function updateStableOrbit() {
  if ((await gitOutput(root, ['status', '--porcelain'])).trim()) throw new Error('O Orbit em main tem alterações locais. Finalize-as antes do Deploy.');
  await git(root, ['checkout', 'main']);
  await git(root, ['pull', '--ff-only', 'origin', 'develop']);
  await git(root, ['push', 'origin', 'main']);
}

async function prepareAndValidate(directory) {
  await run(npm, ['run', 'db:prepare'], { cwd: directory });
  await run(npm, ['run', 'build'], { cwd: directory });
  await run(npm, ['run', 'test:unit'], { cwd: directory });
}

const signalChild = (child, signal) => {
  if (!child.pid) return;
  try { process.platform === 'win32' ? child.kill(signal) : process.kill(-child.pid, signal); }
  catch { try { child.kill(signal); } catch { /* The process already stopped. */ } }
};

async function stopChildren() {
  const stopping = children;
  children = [];
  for (const child of stopping) signalChild(child, 'SIGTERM');
  await new Promise(resolveDelay => setTimeout(resolveDelay, 3000));
  for (const child of stopping) signalChild(child, 'SIGKILL');
}

function startChildren() {
  children = [
    spawn(npm, ['run', 'start', '-w', 'apps/api'], { cwd: root, stdio: 'inherit', detached: process.platform !== 'win32' }),
    spawn(npm, ['run', 'start', '-w', 'apps/web'], { cwd: root, stdio: 'inherit', detached: process.platform !== 'win32' }),
  ];
  for (const child of children) child.on('exit', code => { if (!deploying && code && code !== 0) console.error(`Orbit parou com código ${code}.`); });
}

async function deploy() {
  if (deploying) return;
  deploying = true;
  await rm(request, { force: true });
  await writeFile(status, JSON.stringify({ status: 'building', started_at: new Date().toISOString() }));
  await stopChildren();
  try {
    await prepareAndValidate(developmentRoot);
    await publishDevelopment();
    await updateStableOrbit();
    await prepareAndValidate(root);
    await writeFile(status, JSON.stringify({ status: 'restarting', finished_at: new Date().toISOString() }));
  } catch (error) {
    await writeFile(status, JSON.stringify({ status: 'failed', error: error instanceof Error ? error.message : 'Falha na compilação.' }));
    console.error('Deploy falhou:', error);
  } finally {
    startChildren();
    deploying = false;
  }
}

startChildren();
const timer = setInterval(() => {
  void writeFile(heartbeat, new Date().toISOString(), { mode: 0o600 });
  if (existsSync(request)) void deploy();
}, 1000);

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { clearInterval(timer); void stopChildren().finally(() => process.exit(0)); });

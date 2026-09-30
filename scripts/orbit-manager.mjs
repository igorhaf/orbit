import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const request = resolve(root, '.orbit-deploy-request');
const heartbeat = resolve(root, '.orbit-deploy-manager');
const status = resolve(root, '.orbit-deploy-status.json');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let children = [];
let deploying = false;

const run = (args, options = {}) => new Promise((resolveRun, reject) => {
  const child = spawn(npm, args, { cwd: root, stdio: 'inherit', detached: process.platform !== 'win32', ...options });
  child.on('error', reject);
  child.on('close', code => code === 0 ? resolveRun() : reject(new Error(`Comando terminou com código ${code}.`)));
});

function stopChildren() {
  for (const child of children) {
    if (!child.pid) continue;
    try { process.platform === 'win32' ? child.kill('SIGTERM') : process.kill(-child.pid, 'SIGTERM'); }
    catch { child.kill('SIGTERM'); }
  }
  children = [];
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
  stopChildren();
  try {
    await run(['run', 'db:migrate', '-w', 'apps/api']);
    await run(['run', 'build']);
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

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { clearInterval(timer); stopChildren(); process.exit(0); });

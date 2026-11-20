import { spawn } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pidFile = resolve(root, '.orbit-manager.pid');
const environment = { ...process.env };
let stopping = false;
const children = new Map();

try {
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  process.kill(pid, 0);
  console.error(`Orbit já está ativo no processo ${pid}.`);
  process.exit(1);
} catch (error) {
  if (error?.code !== 'ENOENT') {
    try { unlinkSync(pidFile); } catch { /* stale pid file */ }
  }
}

writeFileSync(pidFile, `${process.pid}\n`, { flag: 'wx' });

const services = [
  ['API', 'npm', ['run', 'start', '-w', 'apps/api'], root],
  ['Web', 'npm', ['run', 'start', '-w', 'apps/web'], root],
];

function signal(child, name) {
  if (!child.pid) return;
  try { process.kill(-child.pid, name); }
  catch { try { child.kill(name); } catch { /* already stopped */ } }
}

function launch(name, command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    env: environment,
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  });
  children.set(name, child);
  child.on('exit', (code, signalName) => {
    if (children.get(name) !== child) return;
    children.delete(name);
    if (!stopping) {
      console.error(`Orbit ${name} parou (código ${code ?? '-'}, sinal ${signalName ?? '-'}); reiniciando em 2s.`);
      setTimeout(() => { if (!stopping) launch(name, command, args, cwd); }, 2000).unref();
    }
  });
  child.on('error', error => console.error(`Falha ao iniciar Orbit ${name}:`, error.message));
}

for (const service of services) launch(...service);
console.log('Orbit ativo em http://localhost:3000 (API: http://localhost:4000).');

async function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children.values()) signal(child, 'SIGTERM');
  await new Promise(resolveDelay => setTimeout(resolveDelay, 3000));
  for (const child of children.values()) signal(child, 'SIGKILL');
  children.clear();
  try {
    if (Number(readFileSync(pidFile, 'utf8').trim()) === process.pid) unlinkSync(pidFile);
  } catch { /* already removed */ }
  process.exit(0);
}

process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
process.on('exit', () => {
  try { if (Number(readFileSync(pidFile, 'utf8').trim()) === process.pid) unlinkSync(pidFile); } catch { /* already removed */ }
});

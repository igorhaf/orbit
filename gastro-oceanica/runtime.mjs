import { spawn } from 'node:child_process';
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

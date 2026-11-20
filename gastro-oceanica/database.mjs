import { spawnSync } from 'node:child_process';
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

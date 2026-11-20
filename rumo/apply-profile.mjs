import { createRequire } from 'node:module';
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

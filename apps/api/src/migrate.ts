import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { createDatabaseBackup, hasExistingOrbitSchema } from './database-backup';
import { migrateVersions } from './migrations';
import { seedDatabase } from './seed';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    if (await hasExistingOrbitSchema()) await createDatabaseBackup('before-db-migrate');
    await pool.query(readFileSync(resolve(__dirname, '../sql/schema.sql'), 'utf8'));
    await pool.query(readFileSync(resolve(__dirname, '../sql/automations.sql'), 'utf8'));
    await migrateVersions(pool);
    await seedDatabase(pool);
    console.log('Database schema is ready.');
  } finally { await pool.end(); }
}
main().catch(error => { console.error(error); process.exit(1); });

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { backupPath, createDatabaseBackup, hasExistingOrbitSchema, verifyDatabaseBackup } from './database-backup';
import {processGeneratedBackup} from './managed-backup';
import { migrateVersions } from './migrations';
import { allowLocalOnlyMigrationBackup } from './migration-backup-policy';
import { seedDatabase } from './seed';

function deliveryFailed(deliveries: Awaited<ReturnType<typeof processGeneratedBackup>>) {
  return deliveries.some(item => item.cloud?.status === 'failed' || item.vaultBackup?.cloud?.status === 'failed' || item.configBackup?.cloud?.status === 'failed' || item.attachments.failed || item.vaultError);
}

async function main() {
  const localOnlyBackup = allowLocalOnlyMigrationBackup(process.argv.slice(2), process.env);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const backup=await hasExistingOrbitSchema()?await createDatabaseBackup('before-db-migrate'):null;
    if (backup && localOnlyBackup) await verifyDatabaseBackup(backupPath(backup.archive));
    const cloudTables=backup?(await pool.query<{vault:string|null;config:string|null;attachments:string|null;folders:boolean}>("SELECT to_regclass('vault_backup_cloud_copies') AS vault, to_regclass('config_backup_cloud_copies') AS config, to_regclass('attachment_backup_cloud_copies') AS attachments, EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='attachment_backup_cloud_copies' AND column_name='organized_at' AND table_schema=current_schema()) AS folders")).rows[0]:null;
    const cloudSchemaReady=Boolean(cloudTables?.vault&&cloudTables?.config&&cloudTables?.attachments&&cloudTables?.folders);
    if(backup&&cloudSchemaReady){const deliveries=await processGeneratedBackup(backup);if(deliveryFailed(deliveries)&&!localOnlyBackup)throw new Error('Backup pré-migração salvo localmente, mas o envio automático falhou. Consulte o status em Backups.');if(deliveryFailed(deliveries))console.warn('DEMO DEV: envio ao Drive falhou; backup local criptografado foi verificado e a migração continuará pela flag explícita. A cópia em nuvem permanece pendente.');}
    await pool.query(readFileSync(resolve(__dirname, '../sql/schema.sql'), 'utf8'));
    const migrationTable=await pool.query("SELECT to_regclass('schema_migrations') AS name");
    const hasRemovedAutomations=migrationTable.rows[0]?.name
      ? Boolean((await pool.query("SELECT 1 FROM schema_migrations WHERE version='022_remove_automations.sql'")).rowCount)
      : false;
    if(!hasRemovedAutomations)await pool.query(readFileSync(resolve(__dirname, '../sql/pre-022-compat.sql'), 'utf8'));
    await migrateVersions(pool);
    await seedDatabase(pool);
    if(backup&&!cloudSchemaReady&&!localOnlyBackup){const deliveries=await processGeneratedBackup(backup);if(deliveryFailed(deliveries))throw new Error('Migração aplicada, mas um envio automático de backup falhou. Consulte o status em Backups.');}
    if(backup&&!cloudSchemaReady&&localOnlyBackup)console.warn('DEMO DEV: schema de destinos cloud ainda não existe; backup local verificado, migração concluída sem cópia Drive.');
    console.log('Database schema is ready.');
  } finally { await pool.end(); }
}
main().catch(error => { console.error(error); process.exit(1); });

import 'dotenv/config';
import { createDatabaseBackup, listDatabaseBackups, restoreDatabaseBackup, verifyDatabaseBackup } from './database-backup';

async function main() {
  const [action, ...args] = process.argv.slice(2);
  if (action === 'create') {
    const backup = await createDatabaseBackup(args.join(' ') || 'manual');
    console.log(JSON.stringify(backup, null, 2));
    return;
  }
  if (action === 'list') {
    console.log(JSON.stringify(await listDatabaseBackups(), null, 2));
    return;
  }
  if (action === 'verify') {
    if (!args[0]) throw new Error('Usage: npm run db:backup:verify -- <backup-file>');
    console.log(JSON.stringify(await verifyDatabaseBackup(args[0]), null, 2));
    return;
  }
  if (action === 'restore') {
    if (!args[0] || !process.env.ORBIT_RESTORE_DATABASE_URL) {
      throw new Error('Set ORBIT_RESTORE_DATABASE_URL to a fresh, empty database and provide a backup file.');
    }
    console.log(JSON.stringify(await restoreDatabaseBackup(args[0], process.env.ORBIT_RESTORE_DATABASE_URL), null, 2));
    return;
  }
  throw new Error('Usage: npm run db:backup -- <create|list|verify|restore>');
}

main().catch(error => {
  console.error((error as Error).message);
  process.exitCode = 1;
});

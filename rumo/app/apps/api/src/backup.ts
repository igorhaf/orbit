import 'dotenv/config';
import { createDatabaseBackup, listDatabaseBackups, restoreDatabaseBackup, verifyDatabaseBackup } from './database-backup';
import {processGeneratedBackup} from './managed-backup';
import {Db} from './db';
import {restoreVaultBackup,verifyVaultBackup} from './vault-backup';
import {restoreConfigBackup,verifyConfigBackup} from './config-backup';
import {extractAttachmentBackup,verifyAttachmentBackup} from './attachment-backup';

async function main() {
  const [action, ...args] = process.argv.slice(2);
  if (action === 'create') {
    const backup = await createDatabaseBackup(args.join(' ') || 'manual');
    const deliveries=await processGeneratedBackup(backup);
    console.log(JSON.stringify({backup,deliveries}, null, 2));
    if(deliveries.some(item=>item.cloud?.status==='failed'||item.vaultBackup?.cloud?.status==='failed'||item.configBackup?.cloud?.status==='failed'||item.attachments.failed||item.vaultError))process.exitCode=1;
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
  if(action==='verify-vault'){
    if(!args[0])throw new Error('Usage: npm run db:backup -- verify-vault <vault-file>');
    console.log(JSON.stringify(await verifyVaultBackup(args[0]),null,2));
    return;
  }
  if(action==='verify-config'){
    if(!args[0])throw new Error('Usage: npm run db:backup -- verify-config <config-file>');
    console.log(JSON.stringify(await verifyConfigBackup(args[0]),null,2));
    return;
  }
  if(action==='restore-config'){
    if(!args[0]||!args[1])throw new Error('Usage: npm run db:backup -- restore-config <config-file> <empty-target-directory>');
    console.log(JSON.stringify(await restoreConfigBackup(args[0],args[1]),null,2));
    return;
  }
  if(action==='verify-attachment'){
    if(!args[0])throw new Error('Usage: npm run db:backup -- verify-attachment <attachment-file>');
    console.log(JSON.stringify(await verifyAttachmentBackup(args[0]),null,2));
    return;
  }
  if(action==='extract-attachment'){
    if(!args[0]||!args[1])throw new Error('Usage: npm run db:backup -- extract-attachment <attachment-file> <output-directory>');
    console.log(JSON.stringify(await extractAttachmentBackup(args[0],args[1]),null,2));
    return;
  }
  if(action==='restore-vault'){
    if(!args[0]||!args[1])throw new Error('Usage: npm run db:backup -- restore-vault <vault-file> <owner-email>');
    const db=new Db();
    try{
      const owner=await db.one<{id:string}>('SELECT id FROM users WHERE email=$1',[args[1]]);
      if(!owner)throw new Error('Conta de destino não encontrada.');
      console.log(JSON.stringify(await restoreVaultBackup(db,owner.id,args[0]),null,2));
    }finally{await db.pool.end()}
    return;
  }
  throw new Error('Usage: npm run db:backup -- <create|list|verify|restore|verify-vault|restore-vault|verify-config|restore-config|verify-attachment|extract-attachment>');
}

main().catch(error => {
  console.error((error as Error).message);
  process.exitCode = 1;
});

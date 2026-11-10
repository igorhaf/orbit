import 'dotenv/config';
import { createDatabaseBackup, listDatabaseBackups, restoreDatabaseBackup, verifyDatabaseBackup } from './database-backup';
import {processGeneratedBackup} from './managed-backup';
import {Db} from './db';
import {restoreVaultBackup,verifyVaultBackup} from './vault-backup';
import {restoreConfigBackup,verifyConfigBackup} from './config-backup';
import {extractAttachmentBackup,verifyAttachmentBackup} from './attachment-backup';
import {Pool} from 'pg';
import {erasureSubjectRef, initializeErasureLedger, markErasureLedgerCommitted, readErasureLedger, recoverErasureLedgerHead} from './erasure-ledger';

async function main() {
  const [action, ...args] = process.argv.slice(2);
  if (action === 'init-erasure-ledger') {
    console.log(JSON.stringify(await initializeErasureLedger(), null, 2));
    return;
  }
  if (action === 'recover-erasure-ledger-head') {
    console.log(JSON.stringify(await recoverErasureLedgerHead(), null, 2));
    return;
  }
  if (action === 'reconcile-erasure-ledger') {
    const ledger = await readErasureLedger();
    const pending = ledger.filter(entry => entry.state === 'prepared');
    if (!pending.length) {
      console.log(JSON.stringify({ reconciled: 0, unresolved: [] }, null, 2));
      return;
    }
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to reconcile pending erasures against the active database.');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const unresolved: string[] = [];
    try {
      for (const entry of pending) {
        const result = await pool.query<{ external_ledger_state: string; subject_user_id: string }>(
          "SELECT external_ledger_state,subject_user_id::text AS subject_user_id FROM suinda_privacy_erasures WHERE id=$1 AND state='completed' AND external_ledger_state IN ('prepared','committed')",
          [entry.operationId],
        );
        if (!result.rows.length || erasureSubjectRef(result.rows[0].subject_user_id) !== entry.subjectRef) { unresolved.push(entry.operationId); continue; }
        await markErasureLedgerCommitted(entry.operationId);
        await pool.query("UPDATE suinda_privacy_erasures SET external_ledger_state='committed' WHERE id=$1 AND state='completed' AND external_ledger_state='prepared'", [entry.operationId]);
      }
    } finally { await pool.end(); }
    console.log(JSON.stringify({ reconciled: pending.length - unresolved.length, unresolved }, null, 2));
    if (unresolved.length) throw new Error('Some prepared erasures have no completed-operation proof in the active database; the restore ledger remains unresolved.');
    return;
  }
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
  throw new Error('Usage: npm run db:backup -- <create|list|verify|restore|init-erasure-ledger|recover-erasure-ledger-head|reconcile-erasure-ledger|verify-vault|restore-vault|verify-config|restore-config|verify-attachment|extract-attachment>');
}

main().catch(error => {
  console.error((error as Error).message);
  process.exitCode = 1;
});

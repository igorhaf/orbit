import 'reflect-metadata';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Db } from './db';
import { BackupDestinationRegistry } from './backup-destinations';
import { BackupService } from './backup-service';
import { GoogleCredentials, GOOGLE_DRIVE_FILE_SCOPE } from './google/credentials';
import { SecretVault } from './secrets';
import { migrateVersions } from './migrations';
import { decryptVaultPayload, encryptVaultPayload } from './vault-crypto';
import { createVaultBackup, readVaultBackup, restoreVaultBackup, vaultBackupPath } from './vault-backup';

test('a separate encrypted vault archive can be verified and restored without restoring the database',async()=>{
  const old={directory:process.env.ORBIT_BACKUP_DIR,backupKey:process.env.ORBIT_BACKUP_KEY,vaultKey:process.env.VAULT_ENCRYPTION_KEY};
  const directory=await mkdtemp(join(tmpdir(),'orbit-vault-recovery-'));
  process.env.ORBIT_BACKUP_DIR=directory;
  process.env.ORBIT_BACKUP_KEY='ab'.repeat(32);
  process.env.VAULT_ENCRYPTION_KEY='vault-integration-key';
  const db=new Db(),users:string[]=[];
  try{
    await migrateVersions(db.pool);
    for(const name of ['source','destination']){
      const user=await db.one<{id:string}>('INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id',[name,`${randomUUID()}@example.invalid`,'test']);
      users.push(user!.id);
    }
    const category=await db.one<{id:string}>('INSERT INTO vault_categories(owner_id,name,icon) VALUES($1,$2,$3) RETURNING id',[users[0],'Privado','LockKeyhole']);
    await db.query('INSERT INTO vault_items(owner_id,title,category,secret_data) VALUES($1,$2,$3,$4)',[users[0],'Credencial',category!.id,encryptVaultPayload({content_html:'<p>segredo de recuperação</p>'})]);
    const manifest=await createVaultBackup(db,users[0]),path=vaultBackupPath(manifest.archive);
    const encrypted=await readFile(path);
    assert.equal(encrypted.includes(Buffer.from('segredo de recuperação')),false);
    assert.equal((await readFile(`${path}.manifest.json`,'utf8')).includes('Credencial'),false);
    const verified=await readVaultBackup(path);
    assert.equal(verified.snapshot.items[0].content_html,'<p>segredo de recuperação</p>');
    const restored=await restoreVaultBackup(db,users[1],path);
    assert.equal(restored.restoredItems,1);
    const rows=await db.query<{title:string;secret_data:string}>('SELECT title,secret_data FROM vault_items WHERE owner_id=$1',[users[1]]);
    assert.equal(rows[0].title,'Credencial');
    assert.equal(decryptVaultPayload(rows[0].secret_data).content_html,'<p>segredo de recuperação</p>');
    await assert.rejects(()=>restoreVaultBackup(db,users[1],path),/já foi restaurado/);
    const modified=Buffer.from(encrypted);modified[modified.length-1]^=1;await writeFile(path,modified);
    await assert.rejects(()=>readVaultBackup(path),/Integridade/);
  }finally{
    for(const id of users)await db.query('DELETE FROM users WHERE id=$1',[id]);
    await db.pool.end();await rm(directory,{recursive:true,force:true});
    if(old.directory===undefined)delete process.env.ORBIT_BACKUP_DIR;else process.env.ORBIT_BACKUP_DIR=old.directory;
    if(old.backupKey===undefined)delete process.env.ORBIT_BACKUP_KEY;else process.env.ORBIT_BACKUP_KEY=old.backupKey;
    if(old.vaultKey===undefined)delete process.env.VAULT_ENCRYPTION_KEY;else process.env.VAULT_ENCRYPTION_KEY=old.vaultKey;
  }
});

test('a generated backup sends the database and vault archives to the selected Drive connection',async()=>{
  const old={directory:process.env.ORBIT_BACKUP_DIR,backupKey:process.env.ORBIT_BACKUP_KEY,secret:process.env.ORBIT_SECRET_KEY};
  const directory=await mkdtemp(join(tmpdir(),'orbit-auto-backup-'));
  process.env.ORBIT_BACKUP_DIR=directory;
  process.env.ORBIT_BACKUP_KEY='cd'.repeat(32);
  process.env.ORBIT_SECRET_KEY='backup-integration-credential-key';
  const db=new Db();let userId:string|undefined;
  try{
    await migrateVersions(db.pool);
    const user=await db.one<{id:string}>('INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id',['Backup fixture',`${randomUUID()}@example.invalid`,'test']);
    userId=user!.id;
    const sealed=new SecretVault().seal({access_token:'fixture-access',refresh_token:'fixture-refresh',expires_at:Date.now()+3600_000,scope:GOOGLE_DRIVE_FILE_SCOPE});
    const connection=await db.one<{id:string}>("INSERT INTO integration_connections(owner_id,plugin_id,external_account_id,display_name,label,credentials_encrypted) VALUES($1,'google',$2,$3,$3,$4) RETURNING id",[userId,randomUUID(),'Drive fixture',sealed]);
    const calls:string[]=[];
    const destinations=new BackupDestinationRegistry();
    const provider={id:'google_drive',name:'Google Drive',upload:async()=>{calls.push('database');return {archiveFileId:'database-file',manifestFileId:'database-manifest',folderId:'database-folder'}},uploadVault:async()=>{calls.push('vault');return {archiveFileId:'vault-file',manifestFileId:'vault-manifest',folderId:'vault-folder'}},download:async()=>undefined};
    destinations.register(provider);
    const service=new BackupService(db,destinations,new GoogleCredentials(db,new SecretVault()));
    const config=(await service.options(userId)).automatic;
    assert.equal(config.connectionId,connection!.id);
    assert.equal(config.enabled,true);
    const manifest={archive:'orbit-2026-10-06T00-00-00-000Z-fixture.backup.enc'} as Parameters<BackupService['processGenerated']>[0];
    const [result]=await service.processGenerated(manifest,userId);
    const remembered=await db.one<{connection_id:string}>('SELECT connection_id FROM backup_cloud_settings WHERE owner_id=$1',[userId]);
    assert.equal(remembered?.connection_id,connection!.id);
    assert.equal((await service.configureAutomatic(userId,connection!.id,false)).enabled,false);
    assert.equal((await service.configureAutomatic(userId,connection!.id,true)).enabled,true);
    assert.deepEqual(calls,['vault','database']);
    assert.equal(result.cloud?.status,'success');
    assert.equal(result.vaultBackup?.cloud?.status,'success');
    assert.equal((await service.listVault(userId))[0].cloudCopies?.[0].archiveFileId,'vault-file');
    const vaultOnly=await service.createVault(userId);
    assert.equal(vaultOnly.cloud?.status,'success');
    assert.equal((await service.listVault(userId)).length,2);
  }finally{
    if(userId)await db.query('DELETE FROM users WHERE id=$1',[userId]);
    await db.pool.end();await rm(directory,{recursive:true,force:true});
    if(old.directory===undefined)delete process.env.ORBIT_BACKUP_DIR;else process.env.ORBIT_BACKUP_DIR=old.directory;
    if(old.backupKey===undefined)delete process.env.ORBIT_BACKUP_KEY;else process.env.ORBIT_BACKUP_KEY=old.backupKey;
    if(old.secret===undefined)delete process.env.ORBIT_SECRET_KEY;else process.env.ORBIT_SECRET_KEY=old.secret;
  }
});

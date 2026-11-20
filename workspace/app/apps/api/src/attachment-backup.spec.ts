import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { attachmentBackupPath, createAttachmentBackup, extractAttachmentBackup, readAttachmentBackup, verifyAttachmentBackup } from './attachment-backup';

test('card and comment files have separate encrypted, restorable backups',async()=>{
  const backupDir=await mkdtemp(join(tmpdir(),'orbit-attachment-backups-'));
  const restoreDir=await mkdtemp(join(tmpdir(),'orbit-attachment-restore-'));
  const previous={dir:process.env.ORBIT_BACKUP_DIR,key:process.env.ORBIT_BACKUP_KEY};
  process.env.ORBIT_BACKUP_DIR=backupDir;process.env.ORBIT_BACKUP_KEY=randomBytes(32).toString('hex');
  const owner=randomUUID(),card=randomUUID(),comment=randomUUID(),file=Buffer.from('private card attachment');
  const source={id:randomUUID(),card_id:card,comment_id:null,name:'private.txt',mime_type:'text/plain',created_at:new Date().toISOString(),data:file};
  const db={one:async(sql:string,params:unknown[])=>{assert.match(sql,/b.owner_id=\$2/);assert.equal(params[1],owner);return {...source,comment_id:sql.includes('comment_attachments')?comment:null}}};
  try{
    const first=await createAttachmentBackup(db as never,owner,'card',source.id);
    assert.equal(first.file_bytes,file.length);
    const firstPath=attachmentBackupPath(first.archive);
    assert.equal((await readFile(firstPath)).includes(file),false);
    assert.equal((await createAttachmentBackup(db as never,owner,'card',source.id)).archive,first.archive);
    assert.equal((await readAttachmentBackup(firstPath)).snapshot.name,'private.txt');
    const second=await createAttachmentBackup(db as never,owner,'comment',source.id);
    assert.notEqual(second.archive,first.archive);
    assert.equal((await readAttachmentBackup(attachmentBackupPath(second.archive))).snapshot.comment_id,comment);
    assert.deepEqual(await extractAttachmentBackup(firstPath,restoreDir),{archive:first.archive,name:'private.txt',bytes:file.length});
    assert.deepEqual(await readFile(join(restoreDir,'private.txt')),file);
    await assert.rejects(()=>extractAttachmentBackup(firstPath,restoreDir),/EEXIST/);
    const encrypted=await readFile(firstPath);encrypted[encrypted.length-1]^=1;await writeFile(firstPath,encrypted);
    await assert.rejects(()=>verifyAttachmentBackup(firstPath),/Integridade/);
  }finally{
    if(previous.dir===undefined)delete process.env.ORBIT_BACKUP_DIR;else process.env.ORBIT_BACKUP_DIR=previous.dir;
    if(previous.key===undefined)delete process.env.ORBIT_BACKUP_KEY;else process.env.ORBIT_BACKUP_KEY=previous.key;
    await Promise.all([rm(backupDir,{recursive:true,force:true}),rm(restoreDir,{recursive:true,force:true})]);
  }
});

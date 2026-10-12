import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createConfigBackup, readConfigBackup, restoreConfigBackup, verifyConfigBackup } from './config-backup';

test('ignored environment files are encrypted, deduplicated, and restored without overwriting', async () => {
  const root=await mkdtemp(join(tmpdir(),'orbit-config-source-'));
  const output=await mkdtemp(join(tmpdir(),'orbit-config-output-'));
  const target=await mkdtemp(join(tmpdir(),'orbit-config-restore-'));
  const previous={key:process.env.ORBIT_BACKUP_KEY,paths:process.env.ORBIT_CONFIG_BACKUP_PATHS};
  process.env.ORBIT_BACKUP_KEY=randomBytes(32).toString('hex');
  delete process.env.ORBIT_CONFIG_BACKUP_PATHS;
  try{
    await mkdir(join(root,'apps/api'),{recursive:true});
    await mkdir(join(root,'apps/web'),{recursive:true});
    await writeFile(join(root,'apps/api/.env'),'JWT_SECRET=private\n',{mode:0o600});
    await writeFile(join(root,'apps/web/.env.local'),'NEXT_PUBLIC_API_URL=http://localhost:4001\n',{mode:0o600});
    await writeFile(join(root,'apps/api/.env.example'),'EXAMPLE=public\n');
    const first=await createConfigBackup(root,output);
    assert(first);
    assert.equal(first.file_count,2);
    const archive=join(output,first.archive);
    assert.equal((await readFile(archive)).includes('JWT_SECRET'),false);
    assert.deepEqual((await readConfigBackup(archive)).snapshot.files.map(file=>file.path),['apps/api/.env','apps/web/.env.local']);
    assert.equal((await createConfigBackup(root,output))?.archive,first.archive);
    await writeFile(join(root,'apps/api/.env'),'JWT_SECRET=changed\n');
    const second=await createConfigBackup(root,output);
    assert(second&&second.archive!==first.archive);
    assert.equal((await verifyConfigBackup(join(output,second.archive))).file_count,2);
    const result=await restoreConfigBackup(join(output,second.archive),target);
    assert.deepEqual(result.restored,['apps/api/.env','apps/web/.env.local']);
    assert.equal(await readFile(join(target,'apps/api/.env'),'utf8'),'JWT_SECRET=changed\n');
    await assert.rejects(()=>restoreConfigBackup(join(output,second.archive),target),/EEXIST/);
    const contents=await readFile(join(output,second.archive));contents[contents.length-1]^=1;
    await writeFile(join(output,second.archive),contents);
    await assert.rejects(()=>verifyConfigBackup(join(output,second.archive)),/Integridade/);
  }finally{
    if(previous.key===undefined)delete process.env.ORBIT_BACKUP_KEY;else process.env.ORBIT_BACKUP_KEY=previous.key;
    if(previous.paths===undefined)delete process.env.ORBIT_CONFIG_BACKUP_PATHS;else process.env.ORBIT_CONFIG_BACKUP_PATHS=previous.paths;
    await Promise.all([rm(root,{recursive:true,force:true}),rm(output,{recursive:true,force:true}),rm(target,{recursive:true,force:true})]);
  }
});

test('configuration backup rejects symlinks',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orbit-config-link-'));
  const output=await mkdtemp(join(tmpdir(),'orbit-config-link-output-'));
  const previous=process.env.ORBIT_BACKUP_KEY;
  process.env.ORBIT_BACKUP_KEY=randomBytes(32).toString('hex');
  try{
    await mkdir(join(root,'apps/api'),{recursive:true});
    await symlink('/etc/passwd',join(root,'apps/api/.env'));
    await assert.rejects(()=>createConfigBackup(root,output),/Arquivo de configuração inválido/);
  }finally{
    if(previous===undefined)delete process.env.ORBIT_BACKUP_KEY;else process.env.ORBIT_BACKUP_KEY=previous;
    await Promise.all([rm(root,{recursive:true,force:true}),rm(output,{recursive:true,force:true})]);
  }
});

test('explicit extra configuration paths are included and cannot escape the project',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orbit-config-extra-'));
  const output=await mkdtemp(join(tmpdir(),'orbit-config-extra-output-'));
  const previous=process.env.ORBIT_BACKUP_KEY;
  process.env.ORBIT_BACKUP_KEY=randomBytes(32).toString('hex');
  try{
    await mkdir(join(root,'apps/api'),{recursive:true});
    await writeFile(join(root,'apps/api/.env'),'ORBIT_CONFIG_BACKUP_PATHS="apps/api/private.conf"\n');
    await writeFile(join(root,'apps/api/private.conf'),'SECRET=custom\n');
    const archive=await createConfigBackup(root,output);
    assert.equal(archive?.file_count,2);
    await writeFile(join(root,'apps/api/.env'),'ORBIT_CONFIG_BACKUP_PATHS="../outside.conf"\n');
    await assert.rejects(()=>createConfigBackup(root,output),/fora do projeto/);
  }finally{
    if(previous===undefined)delete process.env.ORBIT_BACKUP_KEY;else process.env.ORBIT_BACKUP_KEY=previous;
    await Promise.all([rm(root,{recursive:true,force:true}),rm(output,{recursive:true,force:true})]);
  }
});

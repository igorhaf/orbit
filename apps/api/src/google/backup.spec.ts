import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SecretVault} from '../secrets';
import {GoogleCredentials,GOOGLE_DRIVE_FILE_SCOPE} from './credentials';
import {uploadFile} from '../google-drive-backup';
import {BackupDestinationRegistry} from '../backup-destinations';
import {GoogleDriveBackupPlugin,googleDriveBackupPluginDefinition} from './drive-backup.plugin';
import {PluginRegistry} from '../execution/registries';
import {BackupService} from '../backup-service';

test('shared Google credentials request a narrow Drive scope and encrypt OAuth tokens',async()=>{
  const previous={id:process.env.GOOGLE_CLIENT_ID,secret:process.env.GOOGLE_CLIENT_SECRET,key:process.env.ORBIT_SECRET_KEY,fetch:global.fetch};
  process.env.GOOGLE_CLIENT_ID='google-client';process.env.GOOGLE_CLIENT_SECRET='google-secret';process.env.ORBIT_SECRET_KEY='integration-only-secret-with-thirty-two-characters';
  const writes:Array<{sql:string;params:unknown[]}>=[];let sealed='';
  const db={query:async(sql:string,params:unknown[]=[])=>{writes.push({sql,params});return []},one:async(sql:string,params:unknown[]=[])=>{
    if(sql.includes('oauth_states'))return {owner_id:'owner',redirect_uri:'https://orbit.example/google/drive/oauth/callback',metadata:{requiredScopes:[GOOGLE_DRIVE_FILE_SCOPE]}};
    if(sql.includes('SELECT * FROM integration_connections'))return null;
    if(sql.includes('INSERT INTO integration_connections')){sealed=String(params[3]);return {id:'00000000-0000-4000-8000-000000000001'}};
    return null;
  }};
  global.fetch=async(input)=>new Response(String(input).includes('/token')?JSON.stringify({access_token:'access-secret',refresh_token:'refresh-secret',expires_in:3600,scope:`openid email ${GOOGLE_DRIVE_FILE_SCOPE}`}):JSON.stringify({id:'google-account',email:'owner@example.test'}),{status:200,headers:{'content-type':'application/json'}});
  try{
    const google=new GoogleCredentials(db as never,new SecretVault());
    const {url}=await google.start('owner','drive-backup',[GOOGLE_DRIVE_FILE_SCOPE],'https://orbit.example/google/drive/oauth/callback');
    const parsed=new URL(url);assert.equal(parsed.searchParams.get('access_type'),'offline');assert.equal(parsed.searchParams.get('scope')?.includes(GOOGLE_DRIVE_FILE_SCOPE),true);
    const state=parsed.searchParams.get('state')!;assert.equal(String(writes.find(write=>write.sql.includes('INSERT INTO oauth_states'))?.params[0]).includes(state),false);
    await google.complete('code',state,'drive-backup');
    assert.equal(sealed.includes('refresh-secret'),false);assert.equal(new SecretVault().open<{refresh_token:string}>(sealed).refresh_token,'refresh-secret');
  }finally{
    global.fetch=previous.fetch;
    for(const [key,value] of [['GOOGLE_CLIENT_ID',previous.id],['GOOGLE_CLIENT_SECRET',previous.secret],['ORBIT_SECRET_KEY',previous.key]] as const){if(value===undefined)delete process.env[key];else process.env[key]=value}
  }
});

test('Drive upload uses the resumable upload endpoint and verifies bytes before accepting a copy',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orbit-drive-upload-')),path=join(root,'archive.enc'),content=Buffer.from('encrypted-backup-data'),previous=global.fetch;await writeFile(path,content);
  const checksum=createHash('md5').update(content).digest('hex');const calls:string[]=[];
  global.fetch=async(input,init)=>{const url=String(input);calls.push(url);if(init?.method==='POST')return new Response(null,{status:200,headers:{location:'https://www.googleapis.com/upload/session/fixture'}});return new Response(JSON.stringify({id:'file-id',size:String(content.length),md5Checksum:checksum}),{status:200,headers:{'content-type':'application/json'}})};
  try{
    assert.equal(await uploadFile('token','folder-id',path,'application/octet-stream'),'file-id');
    assert.match(calls[0],/\/upload\/drive\/v3\/files\?uploadType=resumable/);
    assert.equal(calls[1],'https://www.googleapis.com/upload/session/fixture');
    global.fetch=async(input,init)=>init?.method==='POST'?new Response(null,{status:200,headers:{location:'https://evil.example/upload'}}):new Response('{}');
    await assert.rejects(()=>uploadFile('token','folder-id',path,'application/octet-stream'),/invalid upload URL/);
  }finally{global.fetch=previous;await rm(root,{recursive:true,force:true})}
});

test('backup destinations remain independent registrations',()=>{
  const registry=new BackupDestinationRegistry(),provider={id:'google_drive',name:'Google Drive',upload:async()=>({archiveFileId:'a',manifestFileId:'b',folderId:'c'}),download:async()=>undefined};
  registry.register(provider);assert.equal(registry.get('google_drive'),provider);assert.throws(()=>registry.register(provider),/duplicado/);
});

test('Drive plugin exposes an executable backup action',async()=>{
  const registry=new PluginRegistry();registry.register(googleDriveBackupPluginDefinition({uploadExisting:async()=>({status:'success'})} as never));
  const action=registry.getAction('google_drive','upload_existing');
  assert.deepEqual(await action.execute?.({archive:'orbit-2026-10-06T00-00-00.backup.enc',connectionId:'connection'},{userId:'owner'}),{type:'backup',label:'Backup enviado ao Google Drive',value:{status:'success'}});
});

test('Drive plugin streams archive and manifest back to local files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orbit-drive-download-')),path=join(root,'backup.enc'),previous=global.fetch;
  global.fetch=async(input)=>new Response(String(input).includes('/archive-id')?Buffer.from('encrypted-bytes'):Buffer.from('{"archive":"backup.enc"}'),{status:200});
  try{
    const plugin=new GoogleDriveBackupPlugin({token:async()=> 'access-token'} as never);
    await plugin.download('owner','connection',{archiveFileId:'archive-id',manifestFileId:'manifest-id',folderId:'folder'},path);
    assert.equal(await readFile(path,'utf8'),'encrypted-bytes');assert.equal(await readFile(`${path}.manifest.json`,'utf8'),'{"archive":"backup.enc"}');
  }finally{global.fetch=previous;await rm(root,{recursive:true,force:true})}
});

test('Drive plugin explains when the Google Drive API is disabled',async()=>{
  const previous=global.fetch;
  global.fetch=async()=>new Response(JSON.stringify({error:{errors:[{reason:'accessNotConfigured'}]}}),{status:403,headers:{'content-type':'application/json'}});
  try{
    const plugin=new GoogleDriveBackupPlugin({token:async()=> 'access-token'} as never);
    await assert.rejects(()=>plugin.upload('owner','connection','archive.enc'),/API do Google Drive está desativada/);
  }finally{global.fetch=previous}
});

test('Drive token access requires account ownership and the Drive scope',async()=>{
  const old=process.env.ORBIT_SECRET_KEY;process.env.ORBIT_SECRET_KEY='integration-only-secret-with-thirty-two-characters';
  try{
    const vault=new SecretVault(),sealed=vault.seal({access_token:'mail-token',refresh_token:'refresh',expires_at:Date.now()+3600000,scope:'https://www.googleapis.com/auth/gmail.modify'});
    const db={one:async(_sql:string,params:unknown[])=>params[1]==='owner'?{id:params[0],owner_id:'owner',plugin_id:'google',credentials_encrypted:sealed,enabled:true}:null};
    const google=new GoogleCredentials(db as never,vault);
    await assert.rejects(()=>google.token('other','00000000-0000-4000-8000-000000000001',[GOOGLE_DRIVE_FILE_SCOPE]),/não encontrada/);
    await assert.rejects(()=>google.token('owner','00000000-0000-4000-8000-000000000001',[GOOGLE_DRIVE_FILE_SCOPE]),/permissão necessária/);
  }finally{if(old===undefined)delete process.env.ORBIT_SECRET_KEY;else process.env.ORBIT_SECRET_KEY=old}
});

test('attachment folders follow board and card and old files move into that hierarchy',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orbit-drive-attachment-folders-'));
  const path=join(root,'card-archive.attachment.enc'),previous=global.fetch;
  await writeFile(path,Buffer.from('encrypted-attachment'));
  await writeFile(`${path}.manifest.json`,Buffer.from('{"format":"fixture"}'));
  type Item={id:string;name:string;parents:string[];appProperties?:Record<string,string>};
  const items=new Map<string,Item>(),sessions=new Map<string,{name:string;parents:string[]}>();let serial=0;
  global.fetch=async(input,init)=>{
    const url=new URL(String(input)),method=init?.method||'GET';
    if(url.pathname.startsWith('/upload/session/')){
      const session=sessions.get(url.pathname);assert(session);
      const data=Buffer.from(init?.body as ArrayBuffer);
      const id=`file-${++serial}`;items.set(id,{id,name:session.name,parents:session.parents});
      return Response.json({id,size:String(data.length),md5Checksum:createHash('md5').update(data).digest('hex')});
    }
    if(url.pathname==='/upload/drive/v3/files'){
      const metadata=JSON.parse(String(init?.body)) as {name:string;parents:string[]};
      const session=`/upload/session/${++serial}`;sessions.set(session,metadata);
      return new Response(null,{status:200,headers:{location:`https://www.googleapis.com${session}`}});
    }
    if(url.pathname==='/drive/v3/files'&&method==='GET'){
      const q=url.searchParams.get('q')||'';
      const parent=q.match(/^'([^']+)' in parents/)?.[1];
      const kind=q.match(/key='orbitKind' and value='([^']+)'/)?.[1];
      const entityId=q.match(/key='orbitEntityId' and value='([^']+)'/)?.[1];
      const name=q.match(/name = '([^']+)'/)?.[1];
      return Response.json({files:[...items.values()].filter(item=>(!parent||item.parents.includes(parent))&&(!kind||item.appProperties?.orbitKind===kind)&&(!entityId||item.appProperties?.orbitEntityId===entityId)&&(!name||item.name===name))});
    }
    if(url.pathname==='/drive/v3/files'&&method==='POST'){
      const data=JSON.parse(String(init?.body)) as {name:string;parents?:string[];appProperties?:Record<string,string>};
      const id=`folder-${++serial}`;items.set(id,{id,name:data.name,parents:data.parents||[],appProperties:data.appProperties});
      return Response.json({id,name:data.name});
    }
    const id=url.pathname.split('/').at(-1)!;
    const item=items.get(id);assert(item);
    if(method==='GET')return Response.json({id:item.id,parents:item.parents,appProperties:item.appProperties});
    if(method==='PATCH'){
      if(url.searchParams.get('addParents'))item.parents=[url.searchParams.get('addParents')!];
      if(init?.body)item.name=(JSON.parse(String(init.body)) as {name:string}).name;
      return Response.json({id:item.id,parents:item.parents,name:item.name});
    }
    if(method==='DELETE'){items.delete(id);return new Response(null,{status:204})}
    throw new Error(`Unexpected request: ${method} ${url.pathname}`);
  };
  try{
    const drive=new GoogleDriveBackupPlugin({token:async()=> 'token'} as never);
    const location={boardId:'11111111-1111-4111-8111-111111111111',boardTitle:'Projetos',cardId:'22222222-2222-4222-8222-222222222222',cardTitle:'Entrega / revisão',kind:'card' as const};
    const uploaded=await drive.uploadAttachment('owner','connection',path,location);
    assert.equal(uploaded.path,`${process.env.ORBIT_ENV==='development'?'Orbit DEV Card Attachments':'Orbit Card Attachments'} / Projetos [11111111] / Entrega revisão [22222222] / Arquivos do cartão`);
    assert.equal(items.get(uploaded.archiveFileId)?.parents[0],uploaded.folderId);
    assert.equal(items.get(uploaded.manifestFileId)?.parents[0],uploaded.folderId);
    const renamed=await drive.moveCardAttachment('owner','connection',{archiveFileId:uploaded.archiveFileId,manifestFileId:uploaded.manifestFileId},{...location,boardTitle:'Projetos novos',cardTitle:'Entrega final'});
    assert.equal(renamed.folderId,uploaded.folderId);
    assert.match(renamed.path,/Projetos novos.*Entrega final/);
    const comment=await drive.moveCardAttachment('owner','connection',{archiveFileId:uploaded.archiveFileId,manifestFileId:uploaded.manifestFileId},{...location,kind:'comment'});
    assert.match(comment.path,/Anexos dos comentários$/);
    assert.equal(items.get(uploaded.archiveFileId)?.parents[0],comment.folderId);
    assert.equal(items.get(uploaded.manifestFileId)?.parents[0],comment.folderId);
    assert.equal(items.has(uploaded.folderId),false);
  }finally{global.fetch=previous;await rm(root,{recursive:true,force:true})}
});

test('remote copies remain visible after local retention removes the archive',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orbit-backup-list-')),old=process.env.ORBIT_BACKUP_DIR;process.env.ORBIT_BACKUP_DIR=root;
  try{
    const copy={id:'copy',archive:'orbit-2026-10-06T00-00-00.backup.enc',owner_id:'owner',provider:'google_drive',connection_id:'connection',status:'success',folder_id:'folder',archive_file_id:'archive',manifest_file_id:'manifest',error:null,created_at:'2026-10-06T00:00:00Z',updated_at:'2026-10-06T00:00:00Z'};
    const service=new BackupService({query:async()=>[copy]} as never,new BackupDestinationRegistry(),{} as never);
    const listed=await service.list('owner');assert.equal(listed.length,1);assert.equal('remoteOnly' in listed[0] && listed[0].remoteOnly,true);assert.equal(listed[0].cloudCopies[0].archiveFileId,'archive');
  }finally{if(old===undefined)delete process.env.ORBIT_BACKUP_DIR;else process.env.ORBIT_BACKUP_DIR=old;await rm(root,{recursive:true,force:true})}
});

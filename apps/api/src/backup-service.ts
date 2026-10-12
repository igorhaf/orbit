import {HttpException,Inject,Injectable,OnModuleDestroy,OnModuleInit} from '@nestjs/common';
import {access,link,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Db} from './db';
import {BackupDestinationRegistry} from './backup-destinations';
import {backupDirectory,backupPath,createDatabaseBackup,listDatabaseBackups,verifyDatabaseBackup,BackupManifest} from './database-backup';
import {configBackupDirectory,configBackupPath,createConfigBackup,listConfigBackups,verifyConfigBackup,ConfigBackupManifest} from './config-backup';
import {attachmentBackupDirectory,attachmentBackupPath,createAttachmentBackup,listAttachmentBackups,verifyAttachmentBackup,AttachmentBackupManifest} from './attachment-backup';
import {GoogleCredentials,GOOGLE_DRIVE_FILE_SCOPE} from './google/credentials';
import {AttachmentDriveLocation,GoogleDriveBackupPlugin} from './google/drive-backup.plugin';
import {createVaultBackup,listVaultBackups,restoreVaultBackup,vaultBackupDirectory,vaultBackupPath,verifyVaultBackup,VaultBackupManifest} from './vault-backup';

type Copy={id:string;archive:string;owner_id:string;provider:string;connection_id:string;status:string;folder_id:string|null;archive_file_id:string|null;manifest_file_id:string|null;error:string|null;created_at:string;updated_at:string};
type VaultCopy=Omit<Copy,'provider'>;
type AttachmentCopy=VaultCopy&{source_kind:'card'|'comment';source_id:string;card_id:string;folder_path:string|null;organized_at:string|null};
const safe=(copy:Copy)=>({id:copy.id,archive:copy.archive,provider:copy.provider,connectionId:copy.connection_id,status:copy.status,folderId:copy.folder_id,archiveFileId:copy.archive_file_id,manifestFileId:copy.manifest_file_id,error:copy.error,createdAt:copy.created_at,updatedAt:copy.updated_at});
const safeVault=(copy:VaultCopy)=>({...safe({...copy,provider:'google_drive'}),kind:'vault'});
const safeConfig=(copy:VaultCopy)=>({...safe({...copy,provider:'google_drive'}),kind:'config'});
const safeAttachment=(copy:AttachmentCopy)=>({...safe({...copy,provider:'google_drive'}),kind:'attachment',sourceKind:copy.source_kind,sourceId:copy.source_id,cardId:copy.card_id,folderPath:copy.folder_path,organizedAt:copy.organized_at});

@Injectable()
export class BackupService implements OnModuleInit,OnModuleDestroy {
  constructor(@Inject(Db) private db:Db,@Inject(BackupDestinationRegistry) private destinations:BackupDestinationRegistry,@Inject(GoogleCredentials) private google:GoogleCredentials){}
  private configTimer?:ReturnType<typeof setInterval>;
  private configJob?:Promise<{archive:string|null;deliveries:ReturnType<typeof safeConfig>[]}>;
  private attachmentJobs=new Map<string,Promise<ReturnType<typeof safeAttachment>|null>>();
  private attachmentScan?:Promise<{processed:number;failed:number}>;
  onModuleInit(){
    this.configTimer=setInterval(()=>{
      void this.syncConfigs().catch(error=>console.warn(`Config backup: ${(error as Error).message}`));
      void this.syncAttachments().catch(error=>console.warn(`Attachment backup: ${(error as Error).message}`));
    },30000);
    this.configTimer.unref();
    void this.syncConfigs().catch(error=>console.warn(`Config backup: ${(error as Error).message}`));
    void this.syncAttachments().catch(error=>console.warn(`Attachment backup: ${(error as Error).message}`));
  }
  onModuleDestroy(){if(this.configTimer)clearInterval(this.configTimer)}
  private async pluginEnabled(provider:string){const row=await this.db.one<{enabled:boolean}>('SELECT enabled FROM plugin_settings WHERE plugin_id=$1',[provider]);if(row?.enabled===false)throw new HttpException('O plugin de destino está desativado.',409)}
  private async automaticConnection(ownerId:string){
    const plugin=await this.db.one<{enabled:boolean}>('SELECT enabled FROM plugin_settings WHERE plugin_id=$1',['google_drive']);
    if(plugin?.enabled===false)return {connectionId:null,enabled:false,needsSelection:false};
    const available=await this.google.available(ownerId,[GOOGLE_DRIVE_FILE_SCOPE]);
    const saved=await this.db.one<{connection_id:string;auto_upload:boolean}>('SELECT connection_id,auto_upload FROM backup_cloud_settings WHERE owner_id=$1',[ownerId]);
    const connection=saved?available.find(item=>item.id===saved.connection_id):available.length===1?available[0]:undefined;
    return {connectionId:connection?.id||null,enabled:saved?saved.auto_upload&&Boolean(connection):Boolean(connection),needsSelection:!saved&&available.length>1};
  }
  private async rememberAutomatic(ownerId:string,connectionId:string){
    await this.db.query('INSERT INTO backup_cloud_settings(owner_id,connection_id,auto_upload) VALUES($1,$2,true) ON CONFLICT(owner_id) DO NOTHING',[ownerId,connectionId]);
  }
  async configureAutomatic(ownerId:string,connectionId:string,enabled:boolean){
    if(typeof enabled!=='boolean')throw new HttpException('Configuração automática inválida.',400);
    await this.validateConnection(ownerId,connectionId);
    await this.db.query('INSERT INTO backup_cloud_settings(owner_id,connection_id,auto_upload) VALUES($1,$2,$3) ON CONFLICT(owner_id) DO UPDATE SET connection_id=excluded.connection_id,auto_upload=excluded.auto_upload,updated_at=now()',[ownerId,connectionId,enabled]);
    if(enabled)void this.syncConfigs().catch(error=>console.warn(`Config backup: ${(error as Error).message}`));
    if(enabled)void this.syncAttachments(ownerId,100).catch(error=>console.warn(`Attachment backup: ${(error as Error).message}`));
    return this.automaticConnection(ownerId);
  }
  async options(ownerId:string){const disabled=(await this.db.one<{enabled:boolean}>('SELECT enabled FROM plugin_settings WHERE plugin_id=$1',['google_drive']))?.enabled===false;return {destinations:[{id:'local',name:'Somente local'},...disabled?[]:this.destinations.catalog()],googleConfigured:this.google.configured(),googleConnections:disabled?[]:await this.google.available(ownerId,[GOOGLE_DRIVE_FILE_SCOPE]),automatic:disabled?{connectionId:null,enabled:false,needsSelection:false}:await this.automaticConnection(ownerId)}}
  async list(ownerId:string){const backups=await listDatabaseBackups();const copies=await this.db.query<Copy>('SELECT * FROM backup_cloud_copies WHERE owner_id=$1 ORDER BY created_at DESC',[ownerId]);const local=new Set(backups.map(backup=>backup.archive));const remote=[...new Set(copies.filter(copy=>copy.status==='success'&&!local.has(copy.archive)).map(copy=>copy.archive))].map(archive=>({archive,remoteOnly:true,created_at:copies.find(copy=>copy.archive===archive)?.created_at}));return [...backups,...remote].map(backup=>({...backup,cloudCopies:copies.filter(copy=>copy.archive===backup.archive).map(safe)}))}
  async listVault(ownerId:string){
    const backups=await listVaultBackups(ownerId);
    const copies=await this.db.query<VaultCopy>('SELECT * FROM vault_backup_cloud_copies WHERE owner_id=$1 ORDER BY created_at DESC',[ownerId]);
    const local=new Set(backups.map(backup=>backup.archive));
    const remote=[...new Set(copies.filter(copy=>copy.status==='success'&&!local.has(copy.archive)).map(copy=>copy.archive))].map(archive=>({archive,remoteOnly:true,created_at:copies.find(copy=>copy.archive===archive)?.created_at}));
    return [...backups,...remote].map(backup=>({...backup,cloudCopies:copies.filter(copy=>copy.archive===backup.archive).map(safeVault)}));
  }
  async listConfig(ownerId:string){
    const backups=await listConfigBackups();
    const copies=await this.db.query<VaultCopy>('SELECT * FROM config_backup_cloud_copies WHERE owner_id=$1 ORDER BY created_at DESC',[ownerId]);
    const local=new Set(backups.map(backup=>backup.archive));
    const remote=[...new Set(copies.filter(copy=>copy.status==='success'&&!local.has(copy.archive)).map(copy=>copy.archive))].map(archive=>({archive,remoteOnly:true,created_at:copies.find(copy=>copy.archive===archive)?.created_at}));
    return [...backups,...remote].map(backup=>({...backup,cloudCopies:copies.filter(copy=>copy.archive===backup.archive).map(safeConfig)}));
  }
  async listAttachments(ownerId:string){
    const backups=(await listAttachmentBackups()).filter(item=>item.owner_id===ownerId);
    const copies=await this.db.query<AttachmentCopy>('SELECT * FROM attachment_backup_cloud_copies WHERE owner_id=$1 ORDER BY created_at DESC',[ownerId]);
    const local=new Set(backups.map(backup=>backup.archive));
    const remote=[...new Set(copies.filter(copy=>copy.status==='success'&&!local.has(copy.archive)).map(copy=>copy.archive))].map(archive=>({archive,remoteOnly:true,created_at:copies.find(copy=>copy.archive===archive)?.created_at}));
    return [...backups,...remote].slice(0,100).map(backup=>({...backup,cloudCopies:copies.filter(copy=>copy.archive===backup.archive).map(safeAttachment)}));
  }
  async syncAttachment(ownerId:string,kind:'card'|'comment',id:string){
    const jobKey=`${ownerId}:${kind}:${id}`;
    const pending=this.attachmentJobs.get(jobKey);if(pending)return pending;
    const job=this.performAttachmentSync(ownerId,kind,id);this.attachmentJobs.set(jobKey,job);
    try{return await job}finally{this.attachmentJobs.delete(jobKey)}
  }
  private async performAttachmentSync(ownerId:string,kind:'card'|'comment',id:string){
    const automatic=await this.automaticConnection(ownerId);
    if(!automatic.enabled||!automatic.connectionId)return null;
    const manifest=await createAttachmentBackup(this.db,ownerId,kind,id);
    return this.uploadAttachmentVerified(ownerId,manifest,automatic.connectionId);
  }
  async syncAttachments(ownerId?:string,limit=20){
    if(this.attachmentScan)return this.attachmentScan;
    const job=this.performAttachmentScan(ownerId,limit);this.attachmentScan=job;
    try{return await job}finally{this.attachmentScan=undefined}
  }
  private async performAttachmentScan(ownerId?:string,limit=20){
    const owners=ownerId?[{id:ownerId}]:await this.db.query<{id:string}>('SELECT id FROM users ORDER BY id');
    let processed=0,failed=0;
    for(const owner of owners){
      const automatic=await this.automaticConnection(owner.id);
      if(automatic.enabled&&automatic.connectionId){
        const candidates=await this.db.query<{kind:'card'|'comment';id:string}>(`SELECT kind,id FROM (
        SELECT 'card'::text AS kind,a.id,a.created_at FROM attachments a JOIN cards c ON c.id=a.card_id JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id WHERE b.owner_id=$1 AND a.kind='file' AND a.data IS NOT NULL
        UNION ALL SELECT 'comment'::text,a.id,a.created_at FROM comment_attachments a JOIN comments c ON c.id=a.comment_id JOIN cards card ON card.id=c.card_id JOIN lists l ON l.id=card.list_id JOIN boards b ON b.id=l.board_id WHERE b.owner_id=$1 AND a.kind='file' AND a.data IS NOT NULL
      ) files WHERE NOT EXISTS(SELECT 1 FROM attachment_backup_cloud_copies copy WHERE copy.owner_id=$1 AND copy.connection_id=$2 AND copy.source_kind=files.kind AND copy.source_id=files.id AND copy.status='success')
      ORDER BY COALESCE((SELECT max(copy.updated_at) FROM attachment_backup_cloud_copies copy WHERE copy.owner_id=$1 AND copy.connection_id=$2 AND copy.source_kind=files.kind AND copy.source_id=files.id),'epoch'::timestamptz),files.created_at LIMIT $3`,[owner.id,automatic.connectionId,limit]);
        for(const item of candidates){
          try{const copy=await this.syncAttachment(owner.id,item.kind,item.id);processed++;if(copy?.status==='failed')failed++}
          catch(error){failed++;console.warn(`Attachment backup ${item.kind}/${item.id}: ${(error as Error).message}`)}
        }
      }
      const unorganized=await this.db.query<AttachmentCopy>("SELECT * FROM attachment_backup_cloud_copies WHERE owner_id=$1 AND status='success' AND organized_at IS NULL ORDER BY created_at LIMIT $2",[owner.id,limit]);
      for(const copy of unorganized){
        try{await this.organizeAttachmentCopy(copy);processed++}
        catch(error){failed++;console.warn(`Attachment folder ${copy.id}: ${(error as Error).message}`)}
      }
    }
    return {processed,failed};
  }
  async syncConfigs(){
    if(this.configJob)return this.configJob;
    const job=this.performConfigSync();this.configJob=job;
    try{return await job}finally{this.configJob=undefined}
  }
  private async performConfigSync(){
    const manifest=await createConfigBackup();
    if(!manifest)return {archive:null,deliveries:[]};
    const owners=await this.db.query<{id:string}>('SELECT id FROM users ORDER BY id');
    const deliveries:ReturnType<typeof safeConfig>[]=[];
    for(const owner of owners){
      const automatic=await this.automaticConnection(owner.id);
      if(automatic.enabled&&automatic.connectionId)deliveries.push(await this.uploadConfigVerified(owner.id,manifest,automatic.connectionId));
    }
    return {archive:manifest.archive,deliveries};
  }
  async create(ownerId:string,input:{destination?:unknown;connectionId?:unknown}){
    const destination=input.destination===undefined?'local':input.destination;
    if(destination!=='local'&&destination!=='google_drive')throw new HttpException('Destino de backup inválido.',400);
    if(destination==='google_drive')await this.validateConnection(ownerId,input.connectionId);
    const manifest=await createDatabaseBackup('manual');
    const result=await this.processGenerated(manifest,ownerId,destination==='google_drive'?String(input.connectionId):undefined);
    return {...manifest,...result[0]};
  }
  async createVault(ownerId:string){
    const manifest=await createVaultBackup(this.db,ownerId);
    const automatic=await this.automaticConnection(ownerId);
    if(automatic.enabled&&automatic.connectionId)await this.rememberAutomatic(ownerId,automatic.connectionId);
    const cloud=automatic.enabled&&automatic.connectionId?await this.uploadVaultVerified(ownerId,manifest,automatic.connectionId):null;
    return {...manifest,cloud};
  }
  async processGenerated(manifest:BackupManifest,ownerId?:string,forceConnectionId?:string){
    const config=await createConfigBackup();
    const owners=ownerId?[{id:ownerId}]:await this.db.query<{id:string}>('SELECT id FROM users ORDER BY id');
    const results=[];
    for(const owner of owners){
      let vault:VaultBackupManifest|null=null,vaultError:string|null=null;
      try{vault=await createVaultBackup(this.db,owner.id)}catch(error){vaultError=(error as Error).message}
      const automatic=await this.automaticConnection(owner.id);
      const connectionId=forceConnectionId||(automatic.enabled?automatic.connectionId:null);
      let cloud=null,vaultCloud=null,configCloud=null;
      if(connectionId){
        await this.pluginEnabled('google_drive');
        await this.rememberAutomatic(owner.id,connectionId);
        if(vault)vaultCloud=await this.uploadVaultVerified(owner.id,vault,connectionId);
        if(config)configCloud=await this.uploadConfigVerified(owner.id,config,connectionId);
        cloud=await this.uploadVerified(owner.id,manifest,connectionId);
      }
      const attachments=await this.syncAttachments(owner.id,100);
      results.push({ownerId:owner.id,cloud,vaultBackup:vault?{...vault,cloud:vaultCloud}:null,vaultError,configBackup:config?{...config,cloud:configCloud}:null,attachments});
    }
    return results;
  }
  private async validateConnection(ownerId:string,connectionId:unknown){
    if(typeof connectionId!=='string')throw new HttpException('Escolha uma conta Google.',400);
    await this.pluginEnabled('google_drive');
    await this.google.token(ownerId,connectionId,[GOOGLE_DRIVE_FILE_SCOPE]);
  }
  async uploadExisting(ownerId:string,archive:string,connectionId:unknown){
    await this.validateConnection(ownerId,connectionId);
    const manifest=await verifyDatabaseBackup(backupPath(archive));
    return this.uploadVerified(ownerId,manifest,String(connectionId));
  }
  async uploadExistingVault(ownerId:string,archive:string,connectionId:unknown){
    await this.validateConnection(ownerId,connectionId);
    const manifest=await verifyVaultBackup(vaultBackupPath(archive));
    if(manifest.owner_id!==ownerId)throw new HttpException('Este backup do cofre pertence a outra conta.',403);
    return this.uploadVaultVerified(ownerId,manifest,String(connectionId));
  }
  async uploadExistingConfig(ownerId:string,archive:string,connectionId:unknown){
    await this.validateConnection(ownerId,connectionId);
    const manifest=await verifyConfigBackup(configBackupPath(archive));
    return this.uploadConfigVerified(ownerId,manifest,String(connectionId));
  }
  async uploadExistingAttachment(ownerId:string,archive:string,connectionId:unknown){
    await this.validateConnection(ownerId,connectionId);
    const manifest=await verifyAttachmentBackup(attachmentBackupPath(archive));
    if(manifest.owner_id!==ownerId)throw new HttpException('Este anexo pertence a outra conta.',403);
    return this.uploadAttachmentVerified(ownerId,manifest,String(connectionId));
  }
  async restoreVault(ownerId:string,archive:string){
    const path=vaultBackupPath(archive);
    const manifest=await verifyVaultBackup(path);
    if(manifest.owner_id!==ownerId)throw new HttpException('Este backup do cofre pertence a outra conta.',403);
    return restoreVaultBackup(this.db,ownerId,path);
  }
  async download(ownerId:string,copyId:string){
    if(!/^[0-9a-f-]{36}$/i.test(copyId))throw new HttpException('Cópia inválida.',400);
    const copy=await this.db.one<Copy>("SELECT * FROM backup_cloud_copies WHERE id=$1 AND owner_id=$2 AND status='success'",[copyId,ownerId]);
    if(!copy||!copy.archive_file_id||!copy.manifest_file_id||!copy.folder_id)throw new HttpException('Cópia na nuvem não encontrada.',404);
    await this.pluginEnabled(copy.provider);
    const destination=backupPath(copy.archive),manifestPath=`${destination}.manifest.json`;
    const exists=async(path:string)=>access(path).then(()=>true).catch(()=>false);
    if(await exists(destination)&&await exists(manifestPath))return verifyDatabaseBackup(destination);
    if(await exists(destination)||await exists(manifestPath))throw new HttpException('Há um backup local incompleto com o mesmo nome.',409);
    const root=backupDirectory();await mkdir(root,{recursive:true,mode:0o700});const work=await mkdtemp(join(root,'.orbit-cloud-')),temporary=join(work,copy.archive);
    try{
      await this.destinations.get(copy.provider).download(ownerId,copy.connection_id,{archiveFileId:copy.archive_file_id,manifestFileId:copy.manifest_file_id,folderId:copy.folder_id},temporary);
      const verified=await verifyDatabaseBackup(temporary);
      await link(temporary,destination);
      try{await link(`${temporary}.manifest.json`,manifestPath)}catch(error){await rm(destination,{force:true});throw error}
      return verified;
    }finally{await rm(work,{recursive:true,force:true})}
  }
  async downloadVault(ownerId:string,copyId:string){
    if(!/^[0-9a-f-]{36}$/i.test(copyId))throw new HttpException('Cópia inválida.',400);
    const copy=await this.db.one<VaultCopy>("SELECT * FROM vault_backup_cloud_copies WHERE id=$1 AND owner_id=$2 AND status='success'",[copyId,ownerId]);
    if(!copy||!copy.archive_file_id||!copy.manifest_file_id||!copy.folder_id)throw new HttpException('Cópia do cofre não encontrada.',404);
    await this.pluginEnabled('google_drive');
    const destination=vaultBackupPath(copy.archive),manifestPath=`${destination}.manifest.json`;
    const exists=async(path:string)=>access(path).then(()=>true).catch(()=>false);
    if(await exists(destination)&&await exists(manifestPath)){const manifest=await verifyVaultBackup(destination);if(manifest.owner_id!==ownerId)throw new HttpException('Cópia do cofre pertence a outra conta.',403);return manifest}
    if(await exists(destination)||await exists(manifestPath))throw new HttpException('Há um backup local incompleto do cofre com o mesmo nome.',409);
    const root=vaultBackupDirectory();await mkdir(root,{recursive:true,mode:0o700});const work=await mkdtemp(join(root,'.orbit-vault-cloud-')),temporary=join(work,copy.archive);
    try{
      await this.destinations.get('google_drive').download(ownerId,copy.connection_id,{archiveFileId:copy.archive_file_id,manifestFileId:copy.manifest_file_id,folderId:copy.folder_id},temporary);
      const verified=await verifyVaultBackup(temporary);
      if(verified.owner_id!==ownerId)throw new HttpException('Cópia do cofre pertence a outra conta.',403);
      await link(temporary,destination);
      try{await link(`${temporary}.manifest.json`,manifestPath)}catch(error){await rm(destination,{force:true});throw error}
      return verified;
    }finally{await rm(work,{recursive:true,force:true})}
  }
  async downloadConfig(ownerId:string,copyId:string){
    if(!/^[0-9a-f-]{36}$/i.test(copyId))throw new HttpException('Cópia inválida.',400);
    const copy=await this.db.one<VaultCopy>("SELECT * FROM config_backup_cloud_copies WHERE id=$1 AND owner_id=$2 AND status='success'",[copyId,ownerId]);
    if(!copy||!copy.archive_file_id||!copy.manifest_file_id||!copy.folder_id)throw new HttpException('Cópia de configurações não encontrada.',404);
    await this.pluginEnabled('google_drive');
    const destination=configBackupPath(copy.archive),manifestPath=`${destination}.manifest.json`;
    const exists=async(path:string)=>access(path).then(()=>true).catch(()=>false);
    if(await exists(destination)&&await exists(manifestPath))return verifyConfigBackup(destination);
    if(await exists(destination)||await exists(manifestPath))throw new HttpException('Há um backup local incompleto das configurações.',409);
    const root=configBackupDirectory();await mkdir(root,{recursive:true,mode:0o700});const work=await mkdtemp(join(root,'.orbit-config-cloud-')),temporary=join(work,copy.archive);
    try{
      await this.destinations.get('google_drive').download(ownerId,copy.connection_id,{archiveFileId:copy.archive_file_id,manifestFileId:copy.manifest_file_id,folderId:copy.folder_id},temporary);
      const verified=await verifyConfigBackup(temporary);
      await link(temporary,destination);
      try{await link(`${temporary}.manifest.json`,manifestPath)}catch(error){await rm(destination,{force:true});throw error}
      return verified;
    }finally{await rm(work,{recursive:true,force:true})}
  }
  async downloadAttachment(ownerId:string,copyId:string){
    if(!/^[0-9a-f-]{36}$/i.test(copyId))throw new HttpException('Cópia inválida.',400);
    const copy=await this.db.one<AttachmentCopy>("SELECT * FROM attachment_backup_cloud_copies WHERE id=$1 AND owner_id=$2 AND status='success'",[copyId,ownerId]);
    if(!copy||!copy.archive_file_id||!copy.manifest_file_id||!copy.folder_id)throw new HttpException('Cópia de anexo não encontrada.',404);
    await this.pluginEnabled('google_drive');
    const destination=attachmentBackupPath(copy.archive),manifestPath=`${destination}.manifest.json`;
    const exists=async(path:string)=>access(path).then(()=>true).catch(()=>false);
    if(await exists(destination)&&await exists(manifestPath)){const manifest=await verifyAttachmentBackup(destination);if(manifest.owner_id!==ownerId)throw new HttpException('Este anexo pertence a outra conta.',403);return manifest}
    if(await exists(destination)||await exists(manifestPath))throw new HttpException('Há um backup local incompleto do anexo.',409);
    const root=attachmentBackupDirectory();await mkdir(root,{recursive:true,mode:0o700});const work=await mkdtemp(join(root,'.orbit-attachment-cloud-')),temporary=join(work,copy.archive);
    try{
      await this.destinations.get('google_drive').download(ownerId,copy.connection_id,{archiveFileId:copy.archive_file_id,manifestFileId:copy.manifest_file_id,folderId:copy.folder_id},temporary);
      const verified=await verifyAttachmentBackup(temporary);
      if(verified.owner_id!==ownerId||verified.source_kind!==copy.source_kind||verified.source_id!==copy.source_id||verified.card_id!==copy.card_id)throw new HttpException('Identidade do anexo inválida.',409);
      await link(temporary,destination);
      try{await link(`${temporary}.manifest.json`,manifestPath)}catch(error){await rm(destination,{force:true});throw error}
      return verified;
    }finally{await rm(work,{recursive:true,force:true})}
  }
  private async uploadVerified(ownerId:string,manifest:BackupManifest,connectionId:string){
    const existing=await this.db.one<Copy>('SELECT * FROM backup_cloud_copies WHERE archive=$1 AND owner_id=$2 AND provider=$3 AND connection_id=$4',[manifest.archive,ownerId,'google_drive',connectionId]);
    if(existing?.status==='success')return safe(existing);
    const row=await this.db.one<Copy>("INSERT INTO backup_cloud_copies(archive,owner_id,provider,connection_id,status) VALUES($1,$2,'google_drive',$3,'uploading') ON CONFLICT(archive,owner_id,provider,connection_id) DO UPDATE SET status='uploading',error=NULL,updated_at=now() WHERE backup_cloud_copies.status<>'uploading' OR backup_cloud_copies.updated_at<now()-interval '1 hour' RETURNING *",[manifest.archive,ownerId,connectionId]);
    if(!row)throw new HttpException('Este backup já está sendo enviado.',409);
    try{
      const copy=await this.destinations.get('google_drive').upload(ownerId,connectionId,backupPath(manifest.archive),manifest);
      const saved=await this.db.one<Copy>("UPDATE backup_cloud_copies SET status='success',folder_id=$2,archive_file_id=$3,manifest_file_id=$4,error=NULL,updated_at=now() WHERE id=$1 RETURNING *",[row.id,copy.folderId,copy.archiveFileId,copy.manifestFileId]);
      return safe(saved!);
    }catch(error){
      const detail=error instanceof HttpException?error.message:'Falha ao enviar backup ao Google Drive. Verifique a conexão e tente novamente.';
      const failed=await this.db.one<Copy>("UPDATE backup_cloud_copies SET status='failed',error=$2,updated_at=now() WHERE id=$1 RETURNING *",[row.id,detail]);
      return safe(failed!);
    }
  }
  private async uploadVaultVerified(ownerId:string,manifest:VaultBackupManifest,connectionId:string){
    const existing=await this.db.one<VaultCopy>('SELECT * FROM vault_backup_cloud_copies WHERE archive=$1 AND owner_id=$2 AND connection_id=$3',[manifest.archive,ownerId,connectionId]);
    if(existing?.status==='success')return safeVault(existing);
    const row=await this.db.one<VaultCopy>("INSERT INTO vault_backup_cloud_copies(archive,owner_id,connection_id,status) VALUES($1,$2,$3,'uploading') ON CONFLICT(archive,owner_id,connection_id) DO UPDATE SET status='uploading',error=NULL,updated_at=now() WHERE vault_backup_cloud_copies.status<>'uploading' OR vault_backup_cloud_copies.updated_at<now()-interval '1 hour' RETURNING *",[manifest.archive,ownerId,connectionId]);
    if(!row)throw new HttpException('Este backup do cofre já está sendo enviado.',409);
    try{
      const drive=this.destinations.get('google_drive') as GoogleDriveBackupPlugin;
      const copy=await drive.uploadVault(ownerId,connectionId,vaultBackupPath(manifest.archive));
      const saved=await this.db.one<VaultCopy>("UPDATE vault_backup_cloud_copies SET status='success',folder_id=$2,archive_file_id=$3,manifest_file_id=$4,error=NULL,updated_at=now() WHERE id=$1 RETURNING *",[row.id,copy.folderId,copy.archiveFileId,copy.manifestFileId]);
      return safeVault(saved!);
    }catch(error){
      const detail=error instanceof HttpException?error.message:'Falha ao enviar backup do cofre ao Google Drive. Verifique a conexão e tente novamente.';
      const failed=await this.db.one<VaultCopy>("UPDATE vault_backup_cloud_copies SET status='failed',error=$2,updated_at=now() WHERE id=$1 RETURNING *",[row.id,detail]);
      return safeVault(failed!);
    }
  }
  private async uploadConfigVerified(ownerId:string,manifest:ConfigBackupManifest,connectionId:string){
    const existing=await this.db.one<VaultCopy>('SELECT * FROM config_backup_cloud_copies WHERE archive=$1 AND owner_id=$2 AND connection_id=$3',[manifest.archive,ownerId,connectionId]);
    if(existing?.status==='success')return safeConfig(existing);
    const row=await this.db.one<VaultCopy>("INSERT INTO config_backup_cloud_copies(archive,owner_id,connection_id,status) VALUES($1,$2,$3,'uploading') ON CONFLICT(archive,owner_id,connection_id) DO UPDATE SET status='uploading',error=NULL,updated_at=now() WHERE config_backup_cloud_copies.status<>'uploading' OR config_backup_cloud_copies.updated_at<now()-interval '1 hour' RETURNING *",[manifest.archive,ownerId,connectionId]);
    if(!row)return safeConfig(existing!);
    try{
      const drive=this.destinations.get('google_drive') as GoogleDriveBackupPlugin;
      const copy=await drive.uploadConfig(ownerId,connectionId,configBackupPath(manifest.archive));
      const saved=await this.db.one<VaultCopy>("UPDATE config_backup_cloud_copies SET status='success',folder_id=$2,archive_file_id=$3,manifest_file_id=$4,error=NULL,updated_at=now() WHERE id=$1 RETURNING *",[row.id,copy.folderId,copy.archiveFileId,copy.manifestFileId]);
      return safeConfig(saved!);
    }catch(error){
      const detail=error instanceof HttpException?error.message:'Falha ao enviar configurações ao Google Drive. Verifique a conexão e tente novamente.';
      const failed=await this.db.one<VaultCopy>("UPDATE config_backup_cloud_copies SET status='failed',error=$2,updated_at=now() WHERE id=$1 RETURNING *",[row.id,detail]);
      return safeConfig(failed!);
    }
  }
  private async uploadAttachmentVerified(ownerId:string,manifest:AttachmentBackupManifest,connectionId:string){
    const existing=await this.db.one<AttachmentCopy>('SELECT * FROM attachment_backup_cloud_copies WHERE archive=$1 AND owner_id=$2 AND connection_id=$3',[manifest.archive,ownerId,connectionId]);
    if(existing?.status==='success'){
      if(!existing.organized_at){try{return safeAttachment(await this.organizeAttachmentCopy(existing))}catch(error){console.warn(`Attachment folder ${existing.id}: ${(error as Error).message}`)}}
      return safeAttachment(existing);
    }
    const row=await this.db.one<AttachmentCopy>("INSERT INTO attachment_backup_cloud_copies(archive,owner_id,connection_id,source_kind,source_id,card_id,status) VALUES($1,$2,$3,$4,$5,$6,'uploading') ON CONFLICT(archive,owner_id,connection_id) DO UPDATE SET status='uploading',error=NULL,updated_at=now() WHERE attachment_backup_cloud_copies.status<>'uploading' OR attachment_backup_cloud_copies.updated_at<now()-interval '1 hour' RETURNING *",[manifest.archive,ownerId,connectionId,manifest.source_kind,manifest.source_id,manifest.card_id]);
    if(!row)return safeAttachment(existing!);
    try{
      const drive=this.destinations.get('google_drive') as GoogleDriveBackupPlugin;
      const location=await this.attachmentLocation(ownerId,manifest.card_id,manifest.source_kind);
      const copy=await drive.uploadAttachment(ownerId,connectionId,attachmentBackupPath(manifest.archive),location);
      const saved=await this.db.one<AttachmentCopy>("UPDATE attachment_backup_cloud_copies SET status='success',folder_id=$2,archive_file_id=$3,manifest_file_id=$4,folder_path=$5,organized_at=now(),error=NULL,updated_at=now() WHERE id=$1 RETURNING *",[row.id,copy.folderId,copy.archiveFileId,copy.manifestFileId,copy.path]);
      return safeAttachment(saved!);
    }catch(error){
      const detail=error instanceof HttpException?error.message:'Falha ao enviar anexo ao Google Drive. Verifique a conexão e tente novamente.';
      const failed=await this.db.one<AttachmentCopy>("UPDATE attachment_backup_cloud_copies SET status='failed',error=$2,updated_at=now() WHERE id=$1 RETURNING *",[row.id,detail]);
      return safeAttachment(failed!);
    }
  }
  private async attachmentLocation(ownerId:string,cardId:string,kind:'card'|'comment'):Promise<AttachmentDriveLocation>{
    const card=await this.db.one<{board_id:string;board_title:string;card_title:string}>('SELECT b.id AS board_id,b.title AS board_title,c.title AS card_title FROM cards c JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id WHERE c.id=$1 AND b.owner_id=$2',[cardId,ownerId]);
    return {boardId:card?.board_id||null,boardTitle:card?.board_title||'',cardId,cardTitle:card?.card_title||'Cartão removido',kind};
  }
  private async organizeAttachmentCopy(copy:AttachmentCopy){
    if(!copy.archive_file_id||!copy.manifest_file_id)throw new Error('Cópia do anexo incompleta.');
    try{
      const drive=this.destinations.get('google_drive') as GoogleDriveBackupPlugin;
      const location=await this.attachmentLocation(copy.owner_id,copy.card_id,copy.source_kind);
      const folder=await drive.moveCardAttachment(copy.owner_id,copy.connection_id,{archiveFileId:copy.archive_file_id,manifestFileId:copy.manifest_file_id},location);
      return (await this.db.one<AttachmentCopy>("UPDATE attachment_backup_cloud_copies SET folder_id=$2,folder_path=$3,organized_at=now(),error=NULL,updated_at=now() WHERE id=$1 RETURNING *",[copy.id,folder.folderId,folder.path]))!;
    }catch(error){
      const detail=error instanceof HttpException?error.message:'Não foi possível organizar o anexo no Google Drive.';
      await this.db.query("UPDATE attachment_backup_cloud_copies SET error=$2,updated_at=now() WHERE id=$1",[copy.id,detail]);
      throw error;
    }
  }
}

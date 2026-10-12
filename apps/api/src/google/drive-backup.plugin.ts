import {Controller,Get,HttpException,Inject,Injectable,Query,Req,Res} from '@nestjs/common';
import {Request,Response} from 'express';
import {createWriteStream} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import type {BackupDestination} from '../backup-destinations';
import type {BackupCopy} from '../backup-destinations';
import {uploadFile} from '../google-drive-backup';
import {GoogleCredentials,GOOGLE_DRIVE_FILE_SCOPE} from './credentials';
import type {PluginDefinition} from '../plugins/contract';
import {FeaturesService} from '../features';
import type {BackupService} from '../backup-service';
import {googleRedirectUri} from './redirect-uri';

const api='https://www.googleapis.com/drive/v3/files';
type DriveFile={id?:string;name?:string;mimeType?:string};
export type AttachmentDriveLocation={boardId:string|null;boardTitle:string;cardId:string;cardTitle:string;kind:'card'|'comment'};
type FolderInfo={folderId:string;rootId:string;path:string};
const safeLabel=(value:string,fallback:string)=>(value.replace(/[\\/]/g,' ').replace(/\s+/g,' ').trim().slice(0,80)||fallback);
const folderLabel=(title:string,fallback:string,id:string)=>`${safeLabel(title,fallback)} [${id.slice(0,8)}]`;
const queryValue=(value:string)=>value.replaceAll('\\','\\\\').replaceAll("'","\\'");
const environmentFolder=(name:string)=>process.env.ORBIT_ENV==='development'?name.replace(/^Orbit /,'Orbit DEV '):name;

async function driveFailure(response:globalThis.Response,fallback:string):Promise<never>{
  const body=await response.json().catch(()=>null) as {error?:{errors?:Array<{reason?:string}>}}|null;
  if(response.status===403&&body?.error?.errors?.some(error=>error.reason==='accessNotConfigured')){
    throw new HttpException('A API do Google Drive está desativada no projeto do cliente OAuth. Ative a Google Drive API no Google Cloud, aguarde alguns minutos e tente novamente.',502);
  }
  throw new HttpException(fallback,502);
}

@Injectable()
export class GoogleDriveBackupPlugin implements BackupDestination {
  readonly id='google_drive';readonly name='Google Drive';
  private folderJobs=new Map<string,Promise<string>>();
  constructor(@Inject(GoogleCredentials) private google:GoogleCredentials){}
  private async folder(token:string,name:'Orbit Backups'|'Orbit Vault Backups'|'Orbit Config Backups'|'Orbit Card Attachments'){
    const folderName=environmentFolder(name);
    const params=new URLSearchParams({q:`name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,fields:'files(id,name,mimeType)',pageSize:'20'});
    const listing=await fetch(`${api}?${params}`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
    if(!listing.ok)return driveFailure(listing,'Não foi possível localizar a pasta de backups no Google Drive.');
    const files=await listing.json() as {files?:DriveFile[]};if(files.files?.[0]?.id)return files.files[0].id;
    const created=await fetch(api,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({name:folderName,mimeType:'application/vnd.google-apps.folder'}),signal:AbortSignal.timeout(20000)});
    if(!created.ok)return driveFailure(created,'Não foi possível criar a pasta de backups no Google Drive.');
    const folder=await created.json() as DriveFile;if(!folder.id)throw new HttpException('O Google Drive não confirmou a pasta de backups.',502);return folder.id;
  }
  async upload(ownerId:string,connectionId:string,archivePath:string){
    const token=await this.google.token(ownerId,connectionId,[GOOGLE_DRIVE_FILE_SCOPE]);
    const folderId=await this.folder(token,'Orbit Backups');
    return this.uploadPair(token,folderId,archivePath);
  }
  async uploadVault(ownerId:string,connectionId:string,archivePath:string){
    const token=await this.google.token(ownerId,connectionId,[GOOGLE_DRIVE_FILE_SCOPE]);
    const folderId=await this.folder(token,'Orbit Vault Backups');
    return this.uploadPair(token,folderId,archivePath);
  }
  async uploadConfig(ownerId:string,connectionId:string,archivePath:string){
    const token=await this.google.token(ownerId,connectionId,[GOOGLE_DRIVE_FILE_SCOPE]);
    const folderId=await this.folder(token,'Orbit Config Backups');
    return this.uploadPair(token,folderId,archivePath);
  }
  private async childFolder(token:string,parentId:string,name:string,kind:string,entityId:string){
    const key=`${parentId}:${kind}:${entityId}`;
    const pending=this.folderJobs.get(key);if(pending)return pending;
    const job=this.ensureChildFolder(token,parentId,name,kind,entityId);this.folderJobs.set(key,job);
    try{return await job}finally{this.folderJobs.delete(key)}
  }
  private async ensureChildFolder(token:string,parentId:string,name:string,kind:string,entityId:string){
    const q=`'${queryValue(parentId)}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false and appProperties has { key='orbitKind' and value='${queryValue(kind)}' } and appProperties has { key='orbitEntityId' and value='${queryValue(entityId)}' }`;
    const listing=await fetch(`${api}?${new URLSearchParams({q,fields:'files(id,name)',pageSize:'20'})}`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
    if(!listing.ok)return driveFailure(listing,'Não foi possível localizar a pasta do cartão no Google Drive.');
    const files=await listing.json() as {files?:DriveFile[]};
    const existing=files.files?.[0];
    if(existing?.id){
      if(existing.name!==name){
        const renamed=await fetch(`${api}/${encodeURIComponent(existing.id)}?fields=id,name`,{method:'PATCH',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({name}),signal:AbortSignal.timeout(20000)});
        if(!renamed.ok)return driveFailure(renamed,'Não foi possível atualizar o nome da pasta do cartão no Google Drive.');
      }
      return existing.id;
    }
    const created=await fetch(`${api}?fields=id,name`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({name,mimeType:'application/vnd.google-apps.folder',parents:[parentId],appProperties:{orbitKind:kind,orbitEntityId:entityId}}),signal:AbortSignal.timeout(20000)});
    if(!created.ok)return driveFailure(created,'Não foi possível criar a pasta do cartão no Google Drive.');
    const folder=await created.json() as DriveFile;
    if(!folder.id)throw new HttpException('O Google Drive não confirmou a pasta do cartão.',502);
    return folder.id;
  }
  private async attachmentFolder(token:string,location:AttachmentDriveLocation):Promise<FolderInfo>{
    const root=await this.folder(token,'Orbit Card Attachments');
    const boardName=location.boardId?folderLabel(location.boardTitle,'Quadro',location.boardId):'Cartões sem quadro';
    const board=await this.childFolder(token,root,boardName,'board',location.boardId||'removed');
    const cardName=folderLabel(location.cardTitle,'Cartão',location.cardId);
    const card=await this.childFolder(token,board,cardName,'card',location.cardId);
    const sectionName=location.kind==='card'?'Arquivos do cartão':'Anexos dos comentários';
    const section=await this.childFolder(token,card,sectionName,'section',location.kind);
    return {folderId:section,rootId:root,path:`${environmentFolder('Orbit Card Attachments')} / ${boardName} / ${cardName} / ${sectionName}`};
  }
  async uploadAttachment(ownerId:string,connectionId:string,archivePath:string,location:AttachmentDriveLocation){
    const token=await this.google.token(ownerId,connectionId,[GOOGLE_DRIVE_FILE_SCOPE]);
    const folder=await this.attachmentFolder(token,location);
    return {...await this.uploadPair(token,folder.folderId,archivePath),path:folder.path};
  }
  private async moveFile(token:string,fileId:string,folderId:string){
    const metadata=await fetch(`${api}/${encodeURIComponent(fileId)}?fields=id,parents`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
    if(!metadata.ok)return driveFailure(metadata,'Não foi possível localizar um arquivo de anexo no Google Drive.');
    const file=await metadata.json() as {parents?:string[]};
    if(file.parents?.includes(folderId))return null;
    const previous=file.parents?.[0]||null;
    const params=new URLSearchParams({addParents:folderId,fields:'id,parents'});
    if(file.parents?.length)params.set('removeParents',file.parents.join(','));
    const moved=await fetch(`${api}/${encodeURIComponent(fileId)}?${params}`,{method:'PATCH',headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
    if(!moved.ok)return driveFailure(moved,'Não foi possível organizar um anexo no Google Drive.');
    return previous;
  }
  private async removeEmptyFolderTree(token:string,startId:string,rootId:string){
    let folderId=startId;
    for(let depth=0;depth<3&&folderId!==rootId;depth++){
      const metadata=await fetch(`${api}/${encodeURIComponent(folderId)}?fields=id,parents,appProperties`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
      if(metadata.status===404)return;
      if(!metadata.ok)return driveFailure(metadata,'Não foi possível verificar uma pasta antiga de anexos.');
      const folder=await metadata.json() as {parents?:string[];appProperties?:{orbitKind?:string}};
      if(!['section','card','board'].includes(folder.appProperties?.orbitKind||''))return;
      const q=`'${queryValue(folderId)}' in parents and trashed = false`;
      const listing=await fetch(`${api}?${new URLSearchParams({q,fields:'files(id)',pageSize:'1'})}`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
      if(!listing.ok)return driveFailure(listing,'Não foi possível verificar uma pasta antiga de anexos.');
      if(((await listing.json()) as {files?:DriveFile[]}).files?.length)return;
      const deleted=await fetch(`${api}/${encodeURIComponent(folderId)}`,{method:'DELETE',headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
      if(!deleted.ok&&deleted.status!==404)return driveFailure(deleted,'Não foi possível remover uma pasta vazia de anexos.');
      folderId=folder.parents?.[0]||rootId;
    }
  }
  async moveCardAttachment(ownerId:string,connectionId:string,copy:{archiveFileId:string;manifestFileId:string},location:AttachmentDriveLocation){
    const token=await this.google.token(ownerId,connectionId,[GOOGLE_DRIVE_FILE_SCOPE]);
    const folder=await this.attachmentFolder(token,location);
    const oldArchive=await this.moveFile(token,copy.archiveFileId,folder.folderId);
    const oldManifest=await this.moveFile(token,copy.manifestFileId,folder.folderId);
    for(const previous of new Set([oldArchive,oldManifest].filter((id):id is string=>Boolean(id)&&id!==folder.folderId))){
      await this.removeEmptyFolderTree(token,previous,folder.rootId).catch(error=>console.warn(`Drive attachment folder cleanup: ${(error as Error).message}`));
    }
    return folder;
  }
  private async uploadPair(token:string,folderId:string,archivePath:string){
    const archiveFileId=await uploadFile(token,folderId,archivePath,'application/octet-stream');
    try{
      const manifestFileId=await uploadFile(token,folderId,`${archivePath}.manifest.json`,'application/json');
      return {archiveFileId,manifestFileId,folderId};
    }catch(error){await fetch(`${api}/${encodeURIComponent(archiveFileId)}`,{method:'DELETE',headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)}).catch(()=>undefined);throw error}
  }
  async download(ownerId:string,connectionId:string,copy:BackupCopy,archivePath:string){
    const token=await this.google.token(ownerId,connectionId,[GOOGLE_DRIVE_FILE_SCOPE]);
    for(const [fileId,path] of [[copy.archiveFileId,archivePath],[copy.manifestFileId,`${archivePath}.manifest.json`]]){
      const response=await fetch(`${api}/${encodeURIComponent(fileId)}?alt=media`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(120000)});
      if(!response.ok||!response.body)throw new HttpException('Não foi possível baixar o backup do Google Drive.',502);
      await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),createWriteStream(path,{mode:0o600,flags:'wx'}));
    }
  }
}

export function googleDriveBackupPluginDefinition(backups:BackupService):PluginDefinition{return {id:'google_drive',name:'Google Drive',version:'1.0.0',scope:'account',configuration:[{key:'GOOGLE_DRIVE_REDIRECT_URI',label:'URL de retorno OAuth do Drive',secret:false},{key:'ORBIT_DRIVE_CLIENT_ID',label:'Legado: Google OAuth Client ID para CLI',secret:false},{key:'ORBIT_DRIVE_CLIENT_SECRET',label:'Legado: Google OAuth Client Secret para CLI',secret:true},{key:'ORBIT_DRIVE_REFRESH_TOKEN',label:'Legado: Google OAuth Refresh Token para CLI',secret:true},{key:'ORBIT_DRIVE_FOLDER_ID',label:'Legado: pasta do Drive para CLI',secret:false}],capabilities:[{id:'backup.upload',name:'Salvar backup criptografado',permissions:['backup.write']}],actions:[{id:'upload_existing',name:'Enviar backup existente',requiredCapabilities:['backup.upload'],inputSchema:{type:'object',required:['archive','connectionId'],properties:{archive:{type:'string',pattern:'^orbit-.*\\.backup\\.enc$'},connectionId:{type:'string'}},additionalProperties:false},async execute(input,context){if(!context.userId)throw new Error('Usuário obrigatório.');return {type:'backup',label:'Backup enviado ao Google Drive',value:await backups.uploadExisting(context.userId,String(input.archive),input.connectionId)}}}],connectionProvider:{id:'google-oauth',name:'Google OAuth',supportsMultiple:true,capabilities:['backup.upload']},contributions:{settings:[{id:'google_drive',label:'Backup no Google Drive',href:'/backups'}]}}}

@Controller('google/drive')
export class GoogleDriveBackupController {
  constructor(@Inject(GoogleCredentials) private google:GoogleCredentials,@Inject(FeaturesService) private features:FeaturesService){}
  @Get('oauth/start') start(@Req() req:Request){const owner=this.features.user(req);return this.google.start(owner,'drive-backup',[GOOGLE_DRIVE_FILE_SCOPE],googleRedirectUri('drive'))}
  @Get('oauth/callback') async callback(@Query('code') code:string,@Query('state') state:string,@Res() response:Response){try{await this.google.complete(code,state,'drive-backup');response.redirect(`${process.env.WEB_ORIGIN||'http://localhost:3000'}/backups?connected=google_drive`)}catch(error){const message=error instanceof HttpException?error.message:'Falha na conexão Google.';response.redirect(`${process.env.WEB_ORIGIN||'http://localhost:3000'}/backups?error=${encodeURIComponent(message)}`)}}
}

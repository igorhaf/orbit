import type {BackupManifest} from './database-backup';

export type BackupCopy={archiveFileId:string;manifestFileId:string;folderId:string};
export interface BackupDestination {
  id:string;
  name:string;
  upload(ownerId:string,connectionId:string,archivePath:string,manifest:BackupManifest):Promise<BackupCopy>;
  download(ownerId:string,connectionId:string,copy:BackupCopy,archivePath:string):Promise<void>;
}

export class BackupDestinationRegistry {
  private destinations=new Map<string,BackupDestination>();
  register(destination:BackupDestination){if(this.destinations.has(destination.id))throw new Error(`Destino de backup duplicado: ${destination.id}`);this.destinations.set(destination.id,destination)}
  get(id:string){const destination=this.destinations.get(id);if(!destination)throw new Error(`Destino de backup não registrado: ${id}`);return destination}
  catalog(){return [...this.destinations.values()].map(({id,name})=>({id,name}))}
}

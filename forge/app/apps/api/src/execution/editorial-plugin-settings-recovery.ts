import type {EditorialAuthorizationGenerationRepository} from './editorial-authorization-generation';
import type {EditorialAuthorizationGeneration} from './editorial-authorization-generation';

type Registry={
 getById(id:string):unknown;
 isInstalled(id:string):boolean;
 setEnabled(id:string,enabled:boolean):void|Promise<void>;
 catalog():readonly {id:string;configuredEnabled:boolean;enabled:boolean;blockedBy?:readonly string[]}[];
};
export type PluginRecoveryStatus='reconciled_observed'|'stale'|'reconciling'|'unknown'|'unavailable';
export type PluginRecoveryResult=Readonly<{
 status:PluginRecoveryStatus;pluginId:string;generation?:EditorialAuthorizationGeneration;
 reason?:'plugin_unknown'|'plugin_not_installed'|'dependency_unavailable'|'generation_changed'|'configuration_mismatch'|'source_unavailable'|'local_update_failed';
 authorizationState:'unavailable';
}>;
type Observation={generation:EditorialAuthorizationGeneration;explicit:boolean;enabled:boolean};
const unavailable={authorizationState:'unavailable'} as const;
const locks=new WeakMap<object,Map<string,Promise<void>>>();

async function serialize<T>(repository:object,id:string,work:()=>Promise<T>):Promise<T>{
 let byPlugin=locks.get(repository);
 if(!byPlugin){byPlugin=new Map();locks.set(repository,byPlugin)}
 const previous=byPlugin.get(id)??Promise.resolve();
 let release!:()=>void;
 const current=new Promise<void>(resolve=>{release=resolve});
 byPlugin.set(id,current);
 await previous;
 try{return await work()}finally{
  release();
  if(byPlugin.get(id)===current)byPlugin.delete(id);
 }
}

/** Notifications are hints to observe SQL again. Their payload never supplies state. */
export async function recoverEditorialPluginSetting(
 repository:EditorialAuthorizationGenerationRepository,registry:Registry,id:string,_notification?:unknown,defaultEnabled=true,
):Promise<PluginRecoveryResult>{
 return serialize(repository,id,async()=>{
  try{
   if(!registry.isInstalled(id))return {status:'unavailable',pluginId:id,reason:'plugin_not_installed',...unavailable};
   registry.getById(id);
  }catch{return {status:'unavailable',pluginId:id,reason:'plugin_unknown',...unavailable}}
  try{
   const observe=()=>repository.observePluginSetting(id,defaultEnabled);
   const first=await observe();
   let local=registry.catalog().find(item=>item.id===id);
   if(!local)return {status:'unavailable',pluginId:id,reason:'plugin_unknown',generation:first.generation,...unavailable};
   if(first.enabled&&(local.blockedBy?.length||0)>0){
    return {status:'unavailable',pluginId:id,reason:'dependency_unavailable',generation:first.generation,...unavailable};
   }
   if(local.configuredEnabled!==first.enabled){
    try{await registry.setEnabled(id,first.enabled)}catch{
     return {status:'stale',pluginId:id,reason:'local_update_failed',generation:first.generation,...unavailable};
    }
    local=registry.catalog().find(item=>item.id===id);
   }
   if(!local||!registry.isInstalled(id)||local.configuredEnabled!==first.enabled){
    return {status:'stale',pluginId:id,reason:'local_update_failed',generation:first.generation,...unavailable};
   }
   let second:Observation;
   try{second=await observe()}catch{return {status:'unknown',pluginId:id,reason:'source_unavailable',...unavailable}}
   if(second.generation.domainId!==first.generation.domainId||second.generation.revision!==first.generation.revision){
    return {status:'stale',pluginId:id,reason:'generation_changed',generation:second.generation,...unavailable};
   }
   if(second.explicit!==first.explicit||second.enabled!==first.enabled){
    return {status:'stale',pluginId:id,reason:'configuration_mismatch',generation:second.generation,...unavailable};
   }
   local=registry.catalog().find(item=>item.id===id);
   if(!local||local.configuredEnabled!==second.enabled||!registry.isInstalled(id)||
      (second.enabled&&(local.blockedBy?.length||0)>0)){
    return {status:'stale',pluginId:id,reason:'local_update_failed',generation:second.generation,...unavailable};
   }
   return {status:'reconciled_observed',pluginId:id,generation:second.generation,...unavailable};
  }catch{
   return {status:'unknown',pluginId:id,reason:'source_unavailable',...unavailable};
  }
 });
}

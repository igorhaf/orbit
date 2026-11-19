import {
 EditorialAuthorizationGenerationError,
 type EditorialAuthorizationGeneration,
 type EditorialAuthorizationGenerationRef,
 type EditorialAuthorizationGenerationRepository,
} from './editorial-authorization-generation';
import {RequiredBoardViewError,writeEditorialPluginSetting} from './editorial-plugin-settings-writer';

type PluginRegistryPort={
 getById(id:string):unknown;
 isInstalled(id:string):boolean;
 setEnabled(id:string,enabled:boolean):void;
 catalog():readonly {id:string;configuredEnabled:boolean;enabled:boolean}[];
};

/** The synchronized state concerns only the observed setting, never editorial readiness. */
export type PluginSettingReadiness=
 | {state:'synchronized';scope:'plugin_setting';generation:EditorialAuthorizationGeneration;effectiveEnabled:boolean}
 | {state:'stale';scope:'plugin_setting';generation:EditorialAuthorizationGeneration}
 | {state:'reconciling'|'unknown';scope:'plugin_setting'};

type ResultStatus=
 | {status:'committed_reconciled';readiness:Extract<PluginSettingReadiness,{state:'synchronized'}>}
 | {status:'committed_local_stale';reason:'registry_update_failed'|'notification_failed'|'verification_failed';
    readiness:Extract<PluginSettingReadiness,{state:'stale'}>}
 | {status:'commit_uncertain'|'rejected'|'failed_rolled_back'|'failed_unconfirmed';reason:string;
    readiness:{state:'unknown';scope:'plugin_setting'}};

export type PluginSettingReconciliationResult=Readonly<ResultStatus & {authorizationState:'unavailable'}>;

const unknown=Object.freeze({state:'unknown',scope:'plugin_setting'} as const);
const unavailable={authorizationState:'unavailable'} as const;
const rejected=(reason:string):PluginSettingReconciliationResult=>
 ({status:'rejected',reason,readiness:unknown,...unavailable});

/** Internal DEV-shaped flow. The caller must authenticate and authorize before invoking it. */
export async function reconcileEditorialPluginSetting(
 repository:EditorialAuthorizationGenerationRepository,
 registry:PluginRegistryPort,
 pluginsChanged:(id:string)=>void|Promise<void>,
 expected:EditorialAuthorizationGenerationRef,
 id:string,
 enabled:boolean,
):Promise<PluginSettingReconciliationResult>{
 if(typeof id!=='string'||typeof enabled!=='boolean')return rejected('invalid_setting');
 try{
  if(!registry.isInstalled(id))return rejected('plugin_not_installed');
  registry.getById(id);
 }catch{
  return rejected('plugin_unknown');
 }

 let generation:EditorialAuthorizationGeneration;
 try{
  generation=await writeEditorialPluginSetting(repository,expected,id,enabled);
 }catch(error){
  if(error instanceof RequiredBoardViewError)return rejected(error.reason);
  if(error instanceof TypeError&&error.message==='editorial_plugin_setting_invalid')return rejected('invalid_setting');
  if(error instanceof EditorialAuthorizationGenerationError){
   switch(error.code){
    case 'editorial_generation_expected_invalid':
    case 'editorial_generation_domain_mismatch':
    case 'editorial_generation_conflict':
     return rejected(error.code);
    case 'editorial_generation_commit_uncertain':
     return {status:'commit_uncertain',reason:error.code,readiness:unknown,...unavailable};
    default:
     return {status:error.rollbackConfirmed?'failed_rolled_back':'failed_unconfirmed',
      reason:error.code,readiness:unknown,...unavailable};
   }
  }
  return {status:'failed_unconfirmed',reason:'writer_failed',readiness:unknown,...unavailable};
 }

 const stale=(reason:Extract<ResultStatus,{status:'committed_local_stale'}>['reason']):PluginSettingReconciliationResult=>
  ({status:'committed_local_stale',reason,readiness:{state:'stale',scope:'plugin_setting',generation},...unavailable});
 try{registry.setEnabled(id,enabled)}catch{return stale('registry_update_failed')}
 try{await pluginsChanged(id)}catch{return stale('notification_failed')}

 try{
  const effectiveEnabled=await repository.withPinned(generation,async db=>{
   const {rows}: {rows:{enabled:boolean}[]}=
    await db.query('SELECT enabled FROM plugin_settings WHERE plugin_id=$1',[id]);
   const local=registry.catalog().find(item=>item.id===id);
   if((rows[0]?.enabled??true)!==enabled||!local||!registry.isInstalled(id)||local.configuredEnabled!==enabled){
    throw new Error('plugin_setting_observation_mismatch');
   }
   return local.enabled;
  });
  return {status:'committed_reconciled',
   readiness:{state:'synchronized',scope:'plugin_setting',generation,effectiveEnabled},...unavailable};
 }catch{
  return stale('verification_failed');
 }
}

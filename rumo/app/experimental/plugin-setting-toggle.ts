import {HttpException, type ExecutionContext} from '@nestjs/common';
import type {Pool} from 'pg';
import {AccessGuard, type AccessService, type AccessRequest} from '../apps/api/src/access/access';
import type {Db} from '../apps/api/src/db';
import type {PluginRegistry} from '../apps/api/src/execution/registries';
import {EditorialAuthorizationGenerationRepository} from '../../../packages/orbit-core/src/execution/editorial-authorization-generation';
import {
 reconcileEditorialPluginSetting,
 type PluginSettingReconciliationResult,
} from '../../../packages/orbit-core/src/execution/editorial-plugin-settings-orchestration';
import {recoverEditorialPluginSetting} from '../../../packages/orbit-core/src/execution/editorial-plugin-settings-recovery';

/**
 * Experimental host composition. The host owns the pool and its lifecycle.
 * This module is outside the API build until the cutover prerequisites are met.
 */
export function createExperimentalPluginSettingToggle(
 generalDb:Db,
 access:AccessService,
 configurationPool:Pool,
 registry:PluginRegistry,
 pluginsChanged:(id:string)=>void|Promise<void>,
){
 if(!configurationPool||configurationPool===generalDb.pool){
  throw new Error('separate_plugin_configuration_pool_required');
 }
 const guard=new AccessGuard(access,generalDb);
 const repository=new EditorialAuthorizationGenerationRepository(configurationPool);

 // Only reached after the real host guard and permission check.
 async function apply(id:string,enabled:unknown):Promise<PluginSettingReconciliationResult>{
  const rejected=(reason:string):PluginSettingReconciliationResult=>({
   status:'rejected',reason,readiness:{state:'unknown',scope:'plugin_setting'},authorizationState:'unavailable',
  });
  if(typeof enabled!=='boolean')return rejected('invalid_setting');
  if(!registry.isInstalled(id))return rejected('plugin_not_installed');
  let generation;
  try{
   generation=await repository.observe();
  }catch{
   // Observation failed before any write was attempted.
   return rejected('configuration_source_unavailable');
  }
  return reconcileEditorialPluginSetting(repository,registry,pluginsChanged,generation,id,enabled);
 }

 return Object.freeze({
  async toggle(context:ExecutionContext,id:string,enabled:unknown){
   const request=context.switchToHttp().getRequest<AccessRequest>();
   if(request.method!=='PATCH'||request.path!==`/plugins/${id}`||id.includes('/')){
    throw new HttpException('Rota de configuração inválida.',403);
   }
   if(!await guard.canActivate(context)||!request.orbitActor){
    throw new HttpException('Acesso não autorizado.',403);
   }
   await access.require(request.orbitActor,'plugins.manage');
   return apply(id,enabled);
  },
  // For host startup and recovery, with no HTTP exposure.
  recover:(id:string)=>recoverEditorialPluginSetting(repository,registry,id),
 });
}

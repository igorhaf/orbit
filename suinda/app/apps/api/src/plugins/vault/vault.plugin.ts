import type {PluginDefinition} from '../contract';
import type {PluginRegistry} from '../../execution/registries';
import type {AccessService} from '../../access/access';
import type {Request,Response,NextFunction} from 'express';
export const vaultRoute=(path:string)=>/^\/vault(?:\/|$)/.test(path)||/^\/cards\/[^/]+\/vault$/.test(path)||/^\/backups\/vault(?:\/|$)/.test(path);
export const vaultPlugin:PluginDefinition={id:'vault',name:'Cofre',version:'1.0.0',scope:'account',description:'Cadernos privados criptografados, categorias e anotações de credenciais; a resolução de credenciais de integrações permanece no core.',handlesRoute:vaultRoute,routePermission:(path,method)=>path.startsWith('/backups/')?`backups.${['GET','HEAD'].includes(method)?'read':'write'}`:path.startsWith('/cards/')?'boards.write':`vault.${['GET','HEAD'].includes(method)?'read':'write'}`,capabilities:['read','write'].map(action=>({id:action,name:action==='read'?'Consultar o Cofre':'Editar o Cofre',permissions:[`vault.${action}`]}))};
export function installVaultAccess(registry:PluginRegistry,access:AccessService){access.registerResourceAvailability(type=>type!=='vault'||registry.isEnabled('vault'))}
export function vaultFeatureAccess(registry:PluginRegistry){return(req:Request,res:Response,next:NextFunction)=>{if(vaultRoute(req.path)&&!registry.isEnabled('vault')){res.status(409).json({message:'O Cofre não está disponível nesta instância.'});return}next()}}

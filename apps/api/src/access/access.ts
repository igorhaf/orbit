import type {PluginDefinition} from '../plugins/contract';
import {corePrivileges,permissionForRoute,evaluatePermissions,Privilege} from './privileges';
import {Body,CanActivate,Controller,ExecutionContext,Get,HttpException,Inject,Injectable,Param,Patch,Post,Put,Query,Req} from '@nestjs/common';
import type {Request} from 'express';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcryptjs';
import {Db} from '../db';

export const permissions = corePrivileges.map(p=>p.id);
export type AccessRequest = Request & {orbitActor?:string;orbitUser?:string};
function deny(message='Acesso não autorizado.',status=403):never{throw new HttpException({message},status)}
export function text(value:unknown,max=120){if(typeof value!=='string'||!value.trim()||value.trim().length>max)deny('Valor inválido.',400);return (value as string).trim()}
export function id(value:unknown){const result=text(value,36);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result))deny('ID inválido.',400);return result}
export function allowed(root:boolean,granted:string[],permission:string){return root||granted.includes(permission)}
export const routePermission=permissionForRoute;

@Injectable()
export class AccessService {
 private resourceAvailability:Array<(type:string)=>boolean>=[];
 registerResourceAvailability(provider:(type:string)=>boolean){this.resourceAvailability.push(provider)}
 resourceAvailable(type:string){return this.resourceAvailability.every(provider=>provider(type))}

 private boardListProviders:Array<(user:string,status:string)=>Promise<Array<Record<string,unknown>&{id:string}>>>=[];
 private boardScopeProviders:Array<(board:string,user:string)=>Promise<Record<string,unknown>|null>>=[];
 registerBoardListProvider(provider:(user:string,status:string)=>Promise<Array<Record<string,unknown>&{id:string}>>){this.boardListProviders.push(provider)}
 async additionalBoards(user:string,status:string){return (await Promise.all(this.boardListProviders.map(provider=>provider(user,status)))).flat()}
 registerBoardScopeProvider(provider:(board:string,user:string)=>Promise<Record<string,unknown>|null>){this.boardScopeProviders.push(provider)}
 async boardScope(board:string,user:string){for(const provider of this.boardScopeProviders){const scope=await provider(board,user);if(scope)return scope}return null}

 private boardMemberProviders:Array<(board:string,user:string)=>Promise<Array<Record<string,unknown>>|null>>=[];
 registerBoardMembersProvider(provider:(board:string,user:string)=>Promise<Array<Record<string,unknown>>|null>){this.boardMemberProviders.push(provider)}
 async boardMembers(board:string,user:string){for(const provider of this.boardMemberProviders){const members=await provider(board,user);if(members!==null)return members}return null}
 private boardAccessProviders:Array<(board:string,user:string,permission:string)=>Promise<boolean|null>>=[];
 private boardListingPolicies:Array<(board:string,user:string)=>Promise<boolean>>=[];
 registerBoardAccessProvider(provider:(board:string,user:string,permission:string)=>Promise<boolean|null>){this.boardAccessProviders.push(provider)}
 registerBoardListingPolicy(policy:(board:string,user:string)=>Promise<boolean>){this.boardListingPolicies.push(policy)}

 private boardPolicies:Array<(board:string,user:string,permission:string,snapshot?:{is_collection?:boolean})=>Promise<boolean>>=[];
 registerBoardPolicy(policy:(board:string,user:string,permission:string,snapshot?:{is_collection?:boolean})=>Promise<boolean>){this.boardPolicies.push(policy)}
 async availableBoards<T extends {id:string;is_collection?:boolean}>(boards:T[],user:string){const allowed=await Promise.all(boards.map(async board=>(await Promise.all(this.boardPolicies.map(policy=>policy(board.id,user,'boards.read',board)))).every(Boolean)&& (await Promise.all(this.boardListingPolicies.map(policy=>policy(board.id,user)))).every(Boolean)));return boards.filter((_board,index)=>allowed[index])}

 private registeredPermissions=new Map<string,Privilege>(corePrivileges.map(p=>[p.id,p]));
 private routePlugins=new Map<string,string>();
 private pluginDefinitions=new Map<string,PluginDefinition>();
 private pluginRoutes=new Set<string>();
 registerPermissions(values:string[],source='core'){for(const value of values)if(!this.registeredPermissions.has(value))this.registeredPermissions.set(value,{id:value,label:value,source})}
 catalog(){return Array.from(this.registeredPermissions.keys())}
 async privilegeCatalog(){const states=await this.db.query<{permission_id:string;enabled:boolean}>('SELECT * FROM access_permission_settings');return Array.from(this.registeredPermissions.values()).map(p=>({...p,enabled:states.find(state=>state.permission_id===p.id)?.enabled!==false}))}
 registerPlugins(plugins:PluginDefinition[]){for(const plugin of plugins){this.registerPermissions(['read','write','manage'].map(action=>`plugin.${plugin.id}.${action}`),plugin.id);for(const action of [...plugin.capabilities||[],...plugin.actions||[]])this.registerPermissions(action.permissions||[],plugin.id);for(const type of plugin.contributions?.cardTypes||[])this.registerPermissions([`cards.type.${type.id}.use`],plugin.id);for(const view of plugin.contributions?.boardViews||[]){this.registerPermissions([view.permission],plugin.id);this.registeredPermissions.set(view.permission,{id:view.permission,label:'Visualização: '+view.name,source:plugin.id})}}const prefixes:Record<string,string>={'/git':'git','/github':'github','/delivery':'delivery','/planner':'planner','/ai/schedule':'planner','/google/drive':'google_drive','/calendar/google':'google_calendar','/calendar/microsoft':'outlook_calendar','/dropbox':'dropbox','/mail/gmail':'gmail','/mail/outlook_mail':'outlook_mail','/trello':'trello'};for(const [prefix,plugin] of Object.entries(prefixes))this.routePlugins.set(prefix,plugin)}
 permission(path:string,method:string){if(/^\/boards\/[^/]+\/views(?:\/|$)/.test(path))return 'boards.read';for(const plugin of this.pluginDefinitions.values())if(plugin.handlesRoute?.(path))return plugin.routePermission?.(path,method)||`plugin.${plugin.id}.${['GET','HEAD'].includes(method)?'read':'write'}`;for(const [prefix,plugin] of this.routePlugins)if(path===prefix||path.startsWith(prefix+'/'))return `plugin.${plugin}.${['GET','HEAD'].includes(method)?'read':'write'}`;const configuration=path.match(/^\/plugins\/([^/]+)\//)||path.match(/^\/settings\/environment\/plugins\/([^/]+)(?:\/|$)/);if(configuration)return `plugin.${configuration[1]}.manage`;return routePermission(path,method)}
 pluginPermission(path:string,method:string){const plugin=[...this.pluginDefinitions.values()].find(item=>item.handlesRoute?.(path));return plugin?.routePermission?.(path,method)}
 bindPlugins(plugins:PluginDefinition[]){for(const plugin of plugins)this.pluginDefinitions.set(plugin.id,plugin)}
 async authorizePluginAction(user:string,pluginId:string,actionId:string){const plugin=this.pluginDefinitions.get(pluginId),action=plugin?.actions?.find(item=>item.id===actionId);if(!action)deny('Ação não registrada.',404);const required=[...new Set([...(action.permissions||[]),...(plugin?.capabilities||[]).filter(cap=>(action.requiredCapabilities||[]).includes(cap.id)).flatMap(cap=>cap.permissions||[])])];for(const permission of required)await this.require(user,permission)}

 async pluginRequest(user:string,pluginId:string,mode:string,path:string){if((await this.account(user)).is_root)return true;const granted=await this.effective(user);if(mode==='manage')return granted.includes(`plugin.${pluginId}.manage`);const plugin=this.pluginDefinitions.get(pluginId);const declared=[...new Set([...(plugin?.capabilities||[]).flatMap(cap=>cap.permissions||[]),...(plugin?.actions||[]).flatMap(action=>action.permissions||[])])];const kind=declared.filter(permission=>mode==='read'?permission.endsWith('.read'):!permission.endsWith('.read'));const normalize=(value:string)=>value.toLowerCase().replace(/ies$/,'y').replace(/s$/,'').replace(/[._-]/g,'');const segments=path.split('/').map(normalize);const action=plugin?.actions?.find(action=>segments.includes(normalize(action.id)));const required=action?[...action.permissions||[],...(plugin?.capabilities||[]).filter(cap=>(action.requiredCapabilities||[]).includes(cap.id)).flatMap(cap=>cap.permissions||[])]:kind.filter(permission=>segments.includes(normalize(permission.split('.')[0])));const explicitDenied=await this.db.query<{permission_id:string}>("SELECT permission_id FROM access_user_exceptions WHERE user_id=$1 AND effect='deny' UNION SELECT permission_id FROM access_permission_settings WHERE NOT enabled",[user]);if(required.some(permission=>explicitDenied.some(row=>row.permission_id===permission)))return false;if(granted.includes(`plugin.${pluginId}.${mode}`))return true;return required.length>0?required.every(permission=>granted.includes(permission)):kind.some(permission=>granted.includes(permission))}
 registerRoutes(prefix:string){this.pluginRoutes.add(prefix)}
 pluginRoute(path:string){return [...this.pluginDefinitions.values()].some(plugin=>plugin.handlesRoute?.(path))||[...this.pluginRoutes].some(prefix=>path===prefix||path.startsWith(prefix+'/'))}
 private revokeListeners:Array<(user:string)=>void>=[];
 onRevoke(listener:(user:string)=>void){this.revokeListeners.push(listener)}
 revoke(user:string){for(const listener of this.revokeListeners)listener(user)}
 private resourceProviders:Array<{list:(user:string,type:string)=>Promise<string[]>;authorize:(user:string,type:string,key:string,write:boolean)=>Promise<boolean>}>=[];
 registerResources(provider:{list:(user:string,type:string)=>Promise<string[]>;authorize:(user:string,type:string,key:string,write:boolean)=>Promise<boolean>}){this.resourceProviders.push(provider)}
 async sharedResources(user:string,type:string){return [...new Set((await Promise.all(this.resourceProviders.map(provider=>provider.list(user,type)))).flat())]}
 async sharedResource(user:string,type:string,key:string,write:boolean){for(const provider of this.resourceProviders)if(await provider.authorize(user,type,key,write))return true;return false}
 private memberships=new Map<string,(user:string,scope:string,permission:string)=>Promise<boolean>>();
 registerMembership(type:string,provider:(user:string,scope:string,permission:string)=>Promise<boolean>){this.memberships.set(type,provider)}
 private scopes=new Map<string,(scope:string)=>Promise<boolean>>();
 constructor(@Inject(Db) private db:Db){}
 registerScope(type:string,enabled:(scope:string)=>Promise<boolean>){this.scopes.set(type,enabled)}
 async account(user:string){const row=await this.db.one<{id:string;name:string;email:string;is_root:boolean;disabled:boolean;session_version:number}>('SELECT id,name,email,is_root,disabled,session_version FROM users WHERE id=$1',[user]);if(!row||row.disabled)deny('Sessão inválida ou conta suspensa.',401);return row!}
 async authenticate(token:string){let payload:jwt.JwtPayload;try{payload=jwt.verify(token,process.env.JWT_SECRET!) as jwt.JwtPayload}catch{return deny('Sessão expirada.',401)}const user=await this.account(id(payload.sub));if(Number(payload.version||0)!==user.session_version)deny('Sessão revogada. Entre novamente.',401);return user}
 async grants(user:string,type='global',scope='*'){return this.db.query<{role_id:string;name:string;permissions:string[]}>('SELECT g.role_id,r.name,r.permissions FROM access_grants g JOIN access_roles r ON r.id=g.role_id WHERE g.user_id=$1 AND g.scope_type=$2 AND g.scope_id=$3',[user,type,scope])}
 async isAdmin(user:string){return Boolean(await this.db.one("SELECT user_id FROM access_grants WHERE user_id=$1 AND scope_type='global' AND role_id IN ('administrator','platform_admin')",[user]))}
 async initializeDefaults(){const read=this.catalog().filter(p=>p.endsWith('.read')&&!p.startsWith('settings.'));if(this.catalog().includes('views.board.use'))read.push('views.board.use');await this.db.query("UPDATE access_roles SET permissions=$1,defaults_initialized=true WHERE id='user' AND NOT defaults_initialized",[read]);await this.db.query("UPDATE access_roles SET permissions=$1,defaults_initialized=true WHERE id IN ('administrator','platform_admin') AND NOT defaults_initialized",[this.catalog()])}
 async effective(user:string,type='global',scope='*'){const account=await this.account(user);if(account.is_root)return ['*'];const roles=type==='global'?await this.grants(user):await this.db.query<{role_id:string;name:string;permissions:string[]}>(`SELECT g.role_id,r.name,r.permissions FROM access_grants g JOIN access_roles r ON r.id=g.role_id
   WHERE g.user_id=$1 AND ((g.scope_type='global' AND g.scope_id='*') OR (g.scope_type=$2 AND g.scope_id=$3))`,[user,type,scope]);const grouped=await this.db.query<{permissions:string[]}>('SELECT g.permissions FROM access_groups g JOIN access_group_members m ON m.group_id=g.id WHERE m.user_id=$1',[user]);const exceptions=await this.db.query<{permission_id:string;effect:string}>('SELECT permission_id,effect FROM access_user_exceptions WHERE user_id=$1',[user]);const disabled=await this.db.query<{permission_id:string}>('SELECT permission_id FROM access_permission_settings WHERE NOT enabled');const rolePermissions=roles.flatMap(r=>r.permissions);return evaluatePermissions(false,rolePermissions,grouped.flatMap(g=>g.permissions),exceptions,disabled.map(p=>p.permission_id),this.catalog())}
 async has(user:string,permission:string,type='global',scope='*'){
  const account=await this.account(user);if(account.is_root)return true;
  const granted=(await this.effective(user,type,scope)).includes(permission);if(!granted)return false;
  if(type==='global')return true;
  const provider=this.scopes.get(type),membership=this.memberships.get(type);return Boolean(provider&&await provider(scope)&&membership&&await membership(user,scope,permission));
 }

 /** Strict resource authorization: only a grant on this exact scope can authorize access. */
 async hasScoped(user:string,permission:string,type:string,scope:string){
  const account=await this.account(user);if(account.is_root)return true;
  const provider=this.scopes.get(type),membership=this.memberships.get(type);if(!provider||!membership||!await provider(scope))return false;
  const roles=await this.grants(user,type,scope);
  const [denials,disabled]=await Promise.all([
   this.db.query<{permission_id:string}>("SELECT permission_id FROM access_user_exceptions WHERE user_id=$1 AND permission_id=$2 AND effect='deny'",[user,permission]),
   this.db.query<{permission_id:string}>('SELECT permission_id FROM access_permission_settings WHERE permission_id=$1 AND NOT enabled',[permission]),
  ]);
  if(denials.length||disabled.length)return false;
  if(!roles.some(role=>role.permissions.includes(permission)))return false;
  return membership(user,scope,permission);
 }

 async require(user:string,permission:string,type='global',scope='*'){if(!await this.has(user,permission,type,scope)){await this.audit(user,'access.denied',permission,type==='global'?undefined:{type,id:scope});deny()}}
 async requireScoped(user:string,permission:string,type:string,scope:string){if(!await this.hasScoped(user,permission,type,scope)){await this.audit(user,'access.denied',permission,{type,id:scope});deny()}}
 async boardPermission(board:string,user:string,permission='boards.read'){
  for(const provider of this.boardAccessProviders){const allowed=await provider(board,user,permission);if(allowed!==null)return allowed;}
  for(const policy of this.boardPolicies)if(!await policy(board,user,permission))return false;
  const account=await this.account(user);if(account.is_root)return true;if(!await this.has(user,permission))return false;
  const row=await this.db.one('SELECT b.workspace_id,bm.role FROM boards b LEFT JOIN board_members bm ON bm.board_id=b.id AND bm.user_id=$2 WHERE b.id=$1',[board,user]);if(!row)return false;
  if(row.workspace_id)return this.has(user,permission,'workspace',String(row.workspace_id));
  return Boolean(row.role);
 }
 async me(user:string){return {...await this.account(user),roles:await this.grants(user),permissions:await this.effective(user),is_admin:await this.isAdmin(user)}}

 async audit(actor:string,action:string,target?:string,scope?:{type:string;id:string}){const type=scope?text(scope.type,80):null;const scopeId=scope?id(scope.id):null;await this.db.query('INSERT INTO access_audit(actor_id,action,target,scope_type,scope_id) VALUES($1,$2,$3,$4,$5)',[actor,action,target||null,type,scopeId])}
 async roles(){return this.db.query('SELECT * FROM access_roles ORDER BY name')}
 private async assertScope(type:string,scope:string){const provider=this.scopes.get(type);if(!provider)deny('Tipo de escopo não registrado.',404);if(!await provider(scope))deny('Escopo inexistente ou indisponível.',404)}
 async scopedAssignments(actor:string,type:string,scope:string){await this.require(actor,'access.manage');type=text(type,80);scope=text(scope,120);await this.assertScope(type,scope);return this.db.query(`SELECT u.id AS user_id,u.name,u.email,COALESCE(array_agg(g.role_id) FILTER(WHERE g.role_id IS NOT NULL),'{}') AS roles
   FROM users u LEFT JOIN access_grants g ON g.user_id=u.id AND g.scope_type=$1 AND g.scope_id=$2
   WHERE NOT u.disabled AND g.user_id IS NOT NULL GROUP BY u.id ORDER BY u.name`,[type,scope])}
 async assignScopedRoles(actor:string,user:string,type:string,scope:string,values:unknown){await this.require(actor,'access.manage');user=id(user);type=text(type,80);scope=text(scope,120);await this.assertScope(type,scope);const target=await this.db.one<{id:string;is_root:boolean}>('SELECT id,is_root FROM users WHERE id=$1',[user]);if(!target)deny('Usuário não encontrado.',404);if(target.is_root)deny('A conta ROOT é protegida.');const roles=await this.validateRoles(actor,values);const client=await this.db.pool.connect();try{await client.query('BEGIN');await client.query('DELETE FROM access_grants WHERE user_id=$1 AND scope_type=$2 AND scope_id=$3',[user,type,scope]);for(const role of roles)await client.query('INSERT INTO access_grants(user_id,role_id,scope_type,scope_id) VALUES($1,$2,$3,$4)',[user,role,type,scope]);await client.query('UPDATE users SET session_version=session_version+1 WHERE id=$1',[user]);await client.query('COMMIT');this.revoke(user);await this.audit(actor,'role.scope.updated',`${type}:${scope}:${user}`,{type,id:scope});return {ok:true,roles}}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}}
 async users(){return this.db.query(`SELECT u.id,u.name,u.email,u.is_root,u.disabled,u.created_at,COALESCE(array_agg(g.role_id) FILTER(WHERE g.role_id IS NOT NULL),'{}') AS roles FROM users u LEFT JOIN access_grants g ON g.user_id=u.id AND g.scope_type='global' GROUP BY u.id ORDER BY u.is_root DESC,u.name`)}
 async validateRoles(actor:string,values:unknown){if(!Array.isArray(values)||values.some(v=>typeof v!=='string')||values.length>20)deny('Perfis inválidos.',400);const roles=await this.roles();const selected=roles.filter(role=>values.includes(role.id));if(selected.length!==new Set(values).size)deny('Perfil inexistente.',400);const me=await this.me(actor);if(!me.is_root&&!me.is_admin&&selected.some(role=>(role.permissions as string[]).some(p=>!me.permissions.includes(p))))deny('Não é permitido delegar permissões que você não possui.');return [...new Set(values)] as string[]}
 async createUser(actor:string,body:Record<string,unknown>){await this.require(actor,'access.manage');if(Object.keys(body).some(key=>!['name','email','password','roles'].includes(key)))deny('Campo de usuário inválido.',400);const name=text(body.name);const email=text(body.email,255).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))deny('E-mail inválido.',400);const password=text(body.password,200);if(password.length<12)deny('Use uma senha com pelo menos 12 caracteres.',400);const roles=await this.validateRoles(actor,body.roles===undefined?['user']:body.roles);const client=await this.db.pool.connect();try{await client.query('BEGIN');const user=(await client.query('INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id',[name,email,await bcrypt.hash(password,12)])).rows[0];for(const role of roles)await client.query('INSERT INTO access_grants(user_id,role_id) VALUES($1,$2)',[user.id,role]);await client.query('COMMIT');await this.audit(actor,'user.created',user.id);return {id:user.id}}catch(error){await client.query('ROLLBACK');if((error as {code?:string}).code==='23505')deny('E-mail já cadastrado.',409);throw error}finally{client.release()}}
 async updateUser(actor:string,user:string,body:Record<string,unknown>){await this.require(actor,'access.manage');id(user);const target=await this.db.one('SELECT is_root FROM users WHERE id=$1',[user]);if(!target)deny('Usuário não encontrado.',404);if(target!.is_root)deny('A conta ROOT é protegida.');if(body.disabled!==undefined&&typeof body.disabled!=='boolean')deny('Estado inválido.',400);const roles=body.roles===undefined?null:await this.validateRoles(actor,body.roles);const password=body.password===undefined?null:text(body.password,200);if(password&&password.length<12)deny('Use uma senha com pelo menos 12 caracteres.',400);const client=await this.db.pool.connect();try{await client.query('BEGIN');await client.query('UPDATE users SET disabled=COALESCE($2,disabled),password_hash=COALESCE($3,password_hash),session_version=session_version+1 WHERE id=$1',[user,body.disabled??null,password?await bcrypt.hash(password,12):null]);if(roles){await client.query("DELETE FROM access_grants WHERE user_id=$1 AND scope_type='global'",[user]);for(const role of roles)await client.query('INSERT INTO access_grants(user_id,role_id) VALUES($1,$2)',[user,role])}await client.query('COMMIT');this.revoke(user);await this.audit(actor,'user.updated',user);return {ok:true}}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}}
 async saveRole(actor:string,role:string,body:Record<string,unknown>){await this.require(actor,'access.manage');if(!/^[a-z][a-z0-9_-]{1,60}$/.test(role))deny('Identificador inválido.',400);const name=text(body.name);if(!Array.isArray(body.permissions)||body.permissions.some(p=>!this.catalog().includes(String(p))))deny('Permissões inválidas.',400);if(!(await this.account(actor)).is_root&&!await this.isAdmin(actor)){for(const p of body.permissions)await this.require(actor,String(p));}await this.db.query('INSERT INTO access_roles(id,name,permissions) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET name=$2,permissions=$3',[role,name,[...new Set(body.permissions)]]);const changed=await this.db.query<{id:string}>('UPDATE users SET session_version=session_version+1 WHERE id IN (SELECT user_id FROM access_grants WHERE role_id=$1) AND NOT is_root RETURNING id',[role]);for(const user of changed)this.revoke(user.id);await this.audit(actor,'role.updated',role);return {ok:true}}
}

@Injectable()
export class AccessGuard implements CanActivate {
 constructor(@Inject(AccessService) private access:AccessService,@Inject(Db) private db:Db){}
 async canActivate(context:ExecutionContext){const req=context.switchToHttp().getRequest<AccessRequest>();const path=req.path;
  if(path==='/health'||(path==='/branding'&&req.method==='GET')||(req.method==='POST'&&['/auth/login','/auth/register','/auth/recovery','/auth/complete','/email/comments','/email/inbox','/integrations/alexa/orbit'].includes(path))||(/^\/(calendar\/(google|microsoft)|google\/drive|dropbox|mail\/(gmail|outlook_mail))\/oauth\/callback$/.test(path)&&req.method==='GET'))return true;
  if(path.startsWith('/public/')&&this.access.pluginRoute(path)&&this.access.pluginPermission(path,req.method)===null)return true;
  const token=req.headers.authorization?.replace(/^Bearer /i,'');if(!token)deny('Faça login para continuar.',401);const account=await this.access.authenticate(token!);req.orbitActor=account.id;req.orbitUser=account.id;
  const as=req.headers['x-orbit-act-as'];if(as){if(!account.is_root||typeof as!=='string')deny();await this.access.account(id(as));req.orbitUser=as;await this.access.audit(account.id,'root.act-as',as)}
  const resource=path.match(/^\/(vault|notebooks)\/([0-9a-f-]{36})(?:\/|$)/i)||path.match(/^\/ai\/(projects)\/([0-9a-f-]{36})(?:\/|$)/i);
  if(resource){const copying=path.endsWith('/copy-to-card'),reading=['GET','HEAD'].includes(req.method)||copying;const kind=resource[1],key=id(resource[2]),table=({vault:'vault_items',notebooks:'notebooks',projects:'ai_projects'} as Record<string,string>)[kind];const row=await this.db.one(`SELECT owner_id FROM ${table} WHERE id=$1`,[key]);if(!row)deny('Recurso não encontrado.',404);if(!account.is_root){await this.access.require(account.id,kind+'.'+(reading?'read':'write'));if(!reading)await this.access.require(account.id,kind+'.read');if(row.owner_id!==account.id&&!await this.access.sharedResource(account.id,kind,key,!reading))deny('Este recurso não está compartilhado com você.')}if(row.owner_id!==account.id)await this.access.audit(account.id,'shared.resource.request',req.method+' '+path);req.orbitUser=row.owner_id;
   if(!account.is_root&&path.endsWith('/restore-card')){await this.access.require(account.id,'boards.write');const target=await this.db.one('SELECT l.board_id FROM vault_items v JOIN cards c ON c.id=v.card_id JOIN lists l ON l.id=c.list_id WHERE v.id=$1',[key]);if(!target||!await this.access.boardPermission(target.board_id,account.id,'boards.write'))deny()}
   if(!account.is_root&&resource[1]==='projects'&&req.body?.local_path!==undefined)await this.access.require(account.id,'projects.filesystem');
   if(!account.is_root&&path.endsWith('/copy-to-card')){await this.access.require(account.id,'boards.write');const target=await this.db.one('SELECT board_id FROM lists WHERE id=$1',[id(req.body.list_id)]);if(!target||!await this.access.boardPermission(target.board_id,account.id,'boards.write'))deny()}
  }
  if(account.is_root){if(!['GET','HEAD'].includes(req.method))await this.access.audit(account.id,'root.request.attempt',req.method+' '+path);return true}
  const permission=resource&&path.endsWith('/copy-to-card')?resource[1]+'.read':this.access.pluginPermission(path,req.method)||(this.access.pluginRoute(path)?null:this.access.permission(path,req.method));if(!permission)return true;
  if(permission.startsWith('boards.')){
   await this.access.require(account.id,permission);
   if(/\/(execute|execution|prompt|prompt-runs|prompts)(\/|$)/.test(path))await this.access.require(account.id,'execution.'+(['GET','HEAD'].includes(req.method)?'read':'write'));
   if(/\/(git|commits)(\/|$)/.test(path))await this.access.require(account.id,'plugin.git.'+(['GET','HEAD'].includes(req.method)?'read':'write'));
   if(/\/ai(?:\/|$)/.test(path))await this.access.require(account.id,'ai.write');
   const match=path.match(/^\/([^/]+)\/([0-9a-f-]{36})(?:\/|$)/i);let board:string|undefined;
   if(match){const [ ,kind,key]=match;id(key);if(kind==='boards')board=key;else{
    const tables:Record<string,string>={cards:'cards',comments:'comments',checklist:'checklist_items','checklists':'checklists','checklist-items':'checklist_items','card-attachments':'attachments','comment-attachments':'comment_attachments'};
    const table=tables[kind];let row;if(kind==='lists')row=await this.db.one('SELECT board_id FROM lists WHERE id=$1',[key]);else if(table){const expression=kind==='cards'?'r.list_id':'c.list_id';row=await this.db.one(`SELECT l.board_id FROM ${table} r ${kind==='cards'?'':kind==='comment-attachments'?'JOIN comments cm ON cm.id=r.comment_id JOIN cards c ON c.id=cm.card_id':'JOIN cards c ON c.id=r.card_id'} JOIN lists l ON l.id=${expression} WHERE r.id=$1`,[key])}board=row?.board_id;
   }}
   if(board){if(!await this.access.boardPermission(board,account.id,permission))deny();if(permission==='boards.write'){
    if(typeof req.body?.list_id==='string'){const destination=await this.db.one('SELECT board_id FROM lists WHERE id=$1',[id(req.body.list_id)]);if(!destination||!await this.access.boardPermission(destination.board_id,account.id,'boards.write'))deny()}
    if(typeof req.body?.board_id==='string'&&!await this.access.boardPermission(id(req.body.board_id),account.id,'boards.write'))deny();
   }return true}
   if(path==='/boards'&&req.method==='GET')return true;
   if(path==='/boards'&&req.method==='POST'&&typeof req.body.workspace_id==='string'){await this.access.require(account.id,'boards.write','workspace',id(req.body.workspace_id));return true}
   if(['/cards/copy','/cards/move','/cards/merge','/favorites/reorder'].includes(path))return true;
   return deny();
  }
  const pluginPermission=permission.match(/^plugin\.(.+)\.(read|write|manage)$/);if(pluginPermission){if(!await this.access.pluginRequest(account.id,pluginPermission[1],pluginPermission[2],path))deny()}else await this.access.require(account.id,permission);if(path.startsWith('/search'))await this.access.require(account.id,'boards.read');return true;
 }
}

@Controller('access')
export class AccessController {
 constructor(@Inject(AccessService) private access:AccessService,@Inject(Db) private db:Db){}
 @Get('me') me(@Req() req:AccessRequest){return this.access.me(req.orbitActor!)}
 @Get('users') users(){return this.access.users()}
 @Get('roles') roles(){return this.access.roles()}
 @Get('permissions') permissions(){return this.access.catalog()}
 @Get('scopes/:type/:scope/assignments') scopedAssignments(@Req() req:AccessRequest,@Param('type') type:string,@Param('scope') scope:string){return this.access.scopedAssignments(req.orbitActor!,type,scope)}
 @Put('scopes/:type/:scope/users/:user/roles') scopedRoles(@Req() req:AccessRequest,@Param('type') type:string,@Param('scope') scope:string,@Param('user') user:string,@Body() body:Record<string,unknown>){return this.access.assignScopedRoles(req.orbitActor!,user,type,scope,body.roles)}
 @Get('audit') async audit(@Req() req:AccessRequest,@Query('scope_type') scopeType?:string,@Query('scope_id') scopeId?:string){await this.access.require(req.orbitActor!,'access.audit.read');if(Boolean(scopeType)!==Boolean(scopeId))deny('Informe o tipo e o identificador do escopo juntos.',400);const type=scopeType?text(scopeType,80):null;const key=scopeId?id(scopeId):null;return this.db.query('SELECT a.*,u.name AS actor_name FROM access_audit a LEFT JOIN users u ON u.id=a.actor_id WHERE ($1::text IS NULL OR a.scope_type=$1) AND ($2::uuid IS NULL OR a.scope_id=$2) ORDER BY a.id DESC LIMIT 200',[type,key])}
 @Post('users') create(@Req() req:AccessRequest,@Body() body:Record<string,unknown>){return this.access.createUser(req.orbitActor!,body)}
 @Patch('users/:id') update(@Req() req:AccessRequest,@Param('id') user:string,@Body() body:Record<string,unknown>){return this.access.updateUser(req.orbitActor!,user,body)}
 @Post('roles/:id') role(@Req() req:AccessRequest,@Param('id') role:string,@Body() body:Record<string,unknown>){return this.access.saveRole(req.orbitActor!,role,body)}
}

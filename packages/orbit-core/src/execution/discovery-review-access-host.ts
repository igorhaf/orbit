import {type EditorialConditionsResolver} from './discovery-review-sources';
import {type ContextQueryClient} from './context-manifest';
import {DiscoveryReviewApplicationError,type DiscoveryReviewHost} from './discovery-review-application';
import {discoveryEditorialPermissions} from '../access/editorial-permissions';
export type EditorialAccessService={
 editorialPermissions:(db:ContextQueryClient,user:string)=>Promise<string[]>;
 editorialScopeProvidersPresent:()=>boolean;
};
/** Supplied only after host AccessService.authenticate, never parsed from client JSON. */
export type EditorialAuthenticatedIdentity={actorId:string;subjectId:string;simulated:boolean;sessionVersion:number};
const deny=(code='review_forbidden',status=403):never=>{throw new DiscoveryReviewApplicationError(code,status)};
/** Deliberately limited to native personal boards and project owners. No enabled commands:
 * policy/evidence sources are absent, so the resulting host cannot execute decide(). */
export function discoveryReviewAccessHost(access:EditorialAccessService,runtimeId:string,identity:EditorialAuthenticatedIdentity,sources?:EditorialConditionsResolver):DiscoveryReviewHost<void>{
 const actor={...identity};
 const assertLocalScopeBeforeCommit=():undefined=>{
  if(access.editorialScopeProvidersPresent())deny('review_scope_adapter_unavailable',503);
 };
 return {
  assertLocalScopeBeforeCommit,
  session:async()=>({...actor}),policy:async()=>null,
  ...(sources?{conditions:async(db:ContextQueryClient,origin:Parameters<NonNullable<DiscoveryReviewHost<void>['conditions']>>[1])=>{
   const result=await db.query('SELECT c.project_id,c.runtime_id FROM discovery_journal_entries e JOIN discovery_journal_captures c ON c.id=e.capture_id WHERE e.id=$1 AND c.queue=$2',[origin.discoveryId,origin.queue]);
   const row=(Array.isArray(result)?result:result.rows)[0];
   if(!row||row.runtime_id!==runtimeId)deny();
   return sources.resolve(db,{...origin,runtimeId,projectId:row.project_id});
  }}:{}),
  authorize:async(principal,db,origin,operation,command)=>{
   if(actor.simulated||actor.actorId!==actor.subjectId||principal.actorId!==actor.actorId||principal.subjectId!==actor.subjectId)deny();
   assertLocalScopeBeforeCommit();
   // SHARE blocks DML including phantom grants/denials/membership insertions. Fixed order;
   // locks survive to COMMIT, no changes required in existing revocation writers.
   await db.query('LOCK TABLE users,access_roles,access_grants,access_groups,access_group_members,access_user_exceptions,access_permission_settings,boards,board_members,lists,cards,ai_projects,vault_items IN SHARE MODE');
   const query=async(sql:string,p:any[])=>{const r=await db.query(sql,p);return Array.isArray(r)?r:r.rows};
   const user=(await query('SELECT disabled,session_version FROM users WHERE id=$1',[actor.actorId]))[0];
   if(!user||user.disabled||user.session_version!==actor.sessionVersion)deny('review_unauthenticated',401);
   const scope=(await query(`SELECT h.runtime_id,h.actor_id,h.project_id,h.card_id,h.workspace_id,b.id AS board_id,b.owner_id,b.closed_at,b.is_collection,b.workspace_id AS current_workspace,c.archived_at AS card_archived,l.archived_at AS list_archived,p.owner_id AS project_owner
    FROM discovery_journal_entries e JOIN discovery_journal_captures h ON h.id=e.capture_id
    JOIN cards c ON c.id=h.card_id JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id JOIN ai_projects p ON p.id=h.project_id
    WHERE e.id=$1 AND h.queue=$2 AND NOT EXISTS(SELECT 1 FROM vault_items v WHERE v.card_id=c.id)`,[origin.discoveryId,origin.queue]))[0];
   if(!scope||scope.runtime_id!==runtimeId||scope.workspace_id!==null||scope.current_workspace!==null||scope.closed_at||scope.card_archived||scope.list_archived||scope.is_collection||scope.project_owner!==actor.actorId)deny();
   const member=scope.owner_id===actor.actorId||(await query('SELECT 1 FROM board_members WHERE board_id=$1 AND user_id=$2',[scope.board_id,actor.actorId])).length>0;
   if(!member)deny();
   const granted=await access.editorialPermissions(db,actor.actorId);
   const permission=operation==='decide'?`discovery_review.${command?.action}`:`discovery_review.${principal.readKind??'current'}`;
   if(!discoveryEditorialPermissions.includes(permission as typeof discoveryEditorialPermissions[number])||!granted.includes(permission)||!granted.includes('boards.read')||!granted.includes('projects.read'))deny();
   if(command?.action==='approve'&&scope.actor_id===actor.actorId)deny('review_separation_required');
   await db.query('INSERT INTO access_audit(actor_id,action,target,scope_type,scope_id) VALUES($1,$2,$3,$4,$5)',[actor.actorId,permission,origin.discoveryId,'project',scope.project_id]);
  }
 };
}

import type {ContextQueryClient} from './context-manifest';

export type EditorialAuthorizationGenerationRef=Readonly<{domainId:string;revision:string}>;
export type EditorialAuthorizationGeneration=EditorialAuthorizationGenerationRef & Readonly<{
 authorizationState:'unavailable';
 configurationVerification:'unknown';
}>;

type Connection=ContextQueryClient & {release:(discard?:boolean)=>void};
type Pool={connect:()=>Promise<Connection>};
type ErrorCode='editorial_generation_expected_invalid'|'editorial_generation_unavailable'|
 'editorial_generation_domain_mismatch'|'editorial_generation_conflict'|'editorial_generation_operation_failed'|
 'editorial_generation_commit_uncertain';

export class EditorialAuthorizationGenerationError extends Error{
 rollbackConfirmed=false;
 constructor(readonly code:ErrorCode){
  super(code);
  this.name='EditorialAuthorizationGenerationError';
 }
}

const fail=(code:ErrorCode):never=>{throw new EditorialAuthorizationGenerationError(code)};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function isReference(ref:EditorialAuthorizationGenerationRef|null|undefined):ref is EditorialAuthorizationGenerationRef{
 return Boolean(ref&&typeof ref.domainId==='string'&&uuid.test(ref.domainId)&&
  typeof ref.revision==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(ref.revision)&&
  BigInt(ref.revision)<=9223372036854775807n);
}

export function assertEditorialAuthorizationGeneration(expected:EditorialAuthorizationGenerationRef,observed:EditorialAuthorizationGenerationRef):void{
 if(!isReference(expected))fail('editorial_generation_expected_invalid');
 if(!isReference(observed))fail('editorial_generation_unavailable');
 if(expected.domainId!==observed.domainId)fail('editorial_generation_domain_mismatch');
 if(expected.revision!==observed.revision)fail('editorial_generation_conflict');
}

function generation(result:{rows?:Array<{domain_id:string;revision:string;authorization_state:string}>}):EditorialAuthorizationGeneration{
 const row=result?.rows?.length===1?result.rows[0]:undefined;
 const ref=row&&{domainId:row.domain_id,revision:row.revision};
 if(!isReference(ref)||row?.authorization_state!=='unavailable')return fail('editorial_generation_unavailable');
 return Object.freeze({...ref,authorizationState:'unavailable',configurationVerification:'unknown'});
}

/** Internal coordination only. Expected references come from server-controlled state. */
export class EditorialAuthorizationGenerationRepository{
 private observed?:EditorialAuthorizationGenerationRef;

 constructor(private readonly pool:Pool,initialObservation?:EditorialAuthorizationGenerationRef){
  if(initialObservation&&!isReference(initialObservation))fail('editorial_generation_expected_invalid');
  if(initialObservation)this.observed={...initialObservation};
 }

 private acceptObservation(value:EditorialAuthorizationGeneration){
  const previous=this.observed;
  if(previous){
   if(previous.domainId!==value.domainId)fail('editorial_generation_domain_mismatch');
   if(BigInt(previous.revision)>BigInt(value.revision))fail('editorial_generation_conflict');
   this.observed=value;
  }
  return value;
 }

 private async transaction<T>(operation:(db:Connection)=>Promise<T>):Promise<T>{
  let db:Connection;
  try{db=await this.pool.connect()}catch{return fail('editorial_generation_unavailable')}
  let discard=false;
  try{
   await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
   const value=await operation(db);
   try{
    const result=await db.query('COMMIT');
    if(result.command!=='COMMIT')fail('editorial_generation_commit_uncertain');
   }catch{
    discard=true;
    return fail('editorial_generation_commit_uncertain');
   }
   return value;
  }catch(error){
   let rollbackConfirmed=false;
   if(!discard){
    try{rollbackConfirmed=(await db.query('ROLLBACK')).command==='ROLLBACK'}catch{/* Discard the connection below. */}
    discard=!rollbackConfirmed;
   }
   const failure=error instanceof EditorialAuthorizationGenerationError
    ?error:new EditorialAuthorizationGenerationError('editorial_generation_operation_failed');
   failure.rollbackConfirmed=rollbackConfirmed;
   throw failure;
  }finally{
   db.release(discard);
  }
 }

 private async readLocked(db:Connection,mode:'SHARE'|'UPDATE'){
  return this.acceptObservation(generation(await db.query(`SELECT domain_id,revision::text,authorization_state
   FROM editorial_authorization_generation WHERE singleton FOR ${mode}`)));
 }

 /** Fresh observation, also used after an uncertain commit. It does not attribute who advanced the revision. */
 observe():Promise<EditorialAuthorizationGeneration>{
  return this.transaction(db=>this.readLocked(db,'SHARE'));
 }

 observePluginSetting(pluginId:string,defaultEnabled=true){
  if(typeof pluginId!=='string'||pluginId.length>100||!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(pluginId)){
   return Promise.reject(new EditorialAuthorizationGenerationError('editorial_generation_expected_invalid'));
  }
  return this.transaction(async db=>{
   const current=await this.readLocked(db,'SHARE');
   const {rows}=await db.query('SELECT enabled FROM plugin_settings WHERE plugin_id=$1',[pluginId]);
   return {generation:current,explicit:rows.length>0,enabled:rows[0]?.enabled??defaultEnabled};
  });
 }

 /** A single PostgreSQL snapshot for periodic local reconciliation, without a row lock. */
 observePluginSettings(){
  return this.transaction(async db=>{
   const result=await db.query(`SELECT domain_id, revision::text, authorization_state,
    (SELECT coalesce(jsonb_object_agg(plugin_id,enabled),'{}'::jsonb) FROM plugin_settings) AS settings
    FROM editorial_authorization_generation WHERE singleton`);
   const observed=this.acceptObservation(generation(result));
   const settings=result.rows[0]?.settings;
   if(!settings||typeof settings!=='object'||Array.isArray(settings)||
     Object.values(settings).some(enabled=>typeof enabled!=='boolean'))return fail('editorial_generation_unavailable');
   return {generation:observed,settings:new Map(Object.entries(settings) as [string,boolean][])};
  });
 }

 /** The trusted callback must complete its reads before returning and leave transaction control to the repository. */
 withPinned<T>(expected:EditorialAuthorizationGenerationRef,
  inspect:(db:ContextQueryClient,current:EditorialAuthorizationGeneration)=>Promise<T>):Promise<T>{
  const reference=Object.freeze({...expected});
  return this.transaction(async db=>{
   const current=await this.readLocked(db,'SHARE');
   assertEditorialAuthorizationGeneration(reference,current);
   return inspect(db,current);
  });
 }

 /** Only cooperating, trusted server writers. The callback may use DML on this connection, never transaction control. */
 advance(expected:EditorialAuthorizationGenerationRef,mutate:(db:ContextQueryClient)=>Promise<void>){
  const reference=Object.freeze({...expected});
  return this.transaction(async db=>{
   const current=await this.readLocked(db,'UPDATE');
   assertEditorialAuthorizationGeneration(reference,current);
   await mutate(db);
   const result=await db.query(`UPDATE editorial_authorization_generation SET revision=revision+1
    WHERE singleton AND domain_id=$1 AND revision=$2::bigint
    RETURNING domain_id,revision::text,authorization_state`,[current.domainId,current.revision]);
   if(result.rowCount!==1)return fail('editorial_generation_conflict');
   return generation(result);
  }).then(value=>{
   // A later observation may already have advanced the local floor. The
   // acknowledgement of this successful commit must still be returned.
   if(this.observed&&BigInt(value.revision)>BigInt(this.observed.revision))this.observed=value;
   return value;
  });
 }
}

import {createHash, randomUUID} from 'node:crypto';

/** Context is evidence owned by the host. No trust label grants authorization. */
export type ContextJson = null | boolean | number | string | ContextJson[] | {[key:string]:ContextJson};
export type ContextObject = {[key:string]:ContextJson};
export type ContextQueue = 'card_runs'|'card_ai_runs';
export type ContextScope = {runtimeId:string;projectId:string;workspaceId:string|null;actorId:string};
export type ContextSource = {
  schemaVersion:1;id:string;type:string;origin:string;logicalPath?:string;resourceId:string;ownerId:string;
  scope:ContextScope;version:string|null;contentHash:string|null;
  availability:'available'|'missing'|'unavailable'|'unverified';required:boolean;selectionReason:string;
  dependencies:string[];trust:'documental'|'host_policy'|'observation'|'historical'|'hypothesis'|'result';
  observedAt?:string;provenance?:ContextObject;
};
export type ContextManifestIdentity = ContextScope & {
  queue:ContextQueue;runId:string;cardId:string;cardRevision:number|null;executor:string;executionType:string;
};
export type ContextMaterial = {contextHash:string;promptHash:string};
export type CreateContextManifestInput = {
  identity:ContextManifestIdentity;sources:ContextSource[];configuration:ContextObject;
  git:ContextObject|null;checkout:ContextObject|null;assemblyPolicy:ContextJson;material:ContextMaterial;capturedAt?:string;
};
export type ContextManifest = CreateContextManifestInput & {
  schemaVersion:1;capturedAt:string;fingerprint:string;integrityHash:string;captureStatus:'captured'|'unverified';
};
export type ContextCompatibilityStatus = 'captured'|'unverified'|'compatible'|'changed'|'unavailable'|'legacy';
export type ContextCompatibility = {status:ContextCompatibilityStatus;changes:string[];reasons:string[]};
export type CurrentContextObservation = {
  sources:ContextSource[];configuration?:ContextObject;git?:ContextObject|null;checkout?:ContextObject|null;
  assemblyPolicy?:ContextJson;material?:ContextMaterial;identity?:ContextManifestIdentity;
};
export class ContextManifestError extends Error {
  constructor(message:string,readonly code='CONTEXT_MANIFEST_INVALID'){super(message);this.name='ContextManifestError'}
}

/** Reject lossy JSON coercions, accessors, custom prototypes and ambiguous cycles. */
export function canonicalContextJson(value:unknown):string {
  const visiting=new Set<object>();
  function encode(entry:unknown):string {
    if(entry===null)return 'null';
    if(typeof entry==='string'||typeof entry==='boolean')return JSON.stringify(entry);
    if(typeof entry==='number'&&Number.isFinite(entry))return JSON.stringify(entry);
    if(typeof entry!=='object')throw new ContextManifestError('O contexto contém um valor não JSON.');
    if(visiting.has(entry))throw new ContextManifestError('O contexto contém uma referência circular.');
    const prototype=Object.getPrototypeOf(entry);
    if(Array.isArray(entry)?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)throw new ContextManifestError('O contexto exige objetos JSON simples.');
    if(Object.getOwnPropertySymbols(entry).length)throw new ContextManifestError('Símbolos não são permitidos no contexto.');
    visiting.add(entry);
    try {
      const descriptors=Object.getOwnPropertyDescriptors(entry);
      if(Object.values(descriptors).some(item=>item.get||item.set))throw new ContextManifestError('Accessors não são permitidos no contexto.');
      if(Array.isArray(entry)) {
        const keys=Object.keys(entry);
        if(keys.length!==entry.length||keys.some((key,index)=>key!==String(index))||Object.keys(descriptors).some(key=>key!=='length'&&!keys.includes(key)))throw new ContextManifestError('Array esparso ou com propriedades extras no contexto.');
        return '['+keys.map(key=>encode(descriptors[key].value)).join(',')+']';
      }
      if(Object.values(descriptors).some(item=>!item.enumerable))throw new ContextManifestError('Propriedades ocultas não são permitidas no contexto.');
      return '{'+Object.keys(entry).sort().map(key=>JSON.stringify(key)+':'+encode((entry as Record<string,unknown>)[key])).join(',')+'}';
    } finally {visiting.delete(entry)}
  }
  return encode(value);
}
export const hashContextText=(value:string):string=>createHash('sha256').update(value,'utf8').digest('hex');
export const hashContextValue=(value:unknown):string=>hashContextText(canonicalContextJson(value));
const copy=<T>(value:T):T=>JSON.parse(canonicalContextJson(value));
function freeze<T>(value:T):T {if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value}
const text=(value:unknown)=>typeof value==='string'&&value.trim().length>0;
const sha256=/^[0-9a-f]{64}$/;
const operationalKeys=new Set(['observedAt','capturedAt','createdAt','updatedAt']);
function semantic(value:ContextJson):ContextJson {
  if(Array.isArray(value))return value.map(semantic);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!operationalKeys.has(key)).map(([key,entry])=>[key,semantic(entry)]));
  return value;
}
function semanticIdentity(identity:ContextManifestIdentity){return Object.fromEntries(Object.entries(identity).filter(([key])=>key!=='runId'))}
function sourceSemantic(source:ContextSource){return semantic(source as unknown as ContextJson)}
function scopeMatches(scope:ContextScope,identity:ContextScope){return ['runtimeId','projectId','workspaceId','actorId'].every(key=>scope[key as keyof ContextScope]===identity[key as keyof ContextScope])}
function validateIdentity(identity:ContextManifestIdentity){
  if(!identity||!['card_runs','card_ai_runs'].includes(identity.queue)||!['runId','cardId','projectId','actorId','runtimeId','executor','executionType'].every(key=>text(identity[key as keyof ContextManifestIdentity]))||!(identity.workspaceId===null||text(identity.workspaceId))||!(identity.cardRevision===null||Number.isSafeInteger(identity.cardRevision)&&identity.cardRevision>0))throw new ContextManifestError('Identidade de execução/contexto inválida.');
}
function validateSources(sources:ContextSource[],identity?:ContextScope,requireAvailable=false){
  if(!Array.isArray(sources))throw new ContextManifestError('Fontes de contexto devem ser uma lista.');
  const ids=new Set<string>();
  for(const source of sources){
    if(!source||source.schemaVersion!==1||!['id','type','origin','resourceId','ownerId','selectionReason'].every(key=>text(source[key as keyof ContextSource]))||typeof source.required!=='boolean'||!['available','missing','unavailable','unverified'].includes(source.availability)||!['documental','host_policy','observation','historical','hypothesis','result'].includes(source.trust)||!Array.isArray(source.dependencies)||source.dependencies.some(id=>!text(id))||new Set(source.dependencies).size!==source.dependencies.length||!(source.version===null||text(source.version))||!(source.contentHash===null||sha256.test(source.contentHash)))throw new ContextManifestError('Fonte de contexto inválida.');
    if(ids.has(source.id))throw new ContextManifestError('Identidade de fonte duplicada: '+source.id,'CONTEXT_SOURCE_AMBIGUOUS');
    ids.add(source.id);
    if(!source.scope||!['runtimeId','projectId','actorId'].every(key=>text(source.scope[key as keyof ContextScope]))||!(source.scope.workspaceId===null||text(source.scope.workspaceId)))throw new ContextManifestError('Escopo da fonte inválido.');
    if(identity&&!scopeMatches(source.scope,identity))throw new ContextManifestError('Fonte fora do escopo autorizado: '+source.id,'CONTEXT_SOURCE_SCOPE');
    if(requireAvailable&&source.required&&(source.availability!=='available'||!source.contentHash&&!source.version))throw new ContextManifestError('Fonte obrigatória não verificável: '+source.id,'CONTEXT_SOURCE_UNAVAILABLE');
  }
}
function fingerprintInput(input:CreateContextManifestInput){return {
  schemaVersion:1,identity:semanticIdentity(input.identity),sources:input.sources.map(sourceSemantic),
  configuration:input.configuration,git:semantic(input.git),checkout:semantic(input.checkout),
  assemblyPolicy:input.assemblyPolicy,material:input.material,
}}
function validateMaterial(material:ContextMaterial){if(!material||!sha256.test(material.contextHash)||!sha256.test(material.promptHash))throw new ContextManifestError('Hashes do material entregue inválidos.')}
function captureStatus(sources:ContextSource[]):'captured'|'unverified'{return sources.every(source=>!source.required&&source.availability==='missing'||source.availability==='available'&&(source.contentHash||source.version))?'captured':'unverified'}
export function createContextManifest(input:CreateContextManifestInput):ContextManifest {
  const snapshot=copy(input);validateIdentity(snapshot.identity);validateSources(snapshot.sources,snapshot.identity,true);
  validateMaterial(snapshot.material);
  const capturedAt=snapshot.capturedAt??new Date().toISOString();
  if(!Number.isFinite(Date.parse(capturedAt)))throw new ContextManifestError('Momento de captura inválido.');
  const payload={...snapshot,schemaVersion:1 as const,capturedAt,
    captureStatus:captureStatus(snapshot.sources),
    fingerprint:hashContextValue(fingerprintInput(snapshot))};
  return freeze({...payload,integrityHash:hashContextValue(payload)});
}
export function assertContextManifestIntegrity(manifest:ContextManifest):void {
  if(!manifest||manifest.schemaVersion!==1)throw new ContextManifestError('Schema de manifesto inválido.');
  const {integrityHash,...payload}=manifest;
  if(hashContextValue(payload)!==integrityHash||hashContextValue(fingerprintInput(manifest))!==manifest.fingerprint)throw new ContextManifestError('Integridade do manifesto não confere.','CONTEXT_MANIFEST_INTEGRITY');
  validateIdentity(manifest.identity);validateSources(manifest.sources,manifest.identity,true);
  validateMaterial(manifest.material);
  if(!Number.isFinite(Date.parse(manifest.capturedAt))||manifest.captureStatus!==captureStatus(manifest.sources))throw new ContextManifestError('Estado ou momento de captura inválido.');
}

/** Compares only selected dependencies. Extra unrelated sources are not freshness inputs. */
export function compareContextManifest(manifest:ContextManifest|null|undefined,current?:CurrentContextObservation):ContextCompatibility {
  if(!manifest)return {status:'legacy',changes:[],reasons:['Execução legada sem manifesto; compatibilidade não comprovada.']};
  try{assertContextManifestIntegrity(manifest)}catch{return {status:'unavailable',changes:['manifest:integrity'],reasons:['Integridade do manifesto não comprovada.']}}
  if(!current)return {status:'unverified',changes:[],reasons:['Fontes vigentes ainda não foram revalidadas.']};
  try{canonicalContextJson(current);validateSources(current.sources)}catch{return {status:'unavailable',changes:['sources:ambiguous'],reasons:['Fontes vigentes inválidas ou ambíguas.']}}
  const changes:string[]=[],reasons:string[]=[],byId=new Map(current.sources.map(source=>[source.id,source]));
  let unavailable=false,unverified=false;
  const selectedIds=new Set(manifest.sources.map(source=>source.id));
  const order=current.sources.filter(source=>selectedIds.has(source.id)).map(source=>source.id);
  if(canonicalContextJson(order)!==canonicalContextJson(manifest.sources.filter(source=>byId.has(source.id)).map(source=>source.id)))changes.push('sources:order');
  for(const captured of manifest.sources){
    const observed=byId.get(captured.id);
    if(!observed){changes.push('source:'+captured.id);reasons.push('Fonte selecionada ausente: '+captured.id);if(captured.required)unavailable=true;continue}
    if(!scopeMatches(observed.scope,manifest.identity)){unavailable=true;changes.push('source:'+captured.id+':scope');reasons.push('Escopo/autorização da fonte divergiu: '+captured.id);continue}
    if(observed.availability==='unverified'){unverified=true;reasons.push('Fonte selecionada ainda não verificada: '+captured.id);continue}
    if(captured.required&&observed.availability!=='available'){unavailable=true;reasons.push('Fonte obrigatória indisponível: '+captured.id)}
    if(observed.availability==='unavailable'||observed.availability==='available'&&!observed.contentHash&&!observed.version)unverified=true;
    if(canonicalContextJson(sourceSemantic(captured))!==canonicalContextJson(sourceSemantic(observed)))changes.push('source:'+captured.id);
  }
  if(current.identity&&canonicalContextJson(semanticIdentity(current.identity))!==canonicalContextJson(semanticIdentity(manifest.identity)))changes.push('identity');
  for(const key of ['configuration','git','checkout','assemblyPolicy','material'] as const){
    if(Object.prototype.hasOwnProperty.call(current,key)&&canonicalContextJson(key==='git'||key==='checkout'?semantic(current[key] as ContextJson):current[key])!==canonicalContextJson(key==='git'||key==='checkout'?semantic(manifest[key] as ContextJson):manifest[key]))changes.push(key);
  }
  if(unavailable)return {status:'unavailable',changes,reasons};
  if(changes.length)return {status:'changed',changes,reasons:[...reasons,'O contexto selecionado mudou; reconciliação necessária.']};
  if(unverified||manifest.captureStatus==='unverified')return {status:'unverified',changes,reasons:['Há fontes cuja validade não foi comprovada.']};
  return {status:'compatible',changes,reasons:['Fontes selecionadas compatíveis com esta observação; sem aprovação semântica.']};
}

// Structural adapters accept Db (rows) and a transaction PoolClient ({rows}).
// There are no runtime imports of pg, Db, providers, filesystem or executors.
export type ContextQueryRow=Record<string,unknown>;
export type ContextQueryResult={rows:ContextQueryRow[];command?:string;rowCount?:number|null};
export type ContextQueryResponse=ContextQueryRow[]|ContextQueryResult;
export type ContextQueryClient={query:(sql:string,parameters?:unknown[])=>Promise<ContextQueryResponse>};
export type ContextQueryResultClient=Omit<ContextQueryClient,'query'>&{query:(sql:string,parameters?:unknown[])=>Promise<ContextQueryResult>};
/** Tolerates legacy in-memory adapters used by deterministic fixtures. Production
 * PostgreSQL clients return the structured result object in ContextQueryResult. */
export function contextQueryRows(result:ContextQueryResponse):ContextQueryRow[]{
  if(Array.isArray(result))return result as unknown as ContextQueryRow[];
  return result.rows;
}
export type StoredContextManifest={id:string;queue:ContextQueue;runId:string;turn:number;parentId:string|null;manifest:ContextManifest;createdAt:string};
export type ContextManifestObservation={phase:string;compatibility:ContextCompatibility;delivery?:ContextObject;checkout?:ContextObject;observedAt?:string};
export type StoredContextVerification=ContextManifestObservation & {id:string;manifestId:string;observedAt:string};
async function rows(client:ContextQueryClient,sql:string,values:unknown[]=[]):Promise<ContextQueryRow[]>{return contextQueryRows(await client.query(sql,values))}
type ContextManifestDatabaseRow={id:string;queue:ContextQueue;run_id:string;turn:number;parent_id:string|null;manifest:ContextManifest|string;created_at:Date|string};
function stored(value:ContextQueryRow):StoredContextManifest {const row=value as unknown as ContextManifestDatabaseRow;return {id:row.id,queue:row.queue,runId:row.run_id,turn:row.turn,parentId:row.parent_id??null,manifest:freeze(typeof row.manifest==='string'?JSON.parse(row.manifest) as ContextManifest:row.manifest),createdAt:row.created_at instanceof Date?row.created_at.toISOString():String(row.created_at)}}
export class ContextManifestRepository {
  constructor(private readonly db:ContextQueryClient){}
  /** Caller owns the transaction joining this immutable record to the queued run. */
  async store(client:ContextQueryClient,manifest:ContextManifest,options:{parentId?:string}={}):Promise<StoredContextManifest>{
    assertContextManifestIntegrity(manifest);
    const identity=manifest.identity;
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['context-manifest:'+identity.queue+':'+identity.runId]);
    const previous=await rows(client,'SELECT * FROM context_run_manifests WHERE queue=$1 AND run_id=$2 ORDER BY turn DESC LIMIT 1',[identity.queue,identity.runId]);
    if(previous.length&&!options.parentId){const original=stored(previous[0]);if(original.turn!==0||original.manifest.fingerprint!==manifest.fingerprint)throw new ContextManifestError('O run já possui um contexto imutável diferente.','CONTEXT_MANIFEST_CONFLICT');return original}
    let turn=0;
    if(options.parentId){
      if(!previous.length||previous[0].id!==options.parentId)throw new ContextManifestError('A continuação exige o último manifesto do mesmo run.','CONTEXT_MANIFEST_PARENT');
      const parent=stored(previous[0]);
      if(canonicalContextJson(parent.manifest.identity)!==canonicalContextJson(identity))throw new ContextManifestError('A continuação alterou a identidade da execução.','CONTEXT_MANIFEST_PARENT');
      turn=parent.turn+1;
    }
    const result=await rows(client,`INSERT INTO context_run_manifests
      (id,queue,run_id,turn,parent_id,card_id,card_revision,project_id,workspace_id,actor_id,runtime_id,fingerprint,integrity_hash,manifest)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb) RETURNING *`,
      [randomUUID(),identity.queue,identity.runId,turn,options.parentId??null,identity.cardId,identity.cardRevision,identity.projectId,identity.workspaceId,identity.actorId,identity.runtimeId,manifest.fingerprint,manifest.integrityHash,canonicalContextJson(manifest)]);
    if(!result.length)throw new ContextManifestError('Manifesto não foi persistido.');return stored(result[0]);
  }
  async latest(queue:ContextQueue,runId:string):Promise<StoredContextManifest|null>{const result=await rows(this.db,'SELECT * FROM context_run_manifests WHERE queue=$1 AND run_id=$2 ORDER BY turn DESC LIMIT 1',[queue,runId]);return result.length?stored(result[0]):null}
  async get(id:string):Promise<StoredContextManifest|null>{const result=await rows(this.db,'SELECT * FROM context_run_manifests WHERE id=$1',[id]);return result.length?stored(result[0]):null}
  async observe(manifestId:string,observation:ContextManifestObservation):Promise<StoredContextVerification>{
    const snapshot=copy(observation);
    if(!text(snapshot.phase)||!['captured','unverified','compatible','changed','unavailable','legacy'].includes(snapshot.compatibility?.status)||!Array.isArray(snapshot.compatibility.changes)||!Array.isArray(snapshot.compatibility.reasons))throw new ContextManifestError('Observação de compatibilidade inválida.');
    const observedAt=snapshot.observedAt??new Date().toISOString();
    if(!Number.isFinite(Date.parse(observedAt)))throw new ContextManifestError('Momento da observação inválido.');
    const id=randomUUID();
    await this.db.query(`INSERT INTO context_manifest_verifications(id,manifest_id,phase,status,observation,observed_at)
      VALUES($1,$2,$3,$4,$5::jsonb,$6::timestamptz)`,[id,manifestId,snapshot.phase,snapshot.compatibility.status,canonicalContextJson({...snapshot,observedAt}),observedAt]);
    return freeze({...snapshot,id,manifestId,observedAt});
  }
  async history(manifestId:string):Promise<StoredContextVerification[]>{
    type VerificationDatabaseRow={observation:ContextManifestObservation|string;id:string;manifest_id:string;observed_at:Date|string};
    return (await rows(this.db,'SELECT * FROM context_manifest_verifications WHERE manifest_id=$1 ORDER BY observed_at,id',[manifestId])).map(value=>{const row=value as unknown as VerificationDatabaseRow,observation=typeof row.observation==='string'?JSON.parse(row.observation) as ContextManifestObservation:row.observation;return {...observation,id:row.id,manifestId:row.manifest_id,observedAt:row.observed_at instanceof Date?row.observed_at.toISOString():String(row.observed_at)}})
  }
}

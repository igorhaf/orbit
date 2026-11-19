import {randomUUID} from 'node:crypto';
import {canonicalContextJson,type ContextQueryClient,type ContextQueue} from './context-manifest';
import type {ContextBridgeAuditEvent} from './context-bridge';

/** Host-only binding. Neither the agent envelope nor a possession of an ID authorizes it. */
export type BridgeAuditBinding={
  bridgeId:string;manifestId:string;queue:ContextQueue;runId:string;turn:number;
  runtimeId:string;projectId:string;workspaceId:string|null;cardId:string;
  cardRevision:number|null;actorId:string;ownerId:string;contextFingerprint:string;
};
export type StoredBridgeAuditEvent={
  id:string;sequence:string;bridgeId:string;manifestId:string;
  contextFingerprint:string;event:ContextBridgeAuditEvent;recordedAt:string;
};
export class ContextBridgeAuditError extends Error{
  constructor(message:string){super(message);this.name='ContextBridgeAuditError'}
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha=/^[0-9a-f]{64}$/;
const code=/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;
const opaque=/^[A-Za-z0-9_-]{1,160}$/;
const phases=new Set(['bridge_created','request_received','authorized','response_prepared','response_emitted','delivery_unverified','denied','closed','revoked']);
const fields=new Set(['phase','requestId','capability','sourceId','sourceHash','sourceIdentityHash','sourceVersion','status','reason','responseHash','returnedBytes','chargedBytes','observedAt','knowledge']);
const clone=<T>(value:T):T=>JSON.parse(canonicalContextJson(value));
function bindingSnapshot(input:BridgeAuditBinding):BridgeAuditBinding{
  const binding=clone(input);
  if(!binding||!['card_runs','card_ai_runs'].includes(binding.queue)||!Number.isSafeInteger(binding.turn)||binding.turn<0||binding.turn>2147483647||!(binding.cardRevision===null||Number.isSafeInteger(binding.cardRevision)&&binding.cardRevision>0)||!sha.test(binding.contextFingerprint)||!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(binding.runtimeId))throw new ContextBridgeAuditError('Invalid bridge audit binding.');
  for(const key of ['bridgeId','manifestId','runId','projectId','cardId','actorId','ownerId'] as const){
    if(!uuid.test(binding[key]))throw new ContextBridgeAuditError('Invalid bridge audit identity.');
    binding[key]=binding[key].toLowerCase();
  }
  if(binding.workspaceId!==null){if(!uuid.test(binding.workspaceId))throw new ContextBridgeAuditError('Invalid bridge workspace identity.');binding.workspaceId=binding.workspaceId.toLowerCase();}
  if(Object.keys(binding).some(key=>!['bridgeId','manifestId','queue','runId','turn','runtimeId','projectId','workspaceId','cardId','cardRevision','actorId','ownerId','contextFingerprint'].includes(key)))throw new ContextBridgeAuditError('Unexpected bridge audit binding field.');
  return binding;
}
function knowledgeSnapshot(input:unknown):NonNullable<ContextBridgeAuditEvent['knowledge']>{
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ContextBridgeAuditError('Invalid bridge knowledge metadata.');
  const value=input as Record<string,unknown>;
  const required=['schemaVersion','queryHash','corpusHash','policy','found','returned','omitted','sources'],allowed=[...required,'remainingBytes'];
  if(required.some(key=>!Object.prototype.hasOwnProperty.call(value,key))||Object.keys(value).some(key=>!allowed.includes(key))||value.schemaVersion!==1||typeof value.queryHash!=='string'||!sha.test(value.queryHash)||typeof value.corpusHash!=='string'||!sha.test(value.corpusHash)||value.policy!=='orbit-lexical-retrieval/1'||!Array.isArray(value.sources))throw new ContextBridgeAuditError('Invalid bridge knowledge metadata.');
  for(const key of ['found','returned','omitted'])if(!Number.isSafeInteger(value[key])||Number(value[key])<0||Number(value[key])>(key==='returned'?6:256))throw new ContextBridgeAuditError('Invalid bridge knowledge count.');
  if(Number(value.returned)>Number(value.found)||Number(value.omitted)>Number(value.found)||value.sources.length>Number(value.returned)||Number(value.returned)>0&&value.sources.length===0)throw new ContextBridgeAuditError('Invalid bridge knowledge counts.');
  if(value.remainingBytes!==undefined&&(!Number.isSafeInteger(value.remainingBytes)||Number(value.remainingBytes)<0||Number(value.remainingBytes)>1000000))throw new ContextBridgeAuditError('Invalid bridge knowledge remaining byte estimate.');
  for(const item of value.sources){
    if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).sort().join()!==['sourceId','sourceIdentityHash','sourceHash','sourceVersion'].sort().join()||typeof item.sourceId!=='string'||!opaque.test(item.sourceId)||typeof item.sourceIdentityHash!=='string'||!sha.test(item.sourceIdentityHash)||!(item.sourceHash===null||typeof item.sourceHash==='string'&&sha.test(item.sourceHash))||!(item.sourceVersion===null||typeof item.sourceVersion==='string'&&(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(item.sourceVersion)||/^sha256:[0-9a-f]{64}$/.test(item.sourceVersion))))throw new ContextBridgeAuditError('Invalid bridge knowledge source metadata.');
  }
  return value as unknown as NonNullable<ContextBridgeAuditEvent['knowledge']>;
}
function eventSnapshot(input:ContextBridgeAuditEvent):ContextBridgeAuditEvent{
  const event=clone(input);
  if(!event||Object.keys(event).some(key=>!fields.has(key))||!phases.has(event.phase)||typeof event.observedAt!=='string'||event.observedAt.length>64||!Number.isFinite(Date.parse(event.observedAt)))throw new ContextBridgeAuditError('Invalid bridge audit event.');
  if(event.requestId!==undefined&&(typeof event.requestId!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(event.requestId)))throw new ContextBridgeAuditError('Invalid bridge audit request reference.');
  if(event.sourceId!==undefined&&(typeof event.sourceId!=='string'||!opaque.test(event.sourceId)))throw new ContextBridgeAuditError('Bridge audit source references must be opaque.');
  for(const key of ['capability','status','reason'] as const)if(event[key]!==undefined&&(typeof event[key]!=='string'||!code.test(event[key]!)))throw new ContextBridgeAuditError('Bridge audit accepts only bounded status codes.');
  for(const key of ['responseHash','sourceHash','sourceIdentityHash'] as const)if(event[key]!==undefined&&event[key]!==null&&(typeof event[key]!=='string'||!sha.test(event[key]!)))throw new ContextBridgeAuditError('Invalid bridge audit hash.');
  if(event.sourceVersion!==undefined&&event.sourceVersion!==null&&(typeof event.sourceVersion!=='string'||!(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(event.sourceVersion)||/^sha256:[0-9a-f]{64}$/.test(event.sourceVersion))))throw new ContextBridgeAuditError('Invalid bridge audit source version.');
  for(const key of ['returnedBytes','chargedBytes'] as const)if(event[key]!==undefined&&(!Number.isSafeInteger(event[key])||event[key]!<0||event[key]!>2147483647))throw new ContextBridgeAuditError('Invalid bridge audit byte count.');
  if(event.knowledge!==undefined){if(event.capability!=='knowledge.search')throw new ContextBridgeAuditError('Knowledge metadata requires its read-only capability.');event.knowledge=knowledgeSnapshot(event.knowledge);}
  return event;
}
async function rows(client:ContextQueryClient,sql:string,values:any[]=[]):Promise<any[]>{const result=await client.query(sql,values);return Array.isArray(result)?result:result.rows}
function record(row:any):StoredBridgeAuditEvent{
  const audit=typeof row.audit==='string'?JSON.parse(row.audit):row.audit;
  // Read back only the event allowlist. Do not export the private host owner/binding or SQL row.
  return {id:row.id,sequence:String(row.event_sequence),bridgeId:row.bridge_id,manifestId:row.manifest_id,contextFingerprint:row.context_fingerprint,event:eventSnapshot({...audit.event,...(row.knowledge_metadata!==undefined&&row.knowledge_metadata!==null?{knowledge:typeof row.knowledge_metadata==='string'?JSON.parse(row.knowledge_metadata):row.knowledge_metadata}:{})}),recordedAt:row.recorded_at instanceof Date?row.recorded_at.toISOString():String(row.recorded_at)};
}

/** Append-only query audit, deliberately separate from compatibility verifications04.
 * Resource authorization belongs to the host before append/history, never to this repository.
 * No response/request bodies, operational credential, socket path or arbitrary payload is accepted.
 */
export class ContextBridgeRepository{
  constructor(private readonly db:ContextQueryClient){}
  async assertKnowledgeSchema():Promise<void>{await rows(this.db,'SELECT knowledge_metadata FROM context_bridge_events LIMIT 0');}
  async append(input:BridgeAuditBinding,event:ContextBridgeAuditEvent):Promise<StoredBridgeAuditEvent>{
    const binding=bindingSnapshot(input),snapshot=eventSnapshot(event),id=randomUUID();
    const {knowledge,...legacyEvent}=snapshot;
    // Legacy five-capability events work with207 alone. Dynamic query evidence
    // requires208; missing schema must fail, never drop required metadata.
    const result=await rows(this.db,`INSERT INTO context_bridge_events
      (id,bridge_id,manifest_id,queue,run_id,turn,runtime_id,project_id,workspace_id,card_id,card_revision,actor_id,owner_id,context_fingerprint,phase,request_id,capability,source_ref,source_hash,source_version,status,reason,response_hash,returned_bytes,charged_bytes,observed_at,audit,source_identity_hash${knowledge===undefined?'':',knowledge_metadata'})
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26::timestamptz,$27::jsonb,$28${knowledge===undefined?'':',$29::jsonb'}) RETURNING *`,
    [id,binding.bridgeId,binding.manifestId,binding.queue,binding.runId,binding.turn,binding.runtimeId,binding.projectId,binding.workspaceId,binding.cardId,binding.cardRevision,binding.actorId,binding.ownerId,binding.contextFingerprint,snapshot.phase,snapshot.requestId??null,snapshot.capability??null,snapshot.sourceId??null,snapshot.sourceHash??null,snapshot.sourceVersion??null,snapshot.status??null,snapshot.reason??null,snapshot.responseHash??null,snapshot.returnedBytes??0,snapshot.chargedBytes??0,snapshot.observedAt,canonicalContextJson({schemaVersion:1,binding,event:legacyEvent}),snapshot.sourceIdentityHash??null,...(knowledge===undefined?[]:[canonicalContextJson(knowledge)])]);
    if(!result.length)throw new ContextBridgeAuditError('Bridge audit event was not persisted.');return record(result[0]);
  }
  async history(manifestId:string,limit=100):Promise<StoredBridgeAuditEvent[]>{
    if(!uuid.test(manifestId)||!Number.isSafeInteger(limit)||limit<1||limit>500)throw new ContextBridgeAuditError('Invalid bridge audit history query.');
    return (await rows(this.db,'SELECT * FROM context_bridge_events WHERE manifest_id=$1 ORDER BY event_sequence DESC LIMIT $2',[manifestId.toLowerCase(),limit])).map(record);
  }
}

import {assertContextManifestIntegrity,canonicalContextJson,hashContextValue,hashContextText,type ContextJson,type ContextObject,type ContextSource,type StoredContextManifest} from './context-manifest';
import {prepareKnowledgeCandidates,revalidateKnowledgeCandidates,knowledgePolicyForManifest,projectKnowledgeRetriever} from './knowledge-host';
import {knowledgeCandidateEvidence,type KnowledgeResult,type KnowledgeRetrievalPolicy} from './knowledge-retrieval';
import {ProjectRegistry,type Project} from './project-registry';

export type KnowledgeBridgePolicy={schemaVersion:1;maxQueryBytes:number;maxResults:number};
export type KnowledgeBridgeCallback={candidates:ContextSource[];search:(query:string,limit:number,signal:AbortSignal)=>Promise<KnowledgeResult>};
const sha=/^[0-9a-f]{64}$/;
const object=(v:unknown):v is ContextObject=>!!v&&typeof v==='object'&&!Array.isArray(v);
const clone=<T>(v:T):T=>JSON.parse(canonicalContextJson(v));
const retrieval=projectKnowledgeRetriever;

/** 07A already captured identities, versions, body/source hashes and origin/scope
 * identity hashes for every candidate. Older or incomplete evidence stays closed. */
export function assertKnowledgeBridgeMetadata(metadata:ContextJson|undefined):asserts metadata is ContextObject{
 if(!object(metadata)||metadata.schemaVersion!==1||!object(metadata.policy)||metadata.policy.id!=='orbit-lexical-retrieval/1'||!Array.isArray(metadata.considered)||!Number.isSafeInteger(metadata.candidateCount)||metadata.candidateCount!==metadata.considered.length||metadata.considered.length>60||!['catalogHash','catalogPolicyHash','corpusHash'].every(key=>typeof metadata[key]==='string'&&sha.test(metadata[key] as string)))throw new Error('Catálogo lexical capturado indisponível ou incompleto.');
 const ids=new Set<string>();
 for(const row of metadata.considered){if(!object(row)||typeof row.id!=='string'||!row.id||ids.has(row.id)||typeof row.version!=='string'||!row.version||typeof row.authorizationPolicy!=='string'||!row.authorizationPolicy||typeof row.trust!=='string'||!['documental','observation','historical','hypothesis','result'].includes(row.trust)||!['contentHash','bodyHash','sourceIdentityHash'].every(key=>typeof row[key]==='string'&&sha.test(row[key] as string)))throw new Error('Identidade histórica de candidato lexical inválida.');ids.add(row.id)}
}

export async function createKnowledgeBridgeCallback(options:{record:StoredContextManifest;projects:ProjectRegistry;project:Project;permissions:string[];authorize:(signal:AbortSignal)=>Promise<void>}):Promise<KnowledgeBridgeCallback>{
 const {record,projects,project}=options,identity=clone(record.manifest.identity),captured=clone(record.manifest.configuration.knowledgeRetrieval),fingerprint=record.manifest.fingerprint;
 assertContextManifestIntegrity(record.manifest);assertKnowledgeBridgeMetadata(captured);
 const policy=knowledgePolicyForManifest(record.manifest);if(!policy)throw new Error('A recuperação lexical não foi capturada.');
 const scope={runtimeId:identity.runtimeId,projectId:identity.projectId,workspaceId:identity.workspaceId,actorId:identity.actorId};
 const currentPolicy=()=>{const bridge=record.manifest.configuration.contextBridge;if(!object(bridge)||!object(bridge.knowledge)||bridge.knowledge.schemaVersion!==1||process.env.ORBIT_CONTEXT_BRIDGE_ENABLED!=='1'||process.env.ORBIT_CONTEXT_BRIDGE_KNOWLEDGE_ENABLED!=='1')throw new Error('A pesquisa lexical dinâmica não está autorizada no host.');assertContextManifestIntegrity(record.manifest);if(record.manifest.fingerprint!==fingerprint||canonicalContextJson(knowledgePolicyForManifest(record.manifest))!==canonicalContextJson(policy))throw new Error('Contexto ou política lexical mudou.');};
 const alive=(signal:AbortSignal)=>{if(signal.aborted)throw new Error('Consulta lexical revogada.');};
 const compatible=async(signal:AbortSignal)=>{
  alive(signal);await options.authorize(signal);alive(signal);currentPolicy();
  const host={projects,project,user:identity.actorId,workspaceId:identity.workspaceId,permissions:options.permissions,signal};
  const catalog=await prepareKnowledgeCandidates(host);alive(signal);
  const considered=catalog.candidates.map(knowledgeCandidateEvidence),corpusHash=hashContextValue({scope,policy,sources:considered});
  if(catalog.catalogHash!==captured.catalogHash||catalog.policyHash!==captured.catalogPolicyHash||canonicalContextJson(considered)!==canonicalContextJson(captured.considered)||corpusHash!==captured.corpusHash)throw new Error('O corpus lexical capturado mudou ou perdeu autorização.');
  await options.authorize(signal);alive(signal);return {catalog,host};
 };
 const initialController=new AbortController(),initial=await compatible(initialController.signal);
 return {candidates:initial.catalog.candidates.map(c=>clone(c.source)),async search(query,limit,signal){
  if(typeof query!=='string'||!query.trim()||Buffer.byteLength(query)>1024||!Number.isSafeInteger(limit)||limit<1||limit>3)throw new Error('Parâmetros de consulta lexical inválidos.');
  const {catalog,host}=await compatible(signal);
  const result=await retrieval.retrieve({identity,checkout:{approvedRootHash:hashContextText(project.root)},query:{text:query,fields:['dynamic_query'],cardId:identity.cardId,cardRevision:identity.cardRevision},candidates:catalog.candidates,policy:policy as KnowledgeRetrievalPolicy,signal,authorize:async candidate=>{
   alive(signal);await options.authorize(signal);alive(signal);
   const observed=await projects.revalidateSelection(project,identity.actorId,[candidate.source],{workspaceId:identity.workspaceId});alive(signal);
   const current=observed[0];if(!current)return false;
   const withoutObservation=(source:ContextSource)=>Object.fromEntries(Object.entries(source).filter(([key])=>key!=='observedAt'));
   const before=withoutObservation(candidate.source),after=withoutObservation(current);
   return canonicalContextJson(before)===canonicalContextJson(after);
  }});
  await revalidateKnowledgeCandidates(host,catalog);await compatible(signal);await options.authorize(signal);alive(signal);
  if(result.corpusHash!==captured.corpusHash)throw new Error('O corpus lexical divergiu durante a consulta.');
  // Keep the captured retrieval policy and result fingerprint intact. The broker
  // selects up to the requested presentation limit and accounts for omissions.
  return clone(result);
 }};
}

import {canonicalContextJson,hashContextText,hashContextValue,type ContextManifestIdentity,type ContextSource,type ContextObject} from './context-manifest';
import type {ContextCompileBlock} from './context-compiler';
import {lexicalWords,rankLexical,chunkLexical,lexicalAlgorithm} from './knowledge-lexical-loader';
export type KnowledgeCandidate={source:ContextSource;text:string;authorizationPolicy:string};
export type KnowledgeRetrievalPolicy={id:'orbit-lexical-retrieval/1';algorithm:'orbit-bm25/1';maxCandidates:number;maxDocumentBytes:number;maxCorpusBytes:number;chunkMaxBytes:number;maxChunks:number;maxResults:number;maxPerDocument:number};
export const defaultKnowledgeRetrievalPolicy=():KnowledgeRetrievalPolicy=>({id:'orbit-lexical-retrieval/1',algorithm:'orbit-bm25/1',maxCandidates:60,maxDocumentBytes:65536,maxCorpusBytes:1048576,chunkMaxBytes:6000,maxChunks:256,maxResults:6,maxPerDocument:2});
export function knowledgeQueryFromCard(card:{id:string;title:string;description:string;card_revision?:number|null},terms:string[]=[]){
 if(!Number.isSafeInteger(card.card_revision)||card.card_revision!<1||terms.length>32||terms.some(t=>typeof t!=='string'||t.length>256))throw new Error('Knowledge demand revision or terms unavailable.');
 const text=[card.title,card.description,...terms].join('\n');if(Buffer.byteLength(text)>65536)throw new Error('Knowledge query exceeds limit.');
 return {text,fields:['title','description',...(terms.length?['explicit_terms']:[])],cardRevision:card.card_revision!,cardId:card.id};
}
export type KnowledgeChunk={id:string;source:ContextSource;authorizationPolicy:string;documentHash:string;bodyHash:string;text:string;startLine:number;endLine:number;heading:string|null;score:number;rank:number};
export type KnowledgeResult={schemaVersion:1;algorithm:string;policy:KnowledgeRetrievalPolicy;corpusHash:string;queryId:string;queryHash:string;queryFields:string[];cardId:string;cardRevision:number|null;candidateCount:number;considered:ContextObject[];selected:KnowledgeChunk[];status:'matched'|'no_match'|'insufficient_corpus';fingerprint:string;limitations:string[];warnings:string[]};
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
function checkedPolicy(p:KnowledgeRetrievalPolicy){
 if(p.id!=='orbit-lexical-retrieval/1'||p.algorithm!=='orbit-bm25/1'||Object.keys(p).sort().join()!==Object.keys(defaultKnowledgeRetrievalPolicy()).sort().join())throw new Error('Invalid knowledge policy.');
 const max=defaultKnowledgeRetrievalPolicy();for(const k of ['maxCandidates','maxDocumentBytes','maxCorpusBytes','chunkMaxBytes','maxChunks','maxResults','maxPerDocument'] as const)if(!Number.isSafeInteger(p[k])||p[k]<1||p[k]>max[k])throw new Error('Invalid knowledge limits.');
 if(p.chunkMaxBytes<256)throw new Error('Knowledge chunk limit too small.');
}
export function knowledgeCandidateEvidence(c:KnowledgeCandidate):ContextObject{return {id:c.source.id,version:c.source.version,contentHash:c.source.contentHash,bodyHash:hashContextText(c.text),authorizationPolicy:c.authorizationPolicy,trust:c.source.trust,sourceIdentityHash:hashContextValue({id:c.source.id,type:c.source.type,origin:c.source.origin,resourceId:c.source.resourceId,logicalPath:c.source.logicalPath??null,scope:c.source.scope,ownerId:c.source.ownerId,provenance:c.source.provenance??null})};}
/** Reusable token/range cache only. Fresh authorized bodies are always required;
 * cache membership never grants access and no raw document is retained. */
export class ProjectKnowledgeRetriever {
 private cache=new Map<string,Map<string,{tokens:string[]}>>();
 clear(){this.cache.clear()}
 async retrieve(input:{identity:ContextManifestIdentity;query:{text:string;fields:string[];cardRevision:number|null;cardId?:string};candidates:KnowledgeCandidate[];policy:KnowledgeRetrievalPolicy;authorize:(candidate:KnowledgeCandidate)=>Promise<boolean>;signal?:AbortSignal;checkout?:ContextObject}):Promise<KnowledgeResult>{
 const {identity,query,policy,signal}=input;checkedPolicy(policy);const alive=()=>{if(signal?.aborted)throw new Error('Knowledge retrieval cancelled.')};alive();
 if(query.cardRevision!==identity.cardRevision||query.cardId!==undefined&&query.cardId!==identity.cardId||typeof query.text!=='string'||Buffer.byteLength(query.text)>65536)throw new Error('Knowledge demand binding mismatch.');
 const scope={runtimeId:identity.runtimeId,projectId:identity.projectId,workspaceId:identity.workspaceId,actorId:identity.actorId};
 const scopeKey=hashContextValue({scope,policy,checkout:input.checkout??null});if(this.cache.size>=64&&!this.cache.has(scopeKey))this.cache.delete(this.cache.keys().next().value!);
 const old=this.cache.get(scopeKey)??new Map(),next=new Map<string,{tokens:string[]}>();
 const candidates:KnowledgeCandidate[]=[];let volume=0;
 for(const candidate of input.candidates){alive();if(!await input.authorize(candidate))continue;alive();
  if(canonicalContextJson(candidate.source.scope)!==canonicalContextJson(scope)||candidate.source.ownerId!==identity.actorId||candidate.source.availability!=='available'||candidate.source.trust==='host_policy'||!candidate.source.contentHash||!candidate.source.version||typeof candidate.text!=='string'||!candidate.authorizationPolicy)throw new Error('Knowledge source unavailable or outside scope.');
  const size=Buffer.byteLength(candidate.text);volume+=size;if(size>policy.maxDocumentBytes||volume>policy.maxCorpusBytes||candidates.length>=policy.maxCandidates)throw new Error('Knowledge corpus exceeds limits.');
  candidates.push(candidate);
 }
 candidates.sort((a,b)=>compare(a.source.id,b.source.id));if(new Set(candidates.map(c=>c.source.id)).size!==candidates.length)throw new Error('Duplicate knowledge source identity.');
 const documents:Array<{id:string;text:string;label:string;tokens:string[];chunk:Omit<KnowledgeChunk,'rank'|'score'>}>=[],warnings:string[]=[];
 const considered=candidates.map(knowledgeCandidateEvidence);
 const corpusHash=hashContextValue({scope,policy,sources:considered});
 for(const c of candidates){const chunks=chunkLexical(c.text,{maxBytes:policy.chunkMaxBytes,maxChunks:policy.maxChunks});if(chunks.omissions.length)warnings.push('structural_blocks_omitted');
  for(const chunk of chunks.chunks){if(documents.length>=policy.maxChunks)throw new Error('Knowledge chunk corpus exceeds limits.');
   const bodyHash=hashContextText(chunk.text),id='knowledge:'+hashContextValue({sourceId:c.source.id,version:c.source.version,documentHash:c.source.contentHash,bodyHash,start:chunk.startLine,end:chunk.endLine});
   const label=c.source.logicalPath??c.source.resourceId;const key=hashContextValue({id,bodyHash,scope,label});
   const cached=old.get(key)??{tokens:lexicalWords(label+' '+chunk.text)};next.set(key,cached);
   documents.push({id,text:chunk.text,label,tokens:cached.tokens,chunk:{id,source:c.source,authorizationPolicy:c.authorizationPolicy,documentHash:c.source.contentHash!,bodyHash,text:chunk.text,startLine:chunk.startLine,endLine:chunk.endLine,heading:chunk.heading??null}});
  }
 }
 const equivalents=new Set<string>();const uniqueDocuments=documents.filter(d=>{const c=d.chunk,key=hashContextValue({body:c.bodyHash,version:c.source.version,origin:c.source.origin,trust:c.source.trust});if(equivalents.has(key))return false;equivalents.add(key);return true});
 const ranked=rankLexical(query.text,uniqueDocuments,{tieBreak:(a,b)=>compare(a.id,b.id)});const selected:KnowledgeChunk[]=[],perDoc=new Map<string,number>(),seen=new Set<string>();
 for(const row of ranked){const c=row.document.chunk,source=c.source;const duplicate=hashContextValue({body:c.bodyHash,version:source.version,origin:source.origin,trust:source.trust});if(seen.has(duplicate)||(perDoc.get(source.id)??0)>=policy.maxPerDocument)continue;
  const original=candidates.find(v=>v.source.id===source.id)!;alive();if(!await input.authorize(original))throw new Error('Knowledge authorization revoked during retrieval.');alive();
  selected.push({...c,score:row.score,rank:selected.length+1});seen.add(duplicate);perDoc.set(source.id,(perDoc.get(source.id)??0)+1);if(selected.length>=policy.maxResults)break;
 }
 alive();this.cache.set(scopeKey,next);
 const queryHash=hashContextValue({text:query.text,fields:query.fields,cardId:identity.cardId,cardRevision:query.cardRevision});
 const stable={schemaVersion:1 as const,algorithm:lexicalAlgorithm,policy,corpusHash,queryId:'knowledge-query:'+queryHash,queryHash,queryFields:query.fields,cardId:identity.cardId,cardRevision:query.cardRevision,candidateCount:candidates.length,considered,selected,status:!documents.length?'insufficient_corpus' as const:!selected.length?'no_match' as const:'matched' as const,limitations:['lexical_not_semantic','retrieved_data_not_instructions','not_complete_dependency_discovery'],warnings:[...new Set(warnings)]};
 const fingerprint=hashContextValue({...stable,selected:selected.map(item=>({...Object.fromEntries(Object.entries(item).filter(([key])=>key!=='source')),sourceId:item.source.id,sourceVersion:item.source.version}))});
 return JSON.parse(canonicalContextJson({...stable,fingerprint}));
 }
}
export function knowledgeCompileInputs(result:KnowledgeResult):{sources:ContextSource[];blocks:ContextCompileBlock[]}{
 const sources=[...new Map(result.selected.map(c=>[c.source.id,{...c.source,required:false,selectionReason:'lexical_retrieval_selected'}])).values()];
 const blocks:ContextCompileBlock[]=result.selected.map(c=>({id:c.id,section:'dependencies',sourceIds:[c.source.id],text:JSON.stringify({classification:c.source.trust==='hypothesis'?'hypothesis':c.source.trust==='historical'?'historical_result':c.source.trust==='observation'?'technical_observation':c.source.trust==='result'?'unapproved_result':'retrieved_reference_data',source:c.source.resourceId,version:c.source.version,documentHash:c.documentHash,chunkHash:c.bodyHash,startLine:c.startLine,endLine:c.endLine,trust:c.source.trust,text:c.text}),required:false,priority:'related',kind:'structured'}));
 return {sources,blocks};
}
export function knowledgeRetrievalMetadata(result:KnowledgeResult,compilation?:{decisions:ReadonlyArray<{blockId:string}>}):ContextObject{
 return JSON.parse(JSON.stringify({...result,selected:result.selected.map(item=>({...Object.fromEntries(Object.entries(item).filter(([key])=>!['text','source'].includes(key))),sourceId:item.source.id,sourceVersion:item.source.version,trust:item.source.trust})),...(compilation?{compilationDecisions:compilation.decisions.filter(d=>result.selected.some(c=>c.id===d.blockId))}:{})}));
}

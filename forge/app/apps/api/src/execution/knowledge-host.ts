import {canonicalContextJson,hashContextValue,hashContextText,type ContextManifest,type ContextObject,type ContextSource,type ContextManifestIdentity} from './context-manifest';
import {ProjectRegistry,type Project,stringList} from './project-registry';
import {redactContext} from './security';
import {compilerPolicyForManifest} from './context-compiler-host';
import type {ContextCompilerPolicy} from './context-compiler';
import {defaultKnowledgeRetrievalPolicy,type KnowledgeCandidate,type KnowledgeRetrievalPolicy,ProjectKnowledgeRetriever,knowledgeQueryFromCard,knowledgeCompileInputs,knowledgeRetrievalMetadata} from './knowledge-retrieval';

export type KnowledgeHostOptions={projects:ProjectRegistry;project:Project;user:string;workspaceId?:string|null;permissions:string[];signal?:AbortSignal};
export type KnowledgeCandidateCatalog={schemaVersion:1;policyId:'orbit-knowledge-catalog/1';policyHash:string;catalogHash:string;candidates:KnowledgeCandidate[]};
const active=(signal?:AbortSignal)=>{if(signal?.aborted)throw new Error('Preparação do conhecimento interrompida.');};
const semantic=(source:ContextSource)=>Object.fromEntries(Object.entries(source).filter(([key])=>key!=='observedAt'));
const forbidden=/(^|\/)(?:\.env(?:\..*)?|\.git|\.ssh|\.codex|\.next|data|backups?|sessions?|state|snapshots|dist|build|coverage|node_modules|cache|caches|logs?|\.cache|auth(?:\..*)?|credentials?(?:\..*)?|secrets?(?:\..*)?|[^/]*\.(?:pem|key|p12|pfx))(?:\/|$)/i;
function policy(project:Project){
 const raw=project.config.knowledge_retrieval;
 if(raw===undefined)return {schemaVersion:1,id:'orbit-knowledge-catalog/1',documents:[] as string[],files:[] as string[]};
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!['documents','files'].includes(k)))throw new Error('Catálogo de conhecimento inválido.');
 const value=raw as Record<string,unknown>,documents=stringList(value.documents,'knowledge_retrieval.documents').sort(),files=stringList(value.files,'knowledge_retrieval.files').sort();
 for(const document of documents)if(!/^(knowledge|rules|skills)\/[a-z][a-z0-9_-]{0,79}$/.test(document))throw new Error('Documento de recuperação inválido.');
 for(const file of files)if(/(?:^|\/)\.orbit\/(?:local|validations)(?:\/|$)/i.test(file)||!/\.(md|mdx|txt|rst|ts|tsx|js|jsx|mjs|cjs|json|yaml|yml|sql|css)$/i.test(file)||file.startsWith('/')||file.includes('\\')||file.split('/').some(p=>p==='..'||p==='.'||!p)||forbidden.test(file)||file.split('').some(character=>'*?[]{}'.includes(character)))throw new Error('Arquivo de recuperação reservado ou inválido.');
 return {schemaVersion:1,id:'orbit-knowledge-catalog/1',documents,files};
}

/** Host configuration only. A project file or request cannot opt the service in. */
export function knowledgePolicyFromHost(compilerPolicy:ContextCompilerPolicy|null|undefined,env:NodeJS.ProcessEnv=process.env):KnowledgeRetrievalPolicy|null{
 const enabled=env.ORBIT_KNOWLEDGE_RETRIEVAL_ENABLED;
 if(enabled===undefined||enabled==='0')return null;
 if(enabled!=='1')throw new Error('Ativação da recuperação lexical inválida no host.');
 if(!compilerPolicy)throw new Error('A recuperação lexical exige o Context Compiler.');
 return defaultKnowledgeRetrievalPolicy();
}
/** Legacy stays legacy. Captured retrieval requires the current host policy. */
export function knowledgePolicyForManifest(manifest:ContextManifest|null,env:NodeJS.ProcessEnv=process.env):KnowledgeRetrievalPolicy|null{
 const captured=manifest?.configuration.knowledgeRetrieval;
 if(captured===undefined)return null;
 if(!captured||typeof captured!=='object'||Array.isArray(captured)||captured.schemaVersion!==1||!captured.policy||typeof captured.policy!=='object'||Array.isArray(captured.policy))throw new Error('Contrato de recuperação capturado inválido.');
 const current=knowledgePolicyFromHost(compilerPolicyForManifest(manifest,env),env);
 if(!current||canonicalContextJson(current)!==canonicalContextJson(captured.policy))throw new Error('A política de recuperação do host mudou; reconciliação necessária.');
 return current;
}

/** Candidate discovery is a bounded, explicit allowlist, independent of which
 * documents were previously added to the prompt. No glob or tree walk occurs. */
export async function prepareKnowledgeCandidates(options:KnowledgeHostOptions):Promise<KnowledgeCandidateCatalog>{
 const {projects,project,user,signal}=options,scope={workspaceId:options.workspaceId??null};active(signal);
 await projects.revalidateSelection(project,user,[],scope);active(signal);
 const configured=policy(project),policyHash=hashContextValue(configured),candidates:KnowledgeCandidate[]=[];
 for(const reference of configured.documents){
  active(signal);const [kind,id]=reference.split('/') as ['knowledge'|'rules'|'skills',string],document=await projects.document(project,kind,id);active(signal);
  const required=stringList(document.metadata.permissions,'permissions');
  // Unauthorized resources affect neither result bodies nor public counts.
  if(required.some(permission=>!options.permissions.includes(permission)))continue;
  const source={...projects.documentSource(project,document,user,scope,'knowledge_candidate'),version:'sha256:'+document.hash,required:false,trust:'documental' as const,selectionReason:'knowledge_retrieval_candidate'};
  candidates.push({source,text:redactContext(document.body),authorizationPolicy:configured.id+':'+policyHash});
 }
 if(options.permissions.includes('filesystem.read'))for(const path of configured.files){
  active(signal);const selected=await projects.fileSource(project,path,user,scope,{required:false,type:'reference',selectionReason:'knowledge_retrieval_candidate'});active(signal);
  if(selected.text===null)throw new Error('Arquivo configurado para recuperação indisponível.');
  candidates.push({source:{...selected.source,version:'sha256:'+String(selected.source.provenance?.rawHash)},text:redactContext(selected.text),authorizationPolicy:configured.id+':'+policyHash});
 }
 const ordered=candidates.sort((a,b)=>a.source.id<b.source.id?-1:a.source.id>b.source.id?1:0);
 if(new Set(ordered.map(c=>c.source.id)).size!==ordered.length)throw new Error('Candidato de conhecimento ambíguo.');
 await projects.configurationSource(project,user,scope);active(signal);
 const observed=await projects.revalidateSelection(project,user,ordered.map(c=>c.source),scope);active(signal);
 if(canonicalContextJson(observed.map(semantic))!==canonicalContextJson(ordered.map(c=>semantic(c.source))))throw new Error('Uma fonte candidata mudou durante a preparação do conhecimento.');
 return {schemaVersion:1,policyId:'orbit-knowledge-catalog/1',policyHash,catalogHash:hashContextValue({policyHash,sources:ordered.map(c=>({source:semantic(c.source),authorizationPolicy:c.authorizationPolicy}))}),candidates:ordered};
}
/** Rebuild only the explicit catalog to reauthorize both selected and omitted
 * candidates. A corpus change may change ranking and cannot update an old run. */
export async function revalidateKnowledgeCandidates(options:KnowledgeHostOptions,catalog:KnowledgeCandidateCatalog):Promise<void>{
 const current=await prepareKnowledgeCandidates(options);
 if(current.policyHash!==catalog.policyHash||current.catalogHash!==catalog.catalogHash)throw new Error('O corpus de conhecimento mudou ou perdeu autorização.');
}

export const projectKnowledgeRetriever=new ProjectKnowledgeRetriever();
const retrieval=projectKnowledgeRetriever;
/** Host composition seam shared by the two queues. No model, provider or MCP is required. */
export async function prepareProjectKnowledge(options:KnowledgeHostOptions&{scope:ContextManifestIdentity;compilerPolicy:ContextCompilerPolicy|null;policy:KnowledgeRetrievalPolicy;card:{id:string;title:string;description:string;card_revision?:number|null}}){
 if(!options.compilerPolicy)throw new Error('A recuperação lexical exige o Context Compiler.');
 if(options.scope.actorId!==options.user||options.scope.projectId!==options.project.id||options.scope.cardId!==options.card.id||options.scope.cardRevision!==options.card.card_revision)throw new Error('Identidade da demanda de conhecimento incompatível.');
 if(canonicalContextJson(knowledgePolicyFromHost(options.compilerPolicy))!==canonicalContextJson(options.policy))throw new Error('A política de recuperação do host mudou durante a preparação.');
 const host={...options,workspaceId:options.scope.workspaceId};
 const catalog=await prepareKnowledgeCandidates(host);
 const result=await retrieval.retrieve({identity:options.scope,checkout:{approvedRootHash:hashContextText(options.project.root)},query:knowledgeQueryFromCard(options.card),candidates:catalog.candidates,policy:options.policy,signal:options.signal,authorize:async candidate=>{
  active(options.signal);
  const observed=await options.projects.revalidateSelection(options.project,options.user,[candidate.source],{workspaceId:options.scope.workspaceId});
  active(options.signal);
  return canonicalContextJson(observed.map(semantic))===canonicalContextJson([semantic(candidate.source)]);
 }});
 await revalidateKnowledgeCandidates(host,catalog);
 const inputs=knowledgeCompileInputs(result);
 return {...inputs,result,metadata:{...knowledgeRetrievalMetadata(result),catalogPolicyHash:catalog.policyHash,catalogHash:catalog.catalogHash} as ContextObject};
}

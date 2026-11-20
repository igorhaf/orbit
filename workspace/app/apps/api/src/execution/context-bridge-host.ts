import {relative,resolve,dirname,join} from 'node:path';
import {realpath,stat,lstat,readFile} from 'node:fs/promises';
import {ContextBridge,contextBridgeProtocol,bridgeKnowledgeAuditMetadata,type ContextBridgeLimits,type ContextBridgeAuditEvent} from './context-bridge';
import {ContextBridgeAdapter} from './context-bridge-adapter';
import {ContextBridgeRepository} from './context-bridge-repository';
import {ContextManifestRepository,assertContextManifestIntegrity,canonicalContextJson,hashContextValue,type ContextObject,type ContextJson,type ContextSource,type StoredContextManifest,type ContextManifest,type ContextQueryClient} from './context-manifest';
import {compilerPolicyForManifest} from './context-compiler-host';
import type {ContextCompilerPolicy} from './context-compiler';
import {ProjectRegistry,type Project} from './project-registry';
import {relevantPluginSources,contextTechnicalState} from './context-runtime';
import type {PluginRegistry} from './registries';
import {currentWorkspaceWriteLease,assertWorkspaceWriteCoverage,type WorkspaceWriteLease} from './workspace-coordinator';
import {bindActiveIsolatedCheckout} from './isolated-checkout';
import {currentIsolatedExecution} from './isolated-execution-policy';
import {redact,redactContext} from './security';
import {emptyConfig} from './types';
import {validateConfig} from './config';
import {orbitContextRuntime} from '../orbit-architecture';
import {assertKnowledgeBridgeMetadata,createKnowledgeBridgeCallback,type KnowledgeBridgePolicy} from './knowledge-bridge';
import {knowledgePolicyFromHost,knowledgePolicyForManifest} from './knowledge-host';

export type ContextBridgeHostPolicy={schemaVersion:1;protocol:typeof contextBridgeProtocol;transport:'local-bound-adapter';codexIntegration:'not_homologated';limits:ContextBridgeLimits;knowledge?:KnowledgeBridgePolicy};
export type ContextBridgeExecutorHandle={descriptor:ContextObject;exchange:(request:unknown)=>Promise<unknown>;signal:AbortSignal};
const object=(value:unknown):value is ContextObject=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
/** Same host-env opt-in convention as03B/05, never a prompt-controlled flag. */
export function contextBridgePolicyFromHost(compilation:ContextJson|undefined,env:NodeJS.ProcessEnv=process.env,knowledgeMetadata?:ContextJson):ContextBridgeHostPolicy|null{
  const dynamic=env.ORBIT_CONTEXT_BRIDGE_KNOWLEDGE_ENABLED;
  if(dynamic!==undefined&&dynamic!=='0'&&dynamic!=='1')throw new Error('Ativação da busca lexical no Bridge inválida no host.');
  if(env.ORBIT_CONTEXT_BRIDGE_ENABLED===undefined||env.ORBIT_CONTEXT_BRIDGE_ENABLED==='0'){if(dynamic==='1')throw new Error('Busca lexical dinâmica exige Context Bridge habilitado.');return null;}
  if(env.ORBIT_CONTEXT_BRIDGE_ENABLED!=='1')throw new Error('Ativação do Context Bridge inválida no host.');
  if(!object(compilation)||compilation.schemaVersion!==1||compilation.status!=='ready'||!object(compilation.policy)||compilation.policy.id!=='orbit-context-compiler/1'||!object(compilation.policy.budget))throw new Error('O Bridge exige contexto compilado verificável.');
  const policy=compilation.policy as unknown as ContextCompilerPolicy;
  const reserved=Math.floor(policy.budget.reservedExternalTokens/2);
  const limits:ContextBridgeLimits={maxRequests:16,maxResponseBytes:4096,maxTotalBytes:Math.min(10000,reserved),requestTimeoutMs:2000,maxConcurrent:1,maxSources:64,maxDependencyDepth:8,maxRequestBytes:4096};
  const knobs:Record<string,keyof ContextBridgeLimits>={MAX_REQUESTS:'maxRequests',MAX_RESPONSE_BYTES:'maxResponseBytes',MAX_TOTAL_BYTES:'maxTotalBytes',REQUEST_TIMEOUT_MS:'requestTimeoutMs',MAX_CONCURRENT:'maxConcurrent',MAX_SOURCES:'maxSources',MAX_DEPENDENCY_DEPTH:'maxDependencyDepth',MAX_REQUEST_BYTES:'maxRequestBytes'};
  for(const [suffix,key] of Object.entries(knobs)){
    const raw=env['ORBIT_CONTEXT_BRIDGE_'+suffix];if(raw===undefined)continue;
    if(!/^[1-9]\d*$/.test(raw)||!Number.isSafeInteger(Number(raw)))throw new Error('Limite do Bridge inválido no host.');limits[key]=Number(raw);
  }
  if(limits.maxRequests>128||limits.maxResponseBytes<1024||limits.maxResponseBytes>65536||limits.maxTotalBytes<limits.maxResponseBytes+256||limits.maxTotalBytes>reserved||limits.requestTimeoutMs>30000||limits.maxConcurrent>8||limits.maxSources>256||limits.maxDependencyDepth>8||limits.maxRequestBytes!>16384)throw new Error('O orçamento do Bridge não cabe na reserva do compilador.');
  let knowledge:KnowledgeBridgePolicy|undefined;
  if(dynamic==='1'){
    assertKnowledgeBridgeMetadata(knowledgeMetadata);
    const lexical=knowledgePolicyFromHost(policy,env);
    if(!lexical||canonicalContextJson(lexical)!==canonicalContextJson(knowledgeMetadata.policy))throw new Error('A busca dinâmica exige recuperação lexical capturada e compatível.');
    knowledge={schemaVersion:1,maxQueryBytes:1024,maxResults:3};
  }
  return {schemaVersion:1,protocol:contextBridgeProtocol,transport:'local-bound-adapter',codexIntegration:'not_homologated',limits,...(knowledge?{knowledge}:{})};
}
export function contextBridgePolicyForManifest(manifest:ContextManifest|null,env:NodeJS.ProcessEnv=process.env):ContextBridgeHostPolicy|null{
  const captured=manifest?.configuration.contextBridge;
  if(captured===undefined)return null;
  const hasKnowledge=object(captured)&&captured.knowledge!==undefined;
  // Existing five-capability bindings stay unchanged when a later host flag turns on.
  const effectiveEnv=hasKnowledge?env:{...env,ORBIT_CONTEXT_BRIDGE_KNOWLEDGE_ENABLED:'0'};
  if(hasKnowledge&&!knowledgePolicyForManifest(manifest,env))throw new Error('Recuperação lexical histórica indisponível.');
  const current=contextBridgePolicyFromHost(manifest!.configuration.contextCompilation,effectiveEnv,manifest!.configuration.knowledgeRetrieval);
  if(!current||canonicalContextJson(current)!==canonicalContextJson(captured))throw new Error('O vínculo ou a política do Bridge mudou; reconciliação necessária.');
  return current;
}
export function bridgeConfiguration(configuration:ContextObject,policy:ContextBridgeHostPolicy|null):ContextObject{
  const rest={...configuration};delete rest.contextBridge;return policy?{...rest,contextBridge:policy as unknown as ContextObject}:rest;
}

/** Watch the captured local HEAD/ref without spawning a subprocess per query.
 * Shared worktree pointers remain unsupported; they do not authorize metadata reads elsewhere. */
async function localGitSeal(root:string,git:ContextObject|null):Promise<string>{
 if(!git||!['observed','unborn','not_applicable'].includes(String(git.status)))throw new Error('Estado Git não verificável para Bridge.');
 const reference=git.reference;
 for(let parent=root;;parent=dirname(parent)){
  const marker=join(parent,'.git');let entry;
  try{entry=await lstat(marker)}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(entry){
   if(git.status==='not_applicable')throw new Error('A identidade Git mudou.');
   if(!entry.isDirectory()||entry.isSymbolicLink())throw new Error('Layout Git sem contrato local de Bridge homologado.');
   const base=await realpath(marker);
   const read=async(path:string)=>{try{const target=await realpath(join(base,path)),rel=relative(base,target);if(rel==='..'||rel.startsWith('../'))throw new Error('Metadado Git fora da área autorizada.');const info=await lstat(target);if(!info.isFile()||info.size>65536)throw new Error('Metadado Git indisponível.');return await readFile(target,'utf8')}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error}};
   const ref=typeof reference==='string'?reference:null;
   if(ref&&(!/^refs\/[A-Za-z0-9._/-]+$/.test(ref)||ref.includes('..')))throw new Error('Referência Git inválida.');
   const head=await read('HEAD'),loose=ref?await read(ref):null;
   let packed:string|null=null;if(ref&&!loose){const lines=(await read('packed-refs')??'').split('\n');packed=lines.find(line=>line.endsWith(' '+ref))??null;}
   const observedCommit=ref?(loose?.trim()??packed?.split(' ')[0]??null):head?.trim();
   if(ref&&head?.trim()!=='ref: '+ref||git.status==='observed'&&observedCommit!==git.baseCommit||git.status==='unborn'&&observedCommit!==null)throw new Error('A base Git mudou durante a vinculação.');
   return hashContextValue({marker:{dev:entry.dev,ino:entry.ino},head,loose,packed});
  }
  if(parent===dirname(parent)){if(git.status!=='not_applicable')throw new Error('Raiz Git indisponível.');return hashContextValue({git:'not_applicable'});}
 }
}

type CurrentCard={id:string;card_revision:number;workspace_id?:string|null;title:string|null;description:string|null};
export type OpenContextBridgeInput={db:ContextQueryClient;projects:ProjectRegistry;plugins:PluginRegistry;record:StoredContextManifest;project:Project;lease:WorkspaceWriteLease;workerId:string;signal:AbortSignal;card:()=>Promise<CurrentCard>};
/** Host-only authorization/observation. The adapter receives only a bound exchange closure. */
export async function openContextBridge(input:OpenContextBridgeInput){
  const {db,projects,plugins,record,project,lease}=input,manifest=record.manifest,identity=manifest.identity;
  const policy=contextBridgePolicyForManifest(manifest);
  if(!policy)throw new Error('Bridge não foi capturado para esta execução.');
  compilerPolicyForManifest(manifest);assertContextManifestIntegrity(manifest);
  const isolated=currentIsolatedExecution();
  if(identity.runtimeId!==orbitContextRuntime)throw new Error('Bridge fora do runtime autorizado.');
  const originalRoot=await realpath(project.authorizationRoot||project.root),root=await realpath(project.root),inode=await stat(root);
  let verifyCheckout:()=>Promise<void>;
  if(isolated||manifest.checkout?.mode==='isolated'){
    // Only in-process Core queries in an actively managed03B checkout. This does
    // not provision MCP, authorize UDS in the provider sandbox or change CLI guards.
    if(!policy.knowledge||!isolated||manifest.checkout?.mode!=='isolated'||manifest.git?.status!=='pinned'||isolated.root!==root||isolated.queue!==record.queue||isolated.runId!==record.runId||isolated.cardRevision!==identity.cardRevision||isolated.baseCommit!==manifest.git.baseCommit||currentWorkspaceWriteLease()!==lease)throw new Error('Bridge isolado exige vínculo lexical e checkout gerenciado ativo.');
    await lease.assertActive();await assertWorkspaceWriteCoverage(root);
    verifyCheckout=await bindActiveIsolatedCheckout(db,{queue:record.queue,runId:record.runId,projectId:identity.projectId,cardId:identity.cardId,cardRevision:identity.cardRevision,workspaceId:identity.workspaceId,root,authorizedProjectRoot:originalRoot,baseCommit:isolated.baseCommit,sourceIdentity:manifest.checkout.sourceIdentity});
  }else{
    const technicalAtOpen=await contextTechnicalState(root);
    if(hashContextValue(technicalAtOpen.git)!==hashContextValue(manifest.git)||hashContextValue(technicalAtOpen.checkout)!==hashContextValue(manifest.checkout))throw new Error('A base Git ou identidade do checkout mudou.');
    const gitSeal=await localGitSeal(root,manifest.git);
    verifyCheckout=async()=>{if(await localGitSeal(root,manifest.git)!==gitSeal)throw new Error('A referência Git ou identidade do checkout mudou.');};
  }
  const bounded=async<T>(operation:Promise<T>):Promise<T>=>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Prazo do Bridge expirou.')),policy.limits.requestTimeoutMs)})])}finally{if(timer)clearTimeout(timer)}};
  const repository=new ContextBridgeRepository(db),manifests=new ContextManifestRepository(db),scope={workspaceId:identity.workspaceId??undefined};
  const signal=AbortSignal.any([input.signal,lease.signal]);
  let knowledgePermissions:string[]=[];
  const authorize=async(operationSignal:AbortSignal)=>{
    if(signal.aborted||operationSignal.aborted)throw new Error('Bridge revogado.');
    await lease.assertActive();compilerPolicyForManifest(manifest);contextBridgePolicyForManifest(manifest);assertContextManifestIntegrity(manifest);
    const row=(await db.query(`SELECT user_id,project_id,card_id,status,worker_id,card_revision${record.queue==='card_runs'?',cancel_requested':''} FROM ${record.queue} WHERE id=$1`,[record.runId]));
    const active=(Array.isArray(row)?row:row.rows)[0];
    if(!active||active.status!=='running'||active.worker_id!==input.workerId||active.user_id!==identity.actorId||active.project_id!==identity.projectId||active.card_id!==identity.cardId||active.card_revision!==identity.cardRevision||active.cancel_requested===true)throw new Error('Execução não está ativa ou perdeu ownership.');
    const card=await input.card();if(card.id!==identity.cardId||card.card_revision!==identity.cardRevision||(card.workspace_id??null)!==identity.workspaceId)throw new Error('Revisão ou autorização do cartão mudou.');
    const configRows=await db.query('SELECT * FROM card_execution_configs WHERE card_id=$1',[identity.cardId]);
    const configRow=(Array.isArray(configRows)?configRows:configRows.rows)[0];
    knowledgePermissions=Array.isArray(configRow?.permissions)?configRow.permissions.filter((p:unknown):p is string=>typeof p==='string'):[];
    if(typeof manifest.configuration.executionConfigHash==='string'){
      const currentConfig=configRow?validateConfig(JSON.parse(canonicalContextJson(Object.fromEntries(Object.keys(emptyConfig()).map(key=>[key,configRow[key]]))))):emptyConfig();
      const effective={...currentConfig,executor:currentConfig.executor||manifest.identity.executor};
      if(hashContextValue(effective)!==manifest.configuration.executionConfigHash)throw new Error('As permissões ou configurações de execução mudaram.');
    }
    const promptControls=manifest.sources.find(source=>source.id==='prompt:controls');
    if(promptControls){
      const controls=Object.fromEntries(Object.entries(card as CurrentCard & Record<string,unknown>).filter(([key])=>!['title','description','card_revision'].includes(key)));
      const flagsRows=await db.query('SELECT is_internal_orbit FROM ai_projects WHERE id=$1 AND owner_id=$2',[identity.projectId,identity.actorId]);
      const flags=(Array.isArray(flagsRows)?flagsRows:flagsRows.rows)[0];if(!flags)throw new Error('Projeto não autorizado.');
      const controlsHash=hashContextValue({controls,skillConfig:configRow?{skills:configRow.skills,agent:configRow.agent}:null,scope:configRow?{context:configRow.context,permissions:configRow.permissions}:null,projectInternal:flags.is_internal_orbit??false});
      if(controlsHash!==promptControls.contentHash)throw new Error('As permissões ou controles do prompt mudaram.');
    }
    const authorized=isolated?await (async()=>{
      // Current project ownership/configuration are checked at the authorized
      // source root without opening its document bodies. Retrieval itself stays
      // exclusively on the approved worktree, including its captured catalog.
      await projects.revalidateSelection(project,identity.actorId,[],scope);
      await projects.configurationSource({...project,authorizationRoot:undefined,root:originalRoot,resourcesRoot:resolve(originalRoot,relative(root,project.resourcesRoot))},identity.actorId,scope);
      return {...project,root:originalRoot};
    })():await projects.get(identity.projectId,identity.actorId);
    if(await realpath(authorized.root)!==originalRoot)throw new Error('Projeto perdeu autorização.');
    const capturedProjectHash=manifest.sources.find(source=>source.id==='project:configuration')?.provenance?.effectiveHash;
    if(typeof capturedProjectHash==='string'&&capturedProjectHash!==hashContextValue(authorized.config))throw new Error('As regras ou permissões do projeto mudaram.');
    await verifyCheckout();
    const currentRoot=await realpath(project.root),currentInode=await stat(currentRoot);
    if(currentRoot!==root||currentInode.dev!==inode.dev||currentInode.ino!==inode.ino)throw new Error('Checkout mudou.');
    const latest=await manifests.latest(record.queue,record.runId);
    if(!latest||latest.id!==record.id||latest.turn!==record.turn||latest.manifest.fingerprint!==manifest.fingerprint)throw new Error('Manifesto ou turno mudou.');
    assertContextManifestIntegrity(latest.manifest);
    const dependencies=relevantPluginSources(identity,plugins,manifest.sources.filter(source=>source.origin==='plugin_registry').map(source=>source.resourceId.replace(/^plugin:/,'')));
    if(dependencies.some(source=>source.availability!=='available'))throw new Error('Dependência de plugin indisponível.');
    if(signal.aborted||operationSignal.aborted)throw new Error('Bridge revogado.');await lease.assertActive();
  };
  const selectedProject=()=>({...project,root,authorizationRoot:originalRoot,resourcesRoot:resolve(root,relative(project.root,project.resourcesRoot))});
  const observe=async(sources:ContextSource[],operationSignal:AbortSignal)=>{
    await authorize(operationSignal);
    const selected=await projects.revalidateSelection(selectedProject(),identity.actorId,sources,scope);
    const pluginSources=relevantPluginSources(identity,plugins,sources.filter(source=>source.origin==='plugin_registry').map(source=>source.resourceId.replace(/^plugin:/,''))),byId=new Map(pluginSources.map(source=>[source.id,source]));
    return {sources:selected.map(source=>byId.get(source.id)??source)}; // Deliberately partial: no false global compatibility.
  };
  const read=async(source:ContextSource,operationSignal:AbortSignal)=>{
    await authorize(operationSignal);let observed:ContextSource,text:string;
    if(source.origin==='project_file'&&source.logicalPath&&source.type!=='configuration'){
      const file=await projects.fileSource(selectedProject(),source.logicalPath,identity.actorId,scope,{required:source.required,type:source.type,selectionReason:source.selectionReason});
      if(file.text===null)throw new Error('Fonte indisponível.');observed=file.source;text=redactContext(file.text);
    }else if(source.origin==='project_document'&&['agents','skills','rules','knowledge'].includes(source.type)){
      const prefix=source.type+'/',id=source.resourceId.startsWith(prefix)?source.resourceId.slice(prefix.length):'';
      const document=await projects.document(selectedProject(),source.type as 'skills',id);
      observed=projects.documentSource(selectedProject(),document,identity.actorId,scope,source.selectionReason);text=redactContext(document.body);
    }else if(source.origin==='card'||source.origin==='linked_card'){
      const rows=await db.query(`SELECT c.id,c.title,c.description,c.card_revision,b.workspace_id FROM cards c JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id JOIN authorized_board_members m ON m.board_id=b.id WHERE c.id=$1 AND m.user_id=$2 AND b.closed_at IS NULL AND c.archived_at IS NULL AND l.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM vault_items v WHERE v.card_id=c.id)`,[source.resourceId,identity.actorId]);
      const card=(Array.isArray(rows)?rows:rows.rows)[0] as CurrentCard|undefined;if(!card||(card.workspace_id??null)!==identity.workspaceId)throw new Error('Fonte indisponível.');
      const title=typeof card.title==='string'?card.title:'',description=typeof card.description==='string'?card.description:'';
      observed={...source,version:String(card.card_revision),contentHash:hashContextValue({title:redact(title),description:redact(description)}),availability:'available'};text=redactContext(JSON.stringify({title,description}));
    }else throw new Error('Fonte sem contrato de leitura.');
    observed={...observed,required:source.required,...(source.version?.startsWith('sha256:')?{version:'sha256:'+String(observed.provenance?.rawHash)}:{})};
    await projects.assertSelectionUnchanged(selectedProject(),identity.actorId,[observed],scope);await authorize(operationSignal);
    return {source:observed,text};
  };
  await bounded(authorize(signal));if(signal.aborted)throw new Error('Bridge cancelado antes de ativar.');
  if(policy.knowledge||manifest.sources.some(source=>source.version?.startsWith('sha256:')))await bounded(repository.assertKnowledgeSchema());
  const knowledge=policy.knowledge?await bounded(createKnowledgeBridgeCallback({record,projects,project:selectedProject(),permissions:[...knowledgePermissions],authorize})):undefined;
  const audit=(event:ContextBridgeAuditEvent):Promise<void>=>bounded(repository.append({bridgeId:bridge.binding.bridgeId,manifestId:record.id,queue:record.queue,runId:record.runId,turn:record.turn,runtimeId:identity.runtimeId,projectId:identity.projectId,workspaceId:identity.workspaceId,cardId:identity.cardId,cardRevision:identity.cardRevision,actorId:identity.actorId,ownerId:lease.owner,contextFingerprint:manifest.fingerprint},event)).then(()=>undefined);
  const bridge:ContextBridge=new ContextBridge({record,ownerId:lease.owner,limits:policy.limits,signal,authorize,observe,read,
    readableSourceIds:manifest.sources.filter(source=>(source.origin==='project_file'&&source.type!=='configuration'||source.origin==='project_document'&&['agents','skills','rules','knowledge'].includes(source.type)||source.origin==='card'||source.origin==='linked_card')&&source.availability==='available'&&source.provenance?.selectionOnly!==true).map(source=>source.id),
    ...(knowledge?{knowledge:{policy:policy.knowledge!,...knowledge}}:{}),audit});
  try{await audit({phase:'bridge_created',status:'active',observedAt:new Date().toISOString()});}
  catch(error){await bridge.close('audit_unavailable').catch(()=>undefined);throw error;}
  const transportSignal=AbortSignal.any([signal,bridge.signal]);
  const adapter=new ContextBridgeAdapter({knowledge:policy.knowledge,capabilities:bridge.descriptor().capabilities as string[],query:async request=>{try{const response=await bridge.query(request);await audit({phase:'response_emitted',requestId:response.requestId,capability:response.capability,status:response.status,responseHash:response.contentHash,returnedBytes:response.returnedBytes,chargedBytes:response.returnedBytes+256,...(bridgeKnowledgeAuditMetadata(response)?{knowledge:bridgeKnowledgeAuditMetadata(response)}:{}),observedAt:new Date().toISOString()});await authorize(transportSignal);return response;}catch(error){await bridge.revoke('adapter_or_authorization_failure').catch(()=>undefined);throw error;}},close:reason=>bridge.close(reason),signal:transportSignal},{maxFrameBytes:policy.limits.maxRequestBytes,maxResponseBytes:policy.limits.maxResponseBytes+256,maxPendingRequests:policy.limits.maxConcurrent,maxMessages:policy.limits.maxRequests+2,maxTransportBytes:policy.limits.maxTotalBytes});
  const handle:ContextBridgeExecutorHandle={descriptor:bridge.descriptor() as unknown as ContextObject,exchange:request=>adapter.handleJsonRpc(request),signal:transportSignal};
  return {handle,close:async(reason='run_finished')=>{await adapter.close(reason)},summary:()=>bridge.summary()};
}

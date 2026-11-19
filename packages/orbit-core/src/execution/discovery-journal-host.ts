import {realpath,stat} from 'node:fs/promises';
import {relative,resolve} from 'node:path';
import {orbitContextRuntime} from '../orbit-architecture';
import {ContextManifestRepository,assertContextManifestIntegrity,hashContextValue,type ContextQueryClient,type StoredContextManifest,type ContextSource} from './context-manifest';
import {DiscoveryJournal,discoveryArtifacts,discoveryIngestionReviewed,type DiscoveryCaptureReceipt} from './discovery-journal';
import {DiscoveryJournalRepository,type DiscoveryReadFilter} from './discovery-journal-repository';
import {type Project,ProjectRegistry} from './project-registry';
import {currentWorkspaceWriteLease,assertWorkspaceWriteCoverage,type WorkspaceWriteLease} from './workspace-coordinator';
import {currentIsolatedExecution} from './isolated-execution-policy';
import {bindActiveIsolatedCheckout} from './isolated-checkout';

type CaptureInput={db:ContextQueryClient;projects:ProjectRegistry;record:StoredContextManifest|null;project:Project;lease:WorkspaceWriteLease;workerId:string;signal:AbortSignal;output:unknown;authorizeCard:()=>Promise<{id:string;card_revision:number;workspace_id?:string|null}>};
const rows=async(db:ContextQueryClient,sql:string,p:any[])=>{const r=await db.query(sql,p);return Array.isArray(r)?r:r.rows};
/** An internal host hook, not a write API. Failures are capture receipts and never
 * rewrite the executor's technical output or its lifecycle status. */
async function captureProtectedDiscoveries(input:CaptureInput):Promise<DiscoveryCaptureReceipt[]>{
 const receipt=(state:DiscoveryCaptureReceipt['state'],code?:string):DiscoveryCaptureReceipt=>({schemaVersion:1,state,proposalCount:0,...(code?{code}:{}),artifactAvailability:'host_observed_not_durable',semanticApproval:false});
 const {record,db,project,lease,signal,projects}=input;
 if(!record?.manifest.configuration.discoveryJournal)return [receipt('disabled')];
 try{
  const artifacts=discoveryArtifacts(record.queue,input.output);if(!artifacts.length)return [receipt('absent')];if(artifacts.length>1)return [receipt('rejected','discovery_single_envelope_required')];
  const i=record.manifest.identity;
  if(i.runtimeId!==orbitContextRuntime||project.id!==i.projectId||currentWorkspaceWriteLease()!==lease)throw Error('scope');
  const root=await realpath(project.root),originalRoot=await realpath(project.authorizationRoot||project.root),ino=await stat(root);
  const isolated=currentIsolatedExecution();let verifyCheckout:()=>Promise<void>=async()=>{};
  if(isolated||record.manifest.checkout?.mode==='isolated'){
   if(!isolated||isolated.root!==root||isolated.runId!==record.runId||isolated.queue!==record.queue||isolated.cardRevision!==i.cardRevision||isolated.baseCommit!==record.manifest.git?.baseCommit)throw Error('checkout');
   verifyCheckout=await bindActiveIsolatedCheckout(db,{queue:record.queue,runId:record.runId,cardId:i.cardId,cardRevision:i.cardRevision!,projectId:i.projectId,workspaceId:i.workspaceId,root,authorizedProjectRoot:originalRoot,baseCommit:isolated.baseCommit,sourceIdentity:record.manifest.checkout!.sourceIdentity});
  }
  const authorize=async()=>{
   if(signal.aborted)throw Error('cancelled');await lease.assertActive();await assertWorkspaceWriteCoverage(root);assertContextManifestIntegrity(record.manifest);
   const card=await input.authorizeCard();if(card.id!==i.cardId||card.card_revision!==i.cardRevision||(card.workspace_id??null)!==i.workspaceId)throw Error('card');
   await projects.revalidateSelection(project,i.actorId,[],{workspaceId:i.workspaceId});
   await projects.configurationSource({...project,authorizationRoot:undefined,root:originalRoot,resourcesRoot:resolve(originalRoot,relative(root,project.resourcesRoot))},i.actorId,{workspaceId:i.workspaceId});
   const active=(await rows(db,`SELECT user_id,project_id,card_id,status,worker_id,card_revision${record.queue==='card_runs'?',cancel_requested':''} FROM ${record.queue} WHERE id=$1`,[record.runId]))[0];
   if(!active||active.status!=='running'||active.worker_id!==input.workerId||active.user_id!==i.actorId||active.project_id!==i.projectId||active.card_id!==i.cardId||active.card_revision!==i.cardRevision||active.cancel_requested===true)throw Error('run');
   const latest=await new ContextManifestRepository(db).latest(record.queue,record.runId);if(!latest||latest.id!==record.id||latest.turn!==record.turn||latest.manifest.fingerprint!==record.manifest.fingerprint)throw Error('manifest');
   const physical=await stat(await realpath(project.root));if(physical.dev!==ino.dev||physical.ino!==ino.ino||await realpath(project.root)!==root)throw Error('root');await verifyCheckout();await lease.assertActive();if(signal.aborted)throw Error('cancelled');
  };
  const observe=async(source:ContextSource)=>{
   await authorize();if(!['project_file','project_document'].includes(source.origin))return null;
   const observed=await projects.revalidateSelection(project,i.actorId,[source],{workspaceId:i.workspaceId});await authorize();return observed[0]??null;
  };
  const journal=new DiscoveryJournal(new DiscoveryJournalRepository(db));
  return [await journal.capture({record,workerId:input.workerId,runtimeId:orbitContextRuntime,signal,authorize,observe},artifacts[0])];
 }catch{return [receipt('pending','discovery_capture_pending')]}
}
/** The caller already authorized card membership, project ownership, runtime and
 * run actor. Every request is reauthorized before this method; no global list. */
export async function readExecutionDiscoveries(db:ContextQueryClient,record:StoredContextManifest,actorId:string,filter:DiscoveryReadFilter={}){
 const i=record.manifest.identity;
 if(i.runtimeId!==orbitContextRuntime||i.actorId!==actorId)throw Error('discovery_read_forbidden');
 const repository=new DiscoveryJournalRepository(db),records=await repository.list({runtimeId:i.runtimeId,projectId:i.projectId,workspaceId:i.workspaceId,actorId,queue:record.queue,runId:record.runId,cardId:i.cardId},filter);
 const counts:Record<string,number>={};for(const r of records)counts[r.category]=(counts[r.category]??0)+1;
 const result=await rows(db,record.queue==='card_runs'?"SELECT metadata->'discovery_capture' AS discovery_capture FROM card_runs WHERE id=$1 AND user_id=$2":"SELECT discovery_capture FROM card_ai_runs WHERE id=$1 AND user_id=$2",[record.runId,actorId]);
 const observed=result[0]?.discovery_capture;
 const latestCapture=observed&&observed.schemaVersion===1&&Array.isArray(observed.receipts)?{schemaVersion:1,manifestId:typeof observed.manifestId==='string'&&/^[0-9a-f-]{36}$/.test(observed.manifestId)?observed.manifestId:null,turn:Number.isSafeInteger(observed.turn)?observed.turn:null,receipts:observed.receipts.slice(0,1).map((r:any)=>({state:['disabled','absent','empty','persisted','duplicate','rejected','pending'].includes(r.state)?r.state:'pending',proposalCount:Number.isSafeInteger(r.proposalCount)&&r.proposalCount>=0&&r.proposalCount<=8?r.proposalCount:0,code:typeof r.code==='string'&&/^discovery_[a-z0-9_]{1,64}$/.test(r.code)?r.code:undefined,semanticApproval:false})),scope:'last_host_receipt_not_global_history'}:{state:'unavailable_or_not_recorded'};

 return {schemaVersion:1,latestCapture,records:records.map(r=>({...r,statement:discoveryIngestionReviewed(i.projectId,r.artifactHash)?r.statement:null,statementVisibility:discoveryIngestionReviewed(i.projectId,r.artifactHash)?'reviewed_for_ingestion_not_semantically_approved':'withheld_pending_authorized_review',evidence:r.evidence.map(e=>({...e,state:'historical_reference',recordedState:e.state,availability:'not_revalidated'})),semanticApproval:false})),countsByCategory:counts,countsScope:'returned_page_only',limit:filter.limit??50,offset:filter.offset??0,hasMore:records.length===(filter.limit??50),state:'proposed',compatibility:'historical_not_revalidated',approvalWorkflow:'not_implemented'};
}

export async function captureExecutionDiscoveries(input:CaptureInput):Promise<DiscoveryCaptureReceipt[]>{
 const receipts=await captureProtectedDiscoveries(input);
 if(input.record?.manifest.configuration.discoveryJournal){
  const value={schemaVersion:1,manifestId:input.record.id,turn:input.record.turn,receipts};
  try{const sql=input.record.queue==='card_runs'?"UPDATE card_runs SET metadata=jsonb_set(metadata,'{discovery_capture}',$2::jsonb) WHERE id=$1 AND worker_id=$3 AND status='running'":"UPDATE card_ai_runs SET discovery_capture=$2::jsonb WHERE id=$1 AND worker_id=$3 AND status='running'";await input.db.query(sql,[input.record.runId,JSON.stringify(value),input.workerId])}catch{console.error('Discovery capture receipt persistence unavailable.');}
 }
 return receipts;
}

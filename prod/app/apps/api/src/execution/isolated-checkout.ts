import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {access,lstat,mkdir,open,readFile,readlink,realpath,rename,stat,statfs} from 'node:fs/promises';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {runManagedProcess} from './managed-process';
import {currentWorkspaceWriteLease,withWorkspaceWriteLease,WorkspaceWriteLease} from './workspace-coordinator';
import type {ContextQueryClient} from './context-manifest';

/** Checkout identity belongs to the host/Core, never to an agent's prompt. */
export type IsolatedCheckoutRequest={
  version:1;mode:'isolated';projectId:string;workspaceId?:string;sourceRoot:string;repositoryRoot:string;
  projectSubdirectory:string;commonDir:string;reference:string;branch:string|null;baseCommit:string;
  sourceIdentity:PhysicalIdentity;repositoryIdentity:PhysicalIdentity;commonIdentity:PhysicalIdentity;capturedAt:string;
};
export type PhysicalIdentity={dev:number;ino:number};
export type IsolatedCheckoutIdentity={queue:'card_runs'|'card_ai_runs';runId:string;cardId:string;cardRevision:number|null;projectId:string;authorizedProjectRoot:string;workspaceId?:string;request:IsolatedCheckoutRequest;signal?:AbortSignal;continuation?:boolean;onState?:(state:string)=>void};
export type IsolatedCheckoutState='preparing'|'ready'|'running'|'ended'|'awaiting_answer'|'preserved'|'blocked'|'quarantined'|'discard_eligible';
export type IsolatedCheckout={id:string;root:string;worktreeRoot:string;runDirectory:string;owner:string;baseCommit:string;deferForAnswer():void};
export type IsolatedCheckoutEvidence={baseCommit:string;headCommit:string;initialStatus:'clean'|'preserved_continuation';statusPorcelain:string;statusEncoding:'nul-escaped';changes:{path:string;previousPath?:string;indexStatus:string;worktreeStatus:string;kind:string}[];untracked:{path:string;sha256:string;size:number;type:string}[];artifact:{path:string;sha256:string;size:number};fingerprint:string;executorStatus:string;integration:'not_integrated';attribution:'executor_and_auxiliary_tools_unseparated';capturedAt:string};
type Database=Parameters<typeof withWorkspaceWriteLease>[0]&{query:(sql:string,parameters?:any[])=>Promise<any[]>};
type Project={id:string;root:string;workspace_id?:string};
type StoredIdentity={version:1;queue:string;runId:string;cardId:string;cardRevision:number|null;projectId:string;workspaceId?:string;request:IsolatedCheckoutRequest;owner:string;runDirectory:string;worktreeRoot:string;root:string;worktreeIdentity?:PhysicalIdentity;rootIdentity?:PhysicalIdentity;storageIdentity:PhysicalIdentity;runDirectoryIdentity?:PhysicalIdentity;gitDirectory?:string;gitDirectoryIdentity?:PhysicalIdentity;gitPointerHash?:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha=/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const stable=(value:unknown):string=>JSON.stringify(value,(_key,entry)=>entry&&typeof entry==='object'&&!Array.isArray(entry)?Object.fromEntries(Object.entries(entry).sort(([a],[b])=>a.localeCompare(b))):entry);
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const contains=(parent:string,child:string)=>{const value=relative(parent,child);return value===''||value!=='..'&&!value.startsWith('../')&&!isAbsolute(value)};
const OUTPUT_LIMIT=4*1024*1024;
const gitEnvironment:NodeJS.ProcessEnv={PATH:'/usr/bin:/bin',HOME:'/nonexistent',LANG:'C.UTF-8',LC_ALL:'C.UTF-8',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0',GIT_ATTR_NOSYSTEM:'1',GIT_LFS_SKIP_SMUDGE:'1',GIT_NO_REPLACE_OBJECTS:'1'};
const gitOptions=['--no-pager','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-c','diff.external=','-c','core.attributesFile=/dev/null'];
export class IsolatedCheckoutError extends Error{constructor(message:string,readonly code='ISOLATED_CHECKOUT_BLOCKED'){super(message);this.name='IsolatedCheckoutError'}}
function requireHost(){if(process.env.ORBIT_ISOLATED_RUNS!=='1')throw new IsolatedCheckoutError('Execução isolada não foi habilitada explicitamente pelo host.','ISOLATION_DISABLED');if(process.platform!=='linux'||!process.getuid)throw new IsolatedCheckoutError('Worktrees isoladas exigem o coordenador Linux homologado.');}
async function physical(path:string):Promise<PhysicalIdentity>{const info=await stat(path);if(!info.isDirectory()||info.uid!==process.getuid?.())throw new IsolatedCheckoutError('Diretório deve pertencer ao usuário do host.');return {dev:info.dev,ino:info.ino};}
function same(a:PhysicalIdentity,b:PhysicalIdentity){return a.dev===b.dev&&a.ino===b.ino;}
async function assertIdentity(path:string,expected:PhysicalIdentity){if(await realpath(path)!==path||!same(await physical(path),expected))throw new IsolatedCheckoutError('A identidade física do checkout ou dos metadados Git mudou.','ISOLATED_IDENTITY_CHANGED');}
async function git(cwd:string,args:string[],signal?:AbortSignal,allowedCodes:number[]=[0]){const result=await runManagedProcess('/usr/bin/git',[...gitOptions,'-C',cwd,...args],{cwd:currentWorkspaceWriteLease()?.resource||cwd,timeoutMs:30000,maxOutputBytes:OUTPUT_LIMIT,signal,env:gitEnvironment});if(!allowedCodes.includes(result.code??-1)||result.signal)throw new IsolatedCheckoutError(`Git não concluiu a operação segura ${args[0]} (código ${result.code}).`);if(result.stdout.includes('\ufffd'))throw new IsolatedCheckoutError('Saída Git contém bytes UTF-8 não verificáveis; evidência exata indisponível.');if(Buffer.byteLength(result.stdout)>=OUTPUT_LIMIT||Buffer.byteLength(result.stderr)>=OUTPUT_LIMIT)throw new IsolatedCheckoutError('A evidência Git excede o limite de captura; checkout preservado sem aprovação.');return result;}
function safePathName(path:string){if(!path||path.includes('\u0000')||path.includes('\ufffd')||isAbsolute(path)||path.split('/').some(part=>part==='..'||part==='.'||part===''))throw new IsolatedCheckoutError('Nome de arquivo Git ambíguo ou fora do checkout.');return path;}
async function storageMountSafety(path:string){
  const supported=new Set([0xef53,0x58465342,0x9123683e,0x01021994,0x794c7630]);if(!supported.has(Number((await statfs(path)).type)>>>0))throw new IsolatedCheckoutError('Filesystem do storage não homologado para coordenação local.');
  const unescape=(value:string)=>value.replace(/\\([0-7]{3})/g,(_,n)=>String.fromCharCode(parseInt(n,8)));
  const mounts=(await readFile('/proc/self/mountinfo','utf8')).trim().split('\n').map(line=>{const fields=line.split(' ');return {root:unescape(fields[3]),point:unescape(fields[4])}});
  const parents=mounts.filter(mount=>contains(mount.point,path)).sort((a,b)=>b.point.length-a.point.length);
  if(!parents.length||parents[0].root!=='/'||mounts.some(mount=>mount.point!==path&&contains(path,mount.point)))throw new IsolatedCheckoutError('Storage com bind mount ou mount aninhado não possui identidade homologada.');
}
async function storageRoot(source:string){const configured=process.env.ORBIT_WORKTREE_ROOT;if(!configured||!isAbsolute(configured)||configured!==resolve(configured))throw new IsolatedCheckoutError('Configure ORBIT_WORKTREE_ROOT absoluto, físico e privado antes da execução.');const actual=await realpath(configured);const info=await lstat(configured);if(actual!==configured||info.isSymbolicLink()||!info.isDirectory()||info.uid!==process.getuid?.()||(info.mode&0o077)!==0||contains(source,actual)||contains(actual,source))throw new IsolatedCheckoutError('Armazenamento de worktrees deve ser privado (0700), pertencente ao host e separado do checkout original.');await storageMountSafety(actual);await access(actual,constants.R_OK|constants.W_OK|constants.X_OK);const disk=await statfs(actual);if(BigInt(disk.bavail)*BigInt(disk.bsize)<64n*1024n*1024n)throw new IsolatedCheckoutError('Espaço insuficiente: exige-se pelo menos 64 MiB livres antes da preparação.');return {path:actual,identity:await physical(actual)};}
async function indexSafety(root:string){
  const indexFlags=(await git(root,['ls-files','-v','-z'])).stdout.split('\0').filter(Boolean);if(indexFlags.some(entry=>entry[0]==='S'||/[a-z]/.test(entry[0])))throw new IsolatedCheckoutError('Índice com assume-unchanged ou skip-worktree impede provar uma árvore limpa.');
  const indexPath=resolve(root,(await git(root,['rev-parse','--git-path','index'])).stdout.trim());const indexInfo=await lstat(indexPath);if(indexInfo.isSymbolicLink()||!indexInfo.isFile()||indexInfo.uid!==process.getuid?.())throw new IsolatedCheckoutError('Índice Git não é um arquivo local regular autorizado.');
}
async function pointerHash(root:string){const path=join(root,'.git');const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const value=await handle.stat();if(!value.isFile()||value.uid!==process.getuid?.()||value.size>65536)throw new IsolatedCheckoutError('Ponteiro Git da worktree não é arquivo regular autorizado.');return hash(await handle.readFile())}finally{await handle.close()}}
async function repositorySafety(root:string,commit:string){
  const keys=(await git(root,['config','--local','--name-only','--get-regexp','.*'],undefined,[0,1])).stdout.split('\n').filter(Boolean);
  if(keys.some(key=>/^(filter\.|include\.|includeif\.|extensions\.|core\.(?:worktree|alternateRefsCommand|sparseCheckout|sparseCheckoutCone)|submodule\.)/i.test(key)))throw new IsolatedCheckoutError('Configuração Git local exige revisão explícita (filters/includes/extensions/submodules não são provisionados).');
  await indexSafety(root);
  const gitEntry=await lstat(join(root,'.git'));if(gitEntry.isSymbolicLink()||gitEntry.uid!==process.getuid?.()||(!gitEntry.isFile()&&!gitEntry.isDirectory()))throw new IsolatedCheckoutError('Raiz Git original possui ponteiro físico inseguro.');
  const gitDirValue=(await git(root,['rev-parse','--absolute-git-dir'])).stdout.trim();const gitDir=await realpath(gitDirValue);
  for(const marker of ['MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','REBASE_HEAD','BISECT_LOG','rebase-merge','rebase-apply','sequencer','index.lock']){try{await lstat(join(gitDir,marker));throw new IsolatedCheckoutError(`Operação Git incompleta: ${marker}.`)}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}}
  const common=await realpath(resolve(root,(await git(root,['rev-parse','--git-common-dir'])).stdout.trim()));
  for(const file of [join(common,'objects/info/alternates'),join(common,'shallow'),join(common,'commondir')]){try{await lstat(file);throw new IsolatedCheckoutError('Objetos Git externos, shallow ou common-dir ambíguo exigem preparação explícita.')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}}
  const entries=(await git(root,['ls-tree','-r','-z',commit])).stdout.split('\0').filter(Boolean);
  if(entries.length>50000)throw new IsolatedCheckoutError('Árvore acima do limite conservador de 50 mil arquivos.');
  for(const entry of entries){const match=/^(\d+) (\w+) ([0-9a-f]+)\t([\s\S]+)$/.exec(entry);if(!match)throw new IsolatedCheckoutError('Árvore Git inválida.');const [,mode,type,object,path]=match;safePathName(path);if(type!=='blob'||mode==='160000')throw new IsolatedCheckoutError('Submódulos não possuem provisioning isolado nesta etapa.');if(/(?:^|\/)(?:\.env(?:\..*)?|id_rsa|id_ed25519|credentials(?:\.json)?|[^/]+\.(?:pem|p12|pfx|key))$/i.test(path)&&!/(?:example|sample|template)$/i.test(path))throw new IsolatedCheckoutError(`Arquivo sensível rastreado exige revisão antes de criar checkout: ${path}.`);
    if(mode==='120000'){const target=(await git(root,['cat-file','blob',object])).stdout;if(isAbsolute(target)||!contains(root,resolve(dirname(join(root,path)),target)))throw new IsolatedCheckoutError(`Symlink rastreado sai da árvore: ${path}.`);}
  }
}
async function sourceSnapshot(project:Project,reference='HEAD'):Promise<IsolatedCheckoutRequest>{
  requireHost();if(!uuid.test(project.id)||(project.workspace_id!==undefined&&!uuid.test(project.workspace_id)))throw new IsolatedCheckoutError('Identidade de projeto/workspace inválida.');
  if(reference!=='HEAD'&&!/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(reference))throw new IsolatedCheckoutError('Use HEAD ou uma referência local completa e validada.');
  const sourceRoot=await realpath(project.root);const repositoryRoot=await realpath((await git(sourceRoot,['rev-parse','--show-toplevel'])).stdout.trim());
  if(!contains(repositoryRoot,sourceRoot)||(await git(repositoryRoot,['rev-parse','--is-bare-repository'])).stdout.trim()!=='false')throw new IsolatedCheckoutError('Projeto não é um checkout Git físico válido.');
  if(reference!=='HEAD')await git(repositoryRoot,['check-ref-format',reference]);
  const baseCommit=(await git(repositoryRoot,['rev-parse','--verify',`${reference}^{commit}`])).stdout.trim();const head=(await git(repositoryRoot,['rev-parse','--verify','HEAD^{commit}'])).stdout.trim();
  if(!sha.test(baseCommit)||baseCommit!==head)throw new IsolatedCheckoutError('A referência escolhida não representa o HEAD usado para preparar o contexto.');
  const branchValue=await git(repositoryRoot,['symbolic-ref','--quiet','HEAD'],undefined,[0,1]);const branch=branchValue.code===0?branchValue.stdout.trim():null;
  const commonDir=await realpath(resolve(repositoryRoot,(await git(repositoryRoot,['rev-parse','--git-common-dir'])).stdout.trim()));
  await repositorySafety(repositoryRoot,baseCommit);
  // Ignored operational resources are not copied or silently assumed available.
  const status=(await git(repositoryRoot,['status','--porcelain=v1','-z','--untracked-files=all','--ignored'])).stdout;
  if(status)throw new IsolatedCheckoutError('Checkout original possui alterações tracked/staged/untracked ou recursos ignored. É necessária preparação explícita; nada foi copiado, descartado ou commitado.','ISOLATED_SOURCE_DIRTY');
  await storageRoot(repositoryRoot);
  return {version:1,mode:'isolated',projectId:project.id,...(project.workspace_id?{workspaceId:project.workspace_id}:{}),sourceRoot,repositoryRoot,projectSubdirectory:relative(repositoryRoot,sourceRoot),commonDir,reference,branch,baseCommit,sourceIdentity:await physical(sourceRoot),repositoryIdentity:await physical(repositoryRoot),commonIdentity:await physical(commonDir),capturedAt:new Date().toISOString()};
}
export async function captureIsolationRequest(project:Project,options:{reference?:string}={}):Promise<IsolatedCheckoutRequest>{return sourceSnapshot(project,options.reference)}
export async function validateIsolationRequest(project:Project,request:IsolatedCheckoutRequest){
  if(!request||request.version!==1||request.mode!=='isolated'||request.projectId!==project.id||request.workspaceId!==project.workspace_id||!sha.test(request.baseCommit))throw new IsolatedCheckoutError('A solicitação isolada não corresponde ao projeto/workspace autorizado.');
  const current=await sourceSnapshot(project,request.reference);
  for(const key of ['sourceRoot','repositoryRoot','projectSubdirectory','commonDir','reference','branch','baseCommit'] as const)if(current[key]!==request[key])throw new IsolatedCheckoutError(`A base Git ou identidade mudou desde o enqueue (${key}); reconcilie o contexto.`, 'ISOLATED_BASE_CHANGED');
  if(!same(current.sourceIdentity,request.sourceIdentity)||!same(current.repositoryIdentity,request.repositoryIdentity)||!same(current.commonIdentity,request.commonIdentity))throw new IsolatedCheckoutError('Identidade física mudou desde o enqueue.','ISOLATED_IDENTITY_CHANGED');
  return current;
}
async function durableJson(path:string,value:unknown){const directory=dirname(path),info=await lstat(directory);if(await realpath(directory)!==directory||!info.isDirectory()||info.isSymbolicLink()||info.uid!==process.getuid?.()||(info.mode&0o077)!==0)throw new IsolatedCheckoutError('Diretório privado de evidências mudou ou é inseguro.');const temporary=path+'.'+randomUUID()+'.tmp';const handle=await open(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);try{await handle.writeFile(JSON.stringify(value,null,2));await handle.sync()}finally{await handle.close()}await rename(temporary,path);const parent=await open(dirname(path),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await parent.sync()}finally{await parent.close()}}
async function privateJson(path:string){const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const info=await handle.stat();if(!info.isFile()||info.uid!==process.getuid?.()||(info.mode&0o077)!==0||info.size>8*1024*1024)throw new IsolatedCheckoutError('Manifesto de ownership inseguro.');return JSON.parse(await handle.readFile('utf8'))}finally{await handle.close()}}
function binding(identity:IsolatedCheckoutIdentity){return {version:1 as const,queue:identity.queue,runId:identity.runId,cardId:identity.cardId,cardRevision:identity.cardRevision,projectId:identity.projectId,...(identity.workspaceId?{workspaceId:identity.workspaceId}:{}),request:identity.request};}
async function verifyStored(stored:StoredIdentity,identity:IsolatedCheckoutIdentity,storage:{path:string;identity:PhysicalIdentity}){
  if(stable(binding(identity))!==stable({version:stored.version,queue:stored.queue,runId:stored.runId,cardId:stored.cardId,cardRevision:stored.cardRevision,projectId:stored.projectId,...(stored.workspaceId?{workspaceId:stored.workspaceId}:{}),request:stored.request}))throw new IsolatedCheckoutError('Associação run/card/projeto/revisão/base divergiu.');
  if(stored.runDirectory!==join(storage.path,identity.queue+'-'+identity.runId)||stored.worktreeRoot!==join(stored.runDirectory,'tree')||stored.root!==resolve(stored.worktreeRoot,identity.request.projectSubdirectory)||!same(stored.storageIdentity,storage.identity))throw new IsolatedCheckoutError('Destino ou storage não corresponde à identidade registrada.');
  await assertIdentity(storage.path,stored.storageIdentity);
  if(!stored.worktreeIdentity||!stored.rootIdentity||!stored.runDirectoryIdentity||!stored.gitDirectory||!stored.gitDirectoryIdentity||!stored.gitPointerHash)throw new IsolatedCheckoutError('Criação anterior incompleta exige recuperação explícita.');
  await assertIdentity(stored.runDirectory,stored.runDirectoryIdentity);const privateDirectory=await lstat(stored.runDirectory);if(privateDirectory.isSymbolicLink()||(privateDirectory.mode&0o077)!==0)throw new IsolatedCheckoutError('Diretório da execução deixou de ser privado.');await assertIdentity(stored.worktreeRoot,stored.worktreeIdentity);await assertIdentity(stored.root,stored.rootIdentity);
  await assertIdentity(stored.gitDirectory,stored.gitDirectoryIdentity);const currentGitDirectory=await realpath((await git(stored.worktreeRoot,['rev-parse','--absolute-git-dir'])).stdout.trim());if(currentGitDirectory!==stored.gitDirectory||dirname(currentGitDirectory)!==join(identity.request.commonDir,'worktrees')||await pointerHash(stored.worktreeRoot)!==stored.gitPointerHash)throw new IsolatedCheckoutError('Ponteiro ou registro Git da worktree mudou.');
  const manifest=await privateJson(join(stored.runDirectory,'identity.json'));if(stable(manifest)!==stable(stored))throw new IsolatedCheckoutError('Manifesto físico divergiu do registro de execução.');
}
/** Read-only binding to one currently running manager-created checkout. The
 * caller also needs the current ALS run and physical write-lease coverage; this
 * helper never grants execution authority from a .git pointer alone. */
export async function bindActiveIsolatedCheckout(db:ContextQueryClient,scope:{queue:'card_runs'|'card_ai_runs';runId:string;projectId:string;cardId:string;cardRevision:number|null;workspaceId?:string|null;root:string;authorizedProjectRoot:string;baseCommit:string;sourceIdentity:unknown}):Promise<()=>Promise<void>>{
  requireHost();
  if(!['card_runs','card_ai_runs'].includes(scope.queue)||[scope.runId,scope.cardId,scope.projectId].some(value=>!uuid.test(value))||scope.workspaceId!=null&&!uuid.test(scope.workspaceId)||!sha.test(scope.baseCommit)||(scope.cardRevision!==null&&(!Number.isSafeInteger(scope.cardRevision)||scope.cardRevision<1)))throw new IsolatedCheckoutError('Identidade do vínculo isolado inválida.');
  const load=async()=>{const result=await db.query('SELECT * FROM isolated_run_checkouts WHERE queue=$1 AND run_id=$2',[scope.queue,scope.runId]);const rows=Array.isArray(result)?result:result?.rows;if(!Array.isArray(rows)||rows.length!==1)throw new IsolatedCheckoutError('Checkout isolado registrado indisponível.');return rows[0];};
  const first=await load();
  if(!first.identity||typeof first.identity!=='object'||Array.isArray(first.identity))throw new IsolatedCheckoutError('Identidade física registrada indisponível.');
  // Retain an immutable observation instead of following later mutable ledger objects.
  const stored=JSON.parse(stable(first.identity)) as StoredIdentity;
  if(!stored.request||stored.request.version!==1||stored.request.mode!=='isolated'||stored.request.projectId!==scope.projectId||stored.request.workspaceId!==(scope.workspaceId??undefined)||stored.request.baseCommit!==scope.baseCommit||stable(stored.request.sourceIdentity)!==stable(scope.sourceIdentity)||!stored.owner||!uuid.test(stored.owner))throw new IsolatedCheckoutError('Pin ou origem do checkout isolado divergiu.');
  if(scope.root!==resolve(scope.root)||scope.authorizedProjectRoot!==resolve(scope.authorizedProjectRoot)||stored.root!==scope.root||stored.request.sourceRoot!==scope.authorizedProjectRoot||await realpath(scope.authorizedProjectRoot)!==scope.authorizedProjectRoot)throw new IsolatedCheckoutError('Raiz do checkout não corresponde à área autorizada.');
  const identity:IsolatedCheckoutIdentity={queue:scope.queue,runId:scope.runId,projectId:scope.projectId,cardId:scope.cardId,cardRevision:scope.cardRevision,...(scope.workspaceId?{workspaceId:scope.workspaceId}:{}),authorizedProjectRoot:scope.authorizedProjectRoot,request:stored.request};
  const ledger=(row:any)=>{
    if(row.queue!==scope.queue||row.run_id!==scope.runId||row.project_id!==scope.projectId||row.card_id!==scope.cardId||(row.workspace_id??null)!==(scope.workspaceId??null)||(row.card_revision===null?null:Number(row.card_revision))!==scope.cardRevision||row.state!=='running'||row.owner_id!==stored.owner||stable(row.identity)!==stable(stored))throw new IsolatedCheckoutError('Ownership ou lifecycle do checkout isolado mudou.');
  };
  ledger(first);
  const storage=await storageRoot(stored.request.repositoryRoot);
  await verifyStored(stored,identity,storage);
  if(!stored.gitDirectory||!stored.gitDirectoryIdentity||!stored.worktreeIdentity||!stored.rootIdentity||!stored.runDirectoryIdentity||!stored.gitPointerHash)throw new IsolatedCheckoutError('Registro físico da worktree incompleto.');
  const gitDirectory=stored.gitDirectory,gitDirectoryIdentity=stored.gitDirectoryIdentity;
  const files=new Map<string,PhysicalIdentity>();
  const metadata=async(path:string)=>{const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const info=await handle.stat();if(!info.isFile()||info.uid!==process.getuid?.()||info.size>65536)throw new IsolatedCheckoutError('Metadado Git isolado indisponível.');const expected=files.get(path);if(expected&&!same(expected,{dev:info.dev,ino:info.ino}))throw new IsolatedCheckoutError('Arquivo de metadados isolado foi substituído.');const content=await handle.readFile('utf8');const current=await lstat(path);if(await realpath(path)!==path||current.isSymbolicLink()||!current.isFile()||current.dev!==info.dev||current.ino!==info.ino||Buffer.byteLength(content)>65536||content.includes('\0')||content.includes('\ufffd'))throw new IsolatedCheckoutError('Metadado Git isolado inválido.');if(!expected)files.set(path,{dev:info.dev,ino:info.ino});return content;}finally{await handle.close()}};
  const verify=async()=>{
    requireHost();ledger(await load());
    if(process.env.ORBIT_WORKTREE_ROOT!==storage.path)throw new IsolatedCheckoutError('Storage do checkout isolado mudou.');
    await assertIdentity(storage.path,stored.storageIdentity);
    const storageInfo=await lstat(storage.path);if(storageInfo.isSymbolicLink()||(storageInfo.mode&0o077)!==0)throw new IsolatedCheckoutError('Storage isolado deixou de ser privado.');
    await assertIdentity(stored.runDirectory,stored.runDirectoryIdentity!);const runInfo=await lstat(stored.runDirectory);if(runInfo.isSymbolicLink()||(runInfo.mode&0o077)!==0)throw new IsolatedCheckoutError('Diretório do run isolado deixou de ser privado.');
    await assertIdentity(stored.worktreeRoot,stored.worktreeIdentity!);await assertIdentity(stored.root,stored.rootIdentity!);await assertIdentity(gitDirectory,gitDirectoryIdentity);
    await assertIdentity(stored.request.sourceRoot,stored.request.sourceIdentity);await assertIdentity(stored.request.repositoryRoot,stored.request.repositoryIdentity);await assertIdentity(stored.request.commonDir,stored.request.commonIdentity);
    if(dirname(gitDirectory)!==join(stored.request.commonDir,'worktrees'))throw new IsolatedCheckoutError('Registro Git isolado fora do common-dir capturado.');
    await metadata(join(stored.runDirectory,'identity.json'));if(stable(await privateJson(join(stored.runDirectory,'identity.json')))!==stable(stored))throw new IsolatedCheckoutError('Manifesto físico isolado mudou.');
    if(await pointerHash(stored.worktreeRoot)!==stored.gitPointerHash)throw new IsolatedCheckoutError('Ponteiro Git isolado mudou.');
    const pointer=await metadata(join(stored.worktreeRoot,'.git'));
    if(!/^gitdir: [^\r\n]+\n?$/.test(pointer)||resolve(stored.worktreeRoot,pointer.replace(/^gitdir: /,'').trim())!==gitDirectory)throw new IsolatedCheckoutError('Ponteiro Git isolado não corresponde ao registro privado.');
    const head=await metadata(join(gitDirectory,'HEAD'));if(head.trim()!==scope.baseCommit||!sha.test(head.trim()))throw new IsolatedCheckoutError('HEAD isolado mudou ou deixou de estar detached no pin.');
    const common=await metadata(join(gitDirectory,'commondir'));if(!common.trim()||common.trim().includes('\n')||await realpath(resolve(gitDirectory,common.trim()))!==stored.request.commonDir)throw new IsolatedCheckoutError('Common-dir isolado mudou.');
    const backlink=await metadata(join(gitDirectory,'gitdir'));if(backlink.trim()!==join(stored.worktreeRoot,'.git'))throw new IsolatedCheckoutError('Registro Git isolado aponta para outra árvore.');
    // A concurrent identity/owner swap must not be accepted merely because the
    // first database observation still matched. This is not FS+SQL atomicity.
    ledger(await load());
  };
  await verify();return verify;
}

async function captureEvidence(stored:StoredIdentity,executorStatus:string,initialStatus:'clean'|'preserved_continuation',signal?:AbortSignal):Promise<IsolatedCheckoutEvidence>{
  const root=stored.worktreeRoot;
  await indexSafety(root);
  const headCommit=(await git(root,['rev-parse','--verify','HEAD^{commit}'],signal)).stdout.trim();if(headCommit!==stored.request.baseCommit)throw new IsolatedCheckoutError('O HEAD da worktree foi modificado; commits não são integração autorizada.');
  const common=await realpath(resolve(root,(await git(root,['rev-parse','--git-common-dir'],signal)).stdout.trim()));if(common!==stored.request.commonDir)throw new IsolatedCheckoutError('A worktree deixou de pertencer ao repositório autorizado.');
  const statusPorcelain=(await git(root,['status','--porcelain=v1','-z','--untracked-files=all','--ignored'],signal)).stdout;
  const changes:IsolatedCheckoutEvidence['changes']=[],untracked:IsolatedCheckoutEvidence['untracked']=[];const statuses=statusPorcelain.split('\0');let budget=64*1024*1024;
  for(let index=0;index<statuses.length;index++){const entry=statuses[index];if(!entry)continue;if(entry.length<4||entry[2]!==' ')throw new IsolatedCheckoutError('Status Git inválido.');const status=entry.slice(0,2),path=safePathName(entry.slice(3));const previousPath=/[RC]/.test(status)?safePathName(statuses[++index]||''):undefined;
    const kind=status==='??'?'untracked':status==='!!'?'ignored':status.includes('D')?'removed':status.includes('A')?'added':status.includes('R')?'renamed':'modified';changes.push({path,...(previousPath?{previousPath}:{}),indexStatus:status[0],worktreeStatus:status[1],kind});
    if(status==='??'||status==='!!'){const absolute=join(root,path);const info=await lstat(absolute);if(info.isSymbolicLink()){const target=await readlink(absolute);untracked.push({path,sha256:hash(target),size:Buffer.byteLength(target),type:'symlink'});continue}if(!info.isFile()||info.size>budget)throw new IsolatedCheckoutError('Arquivo não rastreado/ignored exige revisão (tipo ou tamanho não suportado).');const handle=await open(absolute,constants.O_RDONLY|constants.O_NOFOLLOW);try{const opened=await handle.stat();if(opened.ino!==info.ino||opened.dev!==info.dev)throw new IsolatedCheckoutError('Arquivo mudou de identidade na coleta.');const content=await handle.readFile();budget-=content.length;if(budget<0)throw new IsolatedCheckoutError('Limite de hashes de arquivos excedido.');untracked.push({path,sha256:hash(content),size:content.length,type:'file'})}finally{await handle.close()}}
  }
  const diff=(await git(root,['diff','--no-ext-diff','--no-textconv','--binary',stored.request.baseCommit,'--'],signal)).stdout;
  const stagedDiff=(await git(root,['diff','--cached','--no-ext-diff','--no-textconv','--binary',stored.request.baseCommit,'--'],signal)).stdout;
  const artifactBody=JSON.stringify({baseCommit:stored.request.baseCommit,worktreeDiff:diff,stagedDiff,statusPorcelain,untracked});const artifactPath=join(stored.runDirectory,'changes-'+randomUUID()+'.json');await durableJson(artifactPath,JSON.parse(artifactBody));const storedArtifact=await readFile(artifactPath);
  return {baseCommit:stored.request.baseCommit,headCommit,initialStatus,statusPorcelain:statusPorcelain.replace(/\0/g,'\\0'),statusEncoding:'nul-escaped',changes,untracked,artifact:{path:artifactPath,sha256:hash(storedArtifact),size:storedArtifact.length},fingerprint:hash(artifactBody),executorStatus,integration:'not_integrated',attribution:'executor_and_auxiliary_tools_unseparated',capturedAt:new Date().toISOString()};
}
/** Creation and execution acquire separate leases in sequence; common-dir remains serialized (03A). No automatic removal or integration exists. */
export async function withIsolatedCheckout<T>(db:Database,identity:IsolatedCheckoutIdentity,callback:(checkout:IsolatedCheckout,lease:WorkspaceWriteLease)=>Promise<T>):Promise<T>{
  requireHost();for(const value of [identity.runId,identity.cardId,identity.projectId])if(!uuid.test(value))throw new IsolatedCheckoutError('Identidade de execução inválida.');if(!['card_runs','card_ai_runs'].includes(identity.queue)||(identity.cardRevision!==null&&(!Number.isSafeInteger(identity.cardRevision)||identity.cardRevision<1)))throw new IsolatedCheckoutError('Fila ou revisão de execução inválida.');
  const request=identity.request;const project={id:identity.projectId,root:identity.authorizedProjectRoot,workspace_id:identity.workspaceId};
  if(!request||request.projectId!==identity.projectId||request.workspaceId!==identity.workspaceId)throw new IsolatedCheckoutError('Solicitação isolada não pertence ao projeto/workspace do run.');
  const storage=await storageRoot(request.repositoryRoot);let stored:StoredIdentity|undefined,evidence:IsolatedCheckoutEvidence|undefined;let registered=false;let failed:unknown;let result:T|undefined;let deferred=false;let resumed=false;let finalized=false;
  const state=async(value:IsolatedCheckoutState,diagnostic?:string,lease?:WorkspaceWriteLease)=>{identity.onState?.(value);if(stored?.runDirectoryIdentity){await assertIdentity(stored.runDirectory,stored.runDirectoryIdentity);await durableJson(join(stored.runDirectory,'lifecycle.json'),{state:value,diagnostic:diagnostic||null,updatedAt:new Date().toISOString(),owner:stored.owner});}if(registered){try{const rows=await db.query('UPDATE isolated_run_checkouts SET state=$3,identity=$4::jsonb,evidence=$5::jsonb,diagnostic=$6,updated_at=now() WHERE queue=$1 AND run_id=$2 AND owner_id=$7 RETURNING run_id',[identity.queue,identity.runId,value,JSON.stringify(stored),JSON.stringify(evidence||{}),diagnostic||null,stored!.owner]);if(!rows.length)throw new IsolatedCheckoutError('Ownership do registro de checkout perdido.')}catch(error){lease?.poison('Não foi possível persistir o lifecycle da worktree.');throw error}}};
  try{
    await withWorkspaceWriteLease(db,{queue:identity.queue,runId:identity.runId,cardId:identity.cardId,projectId:identity.projectId,projectRoot:request.repositoryRoot,signal:identity.signal,onState:identity.onState},async lease=>{
      await validateIsolationRequest(project,request);await lease.assertActive();await assertIdentity(storage.path,storage.identity);
      const existing=(await db.query('SELECT * FROM isolated_run_checkouts WHERE queue=$1 AND run_id=$2',[identity.queue,identity.runId]))[0];
      if(existing){if(!identity.continuation||existing.state!=='awaiting_answer')throw new IsolatedCheckoutError('Run já possui checkout registrado; não será criada nem retomada uma execução concorrente.','ISOLATED_RUN_ALREADY_REGISTERED');stored=existing.identity;await verifyStored(stored!,identity,storage);if(existing.owner_id!==stored!.owner)throw new IsolatedCheckoutError('Ownership do banco divergiu do manifesto.');evidence=existing.evidence;const claimed=await db.query("UPDATE isolated_run_checkouts SET state='ready',updated_at=now() WHERE queue=$1 AND run_id=$2 AND owner_id=$3 AND state='awaiting_answer' RETURNING run_id",[identity.queue,identity.runId,stored!.owner]);if(!claimed.length)throw new IsolatedCheckoutError('Continuação já reivindicada por outro worker.','ISOLATED_RUN_ALREADY_REGISTERED');registered=true;resumed=true;await state('ready',undefined,lease);return;}
      if(identity.continuation)throw new IsolatedCheckoutError('Não há checkout preservado para esta continuação.');
      const owner=randomUUID(),runDirectory=join(storage.path,identity.queue+'-'+identity.runId),worktreeRoot=join(runDirectory,'tree');
      stored={...binding(identity),owner,runDirectory,worktreeRoot,root:resolve(worktreeRoot,request.projectSubdirectory),storageIdentity:storage.identity};
      const inserted=await db.query("INSERT INTO isolated_run_checkouts(queue,run_id,card_id,card_revision,project_id,workspace_id,owner_id,state,identity) VALUES($1,$2,$3,$4,$5,$6,$7,'preparing',$8::jsonb) ON CONFLICT(queue,run_id) DO NOTHING RETURNING run_id",[identity.queue,identity.runId,identity.cardId,identity.cardRevision,identity.projectId,identity.workspaceId||null,owner,JSON.stringify(stored)]);
      if(!inserted.length)throw new IsolatedCheckoutError('Outra execução registrou este run.','ISOLATED_RUN_ALREADY_REGISTERED');registered=true;
      try{await mkdir(runDirectory,{mode:0o700});stored.runDirectoryIdentity=await physical(runDirectory);await durableJson(join(runDirectory,'identity.json'),stored);await state('preparing',undefined,lease);
        await lease.assertActive();await git(request.repositoryRoot,['worktree','add','--detach','--',worktreeRoot,request.baseCommit],identity.signal);await lease.assertActive();
        stored.worktreeIdentity=await physical(worktreeRoot);stored.rootIdentity=await physical(stored.root);stored.gitDirectory=await realpath((await git(worktreeRoot,['rev-parse','--absolute-git-dir'],identity.signal)).stdout.trim());if(dirname(stored.gitDirectory)!==join(request.commonDir,'worktrees'))throw new IsolatedCheckoutError('Registro Git criado fora do common-dir autorizado.');stored.gitDirectoryIdentity=await physical(stored.gitDirectory);stored.gitPointerHash=await pointerHash(worktreeRoot);await durableJson(join(runDirectory,'identity.json'),stored);
        if((await git(worktreeRoot,['status','--porcelain=v1','-z','--untracked-files=all','--ignored'],identity.signal)).stdout)throw new IsolatedCheckoutError('Worktree não iniciou limpa.');
        // Source tree files, source branch and pin must still match after registry changes.
        await validateIsolationRequest(project,request);await state('ready',undefined,lease);
      }catch(error){lease.poison('Criação de worktree incompleta; preservação exige revisão explícita.');throw error;}
    });
    if(!stored)throw new IsolatedCheckoutError('Checkout não foi preparado.');const prepared=stored;
    await withWorkspaceWriteLease(db,{queue:identity.queue,runId:identity.runId,cardId:identity.cardId,projectId:identity.projectId,projectRoot:prepared.worktreeRoot,workingDirectory:prepared.root,signal:identity.signal,onState:identity.onState},async lease=>{
      await verifyStored(prepared,identity,storage);await validateIsolationRequest(project,request);await lease.assertActive();
      if(resumed){const observed=await captureEvidence(prepared,'resume_validation','preserved_continuation',identity.signal);if(!evidence?.fingerprint||observed.fingerprint!==evidence.fingerprint)throw new IsolatedCheckoutError('A worktree preservada mudou entre pergunta e continuação; reconciliação necessária.');}
      await state('running',undefined,lease);
      try{result=await callback({id:identity.runId,root:prepared.root,worktreeRoot:prepared.worktreeRoot,runDirectory:prepared.runDirectory,owner:prepared.owner,baseCommit:request.baseCommit,deferForAnswer(){deferred=true}},lease)}catch(error){failed=error}
      await lease.assertActive();await verifyStored(prepared,identity,storage);await validateIsolationRequest(project,request);
      evidence=await captureEvidence(prepared,failed?'failed':deferred?'waiting_answer':'success',resumed?'preserved_continuation':'clean',identity.signal);await state('ended',failed?String((failed as Error)?.message||failed):undefined,lease);await lease.assertActive();
    });
    // Awaiting-answer/reserved completion is published only after supervisor drain.
    await state(failed?'preserved':deferred?'awaiting_answer':'preserved',failed?String((failed as Error)?.message||failed):undefined);
    finalized=true;if(failed)throw failed;return result as T;
  }catch(error){
    if(registered&&!finalized){try{await state('quarantined',String((error as Error)?.message||error))}catch{/* Physical manifest/ownership marker and preparing row remain; never delete or take over. */}}
    throw error;
  }
}

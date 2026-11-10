import {Body,Controller,Delete,Get,HttpException,Inject,Injectable,Param,Patch,Post,Query,Req} from '@nestjs/common';
import {Request} from 'express';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lstat,mkdtemp,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {basename,isAbsolute,join,normalize,relative,resolve,sep} from 'node:path';
import {Db} from '../db';
import {FeaturesService} from '../features';
import {SecretVault} from '../secrets';
import {redact} from '../execution/security';
import {PluginDefinition} from '../plugins/contract';
import {allowedBranch,branchName,branches,commitDescription,conventionalMessage,gitPaths,validCommitType} from './rules';
import {dispatchPipeline,pipelineBase,pollPipeline,PipelineTarget,Provider} from './pipeline';
import {DeliveryGitService} from '../delivery/git-service';
import {compareText,mergeText} from './review';

const runFile=promisify(execFile);
const id=(value:unknown)=>{if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new HttpException('ID inválido.',400);return value};
const text=(input:unknown,name:string,max=300)=>{if(typeof input!=='string'||!input.trim()||input.length>max)throw new HttpException(`${name} inválido.`,400);return input.trim()};
const bad=(message:string,status=400):never=>{throw new HttpException(message,status)};
const safeLog=(input:string)=>redact(input).replace(/(https?:\/\/)[^/@\s]+@/gi,'$1[REDACTED]@');
const asRule=<T>(callback:()=>T):T=>{try{return callback()}catch(error){return bad((error as Error).message)}};
const stageName=(input:unknown)=>{const name=text(input,'Etapa',120);if(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name))bad('Etapa inválida.');return name};
const relativeRepo=(input:unknown)=>{const path=input===undefined?'.':text(input,'Pasta',500);if(isAbsolute(path)||path.includes('\\')||path.includes('\0')||path.split('/').some(part=>part==='..'||part==='.git'))bad('Pasta do repositório inválida.');return normalize(path)};
const remoteName=(input:unknown)=>{const name=input===undefined?'origin':text(input,'Remote',80);if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name))bad('Remote inválido.');return name};
type Repo={id:string;owner_id:string;project_id:string;name:string;relative_path:string;remote_name:string;branches:string[];local_path:string};
type Target=PipelineTarget&{id:string;owner_id:string;repository_id:string;name:string;branches:string[];stages:string[];credentials_encrypted:string;active:boolean;deployment_method:string;git_flow:string};
type CardContext={project_id:string;board_id:string;list_id:string;title:string};

@Injectable()
export class GitPlugin {
  constructor(@Inject(Db) private db:Db,@Inject(FeaturesService) private features:FeaturesService,@Inject(SecretVault) private vault:SecretVault){}
  private async project(projectId:string,userId:string){const project=await this.db.one<{id:string;local_path:string}>('SELECT id,local_path FROM ai_projects WHERE id=$1 AND owner_id=$2',[id(projectId),userId]);if(!project)bad('Projeto não encontrado.',404);return project!}
  private async repository(repoId:string,userId:string){const repo=await this.db.one<Repo>('SELECT r.*,p.local_path FROM git_repositories r JOIN ai_projects p ON p.id=r.project_id WHERE r.id=$1 AND r.owner_id=$2 AND p.owner_id=$2',[id(repoId),userId]);if(!repo)bad('Repositório não encontrado.',404);return repo!}
  private async cardRepository(repoId:string,projectId:string){const repo=await this.db.one<Repo>('SELECT r.*,p.local_path FROM git_repositories r JOIN ai_projects p ON p.id=r.project_id WHERE r.id=$1 AND r.project_id=$2',[id(repoId),projectId]);if(!repo)bad('Repositório não pertence ao projeto do cartão.',404);return repo!}
  private async target(targetId:string,userId:string){const target=await this.db.one<Target>('SELECT t.* FROM git_pipeline_targets t JOIN git_repositories r ON r.id=t.repository_id JOIN ai_projects p ON p.id=r.project_id WHERE t.id=$1 AND t.owner_id=$2 AND p.owner_id=$2',[id(targetId),userId]);if(!target)bad('Pipeline não encontrado.',404);return target!}
  private async card(cardId:string,userId:string):Promise<CardContext>{const boardId=await this.features.cardBoard(id(cardId),userId);const card=await this.db.one<CardContext>('SELECT COALESCE(c.ai_project_id,b.ai_default_project_id) AS project_id,l.board_id,c.list_id,c.title FROM cards c JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id WHERE c.id=$1',[cardId]);if(!card?.project_id)bad('Defina um projeto no cartão ou quadro.',409);return {...card!,board_id:boardId}}
  private async writableCard(cardId:string,userId:string){const card=await this.card(cardId,userId);await this.project(card.project_id,userId);return card}
  private async projectDirectory(projectPath:string,repositoryPath:string){
    let root:string,dir:string;
    try { root=await realpath(projectPath);dir=await realpath(resolve(root,repositoryPath)); }
    catch(error){
      const code=(error as NodeJS.ErrnoException).code;
      if(code==='ENOENT'||code==='ENOTDIR')bad('A pasta do repositório não existe dentro do projeto. Use "." quando o projeto já é a raiz do repositório Git.',400);
      if(code==='EACCES'||code==='EPERM')bad('O Orbit não tem permissão para acessar a pasta do repositório.',403);
      throw error;
    }
    const rel=relative(root,dir);
    if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))bad('Repositório fora do projeto.',400);
    return dir;
  }
  private async repoDir(repo:Repo){const dir=await this.projectDirectory(repo.local_path,repo.relative_path);const top=(await this.git(dir,['rev-parse','--show-toplevel'])).trim();if(await realpath(top)!==dir)bad('A pasta não é a raiz do repositório Git.',400);return dir}
  private async git(dir:string,args:string[]):Promise<string>{try{const output=await runFile('git',args,{cwd:dir,timeout:60000,maxBuffer:1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});return output.stdout}catch(error){const output=error as Error&{stderr?:string};return bad(safeLog(output.stderr||output.message).slice(0,1000),409)}}
  private async allowedRepositoryBranch(repo:Repo,branch:string){asRule(()=>allowedBranch(branch,repo.branches));const targets=await this.db.query<{branches:string[]}>('SELECT branches FROM git_pipeline_targets WHERE repository_id=$1 AND active',[repo.id]);if(targets.length&&!targets.some(target=>target.branches.includes(branch)))bad('A branch não consta em nenhum pipeline configurado.',409);return branch}
  private async currentBranch(repo:Repo,dir:string){const branch=(await this.git(dir,['branch','--show-current'])).trim();if(!branch)bad('Checkout em detached HEAD não é permitido.',409);return this.allowedRepositoryBranch(repo,branch)}
  private async explicitFiles(dir:string,paths:string[]){for(const path of paths){try{const full=resolve(dir,path),info=await lstat(full);if(info.isDirectory())bad('Selecione arquivos, não pastas.',400);const real=await realpath(full),rel=relative(dir,real);if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))bad('Arquivo fora do repositório.',400)}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}}}
  async projectConfig(projectId:string,userId:string){await this.project(projectId,userId);const project=await this.db.one<{default_git_repository_id:string|null}>('SELECT default_git_repository_id FROM ai_projects WHERE id=$1 AND owner_id=$2',[projectId,userId]);const repositories=await this.db.query('SELECT id,project_id,name,relative_path,remote_name,branches,created_at FROM git_repositories WHERE project_id=$1 AND owner_id=$2 ORDER BY name',[projectId,userId]);const targets=await this.db.query('SELECT t.id,t.repository_id,t.name,t.provider,t.base_url,t.external_project,t.pipeline_ref,t.branches,t.stages,t.deployment_method,t.git_flow,t.active,t.created_at FROM git_pipeline_targets t JOIN git_repositories r ON r.id=t.repository_id WHERE r.project_id=$1 AND t.owner_id=$2 ORDER BY t.name',[projectId,userId]);const columns=await this.db.query('SELECT l.id,l.title,b.id AS board_id,b.title AS board_title FROM lists l JOIN boards b ON b.id=l.board_id WHERE b.ai_default_project_id=$1 AND b.owner_id=$2 AND l.archived_at IS NULL AND b.closed_at IS NULL ORDER BY b.title,l.position',[projectId,userId]);const mappings=await this.db.query('SELECT cs.list_id,cs.target_id,cs.stage_key FROM git_column_stages cs JOIN git_pipeline_targets t ON t.id=cs.target_id JOIN git_repositories r ON r.id=t.repository_id WHERE r.project_id=$1 AND cs.owner_id=$2',[projectId,userId]);return {default_repository_id:project?.default_git_repository_id||null,repositories,targets,columns,mappings}}
  async setDefaultRepository(projectId:string,userId:string,repositoryId:string){
    await this.project(projectId,userId);
    const repo=await this.repository(id(repositoryId),userId);
    if(repo.project_id!==projectId)bad('Repositório não pertence ao projeto.',409);
    return this.db.one('UPDATE ai_projects SET default_git_repository_id=$3,updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING default_git_repository_id',[projectId,userId,repo.id]);
  }
  async addRepository(projectId:string,userId:string,body:Record<string,unknown>){if(body.detect===true)return this.detectRepository(projectId,userId);const project=await this.project(projectId,userId),path=relativeRepo(body.relative_path),name=text(body.name,'Nome',120),remote=remoteName(body.remote_name),allowed=asRule(()=>branches(body.branches));if(await this.db.one('SELECT id FROM git_repositories WHERE project_id=$1 AND relative_path=$2',[projectId,path]))bad('Esta pasta já está cadastrada como repositório.',409);const dir=await this.projectDirectory(project.local_path,path);const top=(await this.git(dir,['rev-parse','--show-toplevel'])).trim();if(await realpath(top)!==dir)bad('Selecione a raiz de um repositório Git.');try{const repo=await this.db.one<{id:string}>('INSERT INTO git_repositories(owner_id,project_id,name,relative_path,remote_name,branches) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,name,project_id,relative_path,remote_name,branches',[userId,projectId,name,path,remote,allowed]);if(repo)await this.db.query('UPDATE ai_projects SET default_git_repository_id=$2 WHERE id=$1 AND default_git_repository_id IS NULL',[projectId,repo.id]);return repo}catch(error){if((error as {code?:string}).code==='23505')bad('Esta pasta já está cadastrada como repositório.',409);throw error}}
  async detectRepository(projectId:string,userId:string){
    const project=await this.project(projectId,userId),root=await realpath(project.local_path);
    const top=await realpath((await this.git(root,['rev-parse','--show-toplevel'])).trim());
    const path=relative(root,top);
    if(path==='..'||path.startsWith('..'+sep)||isAbsolute(path))bad('O repositório Git está fora da pasta do projeto.',409);
    const branch=(await this.git(top,['branch','--show-current'])).trim();
    if(!branch)bad('O repositório está em detached HEAD; faça checkout de uma branch antes de configurar Git.',409);
    const allowed=[branch];
    const remotes=(await this.git(top,['remote'])).split('\n').map(value=>value.trim()).filter(Boolean);
    const remote=remotes.includes('origin')?'origin':remotes[0]||'origin';
    const relativePath=path.split(sep).join('/')||'.';
    const existing=await this.db.one('SELECT id,name,project_id,relative_path,remote_name,branches FROM git_repositories WHERE project_id=$1 AND owner_id=$2 AND relative_path=$3',[projectId,userId,relativePath]);
    if(existing)return existing;
    const repo=await this.db.one<{id:string}>('INSERT INTO git_repositories(owner_id,project_id,name,relative_path,remote_name,branches) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,name,project_id,relative_path,remote_name,branches',[userId,projectId,basename(top).slice(0,120)||'Repositório',relativePath,remote,allowed]);
    if(repo)await this.db.query('UPDATE ai_projects SET default_git_repository_id=$2 WHERE id=$1 AND default_git_repository_id IS NULL',[projectId,repo.id]);
    return repo;
  }
  async removeRepository(repoId:string,userId:string){const repo=await this.repository(repoId,userId);await this.db.query('DELETE FROM git_repositories WHERE id=$1 AND owner_id=$2',[repoId,userId]);await this.db.query('UPDATE ai_projects SET default_git_repository_id=(SELECT id FROM git_repositories WHERE project_id=$1 ORDER BY created_at,id LIMIT 1) WHERE id=$1 AND default_git_repository_id IS NULL',[repo.project_id]);return {ok:true}}
  async addTarget(repoId:string,userId:string,body:Record<string,unknown>){const repo=await this.repository(repoId,userId),name=text(body.name,'Nome',120),provider=body.provider as Provider;if(!['github_actions','gitlab_ci','bamboo'].includes(provider))bad('Provedor inválido.');const base=asRule(()=>pipelineBase(body.base_url)),project=text(body.external_project,'Projeto externo',300),ref=text(body.pipeline_ref,'Pipeline',300),allowed=asRule(()=>branches(body.branches));if(allowed.some(branch=>!repo.branches.includes(branch)))bad('O pipeline usa branch fora da configuração do repositório.');if(provider==='bamboo'&&allowed.length!==1)bad('Configure um destino Bamboo por branch do plano.');const stages=body.stages===undefined?[]:Array.isArray(body.stages)&&body.stages.length<=30?body.stages.map(stageName):bad('Etapas inválidas.');if(new Set(stages).size!==stages.length)bad('Etapas repetidas.');const token=text(body.token,'Token',5000),method=body.deployment_method??'provider',flow=body.git_flow??'pipeline_only';if(!['provider','ssh','git'].includes(String(method)))bad('Método de deploy inválido.');if(!['pipeline_only','commit_push','pull_push'].includes(String(flow)))bad('Fluxo Git inválido.');return this.db.one('INSERT INTO git_pipeline_targets(owner_id,repository_id,name,provider,base_url,external_project,pipeline_ref,branches,stages,credentials_encrypted,deployment_method,git_flow) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id,repository_id,name,provider,base_url,external_project,pipeline_ref,branches,stages,deployment_method,git_flow,active',[userId,repoId,name,provider,base,project,ref,allowed,stages,this.vault.seal({token}),method,flow])}
  async removeTarget(targetId:string,userId:string){await this.target(targetId,userId);await this.db.query('DELETE FROM git_pipeline_targets WHERE id=$1 AND owner_id=$2',[targetId,userId]);return {ok:true}}
  async mapColumn(listId:string,targetId:string,userId:string,body:Record<string,unknown>){const target=await this.target(targetId,userId),repo=await this.repository(target.repository_id,userId),list=await this.db.one<{board_id:string;ai_default_project_id:string|null}>('SELECT l.board_id,b.ai_default_project_id FROM lists l JOIN boards b ON b.id=l.board_id WHERE l.id=$1 AND b.owner_id=$2 AND l.archived_at IS NULL AND b.closed_at IS NULL',[id(listId),userId]);if(!list||list.ai_default_project_id!==repo.project_id)bad('A coluna não pertence ao quadro desse projeto.',409);const stage=stageName(body.stage_key);if(!target.stages.includes(stage))bad('Etapa não configurada no pipeline.');return this.db.one('INSERT INTO git_column_stages(list_id,target_id,stage_key,owner_id) VALUES($1,$2,$3,$4) ON CONFLICT(list_id,target_id) DO UPDATE SET stage_key=$3 RETURNING list_id,target_id,stage_key',[listId,targetId,stage,userId])}
  async unmapColumn(listId:string,targetId:string,userId:string){await this.target(targetId,userId);await this.db.query('DELETE FROM git_column_stages WHERE list_id=$1 AND target_id=$2 AND owner_id=$3',[id(listId),targetId,userId]);return {ok:true}}
  async cardHistory(cardId:string,userId:string){const card=await this.card(cardId,userId);const commits=await this.db.query('SELECT gc.id,gc.repository_id,gc.sha,gc.branch,gc.title,gc.comments,gc.files,gc.merge,gc.url,gc.action,gc.target_sha,gc.created_at,r.name AS repository,(SELECT action FROM git_card_commits operation WHERE operation.card_id=gc.card_id AND operation.repository_id=gc.repository_id AND operation.target_sha=gc.sha ORDER BY operation.created_at DESC,operation.id DESC LIMIT 1) AS latest_action FROM git_card_commits gc JOIN git_repositories r ON r.id=gc.repository_id WHERE gc.card_id=$1 ORDER BY gc.created_at DESC LIMIT 100',[cardId]);const repositories=await this.db.query<{id:string;name:string;branches:string[]}>('SELECT id,name,branches FROM git_repositories WHERE project_id=$1 ORDER BY name',[card.project_id]);const project=await this.db.one<{default_git_repository_id:string|null}>('SELECT default_git_repository_id FROM ai_projects WHERE id=$1',[card.project_id]);const targets=await this.db.query('SELECT t.id,t.repository_id,t.name,t.provider,t.branches,t.stages,t.deployment_method,t.git_flow FROM git_pipeline_targets t JOIN git_repositories r ON r.id=t.repository_id WHERE r.project_id=$1 AND t.active ORDER BY t.name',[card.project_id]);const mappings=await this.db.query('SELECT target_id,stage_key FROM git_column_stages WHERE list_id=$1',[card.list_id]);const runs=await this.db.query('SELECT r.id,r.target_id,r.stage_key,r.branch,r.status,r.logs,r.error,r.created_at,r.updated_at,t.name AS target_name FROM git_pipeline_runs r JOIN git_pipeline_targets t ON t.id=r.target_id WHERE r.card_id=$1 ORDER BY r.created_at DESC LIMIT 30',[cardId]);const can_write=Boolean(await this.db.one('SELECT id FROM ai_projects WHERE id=$1 AND owner_id=$2',[card.project_id,userId]));const defaultRepositoryId=project?.default_git_repository_id||repositories.length===1&&repositories[0]?.id||null;return {commits,repositories,default_repository_id:defaultRepositoryId,targets,mappings,runs,can_write}}
  async cardCommits(cardId:string,userId:string,offsetInput:unknown,limitInput:unknown=5){
    await this.card(cardId,userId);
    const offset=Number(offsetInput||0);if(!Number.isInteger(offset)||offset<0||offset>10000)bad('Página de commits inválida.');
    const limit=Number(limitInput||5);if(!Number.isInteger(limit)||limit<1||limit>50)bad('Tamanho da página inválido.');
    const commits=await this.db.query('SELECT gc.id,gc.repository_id,gc.sha,gc.branch,gc.title,gc.comments,gc.files,gc.merge,gc.url,gc.action,gc.target_sha,gc.created_at,r.name AS repository,(SELECT action FROM git_card_commits operation WHERE operation.card_id=gc.card_id AND operation.repository_id=gc.repository_id AND operation.target_sha=gc.sha ORDER BY operation.created_at DESC,operation.id DESC LIMIT 1) AS latest_action FROM git_card_commits gc JOIN git_repositories r ON r.id=gc.repository_id WHERE gc.card_id=$1 ORDER BY gc.created_at DESC LIMIT $3 OFFSET $2',[cardId,offset,limit+1]);
    return {commits:commits.slice(0,limit),has_more:commits.length>limit};
  }
  async commitDraft(cardId:string,userId:string,repositoryId:string){
    const card=await this.writableCard(cardId,userId),repo=await this.repository(id(repositoryId),userId);
    if(repo.project_id!==card.project_id)bad('Repositório não pertence ao projeto do cartão.',409);
    const dir=await this.repoDir(repo),branch=await this.currentBranch(repo,dir);
    const raw=await this.git(dir,['status','--porcelain=v1','-z','--untracked-files=all']);
    const entries=raw.split('\0'),dirty:Array<{path:string;status:string;staged:boolean}>=[];
    for(let index=0;index<entries.length;index++){
      const entry=entries[index];if(!entry||entry.length<4)continue;
      const code=entry.slice(0,2),path=entry.slice(3);
      if(code.includes('R')||code.includes('C'))index++;
      try{asRule(()=>gitPaths([path]));dirty.push({path,status:code==='??'||code.includes('A')?'added':code.includes('D')?'deleted':'modified',staged:code[0]!==' '&&code[0]!=='?'});}catch{/* Arquivos ignorados pela política Git não são sugeridos. */}
    }
    const latest=await this.db.one<{created_at:string}>('SELECT created_at FROM git_card_commits WHERE card_id=$1 AND repository_id=$2 ORDER BY created_at DESC LIMIT 1',[cardId,repo.id]);
    const runs=await this.db.query<{summary:string|null;file_changes:Array<{path:string;kind:string}>;suggested_commit_type:string|null;suggested_commit_name:string|null;suggested_commit_summary:string|null}>('SELECT summary,file_changes,suggested_commit_type,suggested_commit_name,suggested_commit_summary FROM card_ai_runs WHERE card_id=$1 AND project_id=$2 AND status=$3 AND ($4::timestamptz IS NULL OR finished_at>$4) ORDER BY finished_at DESC LIMIT 30',[cardId,repo.project_id,'success',latest?.created_at||null]);
    const changed=new Set<string>(),dirtySet=new Set(dirty.map(file=>file.path));let summary:string|null=null,aiCommit:typeof runs[number]|null=null;
    const prefix=repo.relative_path==='.'?'':repo.relative_path.replace(/^\.\//,'').replace(/\/$/,'')+'/';
    for(const run of runs){let matched=false;for(const change of run.file_changes||[]){const projectPath=change.path.replace(/^\.\//,'');const path=prefix&&projectPath.startsWith(prefix)?projectPath.slice(prefix.length):prefix?'':projectPath;if(dirtySet.has(path)){changed.add(path);matched=true;}}if(matched&&!aiCommit){summary=run.summary;aiCommit=run;}}
    if(!summary){const latestRun=runs.find(run=>run.summary?.trim()||run.suggested_commit_type||run.suggested_commit_name||run.suggested_commit_summary);summary=latestRun?.summary||null;aiCommit=aiCommit||latestRun||null;}
    const aiType=validCommitType(aiCommit?.suggested_commit_type)?aiCommit.suggested_commit_type:null;
    const aiSummary=aiCommit?.suggested_commit_summary?.trim()||'';
    const aiName=aiCommit?.suggested_commit_name?.trim()||'';
    const aiSubject=(aiSummary||aiName).replace(/\s+/g,' ').slice(0,100);
    const hasCommitSuggestion=Boolean(aiType&&aiSubject);
    return {repository_id:repo.id,branch,files:dirty.map(file=>({...file,suggested:changed.has(file.path)})),type:aiType||'',subject:aiSubject,description:'',has_commit_suggestion:hasCommitSuggestion,source:hasCommitSuggestion?'card_execution':'manual'};
  }
  async workingFileDiff(cardId:string,userId:string,repositoryId:string,pathInput:unknown){
    const card=await this.writableCard(cardId,userId),repo=await this.repository(id(repositoryId),userId);
    if(repo.project_id!==card.project_id)bad('Repositório não pertence ao projeto do cartão.',409);
    const path=asRule(()=>gitPaths([pathInput]))[0],dir=await this.repoDir(repo),branch=await this.currentBranch(repo,dir);
    const status=(await this.git(dir,['status','--porcelain=v1','-z','--untracked-files=all','--',path]));
    if(!status)bad('O arquivo não possui alterações locais.',409);
    const head=await this.git(dir,['rev-parse','--verify','HEAD']).catch(()=>null);
    const headEntry=head?(await this.git(dir,['ls-tree','-z','HEAD','--',path])).split('\0').find(entry=>entry.endsWith(`\t${path}`)):undefined;
    const indexEntry=(await this.git(dir,['ls-files','--stage','-z','--',path])).split('\0').find(entry=>entry.endsWith(`\t${path}`));
    const headSha=headEntry?.match(/^\d+ blob ([a-f0-9]{40})\t/)?.[1],indexSha=indexEntry?.match(/^\d+ ([a-f0-9]{40}) 0\t/)?.[1];
    const mode=indexEntry?.match(/^(\d+) /)?.[1]||headEntry?.match(/^(\d+) /)?.[1]||'100644';
    const file=resolve(dir,path);let currentBuffer:Buffer|null=null,currentMode=mode;
    try{const info=await lstat(file);if(!info.isFile())bad('Somente arquivos comuns podem ser revisados.',400);const real=await realpath(file),rel=relative(dir,real);if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))bad('Arquivo fora do repositório.',400);currentMode=info.mode&0o111?'100755':'100644';if(info.size<=120_000)currentBuffer=await readFile(file);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    const tooLarge=Boolean(currentBuffer===null&&await lstat(file).then(info=>info.size>120_000).catch(()=>false))||Boolean(headSha&&Number((await this.git(dir,['cat-file','-s',headSha])).trim())>120_000)||Boolean(indexSha&&Number((await this.git(dir,['cat-file','-s',indexSha])).trim())>120_000);
    if(tooLarge)return {path,branch,base:'',current:'',index:'',sections:[],staged_sections:[],too_large:true,binary:false,etag:'',staged:Boolean(indexSha&&indexSha!==headSha),mode:currentMode};
    const base=headSha?await this.git(dir,['show',`HEAD:${path}`]):'',index=indexSha?await this.git(dir,['show',`:${path}`]):'';
    let current='';let binary=false;
    if(currentBuffer){try{current=new TextDecoder('utf-8',{fatal:true}).decode(currentBuffer)}catch{binary=true}}
    if(base.includes('\0')||index.includes('\0')||base.includes('\ufffd')||index.includes('\ufffd'))binary=true;
    if(binary)return {path,branch,base:'',current:'',index:'',sections:[],staged_sections:[],too_large:false,binary:true,etag:'',staged:index!==base,mode:currentMode};
    const result=compareText(base,current),etag=createHash('sha256').update(JSON.stringify([base,index,current,currentMode])).digest('hex');
    return {path,branch,base,current,index,sections:result.sections,staged_sections:compareText(base,index).sections,too_large:result.tooLarge,binary:false,etag,staged:index!==base,mode:currentMode,current_exists:currentBuffer!==null,base_exists:Boolean(headSha)};
  }
  async stageHunks(cardId:string,userId:string,repositoryId:string,body:Record<string,unknown>){
    const review=await this.workingFileDiff(cardId,userId,repositoryId,body.path);
    if(review.too_large||review.binary)bad('Este arquivo só pode ser adicionado por inteiro.',409);
    if(typeof body.etag!=='string'||body.etag!==review.etag)bad('O arquivo mudou desde a revisão. Atualize o diff.',409);
    if(!Array.isArray(body.choices)||body.choices.some(choice=>typeof choice!=='boolean'))bad('Seleção dos trechos inválida.');
    if(body.source!==undefined&&body.source!=='working'&&body.source!=='index')bad('Origem do diff inválida.');
    const content=asRule(()=>mergeText(body.source==='index'?review.staged_sections:review.sections,body.choices as boolean[]));
    const repo=await this.repository(id(repositoryId),userId),dir=await this.repoDir(repo);
    if(!content&&(!review.current_exists||!review.base_exists)){await this.git(dir,['update-index','--force-remove','--',review.path]);}
    else{
      const temp=await mkdtemp(join(tmpdir(),'orbit-git-review-'));
      try{const file=join(temp,'content');await writeFile(file,content,{mode:0o600});const sha=(await this.git(dir,['hash-object','-w',file])).trim();await this.git(dir,['update-index','--add','--cacheinfo',review.mode,sha,review.path]);}
      finally{await rm(temp,{recursive:true,force:true})}
    }
    return {path:review.path,staged:true,files:(await this.git(dir,['diff','--cached','--name-only','-z'])).split('\0').filter(Boolean)};
  }
  async stageFiles(cardId:string,userId:string,repositoryId:string,body:Record<string,unknown>){
    const card=await this.writableCard(cardId,userId),repo=await this.repository(id(repositoryId),userId);
    if(repo.project_id!==card.project_id)bad('Repositório não pertence ao projeto do cartão.',409);
    const selected=body.paths===undefined||Array.isArray(body.paths)&&body.paths.length===0?[]:asRule(()=>gitPaths(body.paths));
    const ignored=body.ignore_paths===undefined||Array.isArray(body.ignore_paths)&&body.ignore_paths.length===0?[]:asRule(()=>gitPaths(body.ignore_paths));
    if(!selected.length&&!ignored.length)bad('Selecione arquivos para adicionar ou ignorar.');
    if(ignored.includes('.gitignore')||ignored.some(path=>selected.includes(path)))bad('Um arquivo não pode ser adicionado e ignorado ao mesmo tempo.');
    const dir=await this.repoDir(repo),branch=await this.currentBranch(repo,dir);
    for(const path of [...selected,...ignored])if(!(await this.git(dir,['status','--porcelain=v1','--untracked-files=all','--',path])).trim())bad(`O arquivo ${path} não possui alterações locais.`,409);
    await this.explicitFiles(dir,[...selected,...ignored]);
    const stagedBefore=(await this.git(dir,['diff','--cached','--name-only','-z'])).split('\0').filter(Boolean);
    if(stagedBefore.some(path=>![...selected,...ignored,'.gitignore'].includes(path)))bad('Há arquivos já preparados fora desta seleção. Revise o stage antes de continuar.',409);
    if(ignored.length){
      const ignoreFile=join(dir,'.gitignore');let content='';
      try{const info=await lstat(ignoreFile);if(!info.isFile())bad('O .gitignore não é um arquivo comum.',409);content=await readFile(ignoreFile,'utf8');}
      catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      const existing=new Set(content.split(/\r?\n/)),patterns=ignored.map(path=>`/${path}`);
      const additions=patterns.filter(pattern=>!existing.has(pattern));
      if(additions.length)await writeFile(ignoreFile,`${content}${content&&!content.endsWith('\n')?'\n':''}${additions.join('\n')}\n`);
      for(const path of ignored){const tracked=(await this.git(dir,['ls-files','--',path])).trim();if(tracked)await this.git(dir,['rm','--cached','-f','--',path]);}
      await this.git(dir,['add','--','.gitignore']);
    }
    const toAdd=[];
    for(const path of selected){const staged=(await this.git(dir,['diff','--cached','--numstat','--',path])).trim(),unstaged=(await this.git(dir,['diff','--numstat','--',path])).trim();if(!(staged&&unstaged))toAdd.push(path);}
    if(toAdd.length)await this.git(dir,['add','--',...toAdd]);
    const files=(await this.git(dir,['diff','--cached','--name-only','-z'])).split('\0').filter(Boolean);
    return {branch,files,ignored};
  }
  async commitPrepared(cardId:string,userId:string,body:Record<string,unknown>){
    const card=await this.writableCard(cardId,userId),repo=await this.repository(id(body.repository_id),userId);
    if(repo.project_id!==card.project_id)bad('Repositório não pertence ao projeto do cartão.',409);
    const dir=await this.repoDir(repo),branch=await this.currentBranch(repo,dir),expected=asRule(()=>gitPaths(body.paths));
    const files=(await this.git(dir,['diff','--cached','--name-only','-z'])).split('\0').filter(Boolean);
    if(files.length!==expected.length||files.some(file=>!expected.includes(file)))bad('O stage mudou desde a revisão. Confira os arquivos antes de commitar.',409);
    const stat=await this.git(dir,['diff','--cached','--shortstat']),message=asRule(()=>conventionalMessage(body.type,body.subject||card.title,files,stat));
    const description=asRule(()=>commitDescription(body.description,message.body));
    await this.git(dir,['commit','-m',message.subject,'-m',description]);
    const sha=(await this.git(dir,['rev-parse','HEAD'])).trim(),metadata=await this.commitMetadata(repo,dir,sha,branch);
    return this.db.one('INSERT INTO git_card_commits(card_id,repository_id,sha,branch,title,comments,files,merge,url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[cardId,repo.id,sha,branch,metadata.subject,metadata.comments,JSON.stringify(metadata.files),metadata.merge,metadata.url]);
  }
  async toggleCardCommit(cardId:string,userId:string,repositoryId:string,shaInput:string){
    const card=await this.writableCard(cardId,userId),repo=await this.repository(id(repositoryId),userId);
    if(repo.project_id!==card.project_id)bad('Repositório não pertence ao projeto do cartão.',409);
    if(!/^[a-f0-9]{40}$/i.test(shaInput))bad('SHA inválido.');
    const original=await this.db.one<{sha:string;branch:string;action:string;merge:boolean;title:string}>('SELECT sha,branch,action,merge,title FROM git_card_commits WHERE card_id=$1 AND repository_id=$2 AND sha=$3',[cardId,repo.id,shaInput]);
    if(!original||original.action!=='commit')return bad('Este commit não pertence ao histórico original do cartão.',404);
    const dir=await this.repoDir(repo),branch=await this.currentBranch(repo,dir);
    if(branch!==original.branch)bad('Abra a branch original do commit para desfazer ou refazer.',409);
    if((await this.git(dir,['status','--porcelain=v1'])).trim())bad('A árvore de trabalho deve estar limpa para desfazer ou refazer.',409);
    await this.git(dir,['merge-base','--is-ancestor',original.sha,branch]);
    const latest=await this.db.one<{sha:string;action:'undo'|'redo'}>('SELECT sha,action FROM git_card_commits WHERE card_id=$1 AND repository_id=$2 AND target_sha=$3 ORDER BY created_at DESC,id DESC LIMIT 1',[cardId,repo.id,original.sha]);
    const source=latest?.sha||original.sha,action=latest?.action==='undo'?'redo':'undo';
    try{await this.git(dir,latest||!original.merge?['revert','--no-commit',source]:['revert','--no-commit','-m','1',source]);await this.git(dir,['commit','-m',`chore: ${action==='undo'?'desfazer':'refazer'} ${original.title.replace(/^[a-z]+(?:\([^)]+\))?!?:\s*/i,'').slice(0,75)}`]);}
    catch(error){try{await this.git(dir,['revert','--abort'])}catch{/* A operação pode ter falhado antes de iniciar o revert. */}bad(`Não foi possível ${action==='undo'?'desfazer':'refazer'} este commit: ${(error as Error).message}`,409)}
    const sha=(await this.git(dir,['rev-parse','HEAD'])).trim(),metadata=await this.commitMetadata(repo,dir,sha,branch);
    return this.db.one('INSERT INTO git_card_commits(card_id,repository_id,sha,branch,title,comments,files,merge,url,action,target_sha) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[cardId,repo.id,sha,branch,metadata.subject,metadata.comments,JSON.stringify(metadata.files),metadata.merge,metadata.url,action,original.sha]);
  }
  async repositoryHistory(cardId:string,userId:string,repositoryId:string,offsetInput:unknown=0,limitInput:unknown=5){
    const card=await this.card(cardId,userId),repo=await this.cardRepository(repositoryId,card.project_id);
    const offset=Number(offsetInput||0);if(!Number.isInteger(offset)||offset<0||offset>10000)bad('Página de commits inválida.');
    const limit=Number(limitInput||5);if(!Number.isInteger(limit)||limit<1||limit>50)bad('Tamanho da página inválido.');
    const dir=await this.repoDir(repo),branch=await this.currentBranch(repo,dir);
    const shas=(await this.git(dir,['log','-n',String(limit+1),'--skip',String(offset),'--format=%H',branch])).trim().split('\n').filter(Boolean);
    const commits=[];
    for(const sha of shas.slice(0,limit)){
      const metadata=await this.commitMetadata(repo,dir,sha,branch);
      const createdAt=(await this.git(dir,['show','-s','--format=%aI',sha])).trim();
      commits.push({repository_id:repo.id,sha,branch,title:metadata.subject,comments:metadata.comments.slice(0,2000),files:metadata.files,merge:metadata.merge,url:metadata.url,created_at:createdAt,repository:repo.name});
    }
    return {repository_id:repo.id,branch,commits,has_more:shas.length>limit};
  }
  async commitDiff(cardId:string,userId:string,repositoryId:string,shaInput:string){
    const card=await this.card(cardId,userId),repo=await this.cardRepository(repositoryId,card.project_id);
    if(!/^[a-f0-9]{7,40}$/i.test(shaInput))bad('SHA inválido.');
    const dir=await this.repoDir(repo),branch=await this.currentBranch(repo,dir);
    await this.git(dir,['merge-base','--is-ancestor',shaInput,branch]);
    const sha=(await this.git(dir,['rev-parse','--verify',`${shaInput}^{commit}`])).trim();
    const parents=(await this.git(dir,['show','-s','--format=%P',sha])).trim().split(/\s+/).filter(Boolean);
    const args=parents.length?['diff','--no-ext-diff','--no-color','--unified=3',parents[0],sha,'--']:['show','--format=','--no-ext-diff','--no-color','--root','--unified=3',sha,'--'];
    const patch=safeLog(await this.git(dir,args));
    return {sha,branch,patch:patch.slice(0,120_000),truncated:patch.length>120_000};
  }
  private async commitMetadata(repo:Repo,dir:string,sha:string,branch:string){if(!/^[a-f0-9]{7,40}$/i.test(sha))bad('SHA inválido.');const parents=(await this.git(dir,['show','-s','--format=%P',sha])).trim().split(/\s+/).filter(Boolean);const subject=(await this.git(dir,['show','-s','--format=%s',sha])).trim();const comments=(await this.git(dir,['show','-s','--format=%b',sha])).trim();const files=(await this.git(dir,parents.length>1?['diff','--name-only',`${sha}^1`,sha]:['diff-tree','--root','--no-commit-id','--name-only','-r',sha])).trim().split('\n').filter(Boolean);let remote='';try{remote=(await this.git(dir,['remote','get-url',repo.remote_name])).trim()}catch{/* Histórico local também funciona sem remote. */}let url:string|null=null;try{const parsed=new URL(remote);if(parsed.protocol==='https:'&&!parsed.username&&!parsed.password&&/^\/[\w.-]+\/[\w.-]+(?:\.git)?$/.test(parsed.pathname))url=`${parsed.origin}${parsed.pathname.replace(/\.git$/,'')}/commit/${sha}`}catch{url=null}return {subject,comments,files,merge:parents.length>1,url,branch}}
  async linkCommit(cardId:string,userId:string,body:Record<string,unknown>){const card=await this.writableCard(cardId,userId),repo=await this.repository(id(body.repository_id),userId);if(repo.project_id!==card.project_id)bad('Repositório não pertence ao projeto do cartão.',409);const dir=await this.repoDir(repo),branch=asRule(()=>branchName(body.branch));await this.allowedRepositoryBranch(repo,branch);const sha=text(body.sha,'SHA',40);await this.git(dir,['merge-base','--is-ancestor',sha,branch]);const metadata=await this.commitMetadata(repo,dir,sha,branch);return this.db.one('INSERT INTO git_card_commits(card_id,repository_id,sha,branch,title,comments,files,merge,url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(card_id,repository_id,sha) DO UPDATE SET title=$5,comments=$6,files=$7,merge=$8,url=$9 RETURNING *',[cardId,repo.id,sha,branch,metadata.subject,metadata.comments,JSON.stringify(metadata.files),metadata.merge,metadata.url])}
  async commit(cardId:string,userId:string,body:Record<string,unknown>){const card=await this.writableCard(cardId,userId),repo=await this.repository(id(body.repository_id),userId);if(repo.project_id!==card.project_id)bad('Repositório não pertence ao projeto do cartão.',409);const dir=await this.repoDir(repo),branch=await this.currentBranch(repo,dir),paths=asRule(()=>gitPaths(body.paths));await this.explicitFiles(dir,paths);const before=(await this.git(dir,['diff','--cached','--name-only'])).trim().split('\n').filter(Boolean);if(before.some(file=>!paths.some(path=>file===path||file.startsWith(path+'/'))))bad('Há arquivos preparados fora dos caminhos selecionados.',409);await this.git(dir,['add','--',...paths]);const files=(await this.git(dir,['diff','--cached','--name-only'])).trim().split('\n').filter(Boolean);if(!files.length)bad('Nenhuma alteração para commitar.',409);const stat=await this.git(dir,['diff','--cached','--shortstat']);const message=asRule(()=>conventionalMessage(body.type,body.subject||card.title,files,stat));const description=asRule(()=>commitDescription(body.description,message.body));await this.git(dir,['commit','-m',message.subject,'-m',description]);const sha=(await this.git(dir,['rev-parse','HEAD'])).trim();const metadata=await this.commitMetadata(repo,dir,sha,branch);return this.db.one('INSERT INTO git_card_commits(card_id,repository_id,sha,branch,title,comments,files,merge,url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[cardId,repo.id,sha,branch,metadata.subject,metadata.comments,JSON.stringify(metadata.files),metadata.merge,metadata.url])}
  async gitOperation(cardId:string,userId:string,body:Record<string,unknown>){const card=await this.writableCard(cardId,userId),repo=await this.repository(id(body.repository_id),userId);if(repo.project_id!==card.project_id)bad('Repositório não pertence ao projeto do cartão.',409);const dir=await this.repoDir(repo),branch=await this.currentBranch(repo,dir),operation=body.operation;if(operation==='add'){const paths=asRule(()=>gitPaths(body.paths));await this.explicitFiles(dir,paths);await this.git(dir,['add','--',...paths]);return {operation,branch,files:(await this.git(dir,['diff','--cached','--name-only'])).trim().split('\n').filter(Boolean)}}if(operation==='push'){const output=await this.git(dir,['push',repo.remote_name,branch]);return {operation,branch,output:safeLog(output).slice(0,4000)}}if(operation==='pull'){const dirty=(await this.git(dir,['status','--porcelain'])).trim();if(dirty)bad('A árvore de trabalho deve estar limpa para executar pull.',409);const output=await this.git(dir,['pull','--ff-only',repo.remote_name,branch]);return {operation,branch,output:safeLog(output).slice(0,4000)}}return bad('Operação Git inválida.')}
  async deploy(cardId:string,userId:string,body:Record<string,unknown>){const card=await this.writableCard(cardId,userId),target=await this.target(id(body.target_id),userId),repo=await this.repository(target.repository_id,userId);if(repo.project_id!==card.project_id)bad('Pipeline não pertence ao projeto do cartão.',409);if(!target.active)bad('Pipeline desativado.',409);const branch=asRule(()=>branchName(body.branch));asRule(()=>allowedBranch(branch,repo.branches,target.branches));const mapping=await this.db.one<{stage_key:string}>('SELECT stage_key FROM git_column_stages WHERE list_id=$1 AND target_id=$2',[card.list_id,target.id]);const stage=body.stage_key===undefined?mapping?.stage_key:stageName(body.stage_key);if(stage&&!target.stages.includes(stage))bad('Etapa não configurada no pipeline.');const row=await this.db.one<{id:string}>('INSERT INTO git_pipeline_runs(target_id,card_id,stage_key,branch,status) VALUES($1,$2,$3,$4,$5) RETURNING id',[target.id,cardId,stage||null,branch,'queued']);try{let localLog='';if(target.git_flow!=='pipeline_only'){const dir=await this.repoDir(repo),actual=await this.currentBranch(repo,dir);if(actual!==branch)bad('A branch local deve corresponder à branch do pipeline.',409);if(target.git_flow==='commit_push'){const created=await this.commit(cardId,userId,{repository_id:repo.id,type:body.type??'chore',subject:body.subject??card.title,paths:body.paths});localLog=`Commit ${String((created as {sha:string}|null)?.sha||'')} criado e enviado.\n`;await this.gitOperation(cardId,userId,{repository_id:repo.id,operation:'push'})}else if(target.git_flow==='pull_push'){await this.gitOperation(cardId,userId,{repository_id:repo.id,operation:'pull'});await this.gitOperation(cardId,userId,{repository_id:repo.id,operation:'push'});localLog='Pull e push concluídos.\n'}}const token=this.vault.open<{token:string}>(target.credentials_encrypted).token;const result=await dispatchPipeline(target,branch,token,stage);await this.db.query('UPDATE git_pipeline_runs SET external_run_id=$2,status=$3,logs=$4,updated_at=now() WHERE id=$1',[row!.id,result.externalId,result.status,redact(localLog+result.logs).split(token).join('[REDACTED]')]);return this.runDetail(row!.id,userId)}catch(error){await this.db.query('UPDATE git_pipeline_runs SET status=$2,error=$3,updated_at=now() WHERE id=$1',[row!.id,'failed',redact((error as Error).message).slice(0,2000)]);throw error}}
  async runDetail(runId:string,userId:string){const row=await this.db.one<{id:string;target_id:string;external_run_id:string|null;branch:string;status:string;stage_key:string|null;logs:string;error:string|null;provider:Provider;base_url:string;external_project:string;pipeline_ref:string;credentials_encrypted:string}>('SELECT r.*,t.provider,t.base_url,t.external_project,t.pipeline_ref,t.credentials_encrypted FROM git_pipeline_runs r JOIN git_pipeline_targets t ON t.id=r.target_id WHERE r.id=$1 AND t.owner_id=$2',[id(runId),userId]);if(!row)bad('Execução não encontrada.',404);return {id:row!.id,target_id:row!.target_id,branch:row!.branch,stage_key:row!.stage_key,status:row!.status,logs:row!.logs,error:row!.error}}
  async refreshRun(runId:string,userId:string){const run=await this.db.one<{id:string;target_id:string;external_run_id:string|null;branch:string;status:string}>('SELECT r.id,r.target_id,r.external_run_id,r.branch,r.status FROM git_pipeline_runs r JOIN git_pipeline_targets t ON t.id=r.target_id WHERE r.id=$1 AND t.owner_id=$2',[id(runId),userId]);if(!run)bad('Execução não encontrada.',404);if(run!.status==='success'||run!.status==='failed')return this.runDetail(runId,userId);const target=await this.target(run!.target_id,userId);try{const token=this.vault.open<{token:string}>(target.credentials_encrypted).token;const result=await pollPipeline(target,run!.external_run_id,run!.branch,token);await this.db.query('UPDATE git_pipeline_runs SET external_run_id=COALESCE($2,external_run_id),status=$3,logs=$4,updated_at=now() WHERE id=$1',[runId,result.externalId,result.status,redact(result.logs).split(token).join('[REDACTED]')]);return this.runDetail(runId,userId)}catch(error){await this.db.query('UPDATE git_pipeline_runs SET error=$2,updated_at=now() WHERE id=$1',[runId,redact((error as Error).message).slice(0,2000)]);return this.runDetail(runId,userId)}}
}

export const gitPluginDefinition=(git:GitPlugin,deliveryGit?:DeliveryGitService):PluginDefinition=>({
  id:'git',name:'Git',version:'1.0.0',scope:'account',
  capabilities:[
    {id:'history.read',name:'Ler histórico Git',permissions:['repository.read']},
    {id:'commit.write',name:'Criar commits',permissions:['repository.write']},
    {id:'pipeline.run',name:'Executar pipelines',permissions:['process.execute']},
  ],
  actions:[
    {id:'history',name:'Consultar commits do card',requiredCapabilities:['history.read'],inputSchema:{type:'object',properties:{},additionalProperties:false},async execute(_input,context){if(!context.userId||!context.cardId)throw new Error('Card e usuário obrigatórios.');return {type:'git',label:'Histórico Git',value:await git.cardHistory(context.cardId,context.userId)}}},
    {id:'commit',name:'Criar commit Conventional Commits',requiredCapabilities:['commit.write'],inputSchema:{type:'object',required:['repository_id','type','paths'],properties:{repository_id:{type:'string'},type:{enum:['feat','fix','chore']},subject:{type:'string'},description:{type:'string'},paths:{type:'array',items:{type:'string'},minItems:1}},additionalProperties:false},async execute(input,context){if(!context.userId||!context.cardId)throw new Error('Card e usuário obrigatórios.');return {type:'git',label:'Commit criado',value:await git.commit(context.cardId,context.userId,input)}}},
    {id:'operation',name:'Executar add, push ou pull',requiredCapabilities:['commit.write'],inputSchema:{type:'object',required:['repository_id','operation'],properties:{repository_id:{type:'string'},operation:{enum:['add','push','pull']},paths:{type:'array',items:{type:'string'}}},additionalProperties:false},async execute(input,context){if(!context.userId||!context.cardId)throw new Error('Card e usuário obrigatórios.');return {type:'git',label:'Operação Git',value:await git.gitOperation(context.cardId,context.userId,input)}}},
    {id:'repository_operation',name:'Operações Git de Delivery',requiredCapabilities:['commit.write'],inputSchema:{type:'object',required:['repositoryId','operation'],properties:{repositoryId:{type:'string'},operation:{enum:['status','add','commit','push','pull','fetch','checkout','switch','merge','tag','log']},remoteId:{type:'string'},branch:{type:'string'},source:{type:'string'},paths:{type:'array',items:{type:'string'}},message:{type:'string'},tag:{type:'string'},executor:{enum:['local','ssh']},serverId:{type:'string'},workingDirectory:{type:'string'}},additionalProperties:false},async execute(input,context){if(!deliveryGit||!context.userId)throw new Error('Serviço Git indisponível.');return {type:'git',label:'Operação Git',value:await deliveryGit.direct(context.userId,String(input.repositoryId),`git.${String(input.operation)}`,input)}}},
    {id:'deploy',name:'Executar pipeline do projeto',requiredCapabilities:['pipeline.run'],inputSchema:{type:'object',required:['target_id','branch'],properties:{target_id:{type:'string'},branch:{type:'string'},paths:{type:'array',items:{type:'string'}},type:{enum:['feat','fix','chore']},subject:{type:'string'}},additionalProperties:false},async execute(input,context){if(!context.userId||!context.cardId)throw new Error('Card e usuário obrigatórios.');return {type:'git',label:'Pipeline disparado',value:await git.deploy(context.cardId,context.userId,input)}}},
  ],
  contributions:{settings:[{id:'git',label:'Git e deploy',href:'/profile?tab=projects'}],resourceRenderers:[{resourceTypes:['commit','pipeline_run'],component:'git-resource'}]},
});

@Controller('git')
export class GitController {
  constructor(@Inject(GitPlugin) private gitPlugin:GitPlugin,@Inject(FeaturesService) private features:FeaturesService){}
  private user(req:Request){return this.features.user(req)}
  @Get('projects/:id') project(@Req() req:Request,@Param('id') projectId:string){return this.gitPlugin.projectConfig(projectId,this.user(req))}
  @Patch('projects/:id/default-repository') defaultRepository(@Req() req:Request,@Param('id') projectId:string,@Body() body:Record<string,unknown>){return this.gitPlugin.setDefaultRepository(projectId,this.user(req),id(body.repository_id))}
  @Post('projects/:id/repositories') addRepository(@Req() req:Request,@Param('id') projectId:string,@Body() body:Record<string,unknown>){return this.gitPlugin.addRepository(projectId,this.user(req),body)}
  @Delete('repositories/:id') removeRepository(@Req() req:Request,@Param('id') repoId:string){return this.gitPlugin.removeRepository(repoId,this.user(req))}
  @Post('repositories/:id/targets') addTarget(@Req() req:Request,@Param('id') repoId:string,@Body() body:Record<string,unknown>){return this.gitPlugin.addTarget(repoId,this.user(req),body)}
  @Delete('targets/:id') removeTarget(@Req() req:Request,@Param('id') targetId:string){return this.gitPlugin.removeTarget(targetId,this.user(req))}
  @Patch('columns/:listId/stages/:targetId') mapColumn(@Req() req:Request,@Param('listId') listId:string,@Param('targetId') targetId:string,@Body() body:Record<string,unknown>){return this.gitPlugin.mapColumn(listId,targetId,this.user(req),body)}
  @Delete('columns/:listId/stages/:targetId') unmapColumn(@Req() req:Request,@Param('listId') listId:string,@Param('targetId') targetId:string){return this.gitPlugin.unmapColumn(listId,targetId,this.user(req))}
  @Get('cards/:id') card(@Req() req:Request,@Param('id') cardId:string){return this.gitPlugin.cardHistory(cardId,this.user(req))}
  @Get('cards/:id/commits') cardCommits(@Req() req:Request,@Param('id') cardId:string,@Query('offset') offset:string,@Query('limit') limit:string){return this.gitPlugin.cardCommits(cardId,this.user(req),offset,limit)}
  @Post('cards/:id/repositories/:repositoryId/commits/:sha/toggle') toggleCardCommit(@Req() req:Request,@Param('id') cardId:string,@Param('repositoryId') repositoryId:string,@Param('sha') sha:string){return this.gitPlugin.toggleCardCommit(cardId,this.user(req),repositoryId,sha)}
  @Get('cards/:id/repositories/:repositoryId/commits') repositoryHistory(@Req() req:Request,@Param('id') cardId:string,@Param('repositoryId') repositoryId:string,@Query('offset') offset:string,@Query('limit') limit:string){return this.gitPlugin.repositoryHistory(cardId,this.user(req),repositoryId,offset,limit)}
  @Get('cards/:id/repositories/:repositoryId/commits/:sha/diff') commitDiff(@Req() req:Request,@Param('id') cardId:string,@Param('repositoryId') repositoryId:string,@Param('sha') sha:string){return this.gitPlugin.commitDiff(cardId,this.user(req),repositoryId,sha)}
  @Get('cards/:id/repositories/:repositoryId/commit-draft') commitDraft(@Req() req:Request,@Param('id') cardId:string,@Param('repositoryId') repositoryId:string){return this.gitPlugin.commitDraft(cardId,this.user(req),repositoryId)}
  @Get('cards/:id/repositories/:repositoryId/files/diff') workingFileDiff(@Req() req:Request,@Param('id') cardId:string,@Param('repositoryId') repositoryId:string,@Query('path') path:string){return this.gitPlugin.workingFileDiff(cardId,this.user(req),repositoryId,path)}
  @Post('cards/:id/repositories/:repositoryId/files/stage-hunks') stageHunks(@Req() req:Request,@Param('id') cardId:string,@Param('repositoryId') repositoryId:string,@Body() body:Record<string,unknown>){return this.gitPlugin.stageHunks(cardId,this.user(req),repositoryId,body)}
  @Post('cards/:id/repositories/:repositoryId/stage') stageFiles(@Req() req:Request,@Param('id') cardId:string,@Param('repositoryId') repositoryId:string,@Body() body:Record<string,unknown>){return this.gitPlugin.stageFiles(cardId,this.user(req),repositoryId,body)}
  @Post('cards/:id/commits/prepared') commitPrepared(@Req() req:Request,@Param('id') cardId:string,@Body() body:Record<string,unknown>){return this.gitPlugin.commitPrepared(cardId,this.user(req),body)}
  @Post('cards/:id/commits') commit(@Req() req:Request,@Param('id') cardId:string,@Body() body:Record<string,unknown>){return this.gitPlugin.commit(cardId,this.user(req),body)}
  @Post('cards/:id/link-commit') linkCommit(@Req() req:Request,@Param('id') cardId:string,@Body() body:Record<string,unknown>){return this.gitPlugin.linkCommit(cardId,this.user(req),body)}
  @Post('cards/:id/operations') operation(@Req() req:Request,@Param('id') cardId:string,@Body() body:Record<string,unknown>){return this.gitPlugin.gitOperation(cardId,this.user(req),body)}
  @Post('cards/:id/deploys') deploy(@Req() req:Request,@Param('id') cardId:string,@Body() body:Record<string,unknown>){return this.gitPlugin.deploy(cardId,this.user(req),body)}
  @Get('runs/:id') run(@Req() req:Request,@Param('id') runId:string){return this.gitPlugin.runDetail(runId,this.user(req))}
  @Post('runs/:id/refresh') refresh(@Req() req:Request,@Param('id') runId:string){return this.gitPlugin.refreshRun(runId,this.user(req))}
}

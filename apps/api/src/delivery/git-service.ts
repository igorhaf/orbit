import {Inject,Injectable} from '@nestjs/common';
import {mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {Db} from '../db';
import {allowedBranch,branchName,gitPaths} from '../git/rules';
import {CommandExecutorRegistry,CommandResult,DeliveryCredentialService,shellQuote} from './executors';
import {StepServices} from './contracts';

type Repository={id:string;project_id:string;relative_path:string;branches:string[];local_path:string};
type Remote={id:string;repository_id:string;name:string;url:string;credential_id:string|null;default_branch:string|null};
const name=(input:unknown)=>{if(typeof input!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(input))throw new Error('Remote inválido.');return input};
const str=(input:unknown,label:string)=>{if(typeof input!=='string'||!input.trim()||input.length>1000)throw new Error(`${label} inválido.`);return input.trim()};
const trim=(result:CommandResult)=>{if(!result.success)throw new Error(result.stderr||`Git retornou ${result.exitCode}.`);return result.stdout.trim()};

@Injectable()
export class DeliveryGitService {
  constructor(@Inject(Db) private db:Db,@Inject(CommandExecutorRegistry) private executors:CommandExecutorRegistry,@Inject(DeliveryCredentialService) private credentials:DeliveryCredentialService){}
  async repository(id:string,userId:string,projectId:string){const row=await this.db.one<Repository>('SELECT r.id,r.project_id,r.relative_path,r.branches,p.local_path FROM git_repositories r JOIN ai_projects p ON p.id=r.project_id WHERE r.id=$1 AND r.project_id=$2 AND r.owner_id=$3 AND p.owner_id=$3',[id,projectId,userId]);if(!row)throw new Error('Repositório não autorizado.');return row}
  async remote(remoteId:string,repositoryId:string){const row=await this.db.one<Remote>('SELECT id,repository_id,name,url,credential_id,default_branch FROM delivery_git_remotes WHERE id=$1 AND repository_id=$2',[remoteId,repositoryId]);if(!row)throw new Error('Remote não pertence ao repositório.');return row}
  async direct(userId:string,repositoryId:string,type:string,config:Record<string,unknown>){const row=await this.db.one<{project_id:string}>('SELECT r.project_id FROM git_repositories r JOIN ai_projects p ON p.id=r.project_id WHERE r.id=$1 AND r.owner_id=$2 AND p.owner_id=$2',[repositoryId,userId]);if(!row)throw new Error('Repositório não autorizado.');const output=await this.operation(type,{...config,repositoryId},{userId,projectId:row.project_id,runId:'manual',context:{values:{},steps:{}},timeoutMs:60000});await this.db.query('INSERT INTO delivery_audit(actor_id,event,details) VALUES($1,$2,$3::jsonb)',[userId,type,JSON.stringify({repositoryId,branch:output.outputs.branch})]);return output}
  async operation(type:string,config:Record<string,unknown>,services:StepServices){
    const repository=await this.repository(str(config.repositoryId,'Repositório'),services.userId,services.projectId);
    const executor=this.executors.get(typeof config.executor==='string'?config.executor:'local');
    const cwd=typeof config.workingDirectory==='string'?config.workingDirectory:await realpath(resolve(repository.local_path,repository.relative_path));
    const serverId=typeof config.serverId==='string'?config.serverId:undefined;
    const base={cwd,projectRoot:repository.local_path,serverId,userId:services.userId,timeoutMs:services.timeoutMs};
    const git=async(args:string[],env?:Record<string,string>)=>executor.execute({...base,file:'git',args,env});
    const checked=async(args:string[],env?:Record<string,string>)=>trim(await git(args,env));
    const current=async()=>{const branch=await checked(['branch','--show-current']);return allowedBranch(branch,repository.branches)};
    const allowed=(input:unknown)=>allowedBranch(branchName(input),repository.branches);
    const remote=async()=>{const row=await this.remote(str(config.remoteId,'Remote'),repository.id);const actual=await checked(['remote','get-url',row.name]);if(actual!==row.url)throw new Error('URL do remote difere da configuração.');return row};
    let output='',branch:string|undefined,remoteName:string|undefined;
    if(type==='git.status')output=await checked(['status','--short','--branch']);
    else if(type==='git.add'){branch=await current();const paths=gitPaths(config.paths);output=await checked(['add','--',...paths]);}
    else if(type==='git.commit'){
      branch=await current();const message=str(config.message,'Mensagem de commit');
      const lines=message.split('\n');if(lines.length>3||!/^(feat|fix|chore)(\([a-z0-9-]+\))?!?: [^\n]{1,100}$/.test(lines[0])||lines.slice(1).some(line=>line.length>180))throw new Error('Commit deve usar Conventional Commits e no máximo duas linhas de descrição.');
      await checked(['commit','-m',lines[0],...lines.length>1?['-m',lines.slice(1).join('\n')]:[]]);output=await checked(['rev-parse','HEAD']);
      if(services.cardId)await this.db.query('INSERT INTO git_card_commits(card_id,repository_id,sha,branch,title,comments,files,merge) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,false) ON CONFLICT DO NOTHING',[services.cardId,repository.id,output,branch,lines[0],lines.slice(1).join('\n'),JSON.stringify((await checked(['show','--pretty=format:','--name-only','HEAD'])).split('\n').filter(Boolean))]);
    }
    else if(type==='git.checkout'||type==='git.switch'){branch=allowed(config.branch);output=await checked([type==='git.checkout'?'checkout':'switch',branch]);}
    else if(type==='git.log'){branch=await current();output=await checked(['log','-n','20','--format=%H %s']);}
    else if(type==='git.tag'){branch=await current();const tag=name(config.tag);output=await checked(['tag',tag]);}
    else if(type==='git.merge'){branch=await current();const source=allowed(config.source);if(source===branch)throw new Error('Origem e destino do merge são iguais.');output=await checked(['merge','--no-edit',source]);}
    else if(['git.push','git.pull','git.fetch'].includes(type)){
      const row=await remote();remoteName=row.name;branch=allowed(config.branch??row.default_branch);if(type!=='git.fetch'&&(await current())!==branch)throw new Error('A branch local difere da branch configurada.');
      if(type==='git.pull'&&(await checked(['status','--porcelain'])))throw new Error('Árvore de trabalho deve estar limpa para pull.');
      let env:Record<string,string>|undefined,temporary:string|undefined;
      try{
        if(row.credential_id){
          if(executor.id!=='local')throw new Error('Credencial Git do Orbit só pode ser usada no executor local; configure Git no servidor para SSH.');
          const credential=await this.credentials.resolve(row.credential_id,services.userId,['GIT_TOKEN','GIT_SSH_KEY']);
          if(credential.kind==='GIT_TOKEN'){
            if(!row.url.startsWith('https://'))throw new Error('GIT_TOKEN exige remote HTTPS.');
            const header=`Authorization: Basic ${Buffer.from(`x-access-token:${credential.value}`).toString('base64')}`;
            env={GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:`http.${row.url}.extraHeader`,GIT_CONFIG_VALUE_0:header};
          }else{
            if(row.url.startsWith('https://'))throw new Error('GIT_SSH_KEY exige remote SSH.');
            temporary=await mkdtemp(join(tmpdir(),'orbit-git-'));
            const keyPath=join(temporary,'key');await writeFile(keyPath,credential.value,{mode:0o600});
            env={GIT_SSH_COMMAND:`ssh -i ${shellQuote(keyPath)} -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes`};
          }
        }
        output=await checked(type==='git.pull'?['pull','--ff-only',row.name,branch]:[type.slice(4),row.name,branch],env);
      }finally{if(temporary)await rm(temporary,{recursive:true,force:true})}
    }else throw new Error(`Operação Git não registrada: ${type}`);
    return {outputs:{...branch?{branch}:{},...remoteName?{remote:remoteName}:{},...type==='git.commit'?{commitSha:output}:{},output:output.slice(0,4000)},stdout:output.slice(0,4000),exitCode:0};
  }
}

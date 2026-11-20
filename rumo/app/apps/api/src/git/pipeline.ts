import {HttpException} from '@nestjs/common';
export type Provider='github_actions'|'gitlab_ci'|'bamboo';
export type PipelineTarget={provider:Provider;base_url:string;external_project:string;pipeline_ref:string};
export type PipelineResult={externalId:string|null;status:'queued'|'running'|'success'|'failed';logs:string};
const safeSegment=(value:string)=>encodeURIComponent(value);
export function pipelineBase(input:unknown){
  if(typeof input!=='string'||input.length>500)throw new Error('URL do pipeline inválida.');
  const url=new URL(input);
  if((url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))||url.username||url.password||url.search||url.hash)throw new Error('URL do pipeline deve usar HTTPS e não conter credenciais.');
  return url.toString().replace(/\/$/,'');
}
function endpoint(target:PipelineTarget,path:string){return `${target.base_url}${path}`}
async function request(target:PipelineTarget,path:string,token:string,init:RequestInit={}){
  const headers:Record<string,string>={Accept:'application/json',...target.provider==='gitlab_ci'?{'PRIVATE-TOKEN':token}:{Authorization:`Bearer ${token}`},...init.body?{'Content-Type':'application/json'}:{}};
  const response=await fetch(endpoint(target,path),{...init,headers,redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new HttpException(`O pipeline respondeu HTTP ${response.status}.`,response.status===401||response.status===403?403:502);
  const text=await response.text();
  if(!text)return {} as Record<string,unknown>;
  try{return JSON.parse(text) as Record<string,unknown>}catch{return {text:text.slice(0,64000)}}
}
export async function dispatchPipeline(target:PipelineTarget,branch:string,token:string,stage?:string):Promise<PipelineResult>{
  if(target.provider==='github_actions'){
    const [owner,repo,...extra]=target.external_project.split('/');if(!owner||!repo||extra.length)throw new Error('Repositório GitHub inválido.');
    const data=await request(target,`/repos/${safeSegment(owner)}/${safeSegment(repo)}/actions/workflows/${safeSegment(target.pipeline_ref)}/dispatches`,token,{method:'POST',body:JSON.stringify({ref:branch,inputs:stage?{stage}:undefined})});
    return {externalId:data.workflow_run_id?String(data.workflow_run_id):null,status:'queued',logs:'Workflow enviado ao GitHub Actions.'};
  }
  if(target.provider==='gitlab_ci'){
    const data=await request(target,`/api/v4/projects/${safeSegment(target.external_project)}/pipeline?ref=${safeSegment(branch)}`,token,{method:'POST',body:JSON.stringify(stage?{variables:[{key:'ORBIT_STAGE',value:stage}]}:{})});
    return {externalId:data.id?String(data.id):null,status:'queued',logs:'Pipeline enviado ao GitLab CI/CD.'};
  }
  const plan=target.pipeline_ref;
  const data=await request(target,`/rest/api/latest/queue/${safeSegment(plan)}.json?bamboo.variable.ORBIT_BRANCH=${safeSegment(branch)}${stage?`&bamboo.variable.ORBIT_STAGE=${safeSegment(stage)}`:''}`,token,{method:'POST'});
  return {externalId:data.buildResultKey?String(data.buildResultKey):null,status:'queued',logs:'Plano enviado ao Bamboo.'};
}
export async function pollPipeline(target:PipelineTarget,externalId:string|null,branch:string,token:string):Promise<PipelineResult>{
  if(target.provider==='github_actions'){
    const [owner,repo]=target.external_project.split('/');let id=externalId;
    if(!id){const list=await request(target,`/repos/${safeSegment(owner)}/${safeSegment(repo)}/actions/workflows/${safeSegment(target.pipeline_ref)}/runs?event=workflow_dispatch&branch=${safeSegment(branch)}&per_page=1`,token);const runs=list.workflow_runs as Array<{id:number}>|undefined;id=runs?.[0]?.id?String(runs[0].id):null;if(!id)return {externalId:null,status:'queued',logs:'Aguardando identificação do workflow.'}}
    const run=await request(target,`/repos/${safeSegment(owner)}/${safeSegment(repo)}/actions/runs/${safeSegment(id)}`,token);
    const jobs=await request(target,`/repos/${safeSegment(owner)}/${safeSegment(repo)}/actions/runs/${safeSegment(id)}/jobs?per_page=30`,token);
    const lines=((jobs.jobs||[]) as Array<{name?:string;status?:string;conclusion?:string;steps?:Array<{name?:string;status?:string;conclusion?:string}>}>).flatMap(job=>[`${job.name||'Job'}: ${job.conclusion||job.status||'unknown'}`,...(job.steps||[]).map(step=>`  ${step.name||'Etapa'}: ${step.conclusion||step.status||'unknown'}`)]);
    const status=run.status==='completed'?(run.conclusion==='success'?'success':'failed'):run.status==='in_progress'?'running':'queued';
    return {externalId:id,status,logs:lines.join('\n').slice(0,64000)};
  }
  if(target.provider==='gitlab_ci'){
    if(!externalId)throw new Error('ID do pipeline GitLab ausente.');
    const data=await request(target,`/api/v4/projects/${safeSegment(target.external_project)}/pipelines/${safeSegment(externalId)}`,token);
    const jobs=await request(target,`/api/v4/projects/${safeSegment(target.external_project)}/pipelines/${safeSegment(externalId)}/jobs?per_page=30`,token);
    const lines=(Array.isArray(jobs)?jobs:[]) as Array<{id:number;name:string;status:string}>;
    const details:string[]=[];
    for(const job of lines.slice(0,5)){
      try{const trace=await request(target,`/api/v4/projects/${safeSegment(target.external_project)}/jobs/${safeSegment(String(job.id))}/trace`,token);if(typeof trace.text==='string')details.push(`${job.name}:\n${trace.text.slice(-8000)}`)}catch{details.push(`${job.name}: trace indisponível`)}
    }
    const status=['success'].includes(String(data.status))?'success':['failed','canceled','skipped'].includes(String(data.status))?'failed':String(data.status)==='running'?'running':'queued';
    return {externalId,status,logs:[...lines.map(job=>`${job.name}: ${job.status} (${job.id})`),...details].join('\n').slice(0,64000)};
  }
  const key=externalId?safeSegment(externalId):`${safeSegment(target.pipeline_ref)}/latest`;
  const data=await request(target,`/rest/api/latest/result/${key}.json?expand=logEntries`,token);
  const entries=((data.logEntries as {logEntry?:Array<{log?:string}>}|undefined)?.logEntry||[]).map(entry=>entry.log||'');
  const status=data.buildState==='Successful'?'success':data.buildState==='Failed'?'failed':data.lifeCycleState==='Finished'?'failed':data.lifeCycleState==='InProgress'?'running':'queued';
  return {externalId:String(data.key||externalId||'')||null,status,logs:entries.join('\n').slice(0,64000)};
}

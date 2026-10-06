import assert from 'node:assert/strict';
import {test} from 'node:test';
import {dispatchPipeline,pipelineBase,pollPipeline} from './pipeline';

const originalFetch=globalThis.fetch;
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
test('GitHub Actions dispatch and status use only the requested branch',async()=>{
  const calls:Array<{url:string;body:string|undefined}>=[];
  globalThis.fetch=async(input,init)=>{calls.push({url:String(input),body:init?.body?.toString()});return calls.length===1?reply({workflow_run_id:42}):calls.length===2?reply({status:'completed',conclusion:'success'}):reply({jobs:[{name:'deploy via SSH',status:'completed',conclusion:'success',steps:[{name:'ssh',conclusion:'success'}]}]})};
  try{const target={provider:'github_actions' as const,base_url:'https://api.github.com',external_project:'owner/repo',pipeline_ref:'deploy.yml'};const dispatched=await dispatchPipeline(target,'main','test-token','production');assert.equal(dispatched.externalId,'42');assert.deepEqual(JSON.parse(calls[0].body||''),{ref:'main',inputs:{stage:'production'}});const status=await pollPipeline(target,'42','main','test-token');assert.equal(status.status,'success');assert.match(status.logs,/SSH/)}finally{globalThis.fetch=originalFetch}
});
test('GitLab and Bamboo adapters send configured branch and stage',async()=>{
  const calls:Array<{url:string;body:string|undefined}>=[];
  globalThis.fetch=async(input,init)=>{calls.push({url:String(input),body:init?.body?.toString()});return reply(calls.length===1?{id:9}:{buildResultKey:'PROJ-PLAN-12'})};
  try{const gitlab=await dispatchPipeline({provider:'gitlab_ci',base_url:'https://gitlab.example.com',external_project:'team/app',pipeline_ref:'default'},'develop','secret','test');assert.equal(gitlab.externalId,'9');assert.match(calls[0].url,/ref=develop/);assert.match(calls[0].body||'',/ORBIT_STAGE/);const bamboo=await dispatchPipeline({provider:'bamboo',base_url:'https://bamboo.example.com',external_project:'PROJ',pipeline_ref:'PROJ-PLAN'},'main','secret','production');assert.equal(bamboo.externalId,'PROJ-PLAN-12');assert.match(calls[1].url,/ORBIT_BRANCH=main/);assert.match(calls[1].url,/ORBIT_STAGE=production/)}finally{globalThis.fetch=originalFetch}
});
test('pipeline URLs reject insecure remote hosts and embedded credentials',()=>{
  assert.equal(pipelineBase('https://ci.example.com/'),'https://ci.example.com');
  assert.throws(()=>pipelineBase('http://ci.example.com'));
  assert.throws(()=>pipelineBase('https://user:secret@ci.example.com'));
});
test('GitLab and Bamboo report failures and provider logs',async()=>{
  globalThis.fetch=async(input)=>{
    const url=String(input);
    if(url.endsWith('/pipelines/9'))return reply({status:'failed'});
    if(url.includes('/pipelines/9/jobs'))return reply([{id:12,name:'SSH deploy',status:'failed'}]);
    if(url.includes('/jobs/12/trace'))return new Response('ssh: connection refused',{status:200});
    return reply({key:'PROJ-PLAN-12',buildState:'Failed',lifeCycleState:'Finished',logEntries:{logEntry:[{log:'Remote pull failed'}]}});
  };
  try{
    const gitlab=await pollPipeline({provider:'gitlab_ci',base_url:'https://gitlab.example.com',external_project:'team/repo',pipeline_ref:'default'},'9','main','token');
    assert.equal(gitlab.status,'failed');assert.match(gitlab.logs,/connection refused/);
    const bamboo=await pollPipeline({provider:'bamboo',base_url:'https://bamboo.example.com',external_project:'PROJ',pipeline_ref:'PROJ-PLAN'},'PROJ-PLAN-12','main','token');
    assert.equal(bamboo.status,'failed');assert.match(bamboo.logs,/Remote pull failed/);
  }finally{globalThis.fetch=originalFetch}
});

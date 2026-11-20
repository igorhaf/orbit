import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {Client,ConnectConfig} from 'ssh2';
import {PipelineExecutionPolicyService,requiredOutputs,Step,StepHandlerRegistry} from './contracts';
import {LocalCommandExecutor,SshCommandExecutor} from './executors';
import {gitRemoteUrl,noInlineSecrets} from './management';

const step=(type:string,policy:Step['bypass_policy']='allow'):Step=>({id:'00000000-0000-4000-8000-000000000001',pipeline_id:'00000000-0000-4000-8000-000000000002',type,name:type,config:{},position:0,timeout_ms:1000,failure_policy:'stop',max_attempts:1,retry_delay_ms:0,bypass_policy:policy,requires:[]});

test('step registry validates each config and rejects duplicate handlers',()=>{
  const registry=new StepHandlerRegistry(),handler={type:'test.run',category:'test',schema:{type:'object',required:['command'],properties:{command:{type:'string'}},additionalProperties:false},run:async()=>({})};
  registry.register(handler);assert.equal(registry.get('test.run'),handler);assert.throws(()=>registry.validate({...step('test.run'),config:{}}),/Configuração inválida/);assert.throws(()=>registry.register(handler),/duplicado/);assert.throws(()=>registry.get('unknown'),/não registrado/);
});

test('normal, selective, full and denied bypass have distinct decisions',()=>{
  const policy=new PipelineExecutionPolicyService();const approval=step('approval.wait');
  assert.equal(policy.decide(approval,'approval','normal',{approvals:true},true),'execute');
  assert.equal(policy.decide(approval,'approval','bypass',{approvals:true},true),'bypass');
  assert.equal(policy.decide(approval,'approval','bypass',{tests:true},true),'execute');
  assert.equal(policy.decide(step('deploy.execute','deny'),'deployment','bypass',{allWorkflowPolicies:true},true),'execute');
  assert.throws(()=>policy.decide(step('deploy.execute','deny'),'deployment','bypass',{deployments:true},true),/negado/);
  assert.throws(()=>policy.validate('bypass','emergency',{approvals:true},false),/pipeline.bypass/);
  assert.throws(()=>policy.validate('bypass','',{approvals:true},true),/motivo/);
  assert.throws(()=>policy.decide(step('test.run','allow_with_permission'),'test','bypass',{tests:true},false),/pipeline.bypass/);
});

test('bypass fails before execution if a required output disappears',()=>{
  const producer=step('promotion.execute');const consumer={...step('deploy.execute'),id:'00000000-0000-4000-8000-000000000003',position:1,requires:[`steps.${producer.id}.targetRevision`]};
  assert.throws(()=>requiredOutputs([producer,consumer],{values:{},steps:{}},new Set([producer.id])),/remove output obrigatório/);
  assert.doesNotThrow(()=>requiredOutputs([producer,consumer],{values:{},steps:{[producer.id]:{targetRevision:'abc'}}},new Set([producer.id])));
});

test('pipeline configuration rejects inline secrets while allowing references',()=>{
  assert.doesNotThrow(()=>noInlineSecrets({credentialId:'00000000-0000-4000-8000-000000000001'}));
  assert.throws(()=>noInlineSecrets({password:'literal'}),/credentialId/);
  assert.throws(()=>noInlineSecrets({command:'echo Bearer abcdefghijklmnopqrstuvwxyz'}),/Segredo literal/);
});

test('Git remotes reject embedded credentials and malformed URLs',()=>{
  assert.equal(gitRemoteUrl('https://git.example.test/team/repo.git'),'https://git.example.test/team/repo.git');
  assert.equal(gitRemoteUrl('ssh://git@git.example.test/team/repo.git'),'ssh://git@git.example.test/team/repo.git');
  assert.equal(gitRemoteUrl('git@git.example.test:team/repo.git'),'git@git.example.test:team/repo.git');
  assert.throws(()=>gitRemoteUrl('ssh://git:secret@git.example.test/team/repo.git'),/segredo embutido/);
  assert.throws(()=>gitRemoteUrl('https://user:secret@git.example.test/team/repo.git'),/segredo embutido/);
  assert.throws(()=>gitRemoteUrl('https://git.example.test/team/repo.git?token=secret'),/segredo embutido/);
});

test('local executor reports success, failure, timeout and protects project boundary',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orbit-local-executor-'));const executor=new LocalCommandExecutor();
  try{
    const base={userId:'user',projectRoot:root,cwd:root,timeoutMs:1000};
    const success=await executor.execute({...base,command:'pwd'});assert.equal(success.success,true);assert.equal(success.stdout.trim(),root);
    const failure=await executor.execute({...base,command:'exit 7'});assert.equal(failure.success,false);assert.equal(failure.exitCode,7);
    const timeout=await executor.execute({...base,command:'sleep 2',timeoutMs:100});assert.equal(timeout.success,false);assert.equal(timeout.exitCode,124);
    await assert.rejects(()=>executor.execute({...base,cwd:tmpdir(),command:'pwd'}),/fora do projeto/);
  }finally{await rm(root,{recursive:true,force:true})}
});

test('SSH executor verifies host, working directory, redacts secrets and reports failure and timeout',async()=>{
  const fingerprint='a'.repeat(64),secret='fixture-ssh-password';
  const db={one:async(sql:string)=>sql.includes('delivery_servers')?{id:'server',host:'example.test',port:22,username:'deploy',credential_id:'credential',host_fingerprint:fingerprint}:{kind:'SSH_PASSWORD',encrypted_value:'encrypted'}};
  const credentials={secret:async()=>secret};
  const requests:string[]=[];let nextCode:number|null=0,hang=false,verified=false;
  class FakeClient extends EventEmitter {
    connect(config:ConnectConfig){const verify=config.hostVerifier as ((hash:string,callback:()=>void)=>boolean)|undefined;verified=verify?.(fingerprint,()=>undefined)===true&&verify?.('b'.repeat(64),()=>undefined)===false;setImmediate(()=>this.emit('ready'));return this}
    exec(command:string,callback:(error:Error|undefined,stream:EventEmitter&{stderr:EventEmitter})=>void){requests.push(command);const stream=Object.assign(new EventEmitter(),{stderr:new EventEmitter()});callback(undefined,stream);if(!hang)setImmediate(()=>{stream.emit('data',Buffer.from(`ok ${secret}`));stream.emit('close',nextCode)});return this}
    end(){return this}
  }
  class FakeExecutor extends SshCommandExecutor {protected createClient(){return new FakeClient() as unknown as Client}}
  const executor=new FakeExecutor(db as never,credentials as never);
  const base={userId:'user',serverId:'server',cwd:'/var/www/api',command:'echo test',timeoutMs:100};
  const success=await executor.execute(base);assert.equal(success.success,true);assert.equal(verified,true);assert.match(requests[0],/cd -- '\/var\/www\/api' && echo test/);assert.doesNotMatch(success.stdout,/fixture-ssh-password/);
  nextCode=7;const failure=await executor.execute(base);assert.equal(failure.success,false);assert.equal(failure.exitCode,7);
  hang=true;const timeout=await executor.execute(base);assert.equal(timeout.success,false);assert.equal(timeout.exitCode,124);
});

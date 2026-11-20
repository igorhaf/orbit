import {test} from 'node:test';
import assert from 'node:assert/strict';
import {contextManifestDto,executionContextIdentity,observedContextSource,manifestForExecution,finalRunContext} from './context-runtime';
import {ContextManifestRepository,StoredContextManifest} from './context-manifest';
import {compareContextManifest} from './context-manifest';
import {relevantPluginSources} from './context-runtime';
import {PluginRegistry} from './registries';
import {compileContext,compilationMetadata,defaultContextCompilerPolicy} from './context-compiler';
import {hashContextText} from './context-manifest';

test('host source scope excludes operational run identity and fingerprints remain stable after binding',()=>{
  const identity=executionContextIdentity('card_runs','pending',{id:'card',card_revision:1,workspace_id:'workspace'},'project','actor','plugin','card_execution');
  const initial=observedContextSource(identity,'plugin:fixture','plugin_contract',{version:1});
  const boundIdentity={...identity,runId:'actual-run'};
  const bound=observedContextSource(boundIdentity,'plugin:fixture','plugin_contract',{version:1});
  assert.deepEqual(Object.keys(initial.scope).sort(),['actorId','projectId','runtimeId','workspaceId']);
  const input={sources:[initial],configuration:{},assemblyPolicy:'fixture/1',prompt:'Fixture'};
  assert.equal(manifestForExecution(identity,input,{git:null,checkout:{mode:'shared'}}).fingerprint,manifestForExecution({...identity,runId:'actual-run'},{...input,sources:[bound]},{git:null,checkout:{mode:'shared'}}).fingerprint);
});

test('terminal run without final verification never inherits an initial compatible state',async()=>{
  const identity=executionContextIdentity('card_runs','run',{id:'card',card_revision:1},'project','actor','plugin','card_execution');
  const manifest=manifestForExecution(identity,{sources:[],configuration:{},assemblyPolicy:'fixture/1',prompt:'Fixture'},{git:null,checkout:{mode:'shared'}});
  const record:StoredContextManifest={id:'manifest',queue:'card_runs',runId:'run',turn:0,parentId:null,createdAt:new Date().toISOString(),manifest};
  const started={id:'check',manifestId:record.id,phase:'started',observedAt:new Date().toISOString(),compatibility:{status:'compatible' as const,changes:[],reasons:[]}};
  assert.equal(contextManifestDto(record,[started],{runStatus:'success'}).context_status,'unverified');
  assert.equal(contextManifestDto(record,[started],{runStatus:'running'}).context_status,'compatible');
  const repo={observe:async()=>{throw new Error('Synthetic verification write failure')}} as unknown as ContextManifestRepository;
  const result=await finalRunContext(repo,record,async()=>manifest);
  assert.equal(result.status,'unverified');assert.equal(contextManifestDto(record,[started],{runStatus:'success'}).context_status,'unverified');
});

test('disabled plugin contracts retain historical identity and block new consumption',()=>{
  const registry=new PluginRegistry();registry.register({id:'fixture',name:'Fixture contract',version:'1.0.0',actions:[],capabilities:[]});
  const identity=executionContextIdentity('card_runs','run',{id:'card',card_revision:1},'project','actor','plugin','card_execution');
  const prepared={sources:relevantPluginSources(identity,registry,['fixture']),configuration:{},assemblyPolicy:'fixture/1',prompt:'Fixture'};
  const manifest=manifestForExecution(identity,prepared,{git:null,checkout:{mode:'shared'}});
  registry.getById('fixture').coreCompatibility={minVersion:'1.0.0',maxExclusive:'3.0.0',pluginApiVersion:1};
  assert.equal(compareContextManifest(manifest,{sources:relevantPluginSources(identity,registry,['fixture'])}).status,'changed');
  registry.setEnabled('fixture',false);
  const unavailable=relevantPluginSources(identity,registry,['fixture']);
  assert.equal(compareContextManifest(manifest,{sources:unavailable}).status,'unavailable');
  assert.throws(()=>manifestForExecution(identity,{...prepared,sources:unavailable},{git:null,checkout:{mode:'shared'}}),/obrigatória/);
  assert.equal(manifest.sources[0].version,'1.0.0');assert.equal(manifest.sources[0].availability,'available');
});

test('context API exposes compilation metrics and delivery hashes without source bodies or private receipts',()=>{
  const identity=executionContextIdentity('card_runs','run',{id:'card',card_revision:1},'project','actor','plugin','card_execution');
  const body='PRIVATE-CONTENT-OF-SELECTED-DOCUMENT';
  const source=observedContextSource(identity,'demand','demand',body,{trust:'documental'});
  const result=compileContext({identity,sources:[source],blocks:[{id:'task',section:'task',sourceIds:['demand'],text:body,required:true}],policy:defaultContextCompilerPolicy()});
  assert.equal(result.status,'ready');
  const manifest=manifestForExecution(identity,{sources:[source],configuration:{contextCompilation:compilationMetadata(result)},assemblyPolicy:result.policy.id,prompt:result.text},{git:null,checkout:{privateRoot:'/private/checkout'}});
  const record:StoredContextManifest={id:'manifest',queue:'card_runs',runId:'run',turn:0,parentId:null,manifest,createdAt:new Date().toISOString()};
  const dto=contextManifestDto(record,[{id:'check',manifestId:'manifest',phase:'delivered',observedAt:new Date().toISOString(),compatibility:{status:'compatible',changes:[],reasons:[]},delivery:{compiledHash:result.compiledHash,envelopeHash:hashContextText('envelope'),checkoutOwner:'/private/owner',rawPrompt:body}}]);
  assert.equal(dto.compilation?.compiled_hash,result.compiledHash);assert.equal(dto.verifications[0].delivery?.envelopeHash,hashContextText('envelope'));
  for(const privateValue of [body,'/private/checkout','/private/owner','rawPrompt'])assert.ok(!JSON.stringify(dto).includes(privateValue));
});

test('plugin actions never receive the host delivery attestation callback',async()=>{
  const registry=new PluginRegistry();let received:unknown;
  registry.register({id:'fixture',name:'Fixture',version:'1.0.0',actions:[{id:'read',name:'Read',permissions:[],inputSchema:{type:'object'},execute:async(_config,context)=>{received=context.execution;return {type:'text',value:'ok'}}}]});
  const input={runId:'run',cardId:'card',userId:'actor',projectId:'project',title:'Fixture',prompt:'task',workingDirectory:'/fixture',projectRoot:'/fixture',permissions:[],action:'read',integrations:[],signal:new AbortController().signal,contextBridge:{descriptor:{},exchange:async()=>null,signal:new AbortController().signal},contextDelivery:{compiledHash:hashContextText('task'),policy:defaultContextCompilerPolicy(),onDelivery:()=>{throw new Error('A plugin cannot attest delivery')}}};
  await registry.execute({plugin:'fixture',action:'read'},input);
  assert.equal((received as typeof input).contextDelivery,undefined);assert.equal((received as typeof input).contextBridge,undefined);assert.equal((received as typeof input).prompt,'task');assert.ok(input.contextDelivery);
});

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {compilerPolicyForManifest,contextCompilerPolicyFromHost} from './context-compiler-host';
import {createContextManifest,hashContextText,type ContextObject} from './context-manifest';

const enabled={ORBIT_CONTEXT_COMPILER_ENABLED:'1'};
function manifest(configuration:ContextObject={},assemblyPolicy='orbit-context-builder/1'){
  return createContextManifest({identity:{runtimeId:'dev',projectId:'project',workspaceId:'workspace',actorId:'actor',queue:'card_runs',runId:'run',cardId:'card',cardRevision:1,executor:'fixture',executionType:'card_execution'},sources:[],configuration,git:null,checkout:null,assemblyPolicy,material:{contextHash:hashContextText('context'),promptHash:hashContextText('prompt')}});
}
test('host opt-in defaults off and rejects ambiguous flags and numeric budgets',()=>{
  assert.equal(contextCompilerPolicyFromHost({}),null);assert.equal(contextCompilerPolicyFromHost({ORBIT_CONTEXT_COMPILER_ENABLED:'0'}),null);
  for(const flag of ['','true','2',' 1'])assert.throws(()=>contextCompilerPolicyFromHost({ORBIT_CONTEXT_COMPILER_ENABLED:flag}),/inválida/);
  for(const value of ['','-1','1.5','Infinity',' 10','10000001'])assert.throws(()=>contextCompilerPolicyFromHost({...enabled,ORBIT_CONTEXT_COMPILER_MAX_ESTIMATED_TOKENS:value}),/inválido/);
  assert.equal(contextCompilerPolicyFromHost({...enabled,ORBIT_CONTEXT_COMPILER_MAX_ESTIMATED_TOKENS:'50000'})?.budget.maxEstimatedTokens,50000);
});
test('captured legacy context stays legacy even when host compiler is activated',()=>{
  assert.equal(compilerPolicyForManifest(null,enabled),null);
  assert.equal(compilerPolicyForManifest(manifest(),enabled),null);
  assert.throws(()=>compilerPolicyForManifest(manifest({},'orbit-context-compiler/1'),enabled),/indisponível/);
});
test('captured compiled runs require the same enabled host policy',()=>{
  const policy=contextCompilerPolicyFromHost(enabled)!;
  const captured=manifest({contextCompilation:{policy}},'orbit-context-compiler/1');
  assert.deepEqual(compilerPolicyForManifest(captured,enabled),policy);
  assert.throws(()=>compilerPolicyForManifest(captured,{}),/política.*mudou/);
  assert.throws(()=>compilerPolicyForManifest(captured,{...enabled,ORBIT_CONTEXT_COMPILER_MAX_ESTIMATED_TOKENS:String(policy.budget.maxEstimatedTokens+1)}),/política.*mudou/);
});

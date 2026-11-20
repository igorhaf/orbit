import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withIsolatedExecution,currentIsolatedExecution,assertIsolatedExecutionRoot,isolatedCodexPolicy,isolatedProcessEnvironment,assertIsolatedExecutionDirectory} from './isolated-execution-policy';
import {runProjectChecks} from './project-checks';
import {PluginRegistry,filesystemPlugin} from './registries';
import {LocalCommandExecutor,SshCommandExecutor} from '../delivery/executors';
import {ExecutionInput} from './types';

test('isolated host authority blocks external actions, checks and delivery before side effects',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orbit-isolated-policy-'));
  try{
    const registry=new PluginRegistry();let effects=0;
    registry.register(filesystemPlugin());
    registry.register({id:'outside',name:'Outside',version:'1.0.0',actions:[{id:'write',name:'External write',inputSchema:{type:'object'},async execute(){effects++;return {type:'text',value:'unsafe'}}}]});
    const input:ExecutionInput={projectRoot:root,workingDirectory:root,permissions:[],userId:'fixture',runId:'fixture',cardId:'fixture',projectId:'fixture',title:'Fixture',prompt:'Fixture',action:'write',integrations:[],signal:new AbortController().signal};
    await withIsolatedExecution({runId:'fixture',queue:'card_runs',root,baseCommit:'a'.repeat(40),cardRevision:3},async()=>{
      assert.equal(currentIsolatedExecution()?.cardRevision,3);
      await assertIsolatedExecutionRoot(root);
      await assertIsolatedExecutionDirectory(root);
      await assert.rejects(()=>assertIsolatedExecutionDirectory(tmpdir()),/worktree/);
      await assert.rejects(()=>assertIsolatedExecutionRoot(tmpdir()),/worktree/);
      await assert.rejects(()=>registry.execute({plugin:'outside',action:'write'},input),/authority|autoridade|homologada/);
      await assert.rejects(()=>runProjectChecks(root,[['must-never-spawn']]),/provisionamento/);
      await assert.rejects(()=>new LocalCommandExecutor().execute({cwd:root,projectRoot:root,command:'must-never-spawn',timeoutMs:1,userId:'fixture'}),/Delivery/);
      await assert.rejects(()=>new SshCommandExecutor({} as never,{} as never).execute({cwd:root,serverId:'must-never-query',timeoutMs:1,userId:'fixture'}),/Delivery/);
    });
    assert.equal(effects,0);assert.equal(currentIsolatedExecution(),undefined);
    const policy=isolatedCodexPolicy();
    assert.equal(policy.includes('--dangerously-bypass-approvals-and-sandbox'),false);
    assert.ok(isolatedCodexPolicy(false).includes('read-only'));
    assert.equal(isolatedProcessEnvironment('/owned/home').DATABASE_URL,undefined);
    assert.equal(isolatedProcessEnvironment('/owned/home').CODEX_HOME,'/owned/home');
    assert.ok(policy.includes('workspace-write'));assert.ok(policy.includes('approval_policy="never"'));
    assert.ok(policy.includes('mcp_servers={}'));assert.ok(policy.includes('sandbox_workspace_write.network_access=false'));
  }finally{await rm(root,{recursive:true,force:true})}
});

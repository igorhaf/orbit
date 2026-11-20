import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {join} from 'node:path';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../..',import.meta.url)),require=createRequire(join(root,'forge/app/package.json'));
process.env.TSX_TSCONFIG_PATH=join(root,'forge/app/apps/api/tsconfig.json');require('tsx/cjs/api').register();
const {CodexAiService}=require(join(root,'forge/app/apps/api/src/plugins/ai/codex-provider.ts'));
const {CodexExecutor}=require(join(root,'forge/app/apps/api/src/execution/codex-executor.ts'));
const {isolatedCodexPolicy}=require(join(root,'forge/app/apps/api/src/execution/isolated-execution-policy.ts'));
test('B19 real adapters refuse unhomologated Bridge before HOME, process or provider initialization',async()=>{
 const provider=new CodexAiService();let homes=0;provider.codexHome=async()=>{homes++;throw new Error('Must not inspect HOME')};
 const bridge={descriptor:{protocol:'orbit-context-bridge/1'},exchange:async()=>null,signal:new AbortController().signal};
 await assert.rejects(()=>provider.execute('fixture','/nonexistent','fake','low',undefined,null,undefined,undefined,'planning',[],undefined,[],false,false,undefined,bridge),/Bridge Codex não homologado/);
 await assert.rejects(()=>new CodexExecutor().execute({contextBridge:bridge}),/Bridge Codex não homologado/);assert.equal(homes,0);
 const isolated=isolatedCodexPolicy();assert.ok(isolated.includes('mcp_servers={}'));assert.ok(isolated.includes('sandbox_workspace_write.network_access=false'));assert.ok(isolated.includes('--ignore-user-config'));
});

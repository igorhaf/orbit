import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../..',import.meta.url));
const require=createRequire(join(root,'forge/app/package.json'));
process.env.TSX_TSCONFIG_PATH=join(root,'forge/app/apps/api/tsconfig.json');require('tsx/cjs/api').register();
const {ContextBridgeAdapter}=require(join(root,'packages/orbit-core/src/execution/context-bridge-adapter.ts'));

// Fixture-owned descriptors prove data plumbing only. Codex/supervisor do not
// currently pass these descriptors. This is deliberately NOT a production entrypoint.
test('M13 fixture MCP child uses stdio plus private host pipes; no DB or global credentials',{timeout:10000},async t=>{
 const dir=mkdtempSync(join(tmpdir(),'orbit06b-mcp-'));mkdirSync(join(dir,'home'),{mode:0o700});let child,queries=0;
 t.after(()=>{if(child?.exitCode===null)child.kill('SIGKILL');rmSync(dir,{recursive:true,force:true})});
 const script=`
 const assert=require('node:assert/strict'),net=require('node:net');
 process.env.TSX_TSCONFIG_PATH=${JSON.stringify(join(root,'forge/app/apps/api/tsconfig.json'))};require(${JSON.stringify(require.resolve('tsx/cjs/api'))}).register();
 const {ContextBridgeMcpAdapter}=require(${JSON.stringify(join(root,'packages/orbit-core/src/execution/context-bridge-mcp.ts'))});
 assert.equal(process.env.DATABASE_URL,undefined);assert.equal(process.env.OPENAI_API_KEY,undefined);
 const upstream=new net.Socket({fd:4,readable:true,writable:false}),downstream=new net.Socket({fd:3,readable:false,writable:true});
 let buffer='',next=0;const pending=new Map();
 upstream.on('data',chunk=>{buffer+=chunk;let at;while((at=buffer.indexOf('\\n'))>=0){const r=JSON.parse(buffer.slice(0,at));buffer=buffer.slice(at+1);const f=pending.get(r.id);if(f){pending.delete(r.id);r.error?f.reject(new Error('host_refused')):f.resolve(r.result);}}});
 upstream.on('end',()=>process.exit(0));
 function exchange(method,params){const id=++next;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});downstream.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\\n');});}
 (async()=>{await exchange('initialize',{protocolVersion:'orbit-context-bridge/1'});
 const adapter=new ContextBridgeMcpAdapter({query:request=>exchange('capabilities/call',{request}),close:()=>{process.stderr.write('closing-host');upstream.destroy();downstream.destroy();}});
 process.stdin.on('end',()=>process.stderr.write('stdin-ended'));await adapter.attach(process.stdin,process.stdout).done;process.stderr.write('adapter-done');process.exit(0);})();
 `;
 child=spawn(process.execPath,['-e',script],{cwd:dir,env:{PATH:'/usr/bin:/bin',HOME:join(dir,'home'),CODEX_HOME:join(dir,'home','no-auth'),TSX_DISABLE_CACHE:'1'},stdio:['pipe','pipe','pipe','pipe','pipe']});
 let diagnostics='';t.after(()=>t.diagnostic(diagnostics));child.stderr.on('data',b=>diagnostics+=b);
 const host=new ContextBridgeAdapter({query:async r=>{queries++;assert.equal(r.capability,'context.describe');return {schemaVersion:1,status:'ok',contentHash:'fixture-hash',data:{text:'fixture-only'},limitations:['delivery_unverified']};},close(){} });
 const link=host.attach(child.stdio[3],child.stdio[4]);
 let buffer='';const waiting=new Map();child.stdout.on('data',chunk=>{buffer+=chunk;let at;while((at=buffer.indexOf('\n'))>=0){const reply=JSON.parse(buffer.slice(0,at));buffer=buffer.slice(at+1);waiting.get(reply.id)?.(reply);waiting.delete(reply.id);}});
 const send=(id,method,params)=>new Promise(resolve=>{waiting.set(id,resolve);child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')});
 t.diagnostic('spawned');const init=await send(1,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'fixture',version:'1'}});t.diagnostic('initialized');assert.equal(init.result.protocolVersion,'2025-06-18');
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
 t.diagnostic('listing');const tools=await send(2,'tools/list',{});assert.equal(tools.result.tools.length,5);
 const call=await send(3,'tools/call',{name:'orbit_context_describe',arguments:{}});assert.equal(call.result.structuredContent.data.text,'fixture-only');assert.equal(queries,1);
 t.diagnostic('call complete');child.stdin.end();const exit=await new Promise(resolve=>child.once('exit',code=>resolve(code)));t.diagnostic('child exited');await host.close();t.diagnostic('host closed');child.stdio[3].destroy();child.stdio[4].destroy();await link.done;t.diagnostic('link done');assert.equal(exit,0,diagnostics);
});

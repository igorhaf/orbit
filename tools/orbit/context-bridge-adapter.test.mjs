import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../..',import.meta.url));
const require=createRequire(join(root,'forge/app/package.json'));
process.env.TSX_TSCONFIG_PATH=join(root,'forge/app/apps/api/tsconfig.json');
require('tsx/cjs/api').register();
const {ContextBridgeAdapter,contextBridgeProtocol}=require(join(root,'packages/orbit-core/src/execution/context-bridge-adapter.ts'));

test('B19 local JSON-RPC NDJSON crosses real anonymous child pipes without network, Codex or credentials',{timeout:10000},async t=>{
  const directory=mkdtempSync(join(tmpdir(),'orbit06-bridge-pipes-')),home=join(directory,'home');mkdirSync(home,{mode:0o700});
  let closed=0,queries=0,child;
  t.after(()=>{if(child?.exitCode===null&&child?.signalCode===null)child.kill('SIGKILL');rmSync(directory,{recursive:true,force:true})});
  const script=`
    const assert=require('node:assert/strict');
    let buffer='';
    const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');
    send({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:${JSON.stringify(contextBridgeProtocol)}}});
    process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{buffer+=chunk;let at;while((at=buffer.indexOf('\\n'))>=0){const reply=JSON.parse(buffer.slice(0,at));buffer=buffer.slice(at+1);assert.equal(reply.error,undefined);if(reply.id===1){assert.equal(reply.result.readOnly,true);send({jsonrpc:'2.0',id:2,method:'capabilities/call',params:{request:{schemaVersion:1,id:'fixture-query',capability:'context.describe',parameters:{}}}});}else{assert.equal(reply.id,2);assert.equal(reply.result.data.text,'Authorized fixture data');assert.equal(process.env.DATABASE_URL,undefined);assert.equal(process.env.OPENAI_API_KEY,undefined);process.stderr.write('fixture-response-verified');process.exit(0);}}});
  `;
  child=spawn(process.execPath,['--input-type=commonjs','-e',script],{cwd:directory,env:{PATH:'/usr/bin:/bin',HOME:home,CODEX_HOME:join(home,'absent-auth'),CODEX_BIN:join(directory,'must-not-run')},stdio:['pipe','pipe','pipe']});
  let diagnostics='';child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>diagnostics+=chunk);
  const adapter=new ContextBridgeAdapter({query:async request=>{queries++;assert.equal(request.capability,'context.describe');return {schemaVersion:1,status:'ok',data:{text:'Authorized fixture data'},delivery:'unverified'}},close(){closed++}});
  const attachment=adapter.attach(child.stdout,child.stdin);
  const result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}))});
  await attachment.done;await adapter.close();
  assert.equal(result.code,0,diagnostics);assert.equal(result.signal,null);assert.equal(diagnostics,'fixture-response-verified');assert.equal(queries,1);assert.equal(closed,1);
  assert.equal(existsSync(join(home,'.codex')),false);assert.equal(existsSync(join(home,'absent-auth')),false);
});

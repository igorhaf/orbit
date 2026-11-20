import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {createServer} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PassThrough} from 'node:stream';
import {runContextBridgeMcpEntrypoint} from './context-bridge-mcp-entry';
const limits={maxRequests:8,maxResponseBytes:4096,maxTotalBytes:18000,requestTimeoutMs:200,maxConcurrent:1,maxSources:4,maxDependencyDepth:2,maxRequestBytes:4096};
for(const mode of ['forged_host','timeout'] as const)test(`F2/F7 entrypoint refuses ${mode} without emitting MCP data`,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'orbit06c-entry-')),path=join(directory,'peer.sock');
 const keys=generateKeyPairSync('ed25519');let observed='';const output=new PassThrough();output.on('data',b=>observed+=b);
 const server=createServer(socket=>{socket.on('error',()=>{});socket.on('data',b=>{if(mode==='forged_host'){const request=JSON.parse(b.toString());socket.write(JSON.stringify({payload:{jsonrpc:'2.0',id:request.id,result:{protocolVersion:'orbit-context-bridge/1',text:'MALICIOUS'}},signature:Buffer.alloc(64).toString('base64')})+'\n')}})});
 try{await new Promise<void>(resolve=>server.listen(path,resolve));await assert.rejects(runContextBridgeMcpEntrypoint({endpointPath:path,publicKey:keys.publicKey.export({format:'der',type:'spki'}).toString('base64'),limits},new PassThrough(),output));assert.equal(observed,'')}
 finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true})}
});

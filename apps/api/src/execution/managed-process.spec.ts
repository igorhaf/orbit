import assert from 'node:assert/strict';
import {test} from 'node:test';
import {access,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runManagedProcess} from './managed-process';

const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

test('managed process captures output and reports its exit code',async()=>{
  const result=await runManagedProcess(process.execPath,['-e','console.log("stdout");console.error("stderr")'],{cwd:tmpdir(),timeoutMs:2000});
  assert.equal(result.code,0);assert.match(result.stdout,/stdout/);assert.match(result.stderr,/stderr/);
});

test('a deadline kills the whole process group, including descendants',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orbit-managed-process-'));const marker=join(root,'orphan');
  const script='const {spawn}=require("node:child_process");spawn(process.execPath,["-e",`process.on("SIGTERM",()=>{});setTimeout(()=>require("node:fs").writeFileSync(process.argv[1],"orphan"),500);setInterval(()=>{},1000)`,process.argv[1]],{stdio:"ignore"});setInterval(()=>{},1000)';
  try{
    await assert.rejects(()=>runManagedProcess(process.execPath,['-e',script,marker],{cwd:root,timeoutMs:80,killGraceMs:50}),/excedeu o prazo/);
    await delay(650);
    await assert.rejects(()=>access(marker));
  }finally{await rm(root,{recursive:true,force:true})}
});

test('cancelling an execution kills its process group',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orbit-managed-cancel-'));const marker=join(root,'orphan');const controller=new AbortController();
  const script='const {spawn}=require("node:child_process");spawn(process.execPath,["-e",`process.on("SIGTERM",()=>{});setTimeout(()=>require("node:fs").writeFileSync(process.argv[1],"orphan"),500);setInterval(()=>{},1000)`,process.argv[1]],{stdio:"ignore"});setInterval(()=>{},1000)';
  try{
    const execution=runManagedProcess(process.execPath,['-e',script,marker],{cwd:root,timeoutMs:2000,killGraceMs:50,signal:controller.signal});
    setTimeout(()=>controller.abort(),50);
    await assert.rejects(()=>execution,/cancelado/);
    await delay(650);
    await assert.rejects(()=>access(marker));
  }finally{await rm(root,{recursive:true,force:true})}
});

test('failed commands preserve bounded diagnostic output',async()=>{
  const result=await runManagedProcess(process.execPath,['-e','console.error("failure");process.exit(7)'],{cwd:tmpdir(),timeoutMs:2000});
  assert.equal(result.code,7);assert.match(result.stderr,/failure/);
});

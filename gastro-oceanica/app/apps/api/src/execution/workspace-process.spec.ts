import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {closeSync,openSync} from 'node:fs';
import {access,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';

const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const supervisor=join(__dirname,'workspace-supervisor.py');
function run(root:string,script:string){
  const guard=openSync(join(root,'guard'),'w');
  try{return spawn('python3',['-I','-B',supervisor,'--fd-count','1','--parent',String(process.pid),'--',process.execPath,'-e',script],{stdio:['ignore','pipe','pipe',guard],env:{...process.env,ORBIT_WORKSPACE_SUPERVISOR_PARENT_PID:String(process.pid)}})}finally{closeSync(guard)}
}
function finished(child:ReturnType<typeof spawn>){return new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)})}

test('workspace supervisor preserves stdout, stderr and normal exit code',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orbit-guardian-output-'));
  try{const child=run(root,'console.log("out");console.error("err");process.exit(7)');let out='',err='';child.stdout?.on('data',value=>out+=value);child.stderr?.on('data',value=>err+=value);assert.equal(await finished(child),7);assert.match(out,/out/);assert.match(err,/err/)}finally{await rm(root,{recursive:true,force:true})}
});

test('workspace supervisor drains orphaned setsid descendants even after they close descriptors',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orbit-guardian-orphan-'));const marker=join(root,'escaped');
  const payload=`process.on('SIGTERM',()=>{});setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'escaped'),900);setInterval(()=>{},1000)`;
  const middle=`const c=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(payload)}],{detached:true,stdio:'ignore'});c.unref()`;
  const command=`const c=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(middle)}],{detached:true,stdio:'ignore'});c.unref();setTimeout(()=>process.exit(0),150)`;
  try{assert.equal(await finished(run(root,command)),0);await delay(1000);await assert.rejects(access(marker))}finally{await rm(root,{recursive:true,force:true})}
});

test('workspace supervisor cancellation drains descendants and reports unsafe run status',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orbit-guardian-cancel-'));const marker=join(root,'escaped');
  const payload=`process.on('SIGTERM',()=>{});setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'escaped'),900);setInterval(()=>{},1000)`;
  const command=`require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(payload)}],{detached:true,stdio:'ignore'});console.log('ready');setInterval(()=>{},1000)`;
  try{const child=run(root,command);const done=finished(child);await new Promise<void>(resolve=>child.stdout?.once('data',()=>resolve()));child.kill('SIGTERM');assert.equal(await done,125);await delay(1000);await assert.rejects(access(marker))}finally{await rm(root,{recursive:true,force:true})}
});

test('workspace supervisor refuses an unexpected parent without starting the command',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orbit-guardian-parent-'));const guard=openSync(join(root,'guard'),'w');
  try{const child=spawn('python3',['-I','-B',supervisor,'--fd-count','1','--parent','1','--',process.execPath,'-e','throw Error("must not execute")'],{stdio:['ignore','ignore','ignore',guard]});assert.equal(await finished(child),125)}finally{closeSync(guard);await rm(root,{recursive:true,force:true})}
});

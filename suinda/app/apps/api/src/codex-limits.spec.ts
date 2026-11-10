import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from './db';
import { enforceCodexQuota, exhaustedQuotaKey, quotaResumeReady, readCodexLimits } from './codex-limits';

test('quota protocol initializes, reads windows and hides authentication details',async()=>{
  const directory=await mkdtemp(join(process.cwd(),'.codex-limits-test-'));
  const original=process.env.CODEX_BIN;
  try{
    const executable=join(directory,'codex');
    await writeFile(executable,`#!${process.execPath}
const readline=require('node:readline');
let initialized=false;
readline.createInterface({input:process.stdin}).on('line',line=>{
 const message=JSON.parse(line);
 if(message.method==='initialize')console.log(JSON.stringify({id:message.id,result:{}}));
 if(message.method==='initialized')initialized=true;
 if(message.method==='account/rateLimits/read'){
  if(!initialized)process.exit(1);
  console.log(JSON.stringify({id:message.id,result:{rateLimits:{primary:{usedPercent:25,windowDurationMins:300,resetsAt:123},secondary:{usedPercent:60,windowDurationMins:10080,resetsAt:456}}}}));
 }
});
`,{mode:0o700});
    process.env.CODEX_BIN=executable;
    const result=await readCodexLimits();
    assert.equal(result.rateLimits?.primary?.windowDurationMins,300);
    assert.equal(result.rateLimits?.secondary?.usedPercent,60);
    const calls:Array<{sql:string;params:unknown[]}>=[];
    const db={query:async(sql:string,params:unknown[])=>{calls.push({sql,params});return []}} as unknown as Db;
    await enforceCodexQuota(db);
    assert.equal(calls.filter(call=>call.sql.startsWith('UPDATE')).length,0);
    await writeFile(executable,(await readFile(executable,'utf8')).replace('usedPercent:25','usedPercent:99'));
    const lowDb={query:db.query} as unknown as Db;
    await Promise.all([enforceCodexQuota(lowDb),enforceCodexQuota(lowDb)]);
    const updates=calls.filter(call=>call.sql.startsWith('UPDATE'));
    assert.equal(updates.length,1);
    assert.equal(updates[0].params[0],'300:123');
    assert.match(updates[0].sql,/codexQuotaAcknowledged/);
    assert.deepEqual(JSON.parse(updates[0].params[1] as string),{codexQueuePaused:true,codexQueueAutoPaused:true,codexQuotaKey:'300:123'});
    await writeFile(executable,`#!${process.execPath}
require('node:readline').createInterface({input:process.stdin}).on('line',line=>console.log(JSON.stringify({id:JSON.parse(line).id,error:{message:'private authentication details'}})));
`,{mode:0o700});
    await assert.rejects(readCodexLimits(),error=>error instanceof Error&&error.message.includes('Limites indisponíveis')&&!error.message.includes('private'));
  }finally{
    if(original===undefined)delete process.env.CODEX_BIN;else process.env.CODEX_BIN=original;
    await rm(directory,{recursive:true,force:true});
  }
});

test('automatic pause includes either quota at 1% or below, with renewal identity',()=>{
  const window=(usedPercent:number,windowDurationMins=300,resetsAt=123)=>({usedPercent,windowDurationMins,resetsAt});
  assert.equal(exhaustedQuotaKey({rateLimits:{primary:window(98.9)}}),'');
  assert.equal(exhaustedQuotaKey({rateLimits:{primary:window(99)}}),'300:123');
  assert.equal(exhaustedQuotaKey({rateLimits:{secondary:window(100,10080)}}),'10080:123');
  assert.equal(exhaustedQuotaKey({rateLimits:{primary:window(99,60)}}),'');
  assert.equal(exhaustedQuotaKey({rateLimits:{primary:window(NaN)}}),'');
  assert.equal(exhaustedQuotaKey({rateLimitsByLimitId:{codex:{primary:window(99,300,456)}}}),'300:456');
});

test('automatic resume requires renewed available quota for every exhausted window',()=>{
 const window=(usedPercent:number,windowDurationMins:number,resetsAt:number)=>({usedPercent,windowDurationMins,resetsAt});
 const limits=(primary?:ReturnType<typeof window>,secondary?:ReturnType<typeof window>)=>({rateLimits:{primary,secondary}});
 assert.equal(quotaResumeReady(limits(window(20,300,2000)), '300:1000',900),true);
 assert.equal(quotaResumeReady(limits(window(20,300,1000)), '300:1000',900),false);
 assert.equal(quotaResumeReady(limits(window(20,300,1000)), '300:1000',1001),true);
 assert.equal(quotaResumeReady(limits(window(99,300,2000)), '300:1000',1001),false);
 assert.equal(quotaResumeReady(limits(window(20,300,2000),window(99,10080,9000)), '300:1000',1001),false);
 assert.equal(quotaResumeReady(limits(window(20,300,2000)), '300:1000|10080:8000',1001),false);
 assert.equal(quotaResumeReady(limits(window(20,300,2000),window(20,10080,10000)), '300:1000|10080:8000',8001),true);
 assert.equal(quotaResumeReady({},'300:1000',8001),false);
 assert.equal(quotaResumeReady(limits(window(NaN,300,2000)),'300:1000',8001),false);
 assert.equal(quotaResumeReady(limits(window(20,300,2000)),'',8001),false);
});

test('background quota monitor resumes only opted-in automatic pauses after confirmed renewal',async()=>{
 const directory=await mkdtemp(join(process.cwd(),'.codex-resume-test-'));const original=process.env.CODEX_BIN;
 try{
  const executable=join(directory,'codex');await writeFile(executable,`#!${process.execPath}
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const message=JSON.parse(line);if(message.id===1)console.log(JSON.stringify({id:1,result:{}}));if(message.id===2)console.log(JSON.stringify({id:2,result:{rateLimits:{primary:{usedPercent:0,windowDurationMins:300,resetsAt:2000}}}}));});
`,{mode:0o700});process.env.CODEX_BIN=executable;
  const calls:string[]=[];let resumed=false;const db={query:async(sql:string,params?:unknown[])=>{calls.push(sql);if(sql.startsWith('SELECT'))return [{id:'opted-in',quota_key:'300:1000'}];if(sql.startsWith('UPDATE')){resumed=true;assert.deepEqual(params,['opted-in','300:1000']);assert.match(sql,/codexQueueAutoResume/);assert.match(sql,/codexQueueAutoPaused/)}return []}} as unknown as Db;
  await enforceCodexQuota(db,true);assert.equal(resumed,true);assert.equal(calls.length,2);
  let updates=0;const noOptIn={query:async(sql:string)=>{if(sql.startsWith('UPDATE'))updates++;return []}} as unknown as Db;await enforceCodexQuota(noOptIn,true);assert.equal(updates,0);
  await writeFile(executable,`#!${process.execPath}
process.exit(1);
`,{mode:0o700});resumed=false;await enforceCodexQuota(db,true);assert.equal(resumed,false);
 }finally{if(original===undefined)delete process.env.CODEX_BIN;else process.env.CODEX_BIN=original;await rm(directory,{recursive:true,force:true})}
});

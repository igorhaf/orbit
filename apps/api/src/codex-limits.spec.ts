import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from './db';
import { enforceCodexQuota, exhaustedQuotaKey, readCodexLimits } from './codex-limits';

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
    assert.equal(calls.length,0);
    await writeFile(executable,(await readFile(executable,'utf8')).replace('usedPercent:25','usedPercent:99'));
    const lowDb={query:db.query} as unknown as Db;
    await Promise.all([enforceCodexQuota(lowDb),enforceCodexQuota(lowDb)]);
    assert.equal(calls.length,1);
    assert.equal(calls[0].params[0],'300:123');
    assert.match(calls[0].sql,/codexQuotaAcknowledged/);
    assert.deepEqual(JSON.parse(calls[0].params[1] as string),{codexQueuePaused:true,codexQueueAutoPaused:true,codexQuotaKey:'300:123'});
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

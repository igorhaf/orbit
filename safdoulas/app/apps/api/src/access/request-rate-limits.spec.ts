import assert from 'node:assert/strict';
import express from 'express';
import {test} from 'node:test';
import {configuredRequestLimit,requestRateBucket,requestRateDecision} from './request-rate-limits';

test('rate limit buckets are opaque and isolated by operation and scope',()=>{
  const email='person@example.test';
  const identity={kind:'identity' as const,value:email,limit:5};
  const first=requestRateBucket('auth.recovery',identity,'a'.repeat(32));
  assert.match(first,/^[0-9a-f]{64}$/);
  assert.notEqual(first,requestRateBucket('auth.invitation',identity,'a'.repeat(32)));
  assert.notEqual(first,requestRateBucket('auth.recovery',{...identity,value:'other@example.test'},'a'.repeat(32)));
  assert.notEqual(first,requestRateBucket('auth.recovery',identity,'b'.repeat(32)));
  assert.equal(first.includes(email),false);
});

test('limits block only the exhausted scope and return Retry-After seconds',()=>{
  const now=Date.parse('2026-10-13T12:00:00Z');
  const decision=requestRateDecision([
    {state:{request_count:5,window_started_at:new Date(now-30_000)},limit:5},
    {state:{request_count:1,window_started_at:new Date(now-30_000)},limit:20},
  ],now,60_000);
  assert.deepEqual(decision,{allowed:false,retryAfterSeconds:30});
  assert.deepEqual(requestRateDecision([{state:{request_count:5,window_started_at:new Date(now-61_000)},limit:5}],now,60_000),{allowed:true,retryAfterSeconds:0});
  assert.deepEqual(requestRateDecision([{state:null,limit:5}],now,60_000),{allowed:true,retryAfterSeconds:0});
});

test('rate limit configuration accepts positive integers and rejects unsafe values',()=>{
  const original=process.env.ORBIT_RATE_LIMIT_TEST;
  try{
    delete process.env.ORBIT_RATE_LIMIT_TEST;
    assert.equal(configuredRequestLimit('ORBIT_RATE_LIMIT_TEST',7),7);
    process.env.ORBIT_RATE_LIMIT_TEST='12';
    assert.equal(configuredRequestLimit('ORBIT_RATE_LIMIT_TEST',7),12);
    process.env.ORBIT_RATE_LIMIT_TEST='0';
    assert.throws(()=>configuredRequestLimit('ORBIT_RATE_LIMIT_TEST',7),/Configuração inválida/);
  }finally{
    if(original===undefined)delete process.env.ORBIT_RATE_LIMIT_TEST;
    else process.env.ORBIT_RATE_LIMIT_TEST=original;
  }
});

test('untrusted forwarded address cannot replace the socket origin',async()=>{
  const app=express();let server:ReturnType<typeof app.listen>|undefined;
  try{
    app.get('/',(req,res)=>res.send(req.ip));
    server=app.listen(0,'127.0.0.1');
    await new Promise<void>((resolve,reject)=>{server!.once('listening',resolve);server!.once('error',reject)});
    const address=server.address();assert.ok(address&&typeof address==='object');
    const response=await fetch(`http://127.0.0.1:${address.port}/`,{headers:{'x-forwarded-for':'203.0.113.77'}});
    assert.equal(await response.text(),'127.0.0.1');
  }finally{if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()))}
});

test('trusted proxy chain uses the nearest untrusted client address',async()=>{
  const app=express();app.set('trust proxy',['127.0.0.1']);let server:ReturnType<typeof app.listen>|undefined;
  try{
    app.get('/',(req,res)=>res.send(req.ip));
    server=app.listen(0,'127.0.0.1');
    await new Promise<void>((resolve,reject)=>{server!.once('listening',resolve);server!.once('error',reject)});
    const address=server.address();assert.ok(address&&typeof address==='object');
    const response=await fetch(`http://127.0.0.1:${address.port}/`,{headers:{'x-forwarded-for':'203.0.113.77, 198.51.100.42'}});
    assert.equal(await response.text(),'198.51.100.42');
  }finally{if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()))}
});

import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as bcrypt from 'bcryptjs';
import {authenticateLoginAccount,loginBucketDigest,loginPasswordMatches,nextLoginBucketState} from './login-attempts';

test('login bucket identifiers are keyed, scope-separated and never retain source values',()=>{
  const account=loginBucketDigest('account','person@example.test','pepper');
  assert.match(account,/^[0-9a-f]{64}$/);
  assert.notEqual(account,loginBucketDigest('origin','person@example.test','pepper'));
  assert.notEqual(account,loginBucketDigest('account','person@example.test','different-pepper'));
  assert.equal(account.includes('person@example.test'),false);
});

test('login failures block at the configured limit and reset after expiry',()=>{
  const now=Date.now();let state=null as ReturnType<typeof nextLoginBucketState>|null;
  for(let attempt=1;attempt<=4;attempt++){state=nextLoginBucketState(state,now,5);assert.equal(state.failure_count,attempt);assert.equal(state.blocked_until,null)}
  state=nextLoginBucketState(state,now,5);assert.equal(state.failure_count,5);assert.equal(state.blocked_until!.getTime(),now+15*60*1000);
  state=nextLoginBucketState(state,now+16*60*1000,5);assert.equal(state.failure_count,1);assert.equal(state.window_started_at.getTime(),now+16*60*1000);assert.equal(state.blocked_until,null);
});

test('each login limiter scope can use a distinct threshold',()=>{
  let account=null as ReturnType<typeof nextLoginBucketState>|null;
  let origin=null as ReturnType<typeof nextLoginBucketState>|null;
  for(let attempt=0;attempt<5;attempt++)account=nextLoginBucketState(account,Date.now(),5);
  for(let attempt=0;attempt<19;attempt++)origin=nextLoginBucketState(origin,Date.now(),20);
  assert.ok(account?.blocked_until);assert.equal(origin?.blocked_until,null);
  origin=nextLoginBucketState(origin,Date.now(),20);assert.ok(origin.blocked_until);
});

test('unknown accounts perform a password comparison but always fail with the same result',async()=>{
  const realHash=await bcrypt.hash('real-password',4);
  assert.equal(await loginPasswordMatches(realHash,'real-password'),true);
  assert.equal(await loginPasswordMatches(realHash,'wrong-password'),false);
  assert.equal(await loginPasswordMatches(undefined,'orbit-invalid-account-dummy-password'),false);
});

test('login account lookup is parameterized and treats invalid credentials uniformly',async()=>{
  const hash=await bcrypt.hash('correct-password',4);let params:unknown[]=[];let row:Record<string,unknown>|null={id:'account',name:'Account',email:'person@example.test',avatar_url:null,preferences:{},password_hash:hash,is_root:false,disabled:false,email_verified:true,session_version:1};
  const db={async one(sql:string,args:unknown[]){assert.match(sql,/email=\$1/);params=args;return row}} as never;
  assert.equal((await authenticateLoginAccount(db,'person@example.test','correct-password'))?.id,'account');
  assert.deepEqual(params,['person@example.test']);
  assert.equal(await authenticateLoginAccount(db,'person@example.test','wrong-password'),null);
  row={...row,disabled:true};assert.equal(await authenticateLoginAccount(db,'person@example.test','correct-password'),null);
  row={...row,disabled:false,email_verified:false};assert.equal(await authenticateLoginAccount(db,'person@example.test','correct-password'),null);
  row=null;assert.equal(await authenticateLoginAccount(db,'missing@example.test','correct-password'),null);
});

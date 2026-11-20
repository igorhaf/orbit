import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as bcrypt from 'bcryptjs';
import {authenticateLoginAccount,authenticateLoginWithMfa,loginBucketDigest,loginPasswordMatches,nextLoginBucketState} from './login-attempts';
import {MfaService} from './mfa';
import type {Db} from '../db';

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

test('MFA login issues a challenge before any session account is returned',async()=>{
 const hash=await bcrypt.hash('secret',4);let passwordLookups=0,challengeRequests=0,completed=0;const db={async one(){passwordLookups++;return{id:'account',name:'A',email:'person@example.test',avatar_url:null,preferences:{},password_hash:hash,is_root:false,disabled:false,email_verified:true,session_version:1,mfa_enabled:true}}} as never;const mfa={async requestLogin(userId:string){challengeRequests++;assert.equal(userId,'account');return{challenge_id:'challenge',email_hint:'p•••@example.test'}},async completeChallenge(){completed++;return null}};
 const result=await authenticateLoginWithMfa(db,mfa,'person@example.test',{password:'secret'});assert.deepEqual(result,{mfa_required:true,challenge_id:'challenge',email_hint:'p•••@example.test',email:'person@example.test'});assert.equal(challengeRequests,1);assert.equal(completed,0);assert.equal(passwordLookups,1);
});
test('MFA challenge must complete for the same account email before returning a session account',async()=>{
 const db={async one(){throw new Error('password lookup must not run for code submission')}} as never;let completed=0;const account={id:'account',name:'A',email:'person@example.test',avatar_url:null,preferences:{},is_root:false,disabled:false,email_verified:true,session_version:1,mfa_enabled:true};const mfa={async requestLogin(){throw new Error('not expected')},async completeChallenge(id:unknown,code:unknown,purpose:string){completed++;assert.equal(id,'challenge');assert.equal(code,'123456');assert.equal(purpose,'login');return account}};
 const result=await authenticateLoginWithMfa(db,mfa,'person@example.test',{mfa_challenge_id:'challenge',mfa_code:'123456'});assert.ok(result&&!('mfa_required' in result));if(result)assert.equal(result.id,'account');assert.equal(await authenticateLoginWithMfa(db,mfa,'other@example.test',{mfa_challenge_id:'challenge',mfa_code:'123456'}),null);assert.equal(completed,2);
});

test('MFA invalid code commits the failed-attempt counter without attempting rollback after commit',async()=>{
 let commits=0,rollbacks=0,releases=0,attemptUpdates=0;const row={id:'challenge',user_id:'account',purpose:'login',code_hash:'0'.repeat(64),attempts:0,expires_at:new Date(Date.now()+60_000),consumed_at:null,challenge_session_version:1,id_user:'account',name:'A',email:'person@example.test',avatar_url:null,preferences:{},is_root:false,disabled:false,email_verified:true,session_version:1,mfa_enabled:true};const client={async query(sql:string){if(sql==='COMMIT')commits++;if(sql==='ROLLBACK')rollbacks++;if(sql.includes('attempts=attempts+1'))attemptUpdates++;return{rows:sql.includes('SELECT c.id')?[row]:[]}},release(){releases++}};const db={pool:{async connect(){return client}}} as unknown as Db;const mfa=new MfaService(db,{send:async()=>undefined});await assert.rejects(()=>mfa.completeChallenge('00000000-0000-4000-8000-000000000001','123456','login'),/Código inválido/);assert.equal(attemptUpdates,1);assert.equal(commits,1);assert.equal(rollbacks,0);assert.equal(releases,1);
});

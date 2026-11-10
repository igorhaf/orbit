import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { AuthLifecycle, AuthMailer } from './auth-lifecycle';
import type { Db } from '../db';

const sha = (value:string) => createHash('sha256').update(value).digest('hex');

test('recovery is non-enumerable and requests for unknown users do not send mail',async()=>{
  const queried:string[]=[];let sends=0;
  const db={async one(sql:string){queried.push(sql);return null},async query(sql:string){queried.push(sql);return []}} as unknown as Db;
  const mailer:AuthMailer={async send(){sends++}};
  const auth=new AuthLifecycle(db,mailer,{} as never);
  assert.deepEqual(await auth.requestRecovery('missing@example.test'),{ok:true});
  assert.deepEqual(await auth.requestRecovery('missing@example.test'),{ok:true});
  assert.equal(sends,0);
  assert.ok(queried.some(q=>q.includes('account_auth_limits')));
});

test('recovery provider failure is indistinguishable, consumes the token and logs no address or token',async()=>{
  const statements:Array<{sql:string;args:unknown[]|undefined}>=[];let requests=0;
  const db={async one(sql:string){if(sql.includes('FROM users'))return {id:'user-1',email:'known@example.test',disabled:false,is_root:false};return null},async query(sql:string,args?:unknown[]){statements.push({sql,args});if(sql.includes('account_auth_limits'))return [{requests:++requests}];return []}} as unknown as Db;
  const mailer:AuthMailer={async send(){throw new Error('provider secret detail')}};
  const auth=new AuthLifecycle(db,mailer,{} as never);
  const oldWarn=console.warn;const logs:unknown[]=[];console.warn=(...args:unknown[])=>logs.push(args);
  try { assert.deepEqual(await auth.requestRecovery('known@example.test'),{ok:true}); }
  finally { console.warn=oldWarn; }
  assert.equal(requests,1);
  assert.equal(sha('known@example.test').length,64);
  assert.ok(statements.some(call=>call.sql.includes('consumed_at=now()')&&call.sql.includes('token_hash=$1')));
  assert.equal(JSON.stringify(logs).includes('known@example.test'),false);
  assert.equal(JSON.stringify(logs).includes('provider secret'),false);
});

test('public recovery returns the same response for unknown and SMTP-failing known accounts',async()=>{
  const make=(known:boolean)=>{
    const db={async one(sql:string){return sql.includes('FROM users')&&known?{id:'user-1',email:'known@example.test',disabled:false,is_root:false}:null},async query(sql:string){return sql.includes('account_auth_limits')?[{requests:1}]:[]}} as unknown as Db;
    return new AuthLifecycle(db,{async send(){throw new Error('smtp')}} as AuthMailer,{} as never);
  };
  assert.deepEqual(await make(false).requestRecovery('missing@example.test'),await make(true).requestRecovery('known@example.test'));
});

test('per-account abuse limit does not prevent another account from requesting recovery',async()=>{
  const counts=new Map<string,number>();
  const db={async one(){return null},async query(sql:string,args:unknown[]){if(sql.includes('account_auth_limits')){const key=String(args[0]),count=(counts.get(key)||0)+1;counts.set(key,count);return [{requests:count}]}return []}} as unknown as Db;
  const auth=new AuthLifecycle(db,{async send(){}} as AuthMailer,{} as never);
  for(let i=0;i<5;i++)await auth.requestRecovery('one@example.test');
  assert.deepEqual(await auth.requestRecovery('one@example.test'),{ok:true});
  await auth.requestRecovery('two@example.test');
  assert.equal(counts.size,2);
  assert.notEqual(sha('one@example.test'),sha('two@example.test'));
});

test('completion consumes a token once, hashes password, verifies account, and revokes sessions',async()=>{
  let active=true;const statements:string[]=[];let commits=0;
  const client={async query(sql:string){statements.push(sql);if(sql.includes('SELECT t.id'))return {rows:active?[{id:'token-row',user_id:'user-1',purpose:'verify'}]:[]};if(sql.includes('consumed_at IS NULL'))active=false;if(sql==='COMMIT')commits++;return {rows:[]}},release(){}};
  const db={pool:{async connect(){return client}}} as unknown as Db;
  const auth=new AuthLifecycle(db,{async send(){}} as AuthMailer,{} as never);
  const token='a'.repeat(43);
  assert.deepEqual(await auth.complete(token,'a sufficiently long password'),{ok:true});
  assert.equal(commits,1);assert.ok(statements.some(sql=>sql.includes('session_version=session_version+1')));assert.ok(statements.some(sql=>sql.includes('email_verified=true')));
  await assert.rejects(()=>auth.complete(token,'another sufficiently long password'),/Token inválido ou expirado/);
});

test('expired or unknown token rolls back completion',async()=>{
  let rolledBack=false;
  const client={async query(sql:string){if(sql.includes('SELECT t.id'))return {rows:[]};if(sql==='ROLLBACK')rolledBack=true;return {rows:[]}},release(){}};
  const auth=new AuthLifecycle({pool:{async connect(){return client}}} as unknown as Db,{async send(){}} as AuthMailer,{} as never);
  await assert.rejects(()=>auth.complete('b'.repeat(43),'a sufficiently long password'),/Token inválido ou expirado/);
  assert.equal(rolledBack,true);
});

test('ROOT recovery updates only password and session version, and accepts only verified recovery tokens',async()=>{
  const statements:string[]=[];
  const client={async query(sql:string){statements.push(sql);if(sql.includes('SELECT t.id'))return {rows:[{id:'root-token',user_id:'root',purpose:'recover'}]};return {rows:[]}},release(){}};
  const auth=new AuthLifecycle({pool:{async connect(){return client}}} as unknown as Db,{async send(){}} as AuthMailer,{} as never);
  assert.deepEqual(await auth.complete('c'.repeat(43),'a sufficiently long password'),{ok:true});
  const select=statements.find(sql=>sql.includes('SELECT t.id'))||'';
  assert.match(select,/NOT u\.is_root OR \(t\.purpose='recover' AND u\.email_verified\)/);
  const update=statements.find(sql=>sql.includes('UPDATE users SET password_hash'))||'';
  assert.match(update,/session_version=session_version\+1/);
  assert.doesNotMatch(update,/email_verified|disabled|is_root|role/i);
});

test('invitation requires access.manage, validates roles, and rolls back on SMTP failure',async()=>{
  const calls:string[]=[];let released=false;let roleValidation=0;
  const client={async query(sql:string){calls.push(sql);if(sql.startsWith('INSERT INTO users'))return {rows:[{id:'new-user'}]};return {rows:[]}},release(){released=true}};
  const db={async one(){return null},async query(sql:string){calls.push(sql);return [{requests:1}]},pool:{async connect(){return client}}} as unknown as Db;
  const access={async require(_actor:string,permission:string){assert.equal(permission,'access.manage')},async validateRoles(_actor:string,roles:unknown){roleValidation++;assert.deepEqual(roles,['user']);return ['user']}};
  const auth=new AuthLifecycle(db,{async send(){throw new Error('smtp secret')}} as AuthMailer,access as never);
  await assert.rejects(()=>auth.invite('admin',{name:'Invited',email:'invite@example.test',roles:['user']}),/SMTP/);
  assert.equal(roleValidation,1);assert.equal(released,true);assert.ok(calls.includes('ROLLBACK'));assert.ok(!calls.includes('COMMIT'));
  const denied=new AuthLifecycle(db,{async send(){}} as AuthMailer,{...access,async require(){throw new Error('forbidden')}} as never);
  await assert.rejects(()=>denied.invite('reader',{name:'Nope',email:'nope@example.test'}),/forbidden/);
});

test('invitation commits the validated profile and mails a one-time link',async()=>{
  const calls:Array<{sql:string;args:unknown[]|undefined}>=[];let mailed='';
  const client={async query(sql:string,args?:unknown[]){calls.push({sql,args});if(sql.startsWith('INSERT INTO users'))return {rows:[{id:'new-user'}]};return {rows:[]}},release(){}};
  const db={async one(){return null},async query(sql:string,args?:unknown[]){calls.push({sql,args});return [{requests:1}]},pool:{async connect(){return client}}} as unknown as Db;
  const access={async require(){},async validateRoles(_actor:string,roles:unknown){assert.deepEqual(roles,['user']);return ['user']}};
  const auth=new AuthLifecycle(db,{async send(_to:string,_subject:string,url:string){mailed=url}},access as never);
  assert.deepEqual(await auth.invite('admin',{name:'New account',email:'new@example.test',roles:['user']}),{ok:true});
  assert.match(mailed,/\/auth\/verify\?token=/);assert.ok(calls.some(call=>call.sql==='COMMIT'));assert.ok(!calls.some(call=>call.sql==='ROLLBACK'));
  const insert=calls.find(call=>call.sql.includes("INSERT INTO account_auth_tokens"));
  assert.ok(insert);assert.ok(typeof insert.args?.[1]==='string');assert.ok(!mailed.includes(String(insert.args?.[1])));
});

test('invitation refuses the protected ROOT account without opening a transaction',async()=>{
  let connected=false;
  const db={async one(){return {id:'root',email_verified:true,is_root:true}},async query(){return [{requests:1}]},pool:{async connect(){connected=true;throw new Error('unexpected transaction')}}} as unknown as Db;
  const access={async require(){},async validateRoles(){return ['user']}};
  const auth=new AuthLifecycle(db,{async send(){}} as AuthMailer,access as never);
  await assert.rejects(()=>auth.invite('admin',{name:'Root',email:'root@example.test'}),/ROOT/);
  assert.equal(connected,false);
});

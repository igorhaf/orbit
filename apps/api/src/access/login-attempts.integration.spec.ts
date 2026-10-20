import 'dotenv/config';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {test} from 'node:test';
import {Pool} from 'pg';
import {Db} from '../db';
import {LoginAttemptLimiter,loginBucketDigest} from './login-attempts';

test('login limiter persists concurrent account and origin buckets without storing identifiers',async()=>{
  const url=new URL(process.env.DATABASE_URL!);url.hostname=process.env.ORBIT_TEST_DB_HOST||process.env.ORBIT_SELENIUM_DB_HOST||url.hostname;
  const adminUrl=new URL(url);adminUrl.username=execFileSync('docker',['exec','orbit-db-dev','printenv','POSTGRES_USER'],{encoding:'utf8'}).trim();adminUrl.password=execFileSync('docker',['exec','orbit-db-dev','printenv','POSTGRES_PASSWORD'],{encoding:'utf8'}).trim();
  const schema=`login_limit_test_${randomUUID().replaceAll('-','')}`,admin=new Pool({connectionString:adminUrl.toString()});
  const db=new Db();await db.pool.end();db.pool=new Pool({connectionString:url.toString(),options:`-c search_path=${schema}`});
  try{
    await admin.query(`CREATE SCHEMA ${schema} AUTHORIZATION ${url.username}`);
    const migration=await readFile(resolve(__dirname,'../../sql/migrations/099_auth_login_attempt_limits.sql'),'utf8');await db.pool.query(migration);
    const limiter=new LoginAttemptLimiter(db,'integration-test-pepper');
    const email='Account.Example@example.test',origin='192.0.2.45';
    const concurrent=await Promise.all(Array.from({length:20},()=>limiter.tryStartAttempt(email,origin)));
    assert.equal(concurrent.filter(Boolean).length,5);
    assert.equal(await limiter.tryStartAttempt(email,origin),false);
    const retryAfter=await limiter.retryAfterSeconds(email,origin);assert.ok(retryAfter>0&&retryAfter<=900);
    const accountHash=loginBucketDigest('account',email.trim().toLowerCase(),'integration-test-pepper');
    const account=await db.one<{failure_count:number;blocked_until:Date}>(`SELECT failure_count,blocked_until FROM auth_login_attempts WHERE bucket_hash=$1`,[accountHash]);
    assert.equal(account?.failure_count,5);assert.ok(account?.blocked_until);
    const columns=await db.query<{column_name:string}>('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2',[schema,'auth_login_attempts']);
    assert.equal(columns.some(row=>row.column_name==='email'||row.column_name==='origin'||row.column_name==='ip_address'),false);

    await db.query("UPDATE auth_login_attempts SET blocked_until=now()-interval '1 second',window_started_at=now()-interval '16 minutes' WHERE bucket_hash=$1",[accountHash]);
    assert.equal(await limiter.tryStartAttempt(email,origin),true);
    const reset=await db.one<{failure_count:number}>('SELECT failure_count FROM auth_login_attempts WHERE bucket_hash=$1',[accountHash]);assert.equal(reset?.failure_count,1);
    await limiter.recordSuccess(email,origin);
    assert.equal(await db.one('SELECT bucket_hash FROM auth_login_attempts WHERE bucket_hash=$1',[accountHash]),null);

    const sharedOrigin='198.51.100.20';
    const originAttempts=await Promise.all(Array.from({length:30},(_,i)=>limiter.tryStartAttempt(`user-${i}@example.test`,sharedOrigin)));
    assert.equal(originAttempts.filter(Boolean).length,20);
    assert.equal(await limiter.tryStartAttempt('another@example.test',sharedOrigin),false);
    const successfulIndex=originAttempts.findIndex(Boolean);assert.ok(successfulIndex>=0);
    await limiter.recordSuccess(`user-${successfulIndex}@example.test`,sharedOrigin);
    const originHash=loginBucketDigest('origin',sharedOrigin,'integration-test-pepper');
    const originBucket=await db.one<{failure_count:number;blocked_until:Date|null}>('SELECT failure_count,blocked_until FROM auth_login_attempts WHERE bucket_hash=$1',[originHash]);
    assert.equal(originBucket?.failure_count,19);assert.equal(originBucket?.blocked_until,null);
    assert.equal(await limiter.tryStartAttempt('another@example.test',sharedOrigin),true);
    assert.equal(await limiter.tryStartAttempt('last@example.test',sharedOrigin),false);
    const raw=await db.query<{bucket_hash:string}>('SELECT bucket_hash FROM auth_login_attempts');
    assert.equal(raw.some(row=>row.bucket_hash.includes('@')||row.bucket_hash.includes(sharedOrigin)),false);
  }finally{await db.pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end()}
});

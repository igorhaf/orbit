import 'dotenv/config';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {test} from 'node:test';
import {Pool} from 'pg';
import {Db} from '../db';
import {RequestRateLimiter,requestRateBucket} from './request-rate-limits';

test('request limits persist atomically by operation, identity and origin without storing identifiers',async()=>{
  const url=new URL(process.env.DATABASE_URL!);url.hostname=process.env.ORBIT_TEST_DB_HOST||url.hostname;
  const adminUrl=new URL(url);adminUrl.username=execFileSync('docker',['exec','orbit-db-dev','printenv','POSTGRES_USER'],{encoding:'utf8'}).trim();adminUrl.password=execFileSync('docker',['exec','orbit-db-dev','printenv','POSTGRES_PASSWORD'],{encoding:'utf8'}).trim();
  const schema=`request_limit_test_${randomUUID().replaceAll('-','')}`,admin=new Pool({connectionString:adminUrl.toString()});
  const db=new Db();await db.pool.end();db.pool=new Pool({connectionString:url.toString(),options:`-c search_path=${schema}`});
  const originalPepper=process.env.JWT_SECRET;
  try{
    await admin.query(`CREATE SCHEMA ${schema} AUTHORIZATION ${url.username}`);
    const migration=await readFile(resolve(__dirname,'../../sql/migrations/100_request_rate_limits.sql'),'utf8');await db.pool.query(migration);
    const pepper='integration-test-pepper-that-is-long-enough';
    process.env.JWT_SECRET=pepper;
    const limiter=new RequestRateLimiter(db),windowMs=60_000;
    const scopes=(identity:string,origin:string)=>[{kind:'identity' as const,value:identity,limit:5},{kind:'origin' as const,value:origin,limit:20}];
    const first=await Promise.all(Array.from({length:15},()=>limiter.consume('auth.recovery',scopes('one@example.test','192.0.2.12'),windowMs)));
    assert.equal(first.filter(value=>value.allowed).length,5);
    const denied=first.find(value=>!value.allowed);assert.ok(denied&&denied.retryAfterSeconds>0&&denied.retryAfterSeconds<=60);
    assert.equal((await limiter.consume('auth.recovery',scopes('two@example.test','192.0.2.12'),windowMs)).allowed,true);
    assert.equal((await limiter.consume('auth.invitation',scopes('one@example.test','192.0.2.12'),windowMs)).allowed,true);
    const identityHash=requestRateBucket('auth.recovery',{kind:'identity',value:'one@example.test',limit:5},pepper);
    const row=await db.one<{request_count:number}>('SELECT request_count FROM request_rate_limits WHERE bucket_hash=$1',[identityHash]);assert.equal(row?.request_count,5);
    const columns=await db.query<{column_name:string}>('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2',[schema,'request_rate_limits']);
    assert.equal(columns.some(row=>['identity','email','origin','ip_address'].includes(row.column_name)),false);
    const hashes=await db.query<{bucket_hash:string}>('SELECT bucket_hash FROM request_rate_limits');
    assert.equal(hashes.some(row=>row.bucket_hash.includes('@')||row.bucket_hash.includes('192.0.2.12')),false);
  }finally{if(originalPepper===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=originalPepper;await db.pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end()}
});

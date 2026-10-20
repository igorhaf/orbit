import {createHmac} from 'node:crypto';
import {Injectable} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import type {Db} from '../db';

const WINDOW_MS=15*60*1000;
const BLOCK_MS=15*60*1000;
const ACCOUNT_LIMIT=5;
const ORIGIN_LIMIT=20;
const MAX_AGE='24 hours';
const DUMMY_PASSWORD_HASH=bcrypt.hashSync('orbit-invalid-account-dummy-password',12);

export type LoginBucketState={failure_count:number;window_started_at:Date|string;blocked_until:Date|string|null};

export function loginBucketDigest(kind:'account'|'origin',value:string,pepper:string){
  return createHmac('sha256',pepper).update(`${kind}\0${value}`).digest('hex');
}

export async function loginPasswordMatches(storedHash:string|undefined,password:string){
  const matches=await bcrypt.compare(password,storedHash||DUMMY_PASSWORD_HASH);
  return Boolean(storedHash)&&matches;
}

export type LoginAccount={id:string;name:string;email:string;avatar_url:string|null;preferences:unknown;is_root:boolean;disabled:boolean;email_verified:boolean;session_version:number};
export async function authenticateLoginAccount(db:Pick<Db,'one'>,email:string,password:string){
  const row=await db.one<LoginAccount&{password_hash:string}>('SELECT id,name,email,avatar_url,preferences,password_hash,is_root,disabled,email_verified,session_version FROM users WHERE email=$1',[email]);
  const passwordMatches=await loginPasswordMatches(row?.password_hash,password);
  return row&&!row.disabled&&row.email_verified!==false&&passwordMatches?row:null;
}

export function nextLoginBucketState(current:LoginBucketState|null,now:number,limit:number){
  const started=current?new Date(current.window_started_at).getTime():NaN;
  const blocked=current?.blocked_until?new Date(current.blocked_until).getTime():NaN;
  const reset=!current||now-started>=WINDOW_MS||(Number.isFinite(blocked)&&blocked<=now);
  const failure_count=reset?1:current.failure_count+1;
  return {
    failure_count,
    window_started_at:new Date(reset?now:started),
    blocked_until:failure_count>=limit?new Date(now+BLOCK_MS):null,
  };
}

@Injectable()
export class LoginAttemptLimiter {
  constructor(private readonly db:Db,private readonly pepper=process.env.JWT_SECRET||''){}

  private buckets(email:string,origin:string){
    const normalized=email.trim().toLowerCase();
    const address=origin.trim().slice(0,128)||'unknown';
    return [
      {hash:loginBucketDigest('account',normalized,this.pepper),limit:ACCOUNT_LIMIT},
      {hash:loginBucketDigest('origin',address,this.pepper),limit:ORIGIN_LIMIT},
    ].sort((a,b)=>a.hash.localeCompare(b.hash));
  }

  async tryStartAttempt(email:string,origin:string){
    const buckets=this.buckets(email,origin);
    const client=await this.db.pool.connect();
    try{
      await client.query('BEGIN');
      const now=new Date((await client.query<{now:Date}>('SELECT clock_timestamp() AS now')).rows[0].now).getTime();
      for(const bucket of buckets){
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[bucket.hash]);
      }
      const currentStates=[] as Array<LoginBucketState|null>;
      for(const bucket of buckets){
        const current=(await client.query<LoginBucketState>('SELECT failure_count,window_started_at,blocked_until FROM auth_login_attempts WHERE bucket_hash=$1 FOR UPDATE',[bucket.hash])).rows[0]||null;
        if(current?.blocked_until&&new Date(current.blocked_until).getTime()>now){await client.query('ROLLBACK');return false;}
        currentStates.push(current);
      }
      for(let index=0;index<buckets.length;index++){
        const bucket=buckets[index],current=currentStates[index];
        const next=nextLoginBucketState(current,now,bucket.limit);
        await client.query(`INSERT INTO auth_login_attempts(bucket_hash,failure_count,window_started_at,blocked_until,updated_at)
          VALUES($1,$2,$3,$4,now()) ON CONFLICT(bucket_hash) DO UPDATE SET failure_count=EXCLUDED.failure_count,
          window_started_at=EXCLUDED.window_started_at,blocked_until=EXCLUDED.blocked_until,updated_at=now()`,
          [bucket.hash,next.failure_count,next.window_started_at,next.blocked_until]);
      }
      await client.query(`WITH stale AS (SELECT bucket_hash FROM auth_login_attempts WHERE updated_at<now()-interval '${MAX_AGE}' ORDER BY updated_at LIMIT 500)
        DELETE FROM auth_login_attempts a USING stale WHERE a.bucket_hash=stale.bucket_hash`);
      await client.query('COMMIT');
      return true;
    }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  }

  async retryAfterSeconds(email:string,origin:string){
    const hashes=this.buckets(email,origin).map(bucket=>bucket.hash);
    const row=await this.db.one<{seconds:number|null}>(`SELECT CEIL(EXTRACT(EPOCH FROM (max(blocked_until)-clock_timestamp())))::int AS seconds
      FROM auth_login_attempts WHERE bucket_hash=ANY($1::text[]) AND blocked_until>clock_timestamp()`,[hashes]);
    return Math.max(1,Number(row?.seconds||1));
  }

  async recordSuccess(email:string,origin:string){
    const buckets=this.buckets(email,origin);
    const client=await this.db.pool.connect();
    try{
      await client.query('BEGIN');
      for(const bucket of buckets)await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[bucket.hash]);
      for(const bucket of buckets){
        const current=(await client.query<LoginBucketState>('SELECT failure_count,window_started_at,blocked_until FROM auth_login_attempts WHERE bucket_hash=$1 FOR UPDATE',[bucket.hash])).rows[0];
        if(!current)continue;
        const remaining=Math.max(0,current.failure_count-1);
        if(!remaining)await client.query('DELETE FROM auth_login_attempts WHERE bucket_hash=$1',[bucket.hash]);
        else await client.query(`UPDATE auth_login_attempts SET failure_count=$2::integer,blocked_until=CASE WHEN $2::integer<$3::integer THEN NULL ELSE blocked_until END,updated_at=now() WHERE bucket_hash=$1`,[bucket.hash,remaining,bucket.limit]);
      }
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  }
}

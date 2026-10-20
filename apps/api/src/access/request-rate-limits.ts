import {createHmac} from 'node:crypto';
import {Inject,Injectable} from '@nestjs/common';
import {Db} from '../db';

export type RequestRateScope={kind:'identity'|'origin';value:string;limit:number};
export type RequestRateDecision={allowed:boolean;retryAfterSeconds:number};
export type RequestRateState={request_count:number;window_started_at:Date|string};

export function configuredRequestLimit(name:string,fallback:number){
  const value=process.env[name];
  if(value===undefined||value.trim()==='')return fallback;
  const parsed=Number(value);
  if(!Number.isSafeInteger(parsed)||parsed<1||parsed>100_000)throw new Error(`Configuração inválida: ${name}.`);
  return parsed;
}

export function requestRateBucket(operation:string,scope:RequestRateScope,pepper:string){
  return createHmac('sha256',pepper).update(`${operation}\0${scope.kind}\0${scope.value.trim().slice(0,256)}`).digest('hex');
}

export function requestRateDecision(states:Array<{state:RequestRateState|null;limit:number}>,now:number,windowMs:number):RequestRateDecision{
  const denied=states.filter(({state,limit})=>state&&now-new Date(state.window_started_at).getTime()<windowMs&&state.request_count>=limit);
  if(!denied.length)return {allowed:true,retryAfterSeconds:0};
  const resetAt=Math.min(...denied.map(({state})=>new Date(state!.window_started_at).getTime()+windowMs));
  return {allowed:false,retryAfterSeconds:Math.max(1,Math.ceil((resetAt-now)/1000))};
}

@Injectable()
export class RequestRateLimiter{
  private lastCleanup=0;
  constructor(@Inject(Db) private readonly db:Db){}
  private get pepper(){return process.env.JWT_SECRET||''}

  async consume(operation:string,scopes:RequestRateScope[],windowMs:number):Promise<RequestRateDecision>{
    if(!/^[a-z][a-z0-9_.-]{1,79}$/.test(operation)||!scopes.length||!Number.isSafeInteger(windowMs)||windowMs<1000||windowMs>86_400_000||scopes.some(scope=>!scope.value.trim()||!Number.isSafeInteger(scope.limit)||scope.limit<1||scope.limit>100_000))throw new Error('Política de limite de requisições inválida.');
    if(this.pepper.length<32)throw new Error('Chave de proteção de limites de requisição indisponível.');
    const buckets=scopes.map(scope=>({hash:requestRateBucket(operation,scope,this.pepper),limit:scope.limit})).sort((a,b)=>a.hash.localeCompare(b.hash));
    const client=await this.db.pool.connect();
    try{
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='5s'");
      const now=new Date((await client.query<{now:Date}>('SELECT clock_timestamp() AS now')).rows[0].now).getTime();
      for(const bucket of buckets)await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[bucket.hash]);
      const states=[] as Array<{state:RequestRateState|null;limit:number}>;
      for(const bucket of buckets){
        const state=(await client.query<RequestRateState>('SELECT request_count,window_started_at FROM request_rate_limits WHERE bucket_hash=$1 FOR UPDATE',[bucket.hash])).rows[0]||null;
        states.push({state,limit:bucket.limit});
      }
      const decision=requestRateDecision(states,now,windowMs);
      if(!decision.allowed){await client.query('ROLLBACK');return decision;}
      for(let index=0;index<buckets.length;index++){
        const bucket=buckets[index],state=states[index].state;
        const active=state&&now-new Date(state.window_started_at).getTime()<windowMs;
        await client.query(`INSERT INTO request_rate_limits(bucket_hash,request_count,window_started_at,updated_at) VALUES($1,1,$2,now())
          ON CONFLICT(bucket_hash) DO UPDATE SET request_count=CASE WHEN $3 THEN request_rate_limits.request_count+1 ELSE 1 END,
          window_started_at=CASE WHEN $3 THEN request_rate_limits.window_started_at ELSE EXCLUDED.window_started_at END,updated_at=now()`,[bucket.hash,new Date(now),Boolean(active)]);
      }
      if(now-this.lastCleanup>60_000){
        await client.query(`WITH stale AS (SELECT bucket_hash FROM request_rate_limits WHERE updated_at<now()-interval '24 hours' ORDER BY updated_at LIMIT 500)
          DELETE FROM request_rate_limits r USING stale WHERE r.bucket_hash=stale.bucket_hash`);
        this.lastCleanup=now;
      }
      await client.query('COMMIT');
      return decision;
    }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error}finally{client.release()}
  }
}

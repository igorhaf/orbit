import type {IsolatedCheckoutRequest} from './isolated-checkout';
import {randomUUID} from 'node:crypto';
import {assertCardRevision} from '../card-versions';
import { enforceCodexQuota } from '../codex-limits';
import {PoolClient} from 'pg';
import {Db} from '../db';
import {ExecutionConfig,ExecutionResult,Output} from './types';
import {redact,scrub} from './security';
export type Run={worker_id?:string|null;card_revision?:number|null;id:string;card_id:string;project_id:string;user_id:string;agent:string|null;executor:string;action:string;status:string;stage:string;input:{config:ExecutionConfig;card:{id:string;title:string;description:string};resources?:unknown;checkout_request?:IsolatedCheckoutRequest;context_manifest_id?:string};cancel_requested:boolean};

export class RunRepository {
  readonly workerId=`orbit-core:${process.pid}:${randomUUID()}`;
  constructor(private db:Db){}
  async enqueue(client:PoolClient,card:{id:string;title:string;description:string;board_id:string;card_revision:number},user:string,config:ExecutionConfig,key:string,checkoutRequest?:IsolatedCheckoutRequest,onInserted?:(client:PoolClient,run:Run)=>Promise<void>){
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[card.id]);
    const previous=(await client.query('SELECT * FROM card_runs WHERE card_id=$1 AND request_key=$2',[card.id,key])).rows[0];if(previous)return previous;
    const current=(await client.query<{card_revision:number}>('SELECT card_revision FROM cards WHERE id=$1 FOR SHARE',[card.id])).rows[0];
    assertCardRevision(card.card_revision,current?.card_revision);
    if((await client.query("SELECT id FROM card_runs WHERE card_id=$1 AND status IN ('queued','running') UNION ALL SELECT id FROM card_ai_runs WHERE card_id=$1 AND status='running'",[card.id])).rowCount)throw new Error('Este cartão já possui uma execução ativa.');
    const run=(await client.query(`INSERT INTO card_runs(card_id,project_id,user_id,agent,executor,action,input,request_key,card_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[card.id,config.project_id,user,config.agent,config.executor,config.action,JSON.stringify({config,...(checkoutRequest?{checkout_request:checkoutRequest}:{}),card:{id:card.id,title:redact(card.title),description:redact(card.description),card_revision:card.card_revision}}),key,card.card_revision])).rows[0];
    if(onInserted)await onInserted(client,run);
    await this.log(client,run.id,'queued','Execução criada.');return run;
  }
  async log(client:PoolClient,id:string,stage:string,message:string){await client.query('INSERT INTO card_run_logs(run_id,stage,message) VALUES($1,$2,$3)',[id,stage,redact(message)])}
  async claim(){await enforceCodexQuota(this.db);const client=await this.db.pool.connect();try{await client.query('BEGIN');const run=(await client.query<Run>("UPDATE card_runs SET status='running',stage='context',worker_id=$1,started_at=now(),heartbeat_at=now() WHERE id=(SELECT id FROM card_runs WHERE status='queued' AND NOT EXISTS (SELECT 1 FROM users WHERE users.id=card_runs.user_id AND preferences->>'codexQueuePaused'='true') ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *",[this.workerId])).rows[0];if(run)await this.log(client,run.id,'started','Execução iniciada.');await client.query('COMMIT');return run}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
  async stage(id:string,stage:string,message:string){const client=await this.db.pool.connect();try{await client.query('BEGIN');const written=await client.query("UPDATE card_runs SET stage=$2,heartbeat_at=now(),metadata=CASE WHEN $2 LIKE '%workspace' THEN jsonb_set(metadata,'{write_coordination}',COALESCE(metadata->'write_coordination','{}'::jsonb)||jsonb_build_object('phase',$2)) ELSE metadata END WHERE id=$1 AND status='running' AND worker_id=$3 RETURNING id",[id,stage,this.workerId]);if(!written.rows.length)throw new Error("A execução deixou de pertencer a este worker.");await this.log(client,id,stage,message);await client.query('COMMIT')}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
  async finish(run:Run,status:'success'|'failed'|'cancelled',output?:ExecutionResult,error?:string,after?:(client:PoolClient)=>Promise<void>){
    await enforceCodexQuota(this.db,true);
    const client=await this.db.pool.connect();try{
      await client.query('BEGIN');const locked=(await client.query('SELECT status,cancel_requested,worker_id FROM card_runs WHERE id=$1 FOR UPDATE',[run.id])).rows[0];
      if(!locked||locked.worker_id!==this.workerId||!['queued','running'].includes(locked.status)){await client.query('COMMIT');return}
      if(locked.cancel_requested)status='cancelled';
      if(status==='success'&&after)await after(client);
      await client.query(`UPDATE card_runs SET status=$2,output=$3,error=$4,metadata=metadata||$5::jsonb,
        finished_at=now(),heartbeat_at=now() WHERE id=$1`,[run.id,status,output?JSON.stringify(scrub(output)):null,error?redact(error):null,JSON.stringify({outputCount:output?.outputs.length||0,terminalStatus:status})]);
      if(status==='success'&&output){
        const outputs=scrub(output.outputs) as Output[];
        for(let position=0;position<outputs.length;position++){
          const item=outputs[position];
          await client.query(`INSERT INTO card_outputs(card_id,run_id,position,type,label,value)
            VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(run_id,position) DO UPDATE
            SET type=EXCLUDED.type,label=EXCLUDED.label,value=EXCLUDED.value`,[run.card_id,run.id,position,item.type,item.label||null,JSON.stringify(item.value??null)]);
        }
      }
      await this.log(client,run.id,status,error||`Execução ${status}.`);
      await client.query('COMMIT');
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }
}

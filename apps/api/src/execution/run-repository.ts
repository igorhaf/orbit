import {PoolClient} from 'pg';
import {Db} from '../db';
import {ExecutionConfig,ExecutionResult} from './types';
import {redact,scrub} from './security';
export type Run={id:string;card_id:string;project_id:string;user_id:string;agent:string|null;executor:string;action:string;status:string;stage:string;input:{config:ExecutionConfig;card:{id:string;title:string;description:string};resources?:unknown};chain:string[];cancel_requested:boolean};

export class RunRepository {
  constructor(private db:Db){}
  async enqueue(client:PoolClient,card:{id:string;title:string;description:string;board_id:string},user:string,config:ExecutionConfig,key:string,chain:string[]=[]){
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[card.id]);
    const previous=(await client.query('SELECT * FROM card_runs WHERE card_id=$1 AND request_key=$2',[card.id,key])).rows[0];if(previous)return previous;
    if((await client.query("SELECT id FROM card_runs WHERE card_id=$1 AND status IN ('queued','running') UNION ALL SELECT id FROM card_ai_runs WHERE card_id=$1 AND status='running'",[card.id])).rowCount)throw new Error('Este cartão já possui uma execução ativa.');
    const run=(await client.query(`INSERT INTO card_runs(card_id,project_id,user_id,agent,executor,action,input,request_key,chain) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[card.id,config.project_id,user,config.agent,config.executor,config.action,JSON.stringify({config,card:{id:card.id,title:redact(card.title),description:redact(card.description)}}),key,chain])).rows[0];
    await this.log(client,run.id,'queued','Execução criada.');await this.event(client,card.id,'execution.queued',run.id,chain);return run;
  }
  async log(client:PoolClient,id:string,stage:string,message:string){await client.query('INSERT INTO card_run_logs(run_id,stage,message) VALUES($1,$2,$3)',[id,stage,redact(message)])}
  async event(client:PoolClient,cardId:string,kind:string,runId:string,chain:string[]){await client.query(`INSERT INTO automation_events(board_id,card_id,kind,payload,chain) SELECT l.board_id,c.id,$2,jsonb_build_object('run_id',$3::text),$4 FROM cards c JOIN lists l ON l.id=c.list_id WHERE c.id=$1`,[cardId,kind,runId,chain])}
  async claim(){const client=await this.db.pool.connect();try{await client.query('BEGIN');const run=(await client.query<Run>("UPDATE card_runs SET status='running',stage='context',started_at=now(),heartbeat_at=now() WHERE id=(SELECT id FROM card_runs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *")).rows[0];if(run){await this.log(client,run.id,'started','Execução iniciada.');await this.event(client,run.card_id,'execution.started',run.id,run.chain)}await client.query('COMMIT');return run}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
  async stage(id:string,stage:string,message:string){const client=await this.db.pool.connect();try{await client.query('BEGIN');await client.query("UPDATE card_runs SET stage=$2,heartbeat_at=now() WHERE id=$1 AND status='running'",[id,stage]);await this.log(client,id,stage,message);await client.query('COMMIT')}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
  async finish(run:Run,status:'success'|'failed'|'cancelled',output?:ExecutionResult,error?:string,after?:(client:PoolClient)=>Promise<void>){
    const client=await this.db.pool.connect();try{
      await client.query('BEGIN');const locked=(await client.query('SELECT status,cancel_requested FROM card_runs WHERE id=$1 FOR UPDATE',[run.id])).rows[0];
      if(!locked||!['queued','running'].includes(locked.status)){await client.query('COMMIT');return}
      if(locked.cancel_requested)status='cancelled';
      await client.query("SELECT set_config('orbit.automation_chain',$1,true)",['{'+run.chain.join(',')+'}']);
      if(status==='success'&&after)await after(client);
      await client.query('UPDATE card_runs SET status=$2,output=$3,error=$4,finished_at=now(),heartbeat_at=now() WHERE id=$1',[run.id,status,output?JSON.stringify(scrub(output)):null,error?redact(error):null]);
      await this.log(client,run.id,status,error||`Execução ${status}.`);
      await this.event(client,run.card_id,status==='success'?'execution.completed':`execution.${status}`,run.id,run.chain);await client.query('COMMIT');
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }
}

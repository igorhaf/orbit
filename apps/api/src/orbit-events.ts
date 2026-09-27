import { Inject, Injectable, Optional } from '@nestjs/common';
import { Server } from 'socket.io';
import {PoolClient} from 'pg';
import {Db} from './db';

export type OrbitEvent={boardId:string;cardId?:string|null;kind:string;payload?:Record<string,unknown>;chain?:string[];sourcePlugin?:string;operationId?:string};

@Injectable()
export class OrbitEvents {
  private server?: Server;
  constructor(@Optional() @Inject(Db) private db?:Db){}

  attach(server: Server) { this.server = server; }
  async publish(event:OrbitEvent,client?:PoolClient){
    if(!client&&!this.db)throw new Error('Event Bus sem persistência configurada.');
    const sql=`INSERT INTO automation_events(board_id,card_id,kind,payload,chain,source_plugin,operation_id)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(operation_id) WHERE operation_id IS NOT NULL DO NOTHING RETURNING id`;
    const params=[event.boardId,event.cardId||null,event.kind,JSON.stringify(event.payload||{}),event.chain||[],event.sourcePlugin||null,event.operationId||null];
    const rows=client?(await client.query(sql,params)).rows:await this.db!.query(sql,params);
    if(rows.length)this.server?.to(`board:${event.boardId}`).emit('orbit:event',{...event,id:rows[0].id,at:new Date().toISOString()});
    return rows[0]||null;
  }
  boardChanged(boardId: string, source: 'trello' | 'orbit') {
    this.server?.to(`board:${boardId}`).emit('board:changed', { boardId, source, at: new Date().toISOString() });
  }
  promptProgress(boardId:string,cardId:string,event:{runId:string;status:'running'|'success'|'error';message:string}) {
    this.server?.to(`board:${boardId}`).emit('prompt:progress',{boardId,cardId,...event,at:new Date().toISOString()});
  }
}

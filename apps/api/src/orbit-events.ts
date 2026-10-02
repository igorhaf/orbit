import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';

@Injectable()
export class OrbitEvents {
  private server?: Server;

  attach(server: Server) { this.server = server; }
  boardChanged(boardId: string, source: string) {
    this.server?.to(`board:${boardId}`).emit('board:changed', { boardId, source, at: new Date().toISOString() });
  }
  notificationChanged(userId:string) {
    this.server?.to(`user:${userId}`).emit('notification:changed',{at:new Date().toISOString()});
  }
  promptProgress(boardId:string,cardId:string,event:{runId:string;status:'queued'|'running'|'success'|'error';message:string;output?:boolean;replace?:boolean;files?:Array<{path:string;kind:'add'|'delete'|'update'}>;activity?:{id:string;kind:'command';command:string;output:string;status:'running'|'completed'|'failed';exitCode?:number}}) {
    this.server?.to(`board:${boardId}`).emit('prompt:progress',{boardId,cardId,...event,at:new Date().toISOString()});
  }
  commentChanged(boardId:string,cardId:string) {
    this.server?.to(`board:${boardId}`).emit('comment:changed',{boardId,cardId,at:new Date().toISOString()});
  }
}

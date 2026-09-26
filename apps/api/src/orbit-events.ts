import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';

@Injectable()
export class OrbitEvents {
  private server?: Server;

  attach(server: Server) { this.server = server; }
  boardChanged(boardId: string, source: 'trello' | 'orbit') {
    this.server?.to(`board:${boardId}`).emit('board:changed', { boardId, source, at: new Date().toISOString() });
  }
  promptProgress(boardId:string,cardId:string,event:{runId:string;status:'running'|'success'|'error';message:string}) {
    this.server?.to(`board:${boardId}`).emit('prompt:progress',{boardId,cardId,...event,at:new Date().toISOString()});
  }
}

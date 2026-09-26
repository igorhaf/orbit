import {Injectable} from '@nestjs/common';
import {PoolClient} from 'pg';
export type ActionRequest={type:string;cardId:string;boardId:string;userId:string;config:Record<string,unknown>;chain:string[]};
type Handler=(request:ActionRequest,client:PoolClient)=>Promise<void>;
@Injectable()
export class ActionDispatcher {
  private handlers=new Map<string,Handler>();
  register(type:string,handler:Handler){if(this.handlers.has(type))throw new Error(`Ação duplicada: ${type}`);this.handlers.set(type,handler)}
  has(type:string){return this.handlers.has(type)}
  async dispatch(request:ActionRequest,client:PoolClient){const handler=this.handlers.get(request.type);if(!handler)throw new Error('Ação não registrada: '+request.type);await handler(request,client)}
}

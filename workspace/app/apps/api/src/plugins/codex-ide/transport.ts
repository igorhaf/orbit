import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createInterface} from 'node:readline';
export type RpcMessage={id?:number|string;method?:string;params?:Record<string,unknown>;result?:unknown;error?:{message:string}};
/** One stdio connection, bounded requests, explicit rejection on process loss. */
export class CodexTransport{
 private sequence=0;
 private pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 private child:ChildProcessWithoutNullStreams;
 private closed=false;
 get isClosed(){return this.closed}
 constructor(home:string,onEvent:(event:RpcMessage)=>void,executable=process.env.CODEX_BIN||'codex'){
  this.child=spawn(executable,['app-server'],{env:{...process.env,CODEX_HOME:home},stdio:'pipe'});
  this.child.stderr.resume();
  createInterface({input:this.child.stdout}).on('line',line=>{let event:RpcMessage;try{event=JSON.parse(line)}catch{return}if(event.method){onEvent(event);return}const pending=this.pending.get(Number(event.id));if(!pending)return;clearTimeout(pending.timer);this.pending.delete(Number(event.id));if(event.error)pending.reject(new Error(event.error.message));else pending.resolve(event.result)});
  this.child.on('error',()=>this.fail('Não foi possível iniciar o Codex. Confira o executável configurado.'));
  this.child.on('exit',()=>this.fail('A conexão com o Codex foi encerrada. Abra a conversa novamente.'));
  this.child.stdin.on('error',()=>this.fail('A conexão de entrada do Codex foi encerrada.'));
 }
 private fail(message:string){this.closed=true;for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(new Error(message))}this.pending.clear()}
 send(message:RpcMessage){if(this.closed)throw new Error('Conexão Codex encerrada.');this.child.stdin.write(JSON.stringify(message)+'\n')}
 call<T=Record<string,unknown>>(method:string,params:Record<string,unknown>={}):Promise<T>{if(this.closed)return Promise.reject(new Error('Conexão Codex encerrada.'));const id=++this.sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`O Codex não respondeu a ${method} dentro de 30 segundos.`))},30_000);this.pending.set(id,{resolve:value=>resolve(value as T),reject,timer});this.send({id,method,params})})}
 async initialize(){await this.call('initialize',{clientInfo:{name:'orbit_codex_ide',title:'Orbit Codex',version:'2.0.0'},capabilities:{experimentalApi:true}});this.send({method:'initialized',params:{}})}
 close(){this.fail('Painel Codex desconectado.');this.child.kill('SIGTERM')}
}

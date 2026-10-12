import {Inject,Injectable} from '@nestjs/common';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {realpath} from 'node:fs/promises';
import {isAbsolute,relative,resolve,sep} from 'node:path';
import {Client} from 'ssh2';
import {Db} from '../db';
import {SecretVault} from '../secrets';
import {redact} from '../execution/security';

const runFile=promisify(execFile);
export type CommandRequest={file?:string;args?:string[];command?:string;cwd:string;env?:Record<string,string>;timeoutMs:number;userId:string;projectRoot?:string;serverId?:string};
export type CommandResult={success:boolean;exitCode:number;stdout:string;stderr:string;startedAt:string;finishedAt:string;duration:number};
export interface CommandExecutor {id:string;execute(input:CommandRequest):Promise<CommandResult>}
export const shellQuote=(value:string)=>`'${value.replace(/'/g,"'\\''")}'`;
const clean=(value:string,secrets:string[]=[])=>{let output=redact(value);for(const secret of secrets)if(secret)output=output.split(secret).join('[REDACTED]');return output.slice(0,64000)};
const result=(started:number,exitCode:number,stdout:string,stderr:string,secrets:string[]=[]):CommandResult=>({success:exitCode===0,exitCode,stdout:clean(stdout,secrets),stderr:clean(stderr,secrets),startedAt:new Date(started).toISOString(),finishedAt:new Date().toISOString(),duration:Date.now()-started});

@Injectable()
export class LocalCommandExecutor implements CommandExecutor {
  id='local';
  async execute(input:CommandRequest):Promise<CommandResult>{
    if(!input.projectRoot)throw new Error('Projeto local obrigatório.');
    const root=await realpath(input.projectRoot),cwd=await realpath(isAbsolute(input.cwd)?input.cwd:resolve(root,input.cwd));
    const rel=relative(root,cwd);if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw new Error('Pasta fora do projeto.');
    const file=input.file||'/bin/sh',args=input.file?(input.args||[]):['-lc',input.command||''];
    const started=Date.now();
    try{const output=await runFile(file,args,{cwd,env:{...process.env,...input.env,GIT_TERMINAL_PROMPT:'0'},timeout:input.timeoutMs,maxBuffer:1024*1024});return result(started,0,output.stdout,output.stderr,Object.values(input.env||{}))}
    catch(error){const failure=error as Error&{code?:number;stdout?:string;stderr?:string;killed?:boolean};return result(started,typeof failure.code==='number'?failure.code:failure.killed?124:1,failure.stdout||'',failure.stderr||failure.message,Object.values(input.env||{}))}
  }
}

type Credential={kind:'SSH_PRIVATE_KEY'|'SSH_PASSWORD'|'GIT_TOKEN'|'GIT_SSH_KEY';encrypted_value:string};
type Server={id:string;host:string;port:number;username:string;credential_id:string;host_fingerprint:string};
@Injectable()
export class DeliveryCredentialService {
  constructor(@Inject(Db) private db:Db,@Inject(SecretVault) private vault:SecretVault){}
  async create(userId:string,input:{name:string;kind:string;value:string}){
    if(!['SSH_PRIVATE_KEY','SSH_PASSWORD','GIT_TOKEN','GIT_SSH_KEY'].includes(input.kind)||!input.name?.trim()||input.name.length>120||!input.value||input.value.length>20000)throw new Error('Credencial inválida.');
    return this.db.one('INSERT INTO delivery_credentials(owner_id,name,kind,encrypted_value) VALUES($1,$2,$3,$4) RETURNING id,name,kind,created_at',[userId,input.name.trim(),input.kind,this.vault.seal({value:input.value})]);
  }
  async list(userId:string){return this.db.query('SELECT id,name,kind,created_at FROM delivery_credentials WHERE owner_id=$1 ORDER BY name',[userId])}
  async secret(id:string,userId:string,kinds:string[]){const row=await this.db.one<Credential>('SELECT kind,encrypted_value FROM delivery_credentials WHERE id=$1 AND owner_id=$2',[id,userId]);if(!row||!kinds.includes(row.kind))throw new Error('Credencial não autorizada ou incompatível.');return this.vault.open<{value:string}>(row.encrypted_value).value}
  async resolve(id:string,userId:string,kinds:string[]){const row=await this.db.one<Credential>('SELECT kind,encrypted_value FROM delivery_credentials WHERE id=$1 AND owner_id=$2',[id,userId]);if(!row||!kinds.includes(row.kind))throw new Error('Credencial não autorizada ou incompatível.');return {kind:row.kind,value:this.vault.open<{value:string}>(row.encrypted_value).value}}
  async redact(userId:string,value:string){let output=redact(value);for(const row of await this.db.query<{encrypted_value:string}>('SELECT encrypted_value FROM delivery_credentials WHERE owner_id=$1',[userId])){const secret=this.vault.open<{value:string}>(row.encrypted_value).value;if(secret)output=output.split(secret).join('[REDACTED]')}return output.slice(0,64000)}
}

@Injectable()
export class SshCommandExecutor implements CommandExecutor {
  id='ssh';
  constructor(@Inject(Db) private db:Db,@Inject(DeliveryCredentialService) private credentials:DeliveryCredentialService){}
  protected createClient(){return new Client()}
  async server(serverId:string,userId:string){const row=await this.db.one<Server>('SELECT id,host,port,username,credential_id,host_fingerprint FROM delivery_servers WHERE id=$1 AND owner_id=$2',[serverId,userId]);if(!row)throw new Error('Servidor não autorizado.');return row}
  async execute(input:CommandRequest):Promise<CommandResult>{
    if(!input.serverId)throw new Error('Servidor obrigatório.');
    const server=await this.server(input.serverId,input.userId);
    if(!/^[a-f0-9]{64}$/i.test(server.host_fingerprint))throw new Error('Fingerprint SHA-256 do host obrigatório.');
    const credential=await this.db.one<Credential>('SELECT kind,encrypted_value FROM delivery_credentials WHERE id=$1 AND owner_id=$2',[server.credential_id,input.userId]);
    if(!credential||!['SSH_PRIVATE_KEY','SSH_PASSWORD'].includes(credential.kind))throw new Error('Credencial SSH não autorizada.');
    const secret=await this.credentials.secret(server.credential_id,input.userId,['SSH_PRIVATE_KEY','SSH_PASSWORD']);
    const command=input.file?[input.file,...input.args||[]].map(shellQuote).join(' '):input.command||'';
    const env=Object.entries(input.env||{}).map(([key,value])=>{if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))throw new Error('Variável de ambiente inválida.');return `${key}=${shellQuote(value)}`}).join(' ');
    const full=`cd -- ${shellQuote(input.cwd)} && ${env?`${env} `:''}${command}`;
    const started=Date.now();
    return new Promise<CommandResult>(resolvePromise=>{
      const client=this.createClient();let settled=false,stdout='',stderr='';
      const finish=(code:number,error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);client.end();if(error)stderr=error.message;resolvePromise(result(started,code,stdout,stderr,[secret]))};
      const timer=setTimeout(()=>finish(124,new Error('Timeout SSH.')),input.timeoutMs);
      client.on('error',(error)=>finish(1,error));
      client.on('ready',()=>client.exec(full,(error,stream)=>{if(error)return finish(1,error);stream.on('data',(chunk:Buffer)=>{stdout=(stdout+chunk.toString()).slice(-64000)});stream.stderr.on('data',(chunk:Buffer)=>{stderr=(stderr+chunk.toString()).slice(-64000)});stream.on('close',(code:number)=>finish(code??1))}));
      try{client.connect({host:server.host,port:server.port,username:server.username,hostHash:'sha256',hostVerifier:(hash:string)=>hash.toLowerCase()===server.host_fingerprint.toLowerCase(),readyTimeout:Math.min(input.timeoutMs,20000),...credential.kind==='SSH_PASSWORD'?{password:secret}:{privateKey:secret}})}catch(error){finish(1,error as Error)}
    });
  }
  async test(serverId:string,userId:string){const started=Date.now();const output=await this.execute({userId,serverId,cwd:'.',command:'echo orbit-connection-ok',timeoutMs:10000});return {connected:output.success&&output.stdout.trim()==='orbit-connection-ok',latency:Date.now()-started,fingerprint:(await this.server(serverId,userId)).host_fingerprint,error:output.success?null:output.stderr}}
}

export class CommandExecutorRegistry {
  private items=new Map<string,CommandExecutor>();
  register(item:CommandExecutor){if(this.items.has(item.id))throw new Error('Executor duplicado.');this.items.set(item.id,item)}
  get(id:string){const item=this.items.get(id);if(!item)throw new Error(`Executor não registrado: ${id}`);return item}
  list(){return [...this.items.keys()]}
}

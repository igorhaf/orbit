import type {Readable,Writable} from 'node:stream';
import {canonicalContextJson} from './context-manifest';

/** Local JSON-RPC/NDJSON contract. This is not an MCP implementation or CLI capability claim. */
export const contextBridgeProtocol='orbit-context-bridge/1' as const;
export const contextBridgeReadCapabilities=Object.freeze(['context.describe','sources.list','sources.read','context.compatibility','sources.dependencies'] as const);
export type ContextBridgeAdapterHandle={query:(request:unknown)=>Promise<unknown>;close:(reason?:string)=>Promise<void>|void;signal?:AbortSignal;capabilities?:readonly string[];knowledge?:{schemaVersion:1;maxQueryBytes:number;maxResults:number}};
export type ContextBridgeAdapterOptions={maxFrameBytes?:number;maxResponseBytes?:number;maxPendingRequests?:number;maxMessages?:number;maxTransportBytes?:number};
export type ContextBridgeRpcResponse={jsonrpc:'2.0';id:string|number|null;result?:unknown;error?:{code:number;message:string}};
type RpcId=string|number|null;
const plain=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null));
const keys=(value:Record<string,unknown>,allowed:string[])=>Object.keys(value).every(key=>allowed.includes(key));
const idValid=(value:unknown):value is string|number=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,64}$/.test(value)||typeof value==='number'&&Number.isSafeInteger(value);
const rpcError=(id:RpcId,code:number,message:string):ContextBridgeRpcResponse=>({jsonrpc:'2.0',id,error:{code,message}});
const copy=(value:unknown)=>JSON.parse(canonicalContextJson(value));

/** One adapter owns one pre-bound host capability. No identity, socket address,
 * credential, arbitrary path or database handle is accepted from the peer.
 */
export class ContextBridgeAdapter {
  private initialized=false;private closed=false;private pending=0;private closing?:Promise<void>;
  private messages=0;private transportBytes=0;private readonly metered=new WeakSet<object>();
  private readonly maxFrameBytes:number;private readonly maxResponseBytes:number;private readonly maxPendingRequests:number;
  private readonly maxMessages:number;private readonly maxTransportBytes:number;
  private readonly attachments=new Set<()=>void>();
  private readonly hostAbort=()=>{void this.close('host_revoked')};
  constructor(private readonly handle:ContextBridgeAdapterHandle,options:ContextBridgeAdapterOptions={}){
    this.maxFrameBytes=options.maxFrameBytes??16384;this.maxResponseBytes=options.maxResponseBytes??32768;this.maxPendingRequests=options.maxPendingRequests??4;
    this.maxMessages=options.maxMessages??128;this.maxTransportBytes=options.maxTransportBytes??262144;
    if(![this.maxFrameBytes,this.maxResponseBytes,this.maxTransportBytes].every(value=>Number.isSafeInteger(value)&&value>=256&&value<=1048576)||!Number.isSafeInteger(this.maxPendingRequests)||this.maxPendingRequests<1||this.maxPendingRequests>64||!Number.isSafeInteger(this.maxMessages)||this.maxMessages<1||this.maxMessages>1024)throw new Error('Invalid local Bridge adapter limits.');
    this.handle.signal?.addEventListener('abort',this.hostAbort,{once:true});if(this.handle.signal?.aborted)void this.close('host_revoked');
  }
  private active(){return !this.closed&&!this.handle.signal?.aborted}
  private bounded(response:ContextBridgeRpcResponse):ContextBridgeRpcResponse{
    if(this.metered.has(response))return response;
    try{
      let json=canonicalContextJson(response);
      if(Buffer.byteLength(json)>this.maxResponseBytes)json=canonicalContextJson(rpcError(response.id,-32004,'Bridge response exceeds the transport limit.'));
      if(this.transportBytes+Buffer.byteLength(json)+1>this.maxTransportBytes){void this.close('transport_budget_exhausted');return rpcError(response.id,-32004,'Bridge transport budget exhausted.');}
      this.transportBytes+=Buffer.byteLength(json)+1;const result=JSON.parse(json);this.metered.add(result);return result;
    }
    catch{return rpcError(response.id,-32603,'Bridge response is unavailable.');}
  }
  async handleJsonRpc(input:unknown):Promise<ContextBridgeRpcResponse|null>{
    if(!this.active())return rpcError(null,-32001,'Bridge is closed.');
    if(this.messages>=this.maxMessages){await this.close('transport_request_limit');return rpcError(null,-32003,'Bridge transport request limit reached.');}
    this.messages++;
    const result=await this.processJsonRpc(input);return result===null?null:this.bounded(result);
  }
  protected async processJsonRpc(input:unknown):Promise<ContextBridgeRpcResponse|null>{
    let request:Record<string,unknown>;
    try{const json=canonicalContextJson(input);if(Buffer.byteLength(json)>this.maxFrameBytes)return rpcError(null,-32600,'Bridge frame exceeds the transport limit.');request=JSON.parse(json);}
    catch{return rpcError(null,-32600,'Invalid Bridge request.');}
    if(!plain(request)||request.jsonrpc!=='2.0'||!keys(request,['jsonrpc','id','method','params'])||typeof request.method!=='string'||(request.id!==undefined&&!idValid(request.id)))return rpcError(null,-32600,'Invalid Bridge request.');
    const id=request.id===undefined?null:request.id as string|number;
    if(!this.active())return rpcError(id,-32001,'Bridge is closed.');
    if(request.method==='notifications/initialized'){
      if(request.id!==undefined||request.params!==undefined&&!plain(request.params)||plain(request.params)&&Object.keys(request.params).length)return rpcError(id,-32602,'Invalid Bridge notification.');
      return null;
    }
    // Only the initialized acknowledgement is a notification; every query needs an id.
    if(request.id===undefined)return rpcError(null,-32600,'Bridge requests require an id.');
    if(request.method==='initialize'){
      if(this.initialized||!plain(request.params)||!keys(request.params,['protocolVersion'])||request.params.protocolVersion!==contextBridgeProtocol)return rpcError(id,-32602,'Unsupported Bridge initialization.');
      this.initialized=true;
      return this.bounded({jsonrpc:'2.0',id,result:{protocolVersion:contextBridgeProtocol,serverInfo:{name:'orbit-context-bridge',version:'1'},readOnly:true,capabilities:[...contextBridgeReadCapabilities,...(this.handle.capabilities?.includes('knowledge.search')?['knowledge.search']:[])],transport:'local-ndjson',...(this.handle.knowledge?{knowledge:this.handle.knowledge}:{}),mcpCompatibility:'not_demonstrated'}});
    }
    if(!this.initialized)return rpcError(id,-32002,'Bridge must be initialized.');
    if(request.method==='ping'){
      if(request.params!==undefined&&(!plain(request.params)||Object.keys(request.params).length))return rpcError(id,-32602,'Invalid Bridge parameters.');
      return this.bounded({jsonrpc:'2.0',id,result:{active:true,protocolVersion:contextBridgeProtocol}});
    }
    if(request.method==='capabilities/list'){
      if(request.params!==undefined&&(!plain(request.params)||Object.keys(request.params).length))return rpcError(id,-32602,'Invalid Bridge parameters.');
      return this.bounded({jsonrpc:'2.0',id,result:{readOnly:true,...(this.handle.knowledge?{knowledge:this.handle.knowledge}:{}),capabilities:[...contextBridgeReadCapabilities,...(this.handle.capabilities?.includes('knowledge.search')?['knowledge.search']:[])]}});
    }
    if(request.method!=='capabilities/call')return rpcError(id,-32601,'Bridge method is not allowed.');
    if(!plain(request.params)||!keys(request.params,['request'])||!plain(request.params.request)||![...contextBridgeReadCapabilities,...(this.handle.capabilities?.includes('knowledge.search')?['knowledge.search']:[])].includes(String(request.params.request.capability)))return rpcError(id,-32602,'Invalid Bridge capability parameters.');
    if(this.pending>=this.maxPendingRequests)return rpcError(id,-32003,'Bridge transport concurrency limit reached.');
    this.pending++;
    try{
      const result=await this.handle.query(copy(request.params.request));
      if(!this.active())return rpcError(id,-32001,'Bridge is closed.');
      return this.bounded({jsonrpc:'2.0',id,result});
    }catch{return rpcError(id,-32603,'Bridge query is unavailable.');}
    finally{this.pending--;}
  }
  /** Attaches only caller-owned anonymous pipes/streams. It never opens a port,
   * socket or subprocess. Response writes are serialized with backpressure.
   */
  attach(readable:Readable,writable:Writable,signal?:AbortSignal):{close:()=>Promise<void>;done:Promise<void>}{
    let buffer=Buffer.alloc(0),ended=false,finished=false,streamPending=0,queuedBytes=0;
    let writes=Promise.resolve();let resolveDone:()=>void=()=>{};
    const done=new Promise<void>(resolve=>{resolveDone=resolve});
    const detach=()=>{
      if(finished)return;
      // A cancellation may race an already scheduled EPIPE/error. Keep a
      // non-authoritative error sink until these dedicated streams close.
      const ignoreLateError=()=>{};
      readable.on('error',ignoreLateError);writable.on('error',ignoreLateError);
      readable.once('close',()=>readable.removeListener('error',ignoreLateError));writable.once('close',()=>writable.removeListener('error',ignoreLateError));
      readable.removeListener('data',onData);readable.removeListener('end',onEnd);readable.removeListener('error',onError);writable.removeListener('error',onError);writable.removeListener('close',onError);signal?.removeEventListener('abort',onAbort);this.attachments.delete(detach);finished=true;if(this.closing)void this.closing.then(resolveDone);else resolveDone();
    };
    const onError=()=>{if(this.closing)detach();else void this.close('transport_lost')};
    const onAbort=()=>{if(this.closing)detach();else void this.close('transport_cancelled')};
    const emit=(response:ContextBridgeRpcResponse|null)=>{
      if(response===null||finished||!this.active())return;
      const line=canonicalContextJson(this.bounded(response))+'\n',bytes=Buffer.byteLength(line);
      queuedBytes+=bytes;
      if(queuedBytes>this.maxResponseBytes*this.maxPendingRequests){onError();return;}
      writes=writes.then(()=>new Promise<void>((resolve,reject)=>{
        if(finished||!this.active()){queuedBytes-=bytes;resolve();return;}
        writable.write(line,error=>{queuedBytes-=bytes;if(error)reject(error);else resolve()});
      })).catch(onError);
    };
    const drain=()=>{if(ended&&streamPending===0)void writes.then(()=>this.close('transport_ended'));};
    const onEnd=()=>{ended=true;if(buffer.length){emit(rpcError(null,-32700,'Incomplete Bridge frame.'));buffer=Buffer.alloc(0);}drain();};
    const onData=(chunk:Buffer|string)=>{
      if(finished||!this.active())return;
      const next=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
      // The transport bounds pending input as well as each completed frame.
      if(buffer.length+next.length>this.maxFrameBytes*(this.maxPendingRequests+1)){onError();return;}
      buffer=Buffer.concat([buffer,next]);
      let newline:number;
      while((newline=buffer.indexOf(10))>=0){
        const frame=buffer.subarray(0,newline);buffer=buffer.subarray(newline+1);
        if(frame.length>this.maxFrameBytes){emit(rpcError(null,-32600,'Bridge frame exceeds the transport limit.'));continue;}
        if(streamPending>=this.maxPendingRequests){emit(rpcError(null,-32003,'Bridge transport concurrency limit reached.'));continue;}
        let value:unknown;try{value=JSON.parse(frame.toString('utf8'))}catch{emit(rpcError(null,-32700,'Invalid Bridge JSON.'));continue;}
        streamPending++;
        void this.handleJsonRpc(value).then(emit).finally(()=>{streamPending--;drain()});
      }
      if(buffer.length>this.maxFrameBytes){emit(rpcError(null,-32600,'Bridge frame exceeds the transport limit.'));buffer=Buffer.alloc(0);onError();}
    };
    readable.on('data',onData);readable.once('end',onEnd);readable.once('error',onError);writable.once('error',onError);writable.once('close',onError);signal?.addEventListener('abort',onAbort,{once:true});this.attachments.add(detach);
    if(signal?.aborted||!this.active())onAbort();
    return {close:()=>this.close('transport_closed'),done};
  }
  async close(reason='adapter_closed'):Promise<void>{
    if(this.closing)return this.closing;
    this.closed=true;this.handle.signal?.removeEventListener('abort',this.hostAbort);
    this.closing=Promise.resolve().then(()=>this.handle.close(reason)).then(()=>undefined,()=>undefined);
    for(const detach of [...this.attachments])detach();
    return this.closing;
  }
}

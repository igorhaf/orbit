import type {ChildProcess} from 'node:child_process';
import {defaults, ProcessIdentity, TunnelConfig, TunnelState} from './configuration';
import {CloudflaredAdapter, Detection, ProcessAdapter, safeProcessError} from './cloudflared-adapter';
import {redact} from './redaction';

export type TunnelLog = {at:string; stream:'stdout'|'stderr'|'orbit'; message:string};
export class CloudflaredProcessManager {
  private config: TunnelConfig = {...defaults};
  private token = '';
  private enabled = false;
  private state: TunnelState = 'DISABLED';
  private detection: Detection = {installed:false,path:null,version:null};
  private child: ChildProcess | null = null;
  private identity: ProcessIdentity | null = null;
  private externalPid: number | null = null;
  private lastError: string | null = null;
  private temporaryUrl: string | null = null;
  private logs: TunnelLog[] = [];
  private connections = new Set<string>();
  private restartTimer?: ReturnType<typeof setTimeout>;
  private restartTimes: number[] = [];
  private restartCount = 0;
  private desiredRunning = false;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private adapter:ProcessAdapter = new CloudflaredAdapter(), private persist:(identity:ProcessIdentity|null)=>Promise<void> = async()=>{}) {}
  private serial<T>(action:()=>Promise<T>):Promise<T> {const result=this.pending.then(action);this.pending=result.catch(()=>{});return result;}
  private append(stream:TunnelLog['stream'],value:string) {const message=redact(value,this.token).slice(0,2048);this.logs.push({at:new Date().toISOString(),stream,message});if(this.logs.length>this.config.logLimit)this.logs.splice(0,this.logs.length-this.config.logLimit);}
  private failure(error:unknown) {this.lastError=safeProcessError(error,this.token);this.state='ERROR';this.append('orbit',this.lastError);}
  snapshot() {return {state:this.state,enabled:this.enabled,mode:this.config.mode,managedBy:this.config.managedBy,installed:this.detection.installed,executable:this.detection.path,version:this.detection.version,pid:this.identity?.pid||this.externalPid,startedAt:this.identity?.startedAt||null,uptimeSeconds:this.identity?Math.max(0,Math.floor((Date.now()-Date.parse(this.identity.startedAt))/1000)):null,restartCount:this.restartCount,lastError:this.lastError,temporaryUrl:this.temporaryUrl,recovered:Boolean(this.identity&&!this.child),running:Boolean(this.identity||this.externalPid),logs:[...this.logs],health:{status:this.state==='CONNECTED'?'healthy':['DISABLED','STOPPED'].includes(this.state)?'idle':'degraded',cloudflared:{installed:this.detection.installed,version:this.detection.version},process:{running:Boolean(this.identity||this.externalPid),pid:this.identity?.pid||this.externalPid},tunnel:{connected:this.state==='CONNECTED'}}};}
  isRunning() {return Boolean(this.identity);}
  reportFailure(error:unknown) {this.failure(error);}
  initialize(enabled:boolean,config:TunnelConfig,token:string,saved:ProcessIdentity|null) {
    return this.serial(async()=>{
      this.cancelRestart();this.desiredRunning=false;this.externalPid=null;this.lastError=null;
      this.config=config;this.token=token;this.enabled=enabled;
      if(config.managedBy==='orbit'&&saved&&await this.adapter.matches(saved)){this.state='STARTING';this.identity=saved;this.desiredRunning=true;this.append('orbit','Processo anterior reconhecido pela identidade completa. Logs anteriores ao reinício não estão disponíveis.');}
      if(!enabled){this.desiredRunning=false;await this.stopInternal();this.state='DISABLED';return;}
      try {await this.prepare();if(this.identity){await this.monitorInternal();return;}if(config.managedBy==='system'){await this.observe();return;}const validation=await this.validateInternal();if(validation.valid&&config.autoStart)await this.startInternal();}catch(error){this.failure(error);}
    });
  }
  setEnabled(enabled:boolean) {return this.serial(async()=>{
    if(enabled===this.enabled&&(enabled||!this.identity))return;
    this.enabled=enabled;
    if(!enabled){this.desiredRunning=false;await this.stopInternal();this.state='DISABLED';}
    else {this.lastError=null;try{await this.prepare();if(this.config.managedBy==='system')await this.observe();else if((await this.validateInternal()).valid&&this.config.autoStart)await this.startInternal();}catch(error){this.failure(error);}}
  });}
  private async prepare() {this.detection=await this.adapter.detect(this.config.executablePath);if(!this.detection.installed&&this.enabled)this.state='NOT_INSTALLED';}
  private async validateInternal() {
    try {await this.prepare();await this.adapter.validate(this.config,this.token,this.detection);if(!this.identity)this.state=this.enabled?'STOPPED':'DISABLED';this.lastError=null;return {valid:true,issues:[] as string[]};}
    catch(error){const issue=safeProcessError(error,this.token);if(!this.identity)this.state=!this.enabled?'DISABLED':this.detection.installed?'NOT_CONFIGURED':'NOT_INSTALLED';this.lastError=issue;return {valid:false,issues:[issue]};}
  }
  detect() {return this.serial(async()=>{await this.prepare();return this.detection;});}
  validate() {return this.serial(async()=>{if(this.config.managedBy==='system'){await this.prepare();return {valid:this.detection.installed,issues:this.detection.installed?[]:['cloudflared não encontrado.']};}return this.validateInternal();});}
  private async observe() {this.externalPid=await this.adapter.external();this.state=this.externalPid?'DEGRADED':this.detection.installed?'STOPPED':'NOT_INSTALLED';this.lastError=this.externalPid?'Processo externo observado. Conectividade e logs não são controlados pelo Orbit.':null;}
  start() {return this.serial(async()=>{
    if(!this.enabled)throw new Error('Este plugin está desativado.');
    if(this.config.managedBy!=='orbit')throw new Error('Processo administrado pelo sistema: o Orbit apenas observa.');
    if(this.identity)return this.snapshot();
    this.cancelRestart();this.restartTimes=[];this.restartCount=0;
    if(!(await this.validateInternal()).valid)throw new Error(this.lastError||'Configuração inválida.');
    await this.startInternal();return this.snapshot();
  });}
  private async startInternal() {
    if(this.identity)return;
    if(await this.adapter.external()){this.failure(new Error('Já existe um cloudflared externo. Selecione administração pelo sistema para observá-lo; nenhum processo foi adotado.'));throw new Error(this.lastError!);}
    this.state='STARTING';this.desiredRunning=true;this.lastError=null;this.temporaryUrl=null;this.connections.clear();
    let launched:Awaited<ReturnType<ProcessAdapter['launch']>>;
    try {launched=await this.adapter.launch(this.config,this.token,this.detection);}catch(error){this.failure(error);this.scheduleRestart();throw new Error(this.lastError!);}
    this.identity=launched.identity;this.child=launched.process;
    this.bindStream(launched.process.stdout,'stdout',launched.identity.marker);this.bindStream(launched.process.stderr,'stderr',launched.identity.marker);
    const current=launched.identity;
    launched.process.once('exit',()=>{void this.serial(()=>this.exited(current)).catch(error=>this.failure(error));});
    launched.process.once('error',()=>{void this.serial(()=>this.exited(current)).catch(error=>this.failure(error));});
    try {await this.persist(current);}catch {this.desiredRunning=false;await this.stopInternal();this.failure(new Error('Não foi possível persistir a propriedade do processo; o tunnel foi encerrado.'));throw new Error(this.lastError!);}
    this.append('orbit','cloudflared iniciado pelo Orbit.');
    if(launched.process.exitCode!==null)await this.exited(current);
  }
  private bindStream(stream:ChildProcess['stdout'],kind:'stdout'|'stderr',marker:string) {
    if(!stream)return;
    let buffered='';
    stream.setEncoding('utf8');
    stream.on('data',(chunk:string)=>{
      if(this.identity?.marker!==marker)return;
      buffered+=chunk;
      let index:number;
      while((index=buffered.indexOf('\n'))>=0){const line=buffered.slice(0,index);buffered=buffered.slice(index+1);this.logLine(kind,line);}
      if(buffered.length>65536){buffered='';this.append('orbit','Linha de log excessiva descartada.');}
    });
    stream.once('end',()=>{if(buffered&&this.identity?.marker===marker)this.logLine(kind,buffered);});
  }
  private logLine(kind:'stdout'|'stderr',line:string) {
    if(line.length>65536){this.append('orbit','Linha de log excessiva descartada.');return;}
    this.append(kind,line);
    if(this.config.mode==='quick'){const url=/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i.exec(line)?.[0];if(url)this.temporaryUrl=url;}
    const connection=/connIndex[=:](\d+)/.exec(line)?.[1]||'default';
    if(/Registered tunnel connection/i.test(line)){this.connections.add(connection);this.state='CONNECTED';this.lastError=null;}
    else if(/Unregistered tunnel connection|Connection terminated|failed to serve tunnel connection|Unable to establish connection/i.test(line)){this.connections.delete(connection);if(!this.connections.size)this.state='DEGRADED';}
    if(/authentication failed|invalid tunnel token|Unauthorized|Invalid tunnel secret/i.test(line)){this.state='ERROR';this.lastError='Falha de autenticação do tunnel. Confira o token ou as credenciais locais.';}
  }
  private cancelRestart() {if(this.restartTimer)clearTimeout(this.restartTimer);this.restartTimer=undefined;}
  private scheduleRestart() {
    if(!this.enabled||!this.desiredRunning||!this.config.restartOnFailure||this.config.managedBy!=='orbit')return;
    const now=Date.now();this.restartTimes=this.restartTimes.filter(at=>now-at<this.config.restartWindowSeconds*1000);
    if(this.restartTimes.length>=this.config.maxRestartAttempts){this.state='ERROR';this.lastError='Limite de reinícios atingido. Corrija a causa e inicie manualmente.';this.append('orbit',this.lastError);this.desiredRunning=false;return;}
    this.state='DEGRADED';this.cancelRestart();
    this.restartTimer=setTimeout(()=>{this.restartTimer=undefined;void this.serial(async()=>{if(!this.enabled||!this.desiredRunning||this.identity)return;this.restartTimes.push(Date.now());this.restartCount++;if((await this.validateInternal()).valid)await this.startInternal();else this.desiredRunning=false;}).catch(error=>this.failure(error));},this.config.restartDelaySeconds*1000);
    this.restartTimer.unref();
  }
  private async exited(expected:ProcessIdentity) {
    if(this.identity?.marker!==expected.marker)return;
    this.identity=null;this.child=null;this.connections.clear();await this.persist(null);
    if(this.desiredRunning&&this.enabled){this.state='ERROR';this.lastError=this.lastError||'cloudflared encerrou inesperadamente.';this.append('orbit',this.lastError);this.scheduleRestart();}
    else this.state=this.enabled?'STOPPED':'DISABLED';
  }
  private async stopInternal() {
    this.cancelRestart();
    const current=this.identity;
    if(!current)return;
    this.state='STOPPING';
    if(await this.adapter.matches(current))await this.adapter.stop(current);
    else this.append('orbit','Identidade anterior ausente ou diferente; nenhum sinal foi enviado.');
    this.identity=null;this.child=null;this.connections.clear();this.temporaryUrl=null;await this.persist(null);
    this.state=this.enabled?'STOPPED':'DISABLED';
  }
  stop() {return this.serial(async()=>{if(this.config.managedBy==='system')throw new Error('Processo administrado pelo sistema: o Orbit apenas observa.');this.desiredRunning=false;await this.stopInternal();return this.snapshot();});}
  restart() {return this.serial(async()=>{if(!this.enabled||this.config.managedBy==='system')throw new Error('Ative o plugin e use administração pelo Orbit para reiniciar.');this.desiredRunning=false;await this.stopInternal();this.restartTimes=[];this.restartCount=0;if(!(await this.validateInternal()).valid)throw new Error(this.lastError!);await this.startInternal();return this.snapshot();});}
  private async monitorInternal() {
    if(this.config.managedBy==='system'){await this.observe();return;}
    const current=this.identity;
    if(!current)return;
    if(!await this.adapter.matches(current)){await this.exited(current);return;}
    if(await this.adapter.ready(current)){this.state='CONNECTED';this.lastError=null;}
    else if(this.state==='CONNECTED'||Date.now()-Date.parse(current.startedAt)>30000){this.state='DEGRADED';}
  }
  tick() {return this.serial(()=>this.monitorInternal());}
  shutdown() {return this.serial(async()=>{this.enabled=false;this.desiredRunning=false;await this.stopInternal();this.state='DISABLED';});}
}

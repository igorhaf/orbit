import {Body, Controller, Get, HttpException, Inject, Injectable, OnModuleDestroy, OnModuleInit, Patch, Post, Req} from '@nestjs/common';
import type {Request} from 'express';
import type {PoolClient} from 'pg';
import {Db} from '../db';
import {SecretVault} from '../secrets';
import {openVaultIntegrationCredentials} from '../vault-integration-credentials';
import {parseVaultReference,resolveVaultReference} from '../vault-credentials';
import {FeaturesService} from '../features';
import type {PluginDefinition} from '../plugins/contract';
import {defaults, parseConfiguration, PLUGIN_ID, ProcessIdentity, TunnelConfig} from './configuration';
import {CloudflaredProcessManager} from './process-manager';

type Stored = {id:string; owner_id:string; credentials_encrypted:string; metadata:{configuration?:TunnelConfig;runtime?:ProcessIdentity|null}};
function validIdentity(input:unknown):ProcessIdentity|null {
  if(!input||typeof input!=='object')return null;
  const value=input as ProcessIdentity;
  return Number.isInteger(value.pid)&&value.pid>1&&typeof value.executable==='string'&&value.executable.startsWith('/')&&typeof value.startTicks==='string'&&/^\d+$/.test(value.startTicks)&&typeof value.marker==='string'&&/^[0-9a-f-]{36}$/i.test(value.marker)&&Number.isInteger(value.metricsPort)&&value.metricsPort>0&&value.metricsPort<65536&&typeof value.startedAt==='string'&&Number.isFinite(Date.parse(value.startedAt))?value:null;
}
@Injectable()
export class CloudflareTunnelPlugin implements OnModuleInit, OnModuleDestroy {
  private manager = new CloudflaredProcessManager(undefined,identity=>this.persistIdentity(identity));
  private row:Stored|null=null;
  private config:TunnelConfig={...defaults};
  private token='';
  private initialized=false;
  private enabled=false;
  private timer?:ReturnType<typeof setInterval>;
  private lock:PoolClient|null=null;
  private lockFailureListener:(()=>void)|null=null;
  private closing=false;
  private pending:Promise<unknown>=Promise.resolve();
  constructor(@Inject(Db) private db:Db,@Inject(SecretVault) private vault:SecretVault) {}
  private run<T>(action:()=>Promise<T>) {const result=this.pending.then(action);this.pending=result.catch(()=>{});return result;}
  async onModuleInit() {
    try{await this.run(()=>this.reconcile());}catch{this.manager.reportFailure(new Error('Não foi possível carregar o plugin. O Orbit continua disponível.'));}
    this.timer=setInterval(()=>{if(!this.closing)void this.run(()=>this.reconcile()).catch(()=>this.manager.reportFailure(new Error('Não foi possível reconciliar o plugin.')));},2000);
    this.timer.unref();
  }
  async onModuleDestroy() {
    this.closing=true;if(this.timer)clearInterval(this.timer);
    await this.run(async()=>{try{await this.manager.shutdown();}catch{this.manager.reportFailure(new Error('Falha ao finalizar o tunnel. A identidade persistida será verificada no próximo início.'));}finally{await this.releaseLock();}});
  }
  private async load() {
    this.row=await this.db.one<Stored>("SELECT id,owner_id,credentials_encrypted,metadata FROM integration_connections WHERE plugin_id=$1 AND external_account_id='local' ORDER BY created_at LIMIT 1",[PLUGIN_ID]);
    this.config=this.row?.metadata.configuration?parseConfiguration(this.row.metadata.configuration):{...defaults};
    this.token=this.row?(await openVaultIntegrationCredentials<{token?:string}>(this.db,this.vault,this.row.credentials_encrypted,this.row.owner_id)).token||'':'';
  }
  private async takeLock() {
    if(this.lock)return true;
    const client=await this.db.pool.connect();
    try{const result=await client.query<{locked:boolean}>('SELECT pg_try_advisory_lock(hashtext($1)) AS locked',['orbit:cloudflare-tunnel']);if(!result.rows[0].locked){client.release();return false;}}
    catch(error){client.release();throw error;}
    this.lock=client;
    const listener=()=>{if(this.lock!==client)return;client.removeListener('error',listener);this.lockFailureListener=null;this.lock=null;client.release(true);this.initialized=false;void this.manager.shutdown().catch(()=>{});this.manager.reportFailure(new Error('Lock do plugin perdido. O processo foi solicitado a encerrar.'));};
    this.lockFailureListener=listener;client.on('error',listener);
    return true;
  }
  private async releaseLock() {const client=this.lock;this.lock=null;if(!client)return;if(this.lockFailureListener)client.removeListener('error',this.lockFailureListener);this.lockFailureListener=null;try{await client.query('SELECT pg_advisory_unlock(hashtext($1))',['orbit:cloudflare-tunnel']);}catch{/* A disconnected session releases its advisory lock. */}finally{client.release();}}
  private async persistIdentity(identity:ProcessIdentity|null) {
    if(!this.row){if(identity)throw new Error('Salve a configuração antes de iniciar.');return;}
    const result=await this.db.query("UPDATE integration_connections SET metadata=jsonb_set(metadata,'{runtime}',$2::jsonb),updated_at=now() WHERE id=$1 RETURNING id",[this.row.id,JSON.stringify(identity)]);
    if(!result.length)throw new Error('Configuração do plugin não encontrada.');
    this.row.metadata.runtime=identity;
  }
  private async reconcile() {
    const enabled=(await this.db.one<{enabled:boolean}>('SELECT enabled FROM plugin_settings WHERE plugin_id=$1',[PLUGIN_ID]))?.enabled===true;
    if(!this.initialized){
      await this.load();
      const runtime=validIdentity(this.row?.metadata.runtime);
      if((enabled||runtime)&&!await this.takeLock()){this.manager.reportFailure(new Error('Outro processo Orbit administra este plugin.'));return;}
      await this.manager.initialize(enabled,this.config,this.token,runtime);this.initialized=true;this.enabled=enabled;
    }else if(enabled!==this.enabled){
      if(enabled&&!await this.takeLock()){this.manager.reportFailure(new Error('Outro processo Orbit administra este plugin.'));return;}
      await this.manager.setEnabled(enabled);this.enabled=enabled;
    }
    if(this.enabled)await this.manager.tick();else if(!this.manager.isRunning())await this.releaseLock();
  }
  private owner(ownerId:string) {if(this.row&&this.row.owner_id!==ownerId)throw new HttpException('Esta configuração pertence ao administrador da instalação.',403);}
  status(ownerId:string) {return this.run(async()=>{await this.reconcile();this.owner(ownerId);return this.manager.snapshot();});}
  configuration(ownerId:string) {return this.run(async()=>{await this.reconcile();await this.load();this.owner(ownerId);return {configuration:this.config,tokenConfigured:Boolean(this.token),tokenReference:this.row?parseVaultReference(this.vault.open<{token?:string}>(this.row.credentials_encrypted).token||'')?this.vault.open<{token:string}>(this.row.credentials_encrypted).token:undefined:undefined,enabled:this.enabled};});}
  save(ownerId:string,input:Record<string,unknown>) {return this.run(async()=>{
    await this.reconcile();
    if(!this.initialized||!await this.takeLock())throw new HttpException('Outro processo Orbit administra este plugin.',409);
    try{
    await this.load();this.owner(ownerId);
    if(Object.keys(input).some(key=>!['configuration','token','removeToken'].includes(key)))throw new HttpException('Campo desconhecido.',400);
    if(this.manager.isRunning())throw new HttpException('Pare o tunnel antes de alterar a configuração.',409);
    const config=parseConfiguration(input.configuration);
    if(input.removeToken!==undefined&&typeof input.removeToken!=='boolean')throw new HttpException('Opção de token inválida.',400);
    if(input.token!==undefined&&(typeof input.token!=='string'||input.token.length>16384||/\s/.test(input.token)))throw new HttpException('Tunnel Token inválido.',400);
    const token=input.removeToken?'':typeof input.token==='string'&&input.token?input.token:this.row?this.vault.open<{token?:string}>(this.row.credentials_encrypted).token||'':this.token;
    const resolvedToken=token.startsWith('orbit-vault://')?await resolveVaultReference(this.db,token,ownerId):token;
    const metadata=JSON.stringify({configuration:config,runtime:null});
    const row=await this.db.one<Stored>("INSERT INTO integration_connections(owner_id,plugin_id,external_account_id,display_name,label,credentials_encrypted,metadata) VALUES($1,$2,'local','Cloudflare Tunnel','Cloudflare Tunnel',$3,$4::jsonb) ON CONFLICT(owner_id,plugin_id,external_account_id) DO UPDATE SET credentials_encrypted=excluded.credentials_encrypted,metadata=excluded.metadata,updated_at=now() RETURNING id,owner_id,credentials_encrypted,metadata",[ownerId,PLUGIN_ID,this.vault.seal({token}),metadata]);
    this.row=row;this.config=config;this.token=resolvedToken;
    await this.manager.initialize(this.enabled,config,resolvedToken,null);
    return {saved:true,tokenConfigured:Boolean(token),configuration:config,status:this.manager.snapshot()};
    }finally{if(!this.enabled)await this.releaseLock();}
  });}
  action(ownerId:string,action:'start'|'stop'|'restart'|'validate'|'detect') {return this.run(async()=>{
    await this.reconcile();this.owner(ownerId);
    if(!this.initialized)throw new HttpException('O controle deste plugin está indisponível.',409);
    if(['start','restart'].includes(action)&&!this.enabled)throw new HttpException('Ative o plugin antes de executar esta operação.',409);
    if(this.enabled&&!this.lock)throw new HttpException('Outro processo Orbit administra este plugin.',409);
    return this.manager[action]();
  });}
}
export function cloudflareTunnelPluginDefinition(plugin:CloudflareTunnelPlugin):PluginDefinition {
  return {id:PLUGIN_ID,name:'Cloudflare Tunnel',version:'1.0.0',scope:'account',description:'Administração opcional do binário oficial cloudflared.',capabilities:[{id:'tunnel.read',name:'Consultar tunnel'},{id:'tunnel.manage',name:'Administrar tunnel',permissions:['process.execute']}],actions:(['status','detect','validate','start','stop','restart'] as const).map(action=>({id:action,name:({status:'Consultar estado',detect:'Detectar cloudflared',validate:'Validar configuração',start:'Iniciar tunnel',stop:'Parar tunnel',restart:'Reiniciar tunnel'})[action],requiredCapabilities:[action==='status'?'tunnel.read':'tunnel.manage'],inputSchema:{type:'object',properties:{},additionalProperties:false},async execute(_input,context){if(!context.userId)throw new Error('Usuário obrigatório.');return {type:PLUGIN_ID,label:'Cloudflare Tunnel',value:action==='status'?await plugin.status(context.userId):await plugin.action(context.userId,action)};}})),contributions:{settings:[{id:PLUGIN_ID,label:'Cloudflare Tunnel',href:'/plugins?configure=cloudflare-tunnel'}]}};
}
@Controller('plugins/cloudflare-tunnel')
export class CloudflareTunnelController {
  constructor(@Inject(CloudflareTunnelPlugin) private plugin:CloudflareTunnelPlugin,@Inject(FeaturesService) private features:FeaturesService) {}
  private async operation<T>(run:()=>Promise<T>) {try{return await run();}catch(error){if(error instanceof HttpException)throw error;throw new HttpException(error instanceof Error&&/configura|cloudflared|token|tunnel|processo|Modo|Valor|Campo|Use |Opção|Quick|URL|Caminho/i.test(error.message)?error.message:'Operação do plugin indisponível.',409);}}
  @Get('status') status(@Req() req:Request) {const user=this.features.user(req);return this.operation(()=>this.plugin.status(user));}
  @Get('configuration') configuration(@Req() req:Request) {const user=this.features.user(req);return this.operation(()=>this.plugin.configuration(user));}
  @Patch('configuration') save(@Req() req:Request,@Body() body:Record<string,unknown>) {const user=this.features.user(req);return this.operation(()=>this.plugin.save(user,body));}
  @Post('detect') detect(@Req() req:Request) {const user=this.features.user(req);return this.operation(()=>this.plugin.action(user,'detect'));}
  @Post('validate') validate(@Req() req:Request) {const user=this.features.user(req);return this.operation(()=>this.plugin.action(user,'validate'));}
  @Post('start') start(@Req() req:Request) {const user=this.features.user(req);return this.operation(()=>this.plugin.action(user,'start'));}
  @Post('stop') stop(@Req() req:Request) {const user=this.features.user(req);return this.operation(()=>this.plugin.action(user,'stop'));}
  @Post('restart') restart(@Req() req:Request) {const user=this.features.user(req);return this.operation(()=>this.plugin.action(user,'restart'));}
}

import { createCipheriv, createDecipheriv, createHmac, randomBytes, createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request } from "node:https";
import type { PoolClient } from "pg";
import { Body, Controller, Delete, Get, HttpException, Inject, Injectable, OnModuleDestroy, OnModuleInit, Param, Patch, Post, Req } from "@nestjs/common";
import { AccessRequest, AccessService, id, text } from "../access/access";
import { Db } from "../db";
import { PluginRegistry } from "../execution/registries";
import type { PluginDefinition } from "./contract";

export const GENERIC_WEBHOOK_EVENTS = [
  { type: "record.created", label: "Registro criado", version: 0 },
  { type: "record.updated", label: "Registro atualizado", version: 0 },
] as const;
export function webhookEventOptions(registry: PluginRegistry): Array<{ type: string; label: string; version: number }> {
  const options = [...GENERIC_WEBHOOK_EVENTS, ...registry.list().filter(plugin => registry.isEnabled(plugin.id)).flatMap(plugin => plugin.recordEvents?.events || [])];
  if (new Set(options.map(event => event.type)).size !== options.length) throw new Error("Tipo de webhook declarado por mais de um plugin.");
  return options;
}
export type WebhookResource = { workspace_id: string; id: string; plugin_id: string; kind: string; state: string; revision: number };
const webhookEventTypePattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;

export function buildWebhookEnvelope(event: { id: string; event_type: string; event_version: number; workspace_id: string; record_id: string; plugin_id: string; kind: string; state: string; revision: number; occurred_at: string }) {
  if (event.event_type.startsWith("record.")) return {
    id: event.id,
    type: event.event_type,
    workspace_id: event.workspace_id,
    record: { id: event.record_id, plugin_id: event.plugin_id, kind: event.kind, state: event.state, revision: event.revision },
    occurred_at: event.occurred_at,
  };
  return {
    id: event.id,
    type: event.event_type,
    version: event.event_version,
    workspace_id: event.workspace_id,
    resource: { id: event.record_id, kind: event.kind, revision: event.revision },
    occurred_at: event.occurred_at,
  };
}

/** Adds a PII-free event and its deliveries on the caller's transaction. */
export async function enqueueWebhookEvent(client: PoolClient, resource: WebhookResource, eventType: string, eventVersion = 1) {
  if (!webhookEventTypePattern.test(eventType) || !Number.isInteger(eventVersion) || eventVersion < 1) throw new Error("Contrato de webhook inválido.");
  await client.query<{ id: string }>(
    `WITH matching_subscriptions AS MATERIALIZED (
       SELECT id FROM webhook_subscriptions
       WHERE workspace_id=$1 AND active AND $7=ANY(event_types)
     ), inserted_event AS (
       INSERT INTO webhook_events(workspace_id,record_id,plugin_id,kind,state,revision,event_type,event_version)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8
       WHERE EXISTS(SELECT 1 FROM matching_subscriptions)
       ON CONFLICT(workspace_id,record_id,revision,event_type) DO NOTHING
       RETURNING id
     ), inserted_deliveries AS (
       INSERT INTO webhook_deliveries(subscription_id,event_id)
       SELECT subscriptions.id,inserted_event.id
       FROM matching_subscriptions subscriptions CROSS JOIN inserted_event
       ON CONFLICT(subscription_id,event_id) DO NOTHING
       RETURNING id
     )
     SELECT id FROM inserted_event`,
    [resource.workspace_id, resource.id, resource.plugin_id, resource.kind, resource.state, resource.revision, eventType, eventVersion],
  );
}

export const webhooksPlugin: PluginDefinition = {
  id: "webhooks", name: "Webhooks", version: "1.0.0", scope: "workspace", configurable: true,
  description: "Assinaturas HTTPS para eventos genéricos do Orbit e eventos de domínio declarados por plugins.",
  capabilities: [{ id: "webhooks.manage", name: "Administrar webhooks", permissions: ["webhooks.manage"] }],
  handlesRoute: (path) => /^\/workspaces\/[^/]+\/webhooks(?:\/|$)/.test(path),
  routePermission: (path) => /^\/workspaces\/[^/]+\/webhooks/.test(path) ? "webhooks.manage" : null,
};

const key = () => {
  const value = process.env.ORBIT_WEBHOOK_ENCRYPTION_KEY?.trim();
  if (!value || value.length < 32) throw new HttpException("Configure ORBIT_WEBHOOK_ENCRYPTION_KEY com pelo menos 32 caracteres.", 503);
  return createHash("sha256").update(value).digest();
};
function encrypt(value: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString("base64url")).join(".");
}
function decrypt(value: string) {
  const [iv, tag, body] = value.split(".").map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}
export function unsafeWebhookAddress(address: string) {
  if (isIP(address) === 4) {
    const n = address.split(".").map(Number), a=n[0], b=n[1], c=n[2];
    return a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===88&&c===99||b===0&&c===2)||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113||a===100&&b>=64&&b<=127;
  }
  if (isIP(address) !== 6) return true;
  const ip = address.toLowerCase();
  const [first,second]=ip.split(":");
  return ip === "::1" || ip === "::" || ip.startsWith("fc") || ip.startsWith("fd") || /^fe[89ab]/.test(ip) || ip.startsWith("2001:db8:") || ip.startsWith("::ffff:") || first==="2001"&&parseInt(second||"0",16)<=0x01ff || first==="2002" || first==="3fff" || !/^2[0-9a-f]{3}:/.test(ip);
}
export async function validatePublicHttpsTarget(raw: string) {
  let url: URL; try { url = new URL(raw); } catch { throw new HttpException("URL inválida.", 400); }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname || url.port && url.port !== "443") throw new HttpException("O destino deve ser HTTPS público na porta padrão.", 400);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: true }).catch(() => []);
  if (!addresses.length || addresses.some(({address}) => unsafeWebhookAddress(address))) throw new HttpException("O destino resolve para um endereço não permitido.", 400);
  return { url, address: addresses[0].address, family: isIP(addresses[0].address) };
}
export async function postSecureHttpsJson(endpoint: string, body: string, headers: Record<string, string> = {}) {
  const {url,address,family}=await validatePublicHttpsTarget(endpoint);
  return new Promise<void>((resolve,reject)=>{
    const req=request(url,{method:"POST",headers:{"content-type":"application/json","content-length":Buffer.byteLength(body),"user-agent":"Orbit-Webhooks/1.0",...headers},lookup:(_host,_options,cb)=>cb(null,address,family),timeout:8000,agent:false},res=>{let received=0;res.on("data",chunk=>{received+=Buffer.byteLength(chunk);if(received>8192)res.destroy(new Error("RESPONSE_TOO_LARGE"))});res.on("end",()=>{if(res.statusCode&&res.statusCode>=200&&res.statusCode<300)resolve();else reject(new Error(`HTTP_${res.statusCode||0}`))});res.on("error",reject)});
    req.on("timeout",()=>req.destroy(new Error("TIMEOUT")));req.on("error",reject);req.end(body);
  });
}
async function postSigned(endpoint: string, body: string, signature: string) {
  return postSecureHttpsJson(endpoint, body, {"x-orbit-signature-256":`sha256=${signature}`});
}

@Injectable()
export class WebhooksService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout; private running=false;
  constructor(@Inject(Db) private readonly db:Db,@Inject(AccessService) private readonly access:AccessService,@Inject(PluginRegistry) private readonly registry:PluginRegistry) {}
  onModuleInit(){ this.access.registerPermissions(["webhooks.manage"],"webhooks"); this.timer=setInterval(()=>void this.dispatch().catch(()=>undefined),5000);this.timer.unref();void this.dispatch().catch(()=>undefined); }
  onModuleDestroy(){if(this.timer)clearInterval(this.timer)}
  private assertEnabled(){if(!this.registry.isEnabled("webhooks"))throw new HttpException("O plugin de webhooks está desativado.",409)}
  private eventOptions():Array<{type:string;label:string;version:number}>{return webhookEventOptions(this.registry)}
  private validEvents(events:unknown):events is string[]{const allowed=new Set(this.eventOptions().map(event=>event.type));return Array.isArray(events)&&events.length>0&&events.length<=allowed.size&&events.every((event)=>typeof event==="string"&&allowed.has(event))&&new Set(events).size===events.length}
  async eventTypes(user:string,workspace:string){this.assertEnabled();await this.manage(user,workspace);return this.eventOptions()}
  private async manage(user:string,workspace:string){id(workspace);const ws=await this.db.one<{id:string}>('SELECT id FROM workspaces WHERE id=$1 AND archived_at IS NULL',[workspace]);if(!ws)throw new HttpException("Workspace não encontrado.",404);if(!(await this.access.account(user)).is_root){await this.access.require(user,"webhooks.manage","workspace",workspace);if(!await this.db.one('SELECT user_id FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 AND can_manage',[workspace,user]))throw new HttpException("Somente administradores do workspace podem gerenciar webhooks.",403)}}
  async list(user:string,workspace:string){this.assertEnabled();await this.manage(user,workspace);const subscriptions=await this.db.query<{id:string;endpoint:string;event_types:string[];active:boolean;created_at:string}>(`SELECT id,endpoint,event_types,active,created_at FROM webhook_subscriptions WHERE workspace_id=$1 ORDER BY created_at DESC`,[workspace]);return Promise.all(subscriptions.map(async item=>{let endpoint="Destino HTTPS";try{const url=new URL(item.endpoint);endpoint=`https://${url.host}/…`}catch(error){void error}return {id:item.id,endpoint,event_types:item.event_types,active:item.active,created_at:item.created_at,deliveries:await this.db.query(`SELECT id,event_type,status,attempt_count,last_error,created_at,updated_at FROM webhook_deliveries WHERE subscription_id=$1 ORDER BY created_at DESC LIMIT 20`,[item.id])}}))}
  async create(user:string,workspace:string,input:Record<string,unknown>){this.assertEnabled();await this.manage(user,workspace);if(Object.keys(input).some(k=>!['endpoint','event_types'].includes(k)))throw new HttpException("Campos inválidos.",400);const endpoint=text(input.endpoint,2048);await validatePublicHttpsTarget(endpoint);const events=input.event_types;if(!this.validEvents(events))throw new HttpException("Selecione eventos de webhook habilitados.",400);const secret=randomBytes(32).toString('base64url');key();const row=await this.db.one<{id:string}>('INSERT INTO webhook_subscriptions(workspace_id,endpoint,event_types,secret_ciphertext,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id',[workspace,endpoint,events,encrypt(secret),user]);await this.access.audit(user,"webhook.subscription.created",row!.id,{type:"workspace",id:workspace});return {id:row!.id,secret};}
  async update(user:string,workspace:string,subscription:string,input:Record<string,unknown>){this.assertEnabled();await this.manage(user,workspace);if(Object.keys(input).some(k=>!['endpoint','event_types','active'].includes(k))||input.active!==undefined&&typeof input.active!=="boolean")throw new HttpException("Campos inválidos.",400);const current=await this.db.one<{endpoint:string;event_types:string[]}>('SELECT endpoint,event_types FROM webhook_subscriptions WHERE id=$1 AND workspace_id=$2',[id(subscription),workspace]);if(!current)throw new HttpException("Assinatura não encontrada.",404);const endpoint=input.endpoint===undefined?current.endpoint:text(input.endpoint,2048);await validatePublicHttpsTarget(endpoint);const events=input.event_types===undefined?current.event_types:input.event_types;if(!this.validEvents(events))throw new HttpException("Selecione eventos de webhook habilitados.",400);await this.db.query('UPDATE webhook_subscriptions SET endpoint=$3,event_types=$4,active=COALESCE($5,active) WHERE id=$1 AND workspace_id=$2',[subscription,workspace,endpoint,events,input.active??null]);await this.access.audit(user,"webhook.subscription.updated",subscription,{type:"workspace",id:workspace});return {ok:true}}
  async remove(user:string,workspace:string,subscription:string){this.assertEnabled();await this.manage(user,workspace);await this.db.query('DELETE FROM webhook_subscriptions WHERE id=$1 AND workspace_id=$2',[id(subscription),workspace]);await this.access.audit(user,"webhook.subscription.deleted",subscription,{type:"workspace",id:workspace});return {ok:true}}
  async dispatch(){if(this.running||!this.registry.isEnabled("webhooks"))return;this.running=true;try{const due=await this.db.query<{id:string;subscription_id:string;endpoint:string;secret_ciphertext:string;event_id:string;event_type:string;event_version:number;workspace_id:string;record_id:string;plugin_id:string;kind:string;state:string;revision:number;occurred_at:string;attempt_count:number}>(`WITH due AS (SELECT d.id FROM webhook_deliveries d WHERE (d.status='pending' AND d.available_at<=now()) OR (d.status='sending' AND d.updated_at<now()-interval '1 minute') ORDER BY d.available_at LIMIT 20 FOR UPDATE SKIP LOCKED) UPDATE webhook_deliveries d SET status='sending',attempt_count=d.attempt_count+1,updated_at=now() FROM due,webhook_subscriptions s,webhook_events e WHERE d.id=due.id AND s.id=d.subscription_id AND e.id=d.event_id AND s.active RETURNING d.id,d.subscription_id,d.attempt_count,s.endpoint,s.secret_ciphertext,e.id AS event_id,e.event_type,e.event_version,e.workspace_id,e.record_id,e.plugin_id,e.kind,e.state,e.revision,e.occurred_at`);
    for(const item of due){let errorCode="DELIVERY_ERROR";try{const payload=JSON.stringify(buildWebhookEnvelope(item));const secret=decrypt(item.secret_ciphertext),signature=createHmac('sha256',secret).update(payload).digest('hex');await postSigned(item.endpoint,payload,signature);await this.db.query("UPDATE webhook_deliveries SET status='delivered',last_error=NULL,updated_at=now() WHERE id=$1",[item.id]);}catch(error){errorCode=error instanceof Error&&/^HTTP_[0-9]+$/.test(error.message)?error.message:error instanceof HttpException?'UNSAFE_DESTINATION':error instanceof Error&&error.message==='TIMEOUT'?'TIMEOUT':'DELIVERY_ERROR';const httpCode=Number(errorCode.slice(5));const permanentHttp=Number.isFinite(httpCode)&&(httpCode>=300&&httpCode<400||httpCode>=400&&httpCode<500&&httpCode!==408&&httpCode!==429);const terminal=item.attempt_count>=8||errorCode==='UNSAFE_DESTINATION'||permanentHttp;const delay=Math.min(21600,15*2**Math.min(item.attempt_count-1,10));await this.db.query("UPDATE webhook_deliveries SET status=$2,available_at=now()+($3::int*interval '1 second'),last_error=$4,updated_at=now() WHERE id=$1",[item.id,terminal?'dead_letter':'pending',delay,errorCode]);}}
    }finally{this.running=false}}
}
@Controller('workspaces/:workspace/webhooks')
export class WebhooksController {
 constructor(@Inject(WebhooksService) private readonly service:WebhooksService){}
 @Get('event-types') eventTypes(@Req() req:AccessRequest,@Param('workspace') workspace:string){return this.service.eventTypes(req.orbitActor!,workspace)}
 @Get() list(@Req() req:AccessRequest,@Param('workspace') workspace:string){return this.service.list(req.orbitActor!,workspace)}
 @Post() create(@Req() req:AccessRequest,@Param('workspace') workspace:string,@Body() body:Record<string,unknown>){return this.service.create(req.orbitActor!,workspace,body)}
 @Patch(':id') update(@Req() req:AccessRequest,@Param('workspace') workspace:string,@Param('id') idValue:string,@Body() body:Record<string,unknown>){return this.service.update(req.orbitActor!,workspace,idValue,body)}
 @Delete(':id') remove(@Req() req:AccessRequest,@Param('workspace') workspace:string,@Param('id') idValue:string){return this.service.remove(req.orbitActor!,workspace,idValue)}
}

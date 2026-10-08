import {HttpException,Inject,Injectable} from '@nestjs/common';
import {createHash,randomBytes} from 'node:crypto';
import {Db} from '../db';
import {SecretVault} from '../secrets';

export const GOOGLE_DRIVE_FILE_SCOPE='https://www.googleapis.com/auth/drive.file';
export const GOOGLE_CALENDAR_SCOPES=[
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.freebusy',
];
export const GOOGLE_MAIL_SCOPES=['https://www.googleapis.com/auth/gmail.modify'];

type Tokens={access_token:string;refresh_token?:string;expires_at:number;scope:string;token_type?:string};
type Connection={id:string;owner_id:string;plugin_id:string;external_account_id:string;display_name:string;credentials_encrypted:string;enabled:boolean};
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const scopes=(value:string)=>new Set(value.split(/\s+/).filter(Boolean));
const id=(value:string)=>{if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new HttpException('Conexão inválida.',400);return value};

@Injectable()
export class GoogleCredentials {
  constructor(@Inject(Db) private db:Db,@Inject(SecretVault) private vault:SecretVault){}
  configured(){return Boolean(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET)}
  private config(){const clientId=process.env.GOOGLE_CLIENT_ID,clientSecret=process.env.GOOGLE_CLIENT_SECRET;if(!clientId||!clientSecret)throw new HttpException('Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET.',503);return {clientId,clientSecret}}
  async start(ownerId:string,purpose:string,requiredScopes:string[],redirectUri:string){
    const {clientId}=this.config(),state=randomBytes(32).toString('base64url');
    await this.db.query('DELETE FROM oauth_states WHERE expires_at<now() OR used_at IS NOT NULL');
    await this.db.query("INSERT INTO oauth_states(state_hash,owner_id,plugin_id,redirect_uri,metadata,expires_at) VALUES($1,$2,'google',$3,$4::jsonb,now()+interval '10 minutes')",[sha(state),ownerId,redirectUri,JSON.stringify({purpose,requiredScopes})]);
    const query=new URLSearchParams({client_id:clientId,redirect_uri:redirectUri,response_type:'code',access_type:'offline',prompt:'consent',include_granted_scopes:'true',scope:['openid','email',...requiredScopes].join(' '),state});
    return {url:`https://accounts.google.com/o/oauth2/v2/auth?${query}`};
  }
  async complete(code:string,state:string,purpose:string){
    if(!code||!state)throw new HttpException('Retorno OAuth inválido.',400);
    const pending=await this.db.one<{owner_id:string;redirect_uri:string;metadata:{requiredScopes:string[]}}>("UPDATE oauth_states SET used_at=now() WHERE state_hash=$1 AND plugin_id='google' AND metadata->>'purpose'=$2 AND used_at IS NULL AND expires_at>now() RETURNING owner_id,redirect_uri,metadata",[sha(state),purpose]);
    if(!pending)throw new HttpException('Estado OAuth inválido ou expirado.',401);
    const {clientId,clientSecret}=this.config();
    const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:clientId,client_secret:clientSecret,redirect_uri:pending.redirect_uri,grant_type:'authorization_code'}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new HttpException('Não foi possível concluir a autorização Google.',502);
    const raw=await response.json() as {access_token?:string;refresh_token?:string;expires_in?:number;scope?:string;token_type?:string};
    if(!raw.access_token)throw new HttpException('O Google não retornou um token de acesso.',502);
    const granted=scopes(raw.scope||'');
    if(!pending.metadata.requiredScopes.every(scope=>granted.has(scope)))throw new HttpException('A conta Google não autorizou as permissões solicitadas.',403);
    const profileResponse=await fetch('https://www.googleapis.com/oauth2/v2/userinfo',{headers:{authorization:`Bearer ${raw.access_token}`},signal:AbortSignal.timeout(15000)});
    if(!profileResponse.ok)throw new HttpException('Não foi possível identificar a conta Google.',502);
    const profile=await profileResponse.json() as {id?:string;email?:string;name?:string};
    const account=profile.id||profile.email;if(!account)throw new HttpException('Conta Google sem identificador.',502);
    const previous=await this.db.one<Connection>("SELECT * FROM integration_connections WHERE owner_id=$1 AND plugin_id='google' AND external_account_id=$2",[pending.owner_id,account]);
    const old=previous?this.vault.open<Tokens>(previous.credentials_encrypted):null;
    const refreshToken=raw.refresh_token||old?.refresh_token;
    if(!refreshToken)throw new HttpException('O Google não forneceu acesso offline. Reconecte a conta.',409);
    const tokens:Tokens={access_token:raw.access_token,refresh_token:refreshToken,expires_at:Date.now()+(raw.expires_in||3600)*1000,scope:raw.scope||'',token_type:raw.token_type||'Bearer'};
    const row=await this.db.one<{id:string}>("INSERT INTO integration_connections(owner_id,plugin_id,external_account_id,display_name,label,credentials_encrypted,metadata) VALUES($1,'google',$2,$3,$3,$4,$5::jsonb) ON CONFLICT(owner_id,plugin_id,external_account_id) DO UPDATE SET display_name=excluded.display_name,label=excluded.label,credentials_encrypted=excluded.credentials_encrypted,metadata=excluded.metadata,enabled=true,status='active',updated_at=now() RETURNING id",[pending.owner_id,account,profile.email||profile.name||'Conta Google',this.vault.seal(tokens),JSON.stringify({email:profile.email||null})]);
    return {id:row!.id,ownerId:pending.owner_id};
  }
  private async connection(ownerId:string,connectionId:string){const row=await this.db.one<Connection>("SELECT id,owner_id,plugin_id,external_account_id,display_name,credentials_encrypted,enabled FROM integration_connections WHERE id=$1 AND owner_id=$2 AND plugin_id=ANY($3::text[]) AND enabled",[id(connectionId),ownerId,['google','google_calendar','gmail']]);if(!row)throw new HttpException('Conexão Google não encontrada.',404);return row}
  async token(ownerId:string,connectionId:string,requiredScopes:string[]){
    const row=await this.connection(ownerId,connectionId);const tokens=this.vault.open<Tokens>(row.credentials_encrypted);
    if(!requiredScopes.every(scope=>scopes(tokens.scope||'').has(scope)))throw new HttpException('A conexão Google não possui a permissão necessária. Reconecte-a.',403);
    if(tokens.expires_at>Date.now()+60000)return tokens.access_token;
    if(!tokens.refresh_token)throw new HttpException('Reconecte a conta Google para renovar o acesso.',401);
    const {clientId,clientSecret}=this.config();
    const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:tokens.refresh_token,grant_type:'refresh_token'}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new HttpException('A conexão Google expirou. Reconecte a conta.',401);
    const refreshed=await response.json() as {access_token?:string;expires_in?:number;scope?:string};
    if(!refreshed.access_token)throw new HttpException('O Google não retornou um token válido.',502);
    const next={...tokens,access_token:refreshed.access_token,expires_at:Date.now()+(refreshed.expires_in||3600)*1000,scope:refreshed.scope||tokens.scope};
    if(!requiredScopes.every(scope=>scopes(next.scope).has(scope)))throw new HttpException('A conexão Google perdeu a permissão necessária. Reconecte-a.',403);
    await this.db.query('UPDATE integration_connections SET credentials_encrypted=$3,updated_at=now() WHERE id=$1 AND owner_id=$2',[row.id,ownerId,this.vault.seal(next)]);
    return next.access_token;
  }
  async available(ownerId:string,requiredScopes:string[]){const rows=await this.db.query<Connection>("SELECT id,owner_id,plugin_id,external_account_id,display_name,credentials_encrypted,enabled FROM integration_connections WHERE owner_id=$1 AND plugin_id=ANY($2::text[]) AND enabled ORDER BY created_at DESC",[ownerId,['google','google_calendar','gmail']]);return rows.filter(row=>requiredScopes.every(scope=>scopes(this.vault.open<Tokens>(row.credentials_encrypted).scope||'').has(scope))).map(row=>({id:row.id,name:row.display_name,pluginId:row.plugin_id}))}
}

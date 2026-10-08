import { Controller, Get, Patch, Body, Req, Inject, HttpException, Optional, Param } from '@nestjs/common';
import { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { FeaturesService } from './features';
import { PluginRegistry } from './execution/registries';
import { googleRedirectUri } from './google/redirect-uri';
import { BackupService } from './backup-service';

const groups = [
  { id: 'runtime', label: 'Aplicação', fields: [
    ['DATABASE_URL','URL do banco de dados',true],['JWT_SECRET','Chave de sessão',true],['API_PORT','Porta da API',false],['WEB_ORIGIN','Origem web permitida',false],['NEXT_PUBLIC_API_URL','URL pública da API web',false],['API_PUBLIC_URL','URL pública da API',false],['ORBIT_SECRET_KEY','Chave de criptografia de integrações',true],['VAULT_ENCRYPTION_KEY','Chave de criptografia do cofre',true],
  ] },
  { id: 'backup', label: 'Backups', fields: [
    ['ORBIT_BACKUP_KEY','Chave de criptografia dos backups',true],['ORBIT_BACKUP_DIR','Pasta local dos backups',false],['ORBIT_BACKUP_KEEP','Quantidade de backups locais',false],['ORBIT_CONFIG_BACKUP_PATHS','Outros arquivos de configuração ignorados pelo Git (caminhos relativos, separados por vírgulas)',false],['ORBIT_RESTORE_DATABASE_URL','Banco de destino para restauração',true],
  ] },
  { id: 'google', label: 'Credenciais Google compartilhadas', fields: [
    ['GOOGLE_CLIENT_ID','Google OAuth Client ID',false],['GOOGLE_CLIENT_SECRET','Google OAuth Client Secret',true],
  ] },
  { id: 'microsoft', label: 'Credenciais Microsoft compartilhadas', fields: [
    ['MICROSOFT_CLIENT_ID','Microsoft Application ID',false],['MICROSOFT_CLIENT_SECRET','Microsoft Client Secret',true],['MICROSOFT_TENANT','Tenant Microsoft',false],['MICROSOFT_REDIRECT_URI','URL de retorno OAuth',false],
  ] },
  { id: 'email', label: 'E-mail e relatórios', fields: [
    ['SMTP_HOST','Servidor SMTP',false],['SMTP_PORT','Porta SMTP',false],['SMTP_SECURE','SMTP com TLS implícito',false],['SMTP_FROM','Endereço remetente',false],['SMTP_USER','Usuário SMTP',false],['SMTP_PASSWORD','Senha SMTP',true],['EMAIL_INGEST_TOKEN','Token de recebimento de e-mail',true],['COMMENT_EMAIL_DOMAIN','Domínio de comentários por e-mail',false],
  ] },
  { id: 'ai', label: 'Execução e IA', fields: [
    ['CODEX_BIN','Executável Codex',false],['CODEX_AI_TIMEOUT_MS','Tempo limite de IA (ms)',false],['ORBIT_EXECUTION_TIMEOUT_MS','Tempo limite de execução (ms)',false],
  ] },
].map(group => ({ ...group, fields: group.fields.map(([key,label,secret]) => ({ key: String(key), label: String(label), secret: Boolean(secret) })) }));

const fields = groups.flatMap(group => group.fields);
const byKey = new Map(fields.map(field => [field.key, field]));
const envFile = resolve(process.env.ORBIT_API_ENV_FILE || resolve(__dirname, '../.env'));
const webEnvFile = resolve(process.env.ORBIT_WEB_ENV_FILE || resolve(__dirname, '../../web/.env.local'));

function readStoredEnv(text: string) { return parse(text); }

function serializeValue(value: string) { return JSON.stringify(value); }

async function saveEnvironment(path: string, changes: Record<string,string>, clear: string[]) {
  let source = '';
  try { source = await readFile(path, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const lines = source.split(/\r?\n/);
  const updates = new Map(Object.entries(changes));
  for (const key of clear) updates.set(key, '');
  for (const [key, value] of updates) {
    const line = `${key}=${serializeValue(value)}`;
    const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
    const index = lines.findIndex(existing => pattern.test(existing));
    if (index === -1) lines.push(line); else lines[index] = line;
  }
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, `${lines.join('\n')}\n`, { mode: 0o600, flag: 'w' });
  await chmod(temp, 0o600);
  await rename(temp, path);
}

@Controller('settings/environment')
export class EnvironmentSettingsController {
  constructor(@Inject(FeaturesService) private features: FeaturesService,@Inject(PluginRegistry) private plugins:PluginRegistry,@Optional() @Inject(BackupService) private backups?:BackupService) {}
  private async backupNotice(){
    if(!this.backups)return '';
    try{
      const result=await this.backups.syncConfigs();
      const failed=result.deliveries.filter(copy=>copy.status==='failed');
      return failed.length?` Atenção: o backup criptografado das configurações ficou local, mas o envio ao Drive falhou: ${failed[0].error}`:' Backup criptografado das configurações atualizado.';
    }catch(error){return ` Atenção: o backup das configurações falhou: ${(error as Error).message}`}
  }

  private async stored(){
    let stored:Record<string,string>={};
    try { stored=readStoredEnv(await readFile(envFile,'utf8')); } catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
    try { stored.NEXT_PUBLIC_API_URL=readStoredEnv(await readFile(webEnvFile,'utf8')).NEXT_PUBLIC_API_URL||stored.NEXT_PUBLIC_API_URL; } catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
    return stored;
  }
  private values(fields:Array<{key:string;label:string;secret:boolean}>,stored:Record<string,string>,hideSecrets=false){return fields.map(field=>{const value=stored[field.key]??process.env[field.key]??'';return {...field,value:hideSecrets&&field.secret?'':value,configured:Boolean(value)}})}
  private plugin(id:string){
    try{return this.plugins.getById(id)}catch{throw new HttpException('Plugin não encontrado.',404)}
  }
  private validate(body:Record<string,unknown>,allowed:Set<string>){
    const values=body?.values,clear=body?.clear;
    if(!values||typeof values!=='object'||Array.isArray(values)||!Array.isArray(clear))throw new HttpException('Configuração inválida.',400);
    const changes:Record<string,string>={};
    for(const [key,value] of Object.entries(values)){
      if(!allowed.has(key)||typeof value!=='string'||value.length>20_000)throw new HttpException('Configuração inválida.',400);
      if(value.length)changes[key]=value;
    }
    if(clear.some(key=>typeof key!=='string'||!allowed.has(key)))throw new HttpException('Configuração inválida.',400);
    if(Object.keys(changes).length+clear.length>100)throw new HttpException('Muitas configurações.',400);
    return {changes,clear:clear as string[]};
  }

  @Get()
  async list(@Req() req: Request) {
    this.features.user(req);
    const stored=await this.stored();
    return {groups:groups.map(group=>({id:group.id,label:group.label,fields:this.values(group.fields,stored,true)}))};
  }

  @Get('plugins/:id')
  async pluginSettings(@Req() req:Request,@Param('id') id:string){
    this.features.user(req);const plugin=this.plugin(id);
    const service = id === 'google_drive' ? 'drive' : id === 'google_calendar' ? 'calendar' : id === 'gmail' ? 'gmail' : null;
    return {id:plugin.id,name:plugin.name,fields:this.values(plugin.configuration||[],await this.stored(),true),oauthRedirectUri:service?googleRedirectUri(service):undefined};
  }

  @Patch()
  async update(@Req() req: Request, @Body() body: Record<string,unknown>) {
    this.features.user(req);
    const {changes,clear:clearKeys}=this.validate(body,new Set(byKey.keys()));
    const webChanges: Record<string,string> = {};
    const apiChanges = { ...changes };
    const webClear = clearKeys.includes('NEXT_PUBLIC_API_URL') ? ['NEXT_PUBLIC_API_URL'] : [];
    if (Object.hasOwn(apiChanges,'NEXT_PUBLIC_API_URL')) { webChanges.NEXT_PUBLIC_API_URL = apiChanges.NEXT_PUBLIC_API_URL; delete apiChanges.NEXT_PUBLIC_API_URL; }
    await saveEnvironment(envFile, apiChanges, clearKeys.filter(key => key !== 'NEXT_PUBLIC_API_URL'));
    if (Object.keys(webChanges).length || webClear.length) await saveEnvironment(webEnvFile, webChanges, webClear);
    const backup=await this.backupNotice();
    return { ok:true, restartRequired:true, message:`Configurações salvas. Reinicie a API para aplicar as alterações; NEXT_PUBLIC_API_URL também exige rebuild da aplicação web.${backup}` };
  }

  @Patch('plugins/:id')
  async updatePlugin(@Req() req:Request,@Param('id') id:string,@Body() body:Record<string,unknown>){
    this.features.user(req);const plugin=this.plugin(id);
    const {changes,clear}=this.validate(body,new Set((plugin.configuration||[]).map(field=>field.key)));
    await saveEnvironment(envFile,changes,clear);
    const backup=await this.backupNotice();
    return {ok:true,restartRequired:true,message:`Configuração de ${plugin.name} salva. Reinicie a API para aplicar as alterações.${backup}`};
  }
}

import { Controller, Get, Patch, Body, Req, Inject, HttpException } from '@nestjs/common';
import { Request } from 'express';
import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { FeaturesService } from './features';

const groups = [
  { id: 'runtime', label: 'Aplicação', fields: [
    ['DATABASE_URL','URL do banco de dados',true],['JWT_SECRET','Chave de sessão',true],['API_PORT','Porta da API',false],['WEB_ORIGIN','Origem web permitida',false],['NEXT_PUBLIC_API_URL','URL pública da API web',false],['API_PUBLIC_URL','URL pública da API',false],['ORBIT_SECRET_KEY','Chave de criptografia de integrações',true],['VAULT_ENCRYPTION_KEY','Chave de criptografia do cofre',true],
  ] },
  { id: 'backup', label: 'Backups', fields: [
    ['ORBIT_BACKUP_KEY','Chave de criptografia dos backups',true],['ORBIT_BACKUP_DIR','Pasta local dos backups',false],['ORBIT_BACKUP_KEEP','Quantidade de backups locais',false],['ORBIT_RESTORE_DATABASE_URL','Banco de destino para restauração',true],['ORBIT_DRIVE_CLIENT_ID','Google OAuth Client ID para backups',false],['ORBIT_DRIVE_CLIENT_SECRET','Google OAuth Client Secret para backups',true],['ORBIT_DRIVE_REFRESH_TOKEN','Google OAuth Refresh Token para backups',true],['ORBIT_DRIVE_FOLDER_ID','Pasta do Google Drive para backups',false],
  ] },
  { id: 'google', label: 'Google Calendar', fields: [
    ['GOOGLE_CLIENT_ID','Google OAuth Client ID',false],['GOOGLE_CLIENT_SECRET','Google OAuth Client Secret',true],['GOOGLE_CALENDAR_REDIRECT_URI','URL de retorno OAuth do Calendar',false],['GOOGLE_CALENDAR_WEBHOOK_URL','URL pública do webhook',false],
  ] },
  { id: 'dropbox', label: 'Dropbox', fields: [
    ['DROPBOX_CLIENT_ID','Dropbox App Key',false],['DROPBOX_CLIENT_SECRET','Dropbox App Secret',true],['DROPBOX_REDIRECT_URI','URL de retorno OAuth',false],
  ] },
  { id: 'github', label: 'GitHub', fields: [
    ['GITHUB_APP_ID','GitHub App ID',false],['GITHUB_APP_PRIVATE_KEY','GitHub App Private Key',true],['GITHUB_CLIENT_ID','GitHub OAuth Client ID',false],['GITHUB_CLIENT_SECRET','GitHub OAuth Client Secret',true],['GITHUB_WEBHOOK_SECRET','GitHub Webhook Secret',true],
  ] },
  { id: 'microsoft', label: 'Microsoft 365', fields: [
    ['MICROSOFT_CLIENT_ID','Microsoft Application ID',false],['MICROSOFT_CLIENT_SECRET','Microsoft Client Secret',true],['MICROSOFT_TENANT','Tenant Microsoft',false],['MICROSOFT_REDIRECT_URI','URL de retorno OAuth',false],['MICROSOFT_GRAPH_WEBHOOK_URL','URL pública do webhook',false],
  ] },
  { id: 'trello', label: 'Trello', fields: [
    ['TRELLO_KEY','Trello API Key',true],['TRELLO_TOKEN','Trello Token',true],['TRELLO_CONFIG_PATH','Arquivo externo de configuração',false],['TRELLO_DEFAULT_BOARD_ID','ID do quadro de origem',false],['TRELLO_DEFAULT_ORBIT_BOARD_ID','ID do quadro Orbit',false],['TRELLO_SYNC_INTERVAL_MS','Intervalo de sincronização (ms)',false],
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
const envFile = resolve(__dirname, '../.env');
const webEnvFile = resolve(__dirname, '../../web/.env.local');

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
  const temp = `${path}.tmp`;
  await writeFile(temp, `${lines.join('\n')}\n`, { mode: 0o600, flag: 'w' });
  await chmod(temp, 0o600);
  await rename(temp, envFile);
}

@Controller('settings/environment')
export class EnvironmentSettingsController {
  constructor(@Inject(FeaturesService) private features: FeaturesService) {}

  @Get()
  async list(@Req() req: Request) {
    this.features.user(req);
    let stored: Record<string,string> = {};
    try { stored = readStoredEnv(await readFile(envFile, 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    try { stored.NEXT_PUBLIC_API_URL = readStoredEnv(await readFile(webEnvFile, 'utf8')).NEXT_PUBLIC_API_URL || stored.NEXT_PUBLIC_API_URL; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return { groups: groups.map(group => ({ id:group.id,label:group.label,fields:group.fields.map(field => {
      const value = stored[field.key] ?? process.env[field.key] ?? '';
      return { ...field, value, configured:Boolean(value) };
    }) })) };
  }

  @Patch()
  async update(@Req() req: Request, @Body() body: Record<string,unknown>) {
    this.features.user(req);
    const values = body.values;
    const clear = body.clear;
    if (!values || typeof values !== 'object' || Array.isArray(values) || !Array.isArray(clear)) throw new HttpException('Configuração inválida.',400);
    const changes: Record<string,string> = {};
    for (const [key, value] of Object.entries(values)) {
      if (!byKey.has(key) || typeof value !== 'string' || value.length > 20_000) throw new HttpException('Configuração inválida.',400);
      if (value.length) changes[key] = value;
    }
    const clearKeys = clear.filter((key): key is string => typeof key === 'string');
    if (clearKeys.some(key => !byKey.has(key))) throw new HttpException('Configuração inválida.',400);
    if (Object.keys(changes).length + clearKeys.length > 100) throw new HttpException('Muitas configurações.',400);
    const webChanges: Record<string,string> = {};
    const apiChanges = { ...changes };
    const webClear = clearKeys.includes('NEXT_PUBLIC_API_URL') ? ['NEXT_PUBLIC_API_URL'] : [];
    if (Object.hasOwn(apiChanges,'NEXT_PUBLIC_API_URL')) { webChanges.NEXT_PUBLIC_API_URL = apiChanges.NEXT_PUBLIC_API_URL; delete apiChanges.NEXT_PUBLIC_API_URL; }
    await saveEnvironment(envFile, apiChanges, clearKeys.filter(key => key !== 'NEXT_PUBLIC_API_URL'));
    if (Object.keys(webChanges).length || webClear.length) await saveEnvironment(webEnvFile, webChanges, webClear);
    return { ok:true, restartRequired:true, message:'Configurações salvas. Reinicie a API para aplicar as alterações; NEXT_PUBLIC_API_URL também exige rebuild da aplicação web.' };
  }
}

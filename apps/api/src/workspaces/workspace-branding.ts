import { Body, Controller, Get, HttpException, Inject, Injectable, Param, Post, Put, Req } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import { resolveTxt } from 'node:dns/promises';
import type { Request } from 'express';
import { Db } from '../db';
import { AccessRequest, AccessService, id } from '../access/access';
import { WorkspacesService } from './workspaces.plugin';
import type { PluginDefinition } from '../plugins/contract';

export const workspaceBrandingPlugin: PluginDefinition = {
  id: 'workspace-branding', name: 'Identidade visual de workspace', version: '1.0.0', scope: 'workspace',
  handlesRoute: path => path === '/public/workspace-branding/host',
  routePermission: (_path, method) => method === 'GET' ? null : 'root.only',
};

type BrandingRow = {
  workspace_id: string; public_name: string | null; logo_url: string | null;
  primary_color: string; accent_color: string; custom_domain: string | null;
  domain_verification_token: string | null; domain_verified_at: Date | string | null;
};
type BrandingInput = { public_name?: unknown; logo_url?: unknown; primary_color?: unknown; accent_color?: unknown; custom_domain?: unknown };

function relativeLuminance(hex: string): number {
  const channels = hex.slice(1).match(/.{2}/g)!.map(part => parseInt(part, 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function color(value: unknown, field: string, background: string): string {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new HttpException(`${field} deve ser uma cor hexadecimal no formato #RRGGBB.`, 400);
  const normalized = value.toLowerCase();
  const luminances = [relativeLuminance(normalized), relativeLuminance(background)].sort((a, b) => b - a);
  const contrast = (luminances[0] + 0.05) / (luminances[1] + 0.05);
  if (contrast < 4.5) throw new HttpException(`${field} precisa oferecer contraste mínimo de 4,5:1 sobre ${background === '#ffffff' ? 'texto branco' : 'a superfície escura #1d2125'}.`, 400);
  return normalized;
}

function hostname(value: unknown): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 253 || /[/:?#@\s]/.test(value)) throw new HttpException('Informe somente um domínio válido, sem protocolo ou caminho.', 400);
  const host = domainToASCII(value.replace(/\.$/, '').toLowerCase());
  if (!host || host.length > 253 || host.includes('..') || !host.includes('.') || host === 'localhost' ||
      host.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
      /^\d+(?:\.\d+){3}$/.test(host) || host.endsWith('.local')) throw new HttpException('Informe um hostname público válido.', 400);
  return host;
}

function safeLogo(value: unknown): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2048) throw new HttpException('A URL do logo excede o limite permitido.', 400);
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new HttpException('O logo deve usar uma URL HTTPS pública.', 400); }
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const reservedSuffixes = ['.localhost', '.local', '.internal', '.test', '.example', '.invalid', '.onion'];
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || isIP(host) !== 0 || !host.includes('.') ||
      host === 'localhost' || reservedSuffixes.some(suffix => host.endsWith(suffix))) throw new HttpException('O logo deve usar uma URL HTTPS pública.', 400);
  return parsed.toString();
}

@Injectable()
export class WorkspaceBrandingService {
  constructor(@Inject(Db) private readonly db: Db, @Inject(WorkspacesService) private readonly workspaces: WorkspacesService, @Inject(AccessService) private readonly access: AccessService) {}

  async read(actor: string, workspaceId: string) {
    id(workspaceId); await this.workspaces.shared(actor, workspaceId, true);
    const row = await this.db.one<BrandingRow>('SELECT * FROM workspace_branding WHERE workspace_id=$1', [workspaceId]);
    return this.adminView(row || { workspace_id: workspaceId, public_name: null, logo_url: null, primary_color: '#2563eb', accent_color: '#38bdf8', custom_domain: null, domain_verification_token: null, domain_verified_at: null });
  }

  private adminView(row: BrandingRow) {
    return { workspace_id: row.workspace_id, public_name: row.public_name, logo_url: row.logo_url,
      primary_color: row.primary_color, accent_color: row.accent_color, custom_domain: row.custom_domain,
      domain_verified: Boolean(row.domain_verified_at),
      verification_record: row.custom_domain && row.domain_verification_token ? { type: 'TXT', name: `_suinda-verification.${row.custom_domain}`, value: `suinda-domain-verification=${row.domain_verification_token}` } : null };
  }

  async update(actor: string, workspaceId: string, body: BrandingInput) {
    id(workspaceId); await this.workspaces.shared(actor, workspaceId, true);
    const allowed = ['public_name', 'logo_url', 'primary_color', 'accent_color', 'custom_domain'];
    if (Object.keys(body).some(key => !allowed.includes(key))) throw new HttpException('Campo de identidade visual inválido.', 400);
    let publicName: string | null = null;
    if (body.public_name !== undefined && body.public_name !== null && body.public_name !== '') {
      if (typeof body.public_name !== 'string' || !body.public_name.trim() || body.public_name.trim().length > 100) throw new HttpException('Informe um nome público de 1 a 100 caracteres.', 400);
      publicName = body.public_name.trim();
    }
    const logo = body.logo_url === undefined ? null : safeLogo(body.logo_url);
    const primary = body.primary_color === undefined ? null : color(body.primary_color, 'A cor principal', '#ffffff');
    const accent = body.accent_color === undefined ? null : color(body.accent_color, 'A cor de destaque', '#1d2125');
    const nextDomain = body.custom_domain === undefined ? undefined : hostname(body.custom_domain);
    const current = await this.db.one<BrandingRow>('SELECT * FROM workspace_branding WHERE workspace_id=$1', [workspaceId]);
    const domainChanged = nextDomain !== undefined && nextDomain !== current?.custom_domain;
    const token = domainChanged && nextDomain ? randomBytes(24).toString('hex') : undefined;
    const row = await this.db.one<BrandingRow>(`INSERT INTO workspace_branding(workspace_id,public_name,logo_url,primary_color,accent_color,custom_domain,domain_verification_token,domain_verified_at,updated_by,updated_at)
      VALUES($1,$2,$3,COALESCE($4,'#2563eb'),COALESCE($5,'#38bdf8'),$6,$7,NULL,$8,now())
      ON CONFLICT(workspace_id) DO UPDATE SET
        public_name=CASE WHEN $9 THEN $2 ELSE workspace_branding.public_name END,
        logo_url=CASE WHEN $10 THEN $3 ELSE workspace_branding.logo_url END,
        primary_color=COALESCE($4,workspace_branding.primary_color),accent_color=COALESCE($5,workspace_branding.accent_color),
        custom_domain=CASE WHEN $11 THEN $6 ELSE workspace_branding.custom_domain END,
        domain_verification_token=CASE WHEN $11 THEN $7 ELSE workspace_branding.domain_verification_token END,
        domain_verified_at=CASE WHEN $11 THEN NULL ELSE workspace_branding.domain_verified_at END,
        updated_by=$8,updated_at=now() RETURNING *`,
      [workspaceId, publicName, logo, primary, accent, nextDomain === undefined ? current?.custom_domain ?? null : nextDomain, token ?? (domainChanged ? null : current?.domain_verification_token ?? null), actor,
        body.public_name !== undefined, body.logo_url !== undefined, domainChanged]);
    if (!row) throw new HttpException('Não foi possível salvar a identidade visual.', 500);
    await this.db.query('INSERT INTO access_audit(actor_id,action,target,scope_type,scope_id) VALUES($1,$2,$3,$4,$5)', [actor, 'workspace.branding.updated', row.custom_domain || null, 'workspace', workspaceId]);
    return this.adminView(row);
  }

  async verify(actor: string, workspaceId: string, lookup: typeof resolveTxt = resolveTxt) {
    id(workspaceId); await this.workspaces.shared(actor, workspaceId, true);
    const row = await this.db.one<BrandingRow>('SELECT * FROM workspace_branding WHERE workspace_id=$1', [workspaceId]);
    if (!row?.custom_domain || !row.domain_verification_token) throw new HttpException('Configure um domínio antes de verificar.', 409);
    const expected = `suinda-domain-verification=${row.domain_verification_token}`;
    try {
      const records = await lookup(`_suinda-verification.${row.custom_domain}`);
      if (!records.some(parts => parts.join('') === expected)) throw new HttpException('O registro TXT ainda não corresponde. Confira o valor e tente novamente após a propagação do DNS.', 409);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException('Não foi possível encontrar o registro TXT. Confira o DNS e tente novamente após a propagação.', 409);
    }
    const verified = await this.db.one<BrandingRow>(`UPDATE workspace_branding SET domain_verified_at=now(),updated_by=$2,updated_at=now()
      WHERE workspace_id=$1 AND custom_domain=$3 AND domain_verification_token=$4 AND domain_verified_at IS NULL RETURNING *`,
      [workspaceId, actor, row.custom_domain, row.domain_verification_token]);
    if (!verified) throw new HttpException('A configuração do domínio mudou durante a verificação. Atualize a página e tente novamente.', 409);
    await this.db.query('INSERT INTO access_audit(actor_id,action,target,scope_type,scope_id) VALUES($1,$2,$3,$4,$5)', [actor, 'workspace.branding.domain_verified', row.custom_domain, 'workspace', workspaceId]);
    return this.adminView(verified!);
  }

  async publicForHost(header: string | undefined) {
    const rawHost = (header || '').split(',')[0].trim().replace(/^\[|\]$/g, '').replace(/:\d+$/, '');
    const host = domainToASCII(rawHost.toLowerCase());
    if (!host || !host.includes('.')) return null;
    const row = await this.db.one<BrandingRow>(`SELECT b.workspace_id,b.public_name,b.logo_url,b.primary_color,b.accent_color,b.custom_domain,b.domain_verified_at
      FROM workspace_branding b JOIN workspaces w ON w.id=b.workspace_id
      WHERE b.custom_domain=$1 AND b.domain_verified_at IS NOT NULL AND w.archived_at IS NULL`, [host]);
    if (!row) return null;
    return { public_name: row.public_name, logo_url: row.logo_url, primary_color: row.primary_color, accent_color: row.accent_color };
  }
}

@Controller('workspaces/:workspace/branding')
export class WorkspaceBrandingController {
  constructor(@Inject(WorkspaceBrandingService) private readonly branding: WorkspaceBrandingService) {}
  @Get() read(@Req() req: AccessRequest, @Param('workspace') workspace: string) { return this.branding.read(req.orbitActor!, workspace); }
  @Put() update(@Req() req: AccessRequest, @Param('workspace') workspace: string, @Body() body: BrandingInput) { return this.branding.update(req.orbitActor!, workspace, body); }
  @Post('domain/verify') verify(@Req() req: AccessRequest, @Param('workspace') workspace: string) { return this.branding.verify(req.orbitActor!, workspace); }
}

@Controller('public/workspace-branding')
export class PublicWorkspaceBrandingController {
  constructor(@Inject(WorkspaceBrandingService) private readonly branding: WorkspaceBrandingService) {}
  @Get('host') current(@Req() req: Request) {
    const forwarded = req.headers['x-forwarded-host'];
    const host = Array.isArray(forwarded) ? forwarded[0] : forwarded || req.headers.host;
    return this.branding.publicForHost(host);
  }
}

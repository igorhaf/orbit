import { Injectable, HttpException, Inject } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import * as nodemailer from 'nodemailer';
import { Logger } from '@nestjs/common';
import { Db } from '../db';
import { AccessService } from './access';

const RATE_LIMIT = 5;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export interface AuthMailer { send(to: string, subject: string, url: string): Promise<void> }

export class SmtpAuthMailer implements AuthMailer {
  async send(to: string, subject: string, url: string) {
    const { SMTP_HOST, SMTP_FROM, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD } = process.env;
    if (!SMTP_HOST || !SMTP_FROM) throw new Error('SMTP não configurado. Configure o envio de e-mail em Configurações → E-mail e e-mails.');
    const transport = nodemailer.createTransport({ host: SMTP_HOST, port: Number(SMTP_PORT || 587), secure: SMTP_SECURE === 'true', auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASSWORD } : undefined });
    await transport.sendMail({ from: SMTP_FROM, to, subject, text: `Use o link para continuar: ${url}\nO link expira em 30 minutos.` });
  }
}

@Injectable()
export class AuthLifecycle {
  private readonly logger = new Logger(AuthLifecycle.name);
  constructor(@Inject(Db) private db: Db, @Inject('AUTH_MAILER') private mailer: AuthMailer, @Inject(AccessService) private access: AccessService) {}

  private async limit(email: string) {
    const key = digest(email.trim().toLowerCase());
    const [row] = await this.db.query<{requests:number}>(`INSERT INTO account_auth_limits(email_hash,window_started_at,requests) VALUES($1,now(),1)
      ON CONFLICT(email_hash) DO UPDATE SET window_started_at=CASE WHEN account_auth_limits.window_started_at < now()-interval '1 hour' THEN now() ELSE account_auth_limits.window_started_at END,
      requests=CASE WHEN account_auth_limits.window_started_at < now()-interval '1 hour' THEN 1 ELSE account_auth_limits.requests+1 END RETURNING requests`, [key]);
    return Number(row?.requests || 0) <= RATE_LIMIT;
  }

  private async issue(userId: string, email: string, purpose: 'invite'|'verify'|'recover') {
    const token = randomBytes(32).toString('base64url');
    await this.db.query(`WITH locked AS MATERIALIZED (SELECT id FROM users WHERE id=$1 FOR UPDATE),
      closed AS (UPDATE account_auth_tokens SET consumed_at=now() WHERE user_id IN (SELECT id FROM locked) AND purpose=$3 AND consumed_at IS NULL)
      INSERT INTO account_auth_tokens(user_id,token_hash,purpose,expires_at)
      SELECT id,$2,$3,now()+interval '30 minutes' FROM locked`, [userId, digest(token), purpose]);
    try { await this.sendLink(email, purpose, token); }
    catch {
      await this.db.query('UPDATE account_auth_tokens SET consumed_at=now() WHERE token_hash=$1', [digest(token)]);
      if (purpose === 'recover') { this.logger.warn('Falha no envio de mensagem de recuperação.'); return; }
      throw new HttpException('Não foi possível enviar o e-mail. Verifique a configuração SMTP e tente novamente.', 503);
    }
  }

  private async sendLink(email: string, purpose: 'invite'|'verify'|'recover', token: string) {
    const base = (process.env.WEB_ORIGIN || 'http://localhost:3000').replace(/\/$/, '');
    const url = `${base}/auth/${purpose === 'recover' ? 'recover' : 'verify'}?token=${encodeURIComponent(token)}`;
    await this.mailer.send(email, purpose === 'recover' ? 'Recuperação de senha Orbit' : 'Convite e verificação de conta Orbit', url);
  }

  async invite(actor: string, body: Record<string, unknown>) {
    await this.access.require(actor,'access.manage');
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name || name.length > 300 || Object.keys(body).some(k => !['email','name','roles'].includes(k))) throw new HttpException('Convite inválido.', 400);
    if (!await this.limit(email)) throw new HttpException('Limite de convites atingido para esta conta. Tente novamente mais tarde.', 429);
    const existing = await this.db.one<{id:string;email_verified:boolean;is_root:boolean}>('SELECT id,email_verified,is_root FROM users WHERE email=$1',[email]);
    if (existing?.is_root) throw new HttpException('Não é possível alterar a conta ROOT.', 403);
    if (existing?.email_verified) throw new HttpException('A conta já está ativa.', 409);
    let userId = existing?.id;
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      if (!userId) userId = (await client.query('INSERT INTO users(name,email,password_hash,email_verified) VALUES($1,$2,$3,false) RETURNING id',[name,email,await bcrypt.hash(randomBytes(48).toString('base64url'),12)])).rows[0].id;
      else await client.query('UPDATE users SET name=$2 WHERE id=$1 AND NOT is_root',[userId,name]);
      const roles = await this.access.validateRoles(actor,body.roles === undefined ? ['user'] : body.roles);
      for (const role of roles) await client.query('INSERT INTO access_grants(user_id,role_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[userId,role]);
      const token = randomBytes(32).toString('base64url');
      await client.query(`WITH locked AS MATERIALIZED (SELECT id FROM users WHERE id=$1 FOR UPDATE),
        closed AS (UPDATE account_auth_tokens SET consumed_at=now() WHERE user_id IN (SELECT id FROM locked) AND purpose='invite' AND consumed_at IS NULL)
        INSERT INTO account_auth_tokens(user_id,token_hash,purpose,expires_at)
        SELECT id,$2,'invite',now()+interval '30 minutes' FROM locked`, [userId, digest(token)]);
      try { await this.sendLink(email, 'invite', token); }
      catch { await client.query('UPDATE account_auth_tokens SET consumed_at=now() WHERE token_hash=$1', [digest(token)]); throw new HttpException('Não foi possível enviar o e-mail. Verifique a configuração SMTP e tente novamente.', 503); }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    await this.db.query('INSERT INTO access_audit(actor_id,action,target) VALUES($1,\'user.invited\',$2)',[actor,userId]);
    return {ok:true};
  }

  async requestRecovery(rawEmail: unknown) {
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return {ok:true};
    if (!await this.limit(email)) return {ok:true};
    const user = await this.db.one<{id:string;email:string;disabled:boolean;is_root:boolean;email_verified:boolean}>('SELECT id,email,disabled,is_root,email_verified FROM users WHERE email=$1',[email]);
    if (user && !user.disabled && (!user.is_root || user.email_verified)) {
      try { await this.issue(user.id,user.email,'recover'); }
      catch (error) {
        if (error instanceof HttpException && error.getStatus() === 503) {
          this.logger.warn('Falha no envio de mensagem de recuperação.');
          return {ok:true};
        }
        throw error;
      }
    }
    return {ok:true};
  }

  async complete(rawToken: unknown, rawPassword: unknown) {
    if (typeof rawToken !== 'string' || !/^[A-Za-z0-9_-]{32,100}$/.test(rawToken) || typeof rawPassword !== 'string' || rawPassword.length < 12 || rawPassword.length > 200) throw new HttpException('Token inválido ou expirado.', 400);
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query(`SELECT t.id,t.user_id,t.purpose FROM account_auth_tokens t JOIN users u ON u.id=t.user_id
        WHERE t.token_hash=$1 AND t.consumed_at IS NULL AND t.expires_at>now() AND NOT u.disabled
        AND (NOT u.is_root OR (t.purpose='recover' AND u.email_verified)) FOR UPDATE OF t,u`,[digest(rawToken)])).rows[0];
      if (!row) throw new HttpException('Token inválido ou expirado.', 400);
      const hash = await bcrypt.hash(rawPassword,12);
      if (row.purpose === 'recover') await client.query('UPDATE users SET password_hash=$2,session_version=session_version+1 WHERE id=$1',[row.user_id,hash]);
      else await client.query('UPDATE users SET password_hash=$2,email_verified=true,session_version=session_version+1 WHERE id=$1 AND NOT is_root',[row.user_id,hash]);
      await client.query('UPDATE account_auth_tokens SET consumed_at=now() WHERE id=$1',[row.id]);
      await client.query('UPDATE account_auth_tokens SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL',[row.user_id]);
      await client.query('COMMIT');
      return {ok:true};
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
}

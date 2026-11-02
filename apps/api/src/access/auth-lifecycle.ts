import { Injectable, HttpException, Inject } from '@nestjs/common';
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import * as nodemailer from 'nodemailer';
import { Logger } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { Db } from '../db';
import { AccessService, id } from './access';
import { productWebOrigin } from '../product-profile';

const RATE_LIMIT = 5;
const MFA_CHALLENGE_HOURLY_LIMIT = 5;
export const SUINDA_TERMS_VERSION = 'suinda-terms-v1';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const mfaDigest = (challengeId: string, code: string) => createHmac('sha256', process.env.JWT_SECRET || '').update(`${challengeId}\0${code}`).digest('hex');

export interface AuthMailer {
  send(to: string, subject: string, url: string): Promise<void>;
  sendMessage?(to: string[], subject: string, text: string): Promise<{ messageId?: string }>;
}

export class SmtpAuthMailer implements AuthMailer {
  async send(to: string, subject: string, url: string) {
    await this.sendMessage([to], subject, `Use o link para continuar: ${url}\nO link expira em 30 minutos.`);
  }

  async sendMessage(to: string[], subject: string, text: string): Promise<{ messageId?: string }> {
    const { SMTP_HOST, SMTP_FROM, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD } = process.env;
    if (!SMTP_HOST || !SMTP_FROM) throw new Error('SMTP não configurado. Configure o envio de e-mail em Configurações → E-mail e e-mails.');
    const transport = nodemailer.createTransport({ host: SMTP_HOST, port: Number(SMTP_PORT || 587), secure: SMTP_SECURE === 'true', auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASSWORD } : undefined });
    const result = await transport.sendMail({ from: SMTP_FROM, to, subject, text });
    return { messageId: result.messageId };
  }
}

@Injectable()
export class AuthLifecycle {
  private readonly logger = new Logger(AuthLifecycle.name);
  constructor(@Inject(Db) private db: Db, @Inject('AUTH_MAILER') private mailer: AuthMailer, @Inject(AccessService) private access: AccessService) {}

  private async sendMfaCode(userId: string, purpose: 'login' | 'enable' | 'disable') {
    const challengeId = randomUUID();
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const client = await this.db.pool.connect();
    let account: { email: string; email_verified: boolean; mfa_enabled: boolean; session_version: number } | undefined;
    try {
      await client.query('BEGIN');
      account = (await client.query<{ email: string; email_verified: boolean; mfa_enabled: boolean; session_version: number }>(
        'SELECT email,email_verified,mfa_enabled,session_version FROM users WHERE id=$1 AND NOT disabled FOR UPDATE', [userId],
      )).rows[0];
      if (!account || !account.email_verified) throw new HttpException('Confirme o e-mail da conta antes de configurar a verificação em duas etapas.', 409);
      if ((purpose === 'login' && !account.mfa_enabled) || (purpose === 'enable' && account.mfa_enabled) || (purpose === 'disable' && !account.mfa_enabled))
        throw new HttpException('O estado da verificação em duas etapas mudou. Atualize a página e tente novamente.', 409);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`mfa:${userId}:${purpose}`]);
      const recent = (await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM auth_mfa_challenges WHERE user_id=$1 AND purpose=$2 AND created_at>=now()-interval '1 hour'",
        [userId, purpose],
      )).rows[0];
      if (Number(recent?.count || 0) >= MFA_CHALLENGE_HOURLY_LIMIT)
        throw new HttpException('Limite de códigos de verificação atingido. Tente novamente mais tarde.', 429);
      await client.query("UPDATE auth_mfa_challenges SET consumed_at=now() WHERE user_id=$1 AND purpose=$2 AND consumed_at IS NULL", [userId, purpose]);
      await client.query(
        "INSERT INTO auth_mfa_challenges(id,user_id,purpose,code_hash,session_version,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')",
        [challengeId, userId, purpose, mfaDigest(challengeId, code), account.session_version],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
    try {
      const subject = purpose === 'login' ? 'Código de acesso Orbit' : 'Confirmação da verificação em duas etapas Orbit';
      if (!this.mailer.sendMessage) throw new Error('O serviço de e-mail não oferece envio de códigos.');
      await this.mailer.sendMessage([account!.email], subject,
        `Seu código Orbit é ${code}. Ele expira em 10 minutos e só pode ser usado uma vez. Se você não solicitou este código, ignore esta mensagem.`);
    } catch {
      await this.db.query('UPDATE auth_mfa_challenges SET consumed_at=now() WHERE id=$1', [challengeId]);
      throw new HttpException('Não foi possível enviar o código. Verifique a configuração de e-mail e tente novamente.', 503);
    }
    return { challenge_id: challengeId, email_hint: account.email.replace(/^(.).+(@.*)$/, '$1•••$2') };
  }

  requestMfaLogin(userId: string) { return this.sendMfaCode(userId, 'login'); }
  requestMfaChange(userId: string, purpose: 'enable' | 'disable') { return this.sendMfaCode(userId, purpose); }

  async completeMfaChallenge(challengeIdInput: unknown, codeInput: unknown, purpose: 'login' | 'enable' | 'disable', userId?: string) {
    if (typeof challengeIdInput !== 'string' || !/^[0-9a-f-]{36}$/i.test(challengeIdInput)
      || typeof codeInput !== 'string' || !/^\d{6}$/.test(codeInput)) throw new HttpException('Código inválido ou expirado.', 401);
    const client = await this.db.pool.connect();
    let account: { id: string; name: string; email: string; avatar_url: string | null; preferences: unknown; is_root: boolean; session_version: number; mfa_enabled: boolean } | null = null;
    let transactionFinished = false;
    try {
      await client.query('BEGIN');
      const row = (await client.query<{ id: string; user_id: string; purpose: string; code_hash: string; attempts: number; expires_at: Date; consumed_at: Date | null; challenge_session_version: number;
        name: string; email: string; avatar_url: string | null; preferences: unknown; is_root: boolean; disabled: boolean; session_version: number; mfa_enabled: boolean }>(
        `SELECT c.id,c.user_id,c.purpose,c.code_hash,c.attempts,c.expires_at,c.consumed_at,c.session_version AS challenge_session_version,
          u.name,u.email,u.avatar_url,u.preferences,u.is_root,u.disabled,u.session_version,u.mfa_enabled
         FROM auth_mfa_challenges c JOIN users u ON u.id=c.user_id WHERE c.id=$1 FOR UPDATE OF c,u`, [challengeIdInput],
      )).rows[0];
      if (!row || row.purpose !== purpose || (userId && row.user_id !== userId) || row.disabled || row.consumed_at
        || row.challenge_session_version !== row.session_version || new Date(row.expires_at).getTime() <= Date.now())
        throw new HttpException('Código inválido ou expirado.', 401);
      const expected = Buffer.from(row.code_hash, 'hex'), actual = Buffer.from(mfaDigest(challengeIdInput, codeInput), 'hex');
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        await client.query("UPDATE auth_mfa_challenges SET attempts=attempts+1,consumed_at=CASE WHEN attempts+1>=5 THEN now() ELSE consumed_at END WHERE id=$1", [row.id]);
        await client.query('COMMIT');
        transactionFinished = true;
        throw new HttpException('Código inválido ou expirado.', 401);
      }
      await client.query('UPDATE auth_mfa_challenges SET consumed_at=now() WHERE id=$1', [row.id]);
      if (purpose === 'enable' || purpose === 'disable') {
        const enabled = purpose === 'enable';
        await client.query('UPDATE users SET mfa_enabled=$2 WHERE id=$1', [row.user_id, enabled]);
        await client.query('INSERT INTO access_audit(actor_id,action) VALUES($1,$2)', [row.user_id, enabled ? 'account.mfa.enabled' : 'account.mfa.disabled']);
      }
      await client.query('COMMIT');
      transactionFinished = true;
      account = { id: row.user_id, name: row.name, email: row.email, avatar_url: row.avatar_url, preferences: row.preferences,
        is_root: row.is_root, session_version: row.session_version, mfa_enabled: purpose === 'enable' ? true : purpose === 'disable' ? false : row.mfa_enabled };
    } catch (error) {
      if (!transactionFinished) await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
    return account;
  }

  private async limit(email: string) {
    const key = digest(email.trim().toLowerCase());
    const [row] = await this.db.query<{requests:number}>(`INSERT INTO account_auth_limits(email_hash,window_started_at,requests) VALUES($1,now(),1)
      ON CONFLICT(email_hash) DO UPDATE SET window_started_at=CASE WHEN account_auth_limits.window_started_at < now()-interval '1 hour' THEN now() ELSE account_auth_limits.window_started_at END,
      requests=CASE WHEN account_auth_limits.window_started_at < now()-interval '1 hour' THEN 1 ELSE account_auth_limits.requests+1 END RETURNING requests`, [key]);
    return Number(row?.requests || 0) <= RATE_LIMIT;
  }

  private async issue(userId: string, email: string, purpose: 'invite'|'verify'|'recover'|'change-email') {
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

  private async sendLink(email: string, purpose: 'invite'|'verify'|'recover'|'change-email', token: string) {
    const base = productWebOrigin().replace(/\/$/, '');
    const page = purpose === 'recover' ? 'recover' : purpose === 'change-email' ? 'change-email' : 'verify';
    const subject = purpose === 'recover' ? 'Recuperação de senha Orbit'
      : purpose === 'change-email' ? 'Confirmação de novo e-mail Orbit' : 'Convite e verificação de conta Orbit';
    const url = `${base}/auth/${page}?token=${encodeURIComponent(token)}`;
    await this.mailer.send(email, subject, url);
  }

  async prepareSuindaStudentInvitation(client: PoolClient, emailInput: string, nameInput: string) {
    if (process.env.ORBIT_PRODUCT !== 'suinda') throw new HttpException('Convites de aluno indisponíveis neste produto.', 403);
    const email = emailInput.trim().toLowerCase();
    const name = nameInput.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320 || !name || name.length > 300)
      throw new HttpException('Nome ou e-mail inválido para o convite.', 400);
    if (!await this.limit(email)) throw new HttpException('Limite de convites atingido para este e-mail. Tente novamente mais tarde.', 429);
    const existing = (await client.query<{ id:string; email_verified:boolean; is_root:boolean; disabled:boolean }>(
      'SELECT id,email_verified,is_root,disabled FROM users WHERE email=$1 FOR UPDATE', [email],
    )).rows[0];
    if (existing?.is_root || existing?.disabled) throw new HttpException('Esta conta não pode receber uma matrícula.', 409);
    if (existing?.email_verified) return { user_id: existing.id, token: null as string | null, email };
    const userId = existing?.id || (await client.query<{ id:string }>(
      'INSERT INTO users(name,email,password_hash,email_verified) VALUES($1,$2,$3,false) RETURNING id',
      [name, email, await bcrypt.hash(randomBytes(48).toString('base64url'), 12)],
    )).rows[0].id;
    if (existing) await client.query('UPDATE users SET name=$2 WHERE id=$1 AND NOT is_root AND NOT disabled', [userId, name]);
    await client.query("INSERT INTO access_grants(user_id,role_id) VALUES($1,'suinda_student') ON CONFLICT DO NOTHING", [userId]);
    const token = randomBytes(32).toString('base64url');
    await client.query("UPDATE account_auth_tokens SET consumed_at=now() WHERE user_id=$1 AND purpose IN ('invite','verify') AND consumed_at IS NULL", [userId]);
    await client.query("INSERT INTO account_auth_tokens(user_id,token_hash,purpose,expires_at) VALUES($1,$2,'invite',now()+interval '30 minutes')", [userId, digest(token)]);
    return { user_id: userId, token, email };
  }

  async prepareSuindaStaffInvitation(client: PoolClient, emailInput: string, nameInput: string) {
    if (process.env.ORBIT_PRODUCT !== 'suinda') throw new HttpException('Convites de equipe indisponíveis neste produto.', 403);
    const email = emailInput.trim().toLowerCase();
    const name = nameInput.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320 || !name || name.length > 300)
      throw new HttpException('Nome ou e-mail inválido para o convite.', 400);
    if (!await this.limit(email)) throw new HttpException('Limite de convites atingido para este e-mail. Tente novamente mais tarde.', 429);
    const existing = (await client.query<{ id: string; email_verified: boolean; is_root: boolean; disabled: boolean }>(
      'SELECT id,email_verified,is_root,disabled FROM users WHERE email=$1 FOR UPDATE', [email],
    )).rows[0];
    if (existing?.is_root) throw new HttpException('A conta ROOT não pode ser vinculada como equipe.', 403);
    if (existing?.disabled) throw new HttpException('A conta está desativada e não pode receber um convite.', 409);
    if (existing?.email_verified) return { user_id: existing.id, token: null as string | null, email, active: true };
    const userId = existing?.id || (await client.query<{ id: string }>(
      'INSERT INTO users(name,email,password_hash,email_verified) VALUES($1,$2,$3,false) RETURNING id',
      [name, email, await bcrypt.hash(randomBytes(48).toString('base64url'), 12)],
    )).rows[0].id;
    if (existing) await client.query('UPDATE users SET name=$2 WHERE id=$1 AND NOT is_root AND NOT disabled', [userId, name]);
    // A staff profile is descriptive metadata. Grant only the baseline role; staff access
    // still depends on explicit RBAC permissions and course/cohort assignments.
    await client.query("INSERT INTO access_grants(user_id,role_id) VALUES($1,'user') ON CONFLICT DO NOTHING", [userId]);
    const token = randomBytes(32).toString('base64url');
    await client.query("UPDATE account_auth_tokens SET consumed_at=now() WHERE user_id=$1 AND purpose IN ('invite','verify') AND consumed_at IS NULL", [userId]);
    await client.query("INSERT INTO account_auth_tokens(user_id,token_hash,purpose,expires_at) VALUES($1,$2,'invite',now()+interval '30 minutes')", [userId, digest(token)]);
    return { user_id: userId, token, email, active: false };
  }

  async deliverSuindaStudentInvitation(email: string, token: string) {
    if (process.env.ORBIT_PRODUCT !== 'suinda') throw new HttpException('Convites de aluno indisponíveis neste produto.', 403);
    await this.sendLink(email, 'invite', token);
  }

  async deliverSuindaStaffInvitation(email: string, token: string) {
    if (process.env.ORBIT_PRODUCT !== 'suinda') throw new HttpException('Convites de equipe indisponíveis neste produto.', 403);
    await this.sendLink(email, 'invite', token);
  }

  async register(body: Record<string, unknown>) {
    if (process.env.ORBIT_PRODUCT !== 'suinda') throw new HttpException('Cadastro público indisponível.', 403);
    if (Object.keys(body).some((key) => !['name', 'email', 'terms_accepted', 'terms_version'].includes(key)))
      throw new HttpException('Cadastro inválido.', 400);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!name || name.length > 300 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new HttpException('Informe um nome e um e-mail válidos.', 400);
    if (body.terms_accepted !== true || body.terms_version !== SUINDA_TERMS_VERSION)
      throw new HttpException('Leia e aceite os termos atuais para continuar.', 400);
    if (!await this.limit(email)) return { ok: true };
    const existing = await this.db.one<{id:string;email_verified:boolean;is_root:boolean;disabled:boolean}>(
      'SELECT id,email_verified,is_root,disabled FROM users WHERE email=$1', [email],
    );
    if (existing?.is_root || existing?.email_verified || existing?.disabled) return { ok: true };
    const client = await this.db.pool.connect();
    let deliveryFailed = false;
    try {
      await client.query('BEGIN');
      const userId = existing?.id || (await client.query<{id:string}>(
        'INSERT INTO users(name,email,password_hash,email_verified) VALUES($1,$2,$3,false) RETURNING id',
        [name, email, await bcrypt.hash(randomBytes(48).toString('base64url'), 12)],
      )).rows[0].id;
      if (existing) await client.query('UPDATE users SET name=$2 WHERE id=$1 AND NOT is_root AND NOT disabled', [userId, name]);
      await client.query("INSERT INTO access_grants(user_id,role_id) VALUES($1,'suinda_student') ON CONFLICT DO NOTHING", [userId]);
      await client.query('INSERT INTO account_terms_acceptances(user_id,terms_version) VALUES($1,$2) ON CONFLICT(user_id,terms_version) DO NOTHING', [userId, SUINDA_TERMS_VERSION]);
      const token = randomBytes(32).toString('base64url');
      await client.query("UPDATE account_auth_tokens SET consumed_at=now() WHERE user_id=$1 AND purpose='verify' AND consumed_at IS NULL", [userId]);
      await client.query("INSERT INTO account_auth_tokens(user_id,token_hash,purpose,expires_at) VALUES($1,$2,'verify',now()+interval '30 minutes')", [userId, digest(token)]);
      try { await this.sendLink(email, 'verify', token); }
      catch { deliveryFailed = true; throw new Error('Email delivery failed.'); }
      await client.query('COMMIT');
      return { ok: true };
    } catch (error) {
      await client.query('ROLLBACK');
      if (deliveryFailed) {
        this.logger.warn('Falha no envio de e-mail de cadastro Suindá.');
        return { ok: true };
      }
      if ((error as {code?:string}).code === '23505') return { ok: true };
      throw error;
    } finally {
      client.release();
    }
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

  async requestEmailChange(userId: string, body: Record<string, unknown>) {
    if (Object.keys(body).some((key) => !['email', 'current_password'].includes(key)))
      throw new HttpException('Solicitação inválida.', 400);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const currentPassword = typeof body.current_password === 'string' ? body.current_password : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320 || currentPassword.length < 1 || currentPassword.length > 200)
      throw new HttpException('Informe um novo e-mail válido e sua senha atual.', 400);
    if (!await this.limit(email)) throw new HttpException('Limite de solicitações atingido para este e-mail. Tente novamente mais tarde.', 429);
    const client = await this.db.pool.connect();
    let token = '';
    try {
      await client.query('BEGIN');
      const account = (await client.query<{ email: string; password_hash: string; disabled: boolean }>(
        'SELECT email,password_hash,disabled FROM users WHERE id=$1 FOR UPDATE', [userId],
      )).rows[0];
      if (!account || account.disabled) throw new HttpException('Sessão inválida.', 401);
      if (!await bcrypt.compare(currentPassword, account.password_hash))
        throw new HttpException('A senha atual está incorreta.', 400);
      if (email === account.email.toLowerCase()) throw new HttpException('Informe um endereço diferente do atual.', 409);
      if ((await client.query('SELECT id FROM users WHERE lower(email)=lower($1) AND id<>$2 LIMIT 1', [email, userId])).rows.length)
        throw new HttpException('Este e-mail já está em uso.', 409);
      token = randomBytes(32).toString('base64url');
      await client.query("UPDATE account_auth_tokens SET consumed_at=now() WHERE user_id=$1 AND purpose='change-email' AND consumed_at IS NULL", [userId]);
      await client.query(
        "INSERT INTO account_auth_tokens(user_id,token_hash,purpose,target_email,expires_at) VALUES($1,$2,'change-email',$3,now()+interval '30 minutes')",
        [userId, digest(token), email],
      );
      await client.query("INSERT INTO access_audit(actor_id,action) VALUES($1,'account.email_change.requested')", [userId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    try {
      await this.sendLink(email, 'change-email', token);
    } catch {
      await this.db.query("UPDATE account_auth_tokens SET consumed_at=now() WHERE token_hash=$1 AND purpose='change-email'", [digest(token)]);
      throw new HttpException('Não foi possível enviar a confirmação. Verifique o envio de e-mail e tente novamente.', 503);
    }
    return { ok: true };
  }

  async completeEmailChange(rawToken: unknown) {
    if (typeof rawToken !== 'string' || !/^[A-Za-z0-9_-]{32,100}$/.test(rawToken))
      throw new HttpException('Link inválido, expirado ou já utilizado.', 400);
    const client = await this.db.pool.connect();
    let userId: string | null = null;
    try {
      await client.query('BEGIN');
      const row = (await client.query<{ id: string; user_id: string; target_email: string }>(
        "SELECT t.id,t.user_id,t.target_email FROM account_auth_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=$1 AND t.purpose='change-email' AND t.consumed_at IS NULL AND t.expires_at>now() AND NOT u.disabled FOR UPDATE OF t,u",
        [digest(rawToken)],
      )).rows[0];
      if (!row?.target_email) throw new HttpException('Link inválido, expirado ou já utilizado.', 400);
      const conflict = await client.query('SELECT id FROM users WHERE lower(email)=lower($1) AND id<>$2 LIMIT 1', [row.target_email, row.user_id]);
      if (conflict.rows.length) throw new HttpException('Este e-mail já está em uso. Solicite outra alteração.', 409);
      await client.query('UPDATE users SET email=$2,email_verified=true,session_version=session_version+1 WHERE id=$1', [row.user_id, row.target_email]);
      await client.query('UPDATE account_auth_tokens SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL', [row.user_id]);
      await client.query("INSERT INTO access_audit(actor_id,action) VALUES($1,'account.email_change.completed')", [row.user_id]);
      await client.query('COMMIT');
      userId = row.user_id;
    } catch (error) {
      await client.query('ROLLBACK');
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
        throw new HttpException('Este e-mail já está em uso. Solicite outra alteração.', 409);
      throw error;
    } finally {
      client.release();
    }
    if (userId) {
      this.access.revoke(userId);
    }
    return { ok: true };
  }

  async requestAdministrativeEmailChange(actor: string, targetUser: string, rawEmail: unknown) {
    await this.access.require(actor, 'access.manage');
    const userId = id(targetUser);
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) || email.length > 320)
      throw new HttpException('Informe um e-mail válido.', 400);
    const client = await this.db.pool.connect();
    let token = '';
    try {
      await client.query('BEGIN');
      const target = (await client.query<{ email: string; is_root: boolean; disabled: boolean }>(
        'SELECT email,is_root,disabled FROM users WHERE id=$1 FOR UPDATE', [userId],
      )).rows[0];
      if (!target) throw new HttpException('Usuário não encontrado.', 404);
      if (target.is_root) throw new HttpException('A conta ROOT é protegida.', 403);
      if (target.disabled) throw new HttpException('Reative a conta antes de solicitar a troca de e-mail.', 409);
      if (email === target.email.toLowerCase()) throw new HttpException('O endereço informado já é o e-mail atual.', 409);
      if ((await client.query('SELECT id FROM users WHERE lower(email)=lower($1) AND id<>$2 LIMIT 1', [email, userId])).rows.length)
        throw new HttpException('Este e-mail já está em uso.', 409);
      if (!await this.limit(email)) throw new HttpException('Limite de solicitações atingido para este e-mail. Tente novamente mais tarde.', 429);
      token = randomBytes(32).toString('base64url');
      await client.query("UPDATE account_auth_tokens SET consumed_at=now() WHERE user_id=$1 AND purpose='change-email' AND consumed_at IS NULL", [userId]);
      await client.query(
        "INSERT INTO account_auth_tokens(user_id,token_hash,purpose,target_email,expires_at) VALUES($1,$2,'change-email',$3,now()+interval '30 minutes')",
        [userId, digest(token), email],
      );
      await client.query("INSERT INTO access_audit(actor_id,action,target) VALUES($1,'account.email_change.admin_requested',$2)", [actor, userId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    try {
      await this.sendLink(email, 'change-email', token);
    } catch {
      await this.db.query("UPDATE account_auth_tokens SET consumed_at=now() WHERE token_hash=$1 AND purpose='change-email'", [digest(token)]);
      throw new HttpException('Não foi possível enviar a confirmação. Verifique o envio de e-mail e tente novamente.', 503);
    }
    return { ok: true };
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

  async complete(rawToken: unknown, rawPassword: unknown, termsAccepted: unknown = false, termsVersion: unknown = '') {
    if (typeof rawToken !== 'string' || !/^[A-Za-z0-9_-]{32,100}$/.test(rawToken) || typeof rawPassword !== 'string' || rawPassword.length < 12 || rawPassword.length > 200) throw new HttpException('Token inválido ou expirado.', 400);
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query(`SELECT t.id,t.user_id,t.purpose FROM account_auth_tokens t JOIN users u ON u.id=t.user_id
        WHERE t.token_hash=$1 AND t.purpose IN ('invite','verify','recover') AND t.consumed_at IS NULL AND t.expires_at>now() AND NOT u.disabled
        AND (NOT u.is_root OR (t.purpose='recover' AND u.email_verified)) FOR UPDATE OF t,u`,[digest(rawToken)])).rows[0];
      if (!row) throw new HttpException('Token inválido ou expirado.', 400);
      if (process.env.ORBIT_PRODUCT === 'suinda' && row.purpose === 'invite'
        && (termsAccepted !== true || termsVersion !== SUINDA_TERMS_VERSION))
        throw new HttpException('Aceite os termos e o aviso de privacidade atuais para ativar a conta.', 400);
      const hash = await bcrypt.hash(rawPassword,12);
      if (row.purpose === 'recover') await client.query('UPDATE users SET password_hash=$2,session_version=session_version+1 WHERE id=$1',[row.user_id,hash]);
      else await client.query('UPDATE users SET password_hash=$2,email_verified=true,session_version=session_version+1 WHERE id=$1 AND NOT is_root',[row.user_id,hash]);
      await client.query("INSERT INTO access_audit(actor_id,action) VALUES($1,$2)",[row.user_id,row.purpose==='recover'?'account.password.changed':'account.password.set']);
      if (process.env.ORBIT_PRODUCT === 'suinda' && row.purpose === 'invite')
        await client.query('INSERT INTO account_terms_acceptances(user_id,terms_version) VALUES($1,$2) ON CONFLICT(user_id,terms_version) DO NOTHING',[row.user_id,SUINDA_TERMS_VERSION]);
      await client.query('UPDATE account_auth_tokens SET consumed_at=now() WHERE id=$1',[row.id]);
      await client.query('UPDATE account_auth_tokens SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL',[row.user_id]);
      await client.query('COMMIT');
      return {ok:true};
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
}

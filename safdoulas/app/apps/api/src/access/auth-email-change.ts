import { HttpException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import type { Db } from '../db';
import type { AccessService } from './access';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export class AuthEmailChangeService {
  constructor(
    private readonly db: Db,
    private readonly access: AccessService,
    private readonly limit: (email: string) => Promise<boolean>,
    private readonly sendLink: (email: string, token: string) => Promise<void>,
  ) {}

  async request(userId: string, body: Record<string, unknown>) {
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
      await this.sendLink(email, token);
    } catch {
      await this.db.query("UPDATE account_auth_tokens SET consumed_at=now() WHERE token_hash=$1 AND purpose='change-email'", [digest(token)]);
      throw new HttpException('Não foi possível enviar a confirmação. Verifique o envio de e-mail e tente novamente.', 503);
    }
    return { ok: true };
  }

  async complete(rawToken: unknown) {
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
    if (userId) this.access.revoke(userId);
    return { ok: true };
  }

  async requestAdministrative(actor: string, targetUser: string, rawEmail: unknown) {
    await this.access.require(actor, 'access.manage');
    if (typeof targetUser !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetUser))
      throw new HttpException('ID inválido.', 400);
    const userId = targetUser;
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320)
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
      await this.sendLink(email, token);
    } catch {
      await this.db.query("UPDATE account_auth_tokens SET consumed_at=now() WHERE token_hash=$1 AND purpose='change-email'", [digest(token)]);
      throw new HttpException('Não foi possível enviar a confirmação. Verifique o envio de e-mail e tente novamente.', 503);
    }
    return { ok: true };
  }
}

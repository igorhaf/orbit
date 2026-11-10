import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { HttpException, Inject, Injectable } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import type { AuthMailer } from "./auth-lifecycle";
import type { LoginAccount } from "./login-attempts";
import { Db } from "../db";

const digestCode = (challengeId: string, code: string) => createHmac("sha256", process.env.JWT_SECRET || "").update(`${challengeId}\0${code}`).digest("hex");

@Injectable()
export class MfaService {
  constructor(@Inject(Db) private readonly db: Db, @Inject("AUTH_MAILER") private readonly mailer: AuthMailer) {}

  private async sendCode(userId: string, purpose: "login" | "enable" | "disable") {
    const challengeId = randomUUID();
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const client = await this.db.pool.connect();
    let account: { email: string; email_verified: boolean; mfa_enabled: boolean; session_version: number } | undefined;
    try {
      await client.query("BEGIN");
      account = (await client.query<{ email: string; email_verified: boolean; mfa_enabled: boolean; session_version: number }>(
        "SELECT email,email_verified,mfa_enabled,session_version FROM users WHERE id=$1 AND NOT disabled FOR UPDATE", [userId],
      )).rows[0];
      if (!account || !account.email_verified) throw new HttpException("Confirme o e-mail da conta antes de configurar a verificação em duas etapas.", 409);
      if ((purpose === "login" && !account.mfa_enabled) || (purpose === "enable" && account.mfa_enabled) || (purpose === "disable" && !account.mfa_enabled))
        throw new HttpException("O estado da verificação em duas etapas mudou. Atualize a página e tente novamente.", 409);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`mfa:${userId}:${purpose}`]);
      await client.query("DELETE FROM auth_mfa_challenges WHERE created_at < now()-interval '30 days'");
      const recent = (await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM auth_mfa_challenges WHERE user_id=$1 AND purpose=$2 AND created_at>=now()-interval '1 hour'", [userId, purpose],
      )).rows[0];
      if (Number(recent?.count || 0) >= 5) throw new HttpException("Limite de envio de códigos atingido. Tente novamente mais tarde.", 429);
      await client.query("UPDATE auth_mfa_challenges SET consumed_at=now() WHERE user_id=$1 AND purpose=$2 AND consumed_at IS NULL", [userId, purpose]);
      await client.query("INSERT INTO auth_mfa_challenges(id,user_id,purpose,code_hash,session_version,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')",
        [challengeId, userId, purpose, digestCode(challengeId, code), account.session_version]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
    try {
      if (!this.mailer.sendMessage) throw new Error("O serviço de e-mail não oferece envio de códigos.");
      const subject = purpose === "login" ? "Código de acesso Orbit" : "Confirmação da verificação em duas etapas Orbit";
      await this.mailer.sendMessage([account!.email], subject,
        `Seu código Orbit é ${code}. Ele expira em 10 minutos e só pode ser usado uma vez. Se você não solicitou este código, ignore esta mensagem.`);
    } catch {
      await this.db.query("UPDATE auth_mfa_challenges SET consumed_at=now() WHERE id=$1", [challengeId]);
      throw new HttpException("Não foi possível enviar o código. Verifique a configuração de e-mail e tente novamente.", 503);
    }
    return { challenge_id: challengeId, email_hint: account.email.replace(/^(.).+(@.*)$/, "$1•••$2") };
  }

  async status(userId: string) {
    const account = await this.db.one<{ mfa_enabled: boolean }>("SELECT mfa_enabled FROM users WHERE id=$1 AND NOT disabled", [userId]);
    if (!account) throw new HttpException("Conta não encontrada.", 404);
    return { enabled: Boolean(account.mfa_enabled) };
  }

  requestLogin(userId: string) { return this.sendCode(userId, "login"); }

  async requestChange(userId: string, body: Record<string, unknown>) {
    if (Object.keys(body).some((key) => !["action", "current_password"].includes(key))) throw new HttpException("Solicitação inválida.", 400);
    const action = body.action === "enable" || body.action === "disable" ? body.action : null;
    if (!action) throw new HttpException("Ação de segurança inválida.", 400);
    if (typeof body.current_password !== "string" || body.current_password.length > 200) throw new HttpException("Informe a senha atual.", 400);
    const account = await this.db.one<{ password_hash: string; mfa_enabled: boolean; email_verified: boolean }>(
      "SELECT password_hash,mfa_enabled,email_verified FROM users WHERE id=$1 AND NOT disabled", [userId],
    );
    if (!account || !await bcrypt.compare(body.current_password, account.password_hash)) throw new HttpException("A senha atual está incorreta.", 401);
    if (!account.email_verified) throw new HttpException("Confirme o e-mail da conta antes de configurar a verificação em duas etapas.", 409);
    if (account.mfa_enabled === (action === "enable")) throw new HttpException("A verificação em duas etapas já está nesse estado.", 409);
    return { action, ...await this.sendCode(userId, action) };
  }

  async completeChallenge(challengeIdInput: unknown, codeInput: unknown, purpose: "login" | "enable" | "disable", userId?: string): Promise<LoginAccount | null> {
    if (typeof challengeIdInput !== "string" || !/^[0-9a-f-]{36}$/i.test(challengeIdInput)
      || typeof codeInput !== "string" || !/^\d{6}$/.test(codeInput)) throw new HttpException("Código inválido ou expirado.", 401);
    const client = await this.db.pool.connect();
    let account: LoginAccount | null = null;
    let transactionFinished = false;
    try {
      await client.query("BEGIN");
      const row = (await client.query<LoginAccount & { user_id: string; purpose: string; code_hash: string; attempts: number; expires_at: Date;
        consumed_at: Date | null; challenge_session_version: number }>(
        `SELECT c.id,c.user_id,c.purpose,c.code_hash,c.attempts,c.expires_at,c.consumed_at,c.session_version AS challenge_session_version,
          u.name,u.email,u.avatar_url,u.preferences,u.is_root,u.disabled,u.email_verified,u.session_version,u.mfa_enabled
         FROM auth_mfa_challenges c JOIN users u ON u.id=c.user_id WHERE c.id=$1 FOR UPDATE OF c,u`, [challengeIdInput],
      )).rows[0];
      if (!row || row.purpose !== purpose || (userId && row.user_id !== userId) || row.disabled || row.consumed_at
        || row.challenge_session_version !== row.session_version || new Date(row.expires_at).getTime() <= Date.now())
        throw new HttpException("Código inválido ou expirado.", 401);
      const expected = Buffer.from(row.code_hash, "hex"), actual = Buffer.from(digestCode(challengeIdInput, codeInput), "hex");
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        await client.query("UPDATE auth_mfa_challenges SET attempts=attempts+1,consumed_at=CASE WHEN attempts+1>=5 THEN now() ELSE consumed_at END WHERE id=$1", [row.id]);
        await client.query("COMMIT");
        transactionFinished = true;
        throw new HttpException("Código inválido ou expirado.", 401);
      }
      await client.query("UPDATE auth_mfa_challenges SET consumed_at=now() WHERE id=$1", [row.id]);
      if (purpose === "enable" || purpose === "disable") {
        const enabled = purpose === "enable";
        await client.query("UPDATE users SET mfa_enabled=$2 WHERE id=$1", [row.user_id, enabled]);
        await client.query("INSERT INTO access_audit(actor_id,action) VALUES($1,$2)", [row.user_id, enabled ? "account.mfa.enabled" : "account.mfa.disabled"]);
      }
      await client.query("COMMIT");
      transactionFinished = true;
      account = { id: row.user_id, name: row.name, email: row.email, avatar_url: row.avatar_url, preferences: row.preferences,
        is_root: row.is_root, disabled: row.disabled, email_verified: row.email_verified, session_version: row.session_version,
        mfa_enabled: purpose === "enable" ? true : purpose === "disable" ? false : row.mfa_enabled };
    } catch (error) {
      if (!transactionFinished) await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
    return account;
  }

  async confirmChange(userId: string, body: Record<string, unknown>) {
    if (Object.keys(body).some((key) => !["challenge_id", "code"].includes(key))) throw new HttpException("Solicitação inválida.", 400);
    const challengeId = typeof body.challenge_id === "string" ? body.challenge_id : "";
    const challenge = await this.db.one<{ purpose: "enable" | "disable" }>(
      "SELECT purpose FROM auth_mfa_challenges WHERE id=$1 AND user_id=$2 AND purpose IN ('enable','disable') AND consumed_at IS NULL", [challengeId, userId],
    );
    if (!challenge) throw new HttpException("Código inválido ou expirado.", 401);
    const account = await this.completeChallenge(challengeId, body.code, challenge.purpose, userId);
    return { enabled: Boolean(account?.mfa_enabled) };
  }
}

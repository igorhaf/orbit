import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify as verifySignature, type JsonWebKey } from "node:crypto";
import { HttpException, Inject, Injectable, Optional } from "@nestjs/common";
import type { LoginAccount } from "./login-attempts";
import { Db } from "../db";

type OidcMetadata = { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string };
type OidcJwk = JsonWebKey & { kid?: string; alg?: string; use?: string };
type OidcClaims = { iss?: string; sub?: string; aud?: string | string[]; azp?: string; exp?: number; iat?: number; nonce?: string; email?: string; email_verified?: boolean | string; name?: string; picture?: string };
const b64url = (value: Buffer) => value.toString("base64url");
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const safeEqual = (left: string, right: string) => {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
};
export const SOCIAL_LOGIN_FETCH = Symbol("SOCIAL_LOGIN_FETCH");

@Injectable()
export class SocialLoginService {
  private metadataCache = new Map<string, { value: OidcMetadata; expires: number }>();
  private readonly fetcher: typeof fetch;
  constructor(
    @Inject(Db) private readonly db: Db,
    @Optional() @Inject(SOCIAL_LOGIN_FETCH) fetcher?: typeof fetch,
  ) { this.fetcher = fetcher ?? globalThis.fetch.bind(globalThis); }

  private providerName(input: string) {
    const provider = input.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_-]{1,39}$/.test(provider)) throw new HttpException("Provedor de login inválido.", 404);
    return provider;
  }

  private providerConfig(input: string) {
    const provider = this.providerName(input);
    const enabled = (process.env.ORBIT_SOCIAL_PROVIDERS || "").split(",").map((value) => value.trim().toLowerCase());
    const prefix = `ORBIT_OAUTH_${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_`;
    const clientId = process.env[`${prefix}CLIENT_ID`]?.trim();
    const clientSecret = process.env[`${prefix}CLIENT_SECRET`];
    const issuer = process.env[`${prefix}ISSUER`]?.trim().replace(/\/$/, "");
    if (!enabled.includes(provider) || !clientId || !clientSecret || !issuer)
      throw new HttpException("Este provedor de login não está configurado.", 404);
    let issuerUrl: URL;
    try { issuerUrl = new URL(issuer); } catch { throw new HttpException("Configuração de login social inválida.", 503); }
    if (issuerUrl.protocol !== "https:" || issuerUrl.username || issuerUrl.password || issuerUrl.search || issuerUrl.hash)
      throw new HttpException("O emissor do login social precisa usar uma URL HTTPS válida.", 503);
    const apiOrigin = process.env.API_PUBLIC_URL || "";
    let callback: URL;
    try { callback = new URL(`/auth/social/${provider}/callback`, apiOrigin); } catch { throw new HttpException("Configure API_PUBLIC_URL para habilitar login social.", 503); }
    if (callback.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(callback.hostname))
      throw new HttpException("API_PUBLIC_URL precisa usar HTTPS para login social fora do ambiente local.", 503);
    return { provider, clientId, clientSecret, issuer, callback: callback.toString() };
  }

  listProviders() {
    const providers = (process.env.ORBIT_SOCIAL_PROVIDERS || "").split(",").map((value) => value.trim()).filter(Boolean);
    return { providers: [...new Set(providers)].flatMap((provider) => {
      try { const config = this.providerConfig(provider); return [{ id: config.provider, name: config.provider === "google" ? "Google" : config.provider === "microsoft" ? "Microsoft" : config.provider === "apple" ? "Apple" : config.provider }]; }
      catch { return []; }
    }) };
  }

  private async metadata(issuer: string): Promise<OidcMetadata> {
    const cached = this.metadataCache.get(issuer);
    if (cached && cached.expires > Date.now()) return cached.value;
    let response: Response;
    try { response = await this.fetcher(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000), headers: { Accept: "application/json" } }); }
    catch { throw new HttpException("O serviço de login social está indisponível.", 502); }
    if (!response.ok) throw new HttpException("Não foi possível carregar a configuração do provedor de login.", 502);
    const data = await response.json() as Partial<OidcMetadata>;
    if (data.issuer !== issuer || !data.authorization_endpoint || !data.token_endpoint || !data.jwks_uri)
      throw new HttpException("O provedor publicou uma configuração OpenID Connect inválida.", 502);
    for (const endpoint of [data.authorization_endpoint, data.token_endpoint, data.jwks_uri]) {
      const url = new URL(endpoint);
      if (url.protocol !== "https:" || url.username || url.password) throw new HttpException("O provedor publicou endpoints inseguros.", 502);
    }
    const value = data as OidcMetadata;
    this.metadataCache.set(issuer, { value, expires: Date.now() + 5 * 60_000 });
    return value;
  }

  async start(input: string) {
    const config = this.providerConfig(input);
    const metadata = await this.metadata(config.issuer);
    const state = b64url(randomBytes(32));
    const nonce = b64url(randomBytes(32));
    const verifier = b64url(randomBytes(48));
    const challenge = b64url(createHash("sha256").update(verifier).digest());
    await this.db.query("DELETE FROM auth_social_states WHERE expires_at < now() OR consumed_at IS NOT NULL");
    await this.db.query(
      `INSERT INTO auth_social_states(state_hash,provider,nonce,code_verifier,expires_at)
       VALUES($1,$2,$3,$4,now()+interval '10 minutes')`,
      [sha256(state), config.provider, nonce, verifier],
    );
    const authorize = new URL(metadata.authorization_endpoint);
    authorize.search = new URLSearchParams({
      client_id: config.clientId, response_type: "code", redirect_uri: config.callback,
      scope: config.provider === "apple" ? "openid email name" : "openid email profile", state, nonce, code_challenge: challenge, code_challenge_method: "S256",
      ...(config.provider === "apple" ? { response_mode: "form_post" } : {}),
    }).toString();
    return { url: authorize.toString() };
  }

  private async claims(idToken: unknown, metadata: OidcMetadata, clientId: string, nonce: string): Promise<OidcClaims> {
    if (typeof idToken !== "string") throw new HttpException("O provedor não confirmou a identidade.", 401);
    const [encodedHeader, encodedClaims, encodedSignature, ...extra] = idToken.split(".");
    if (!encodedHeader || !encodedClaims || !encodedSignature || extra.length) throw new HttpException("Resposta de identidade inválida.", 401);
    let header: { alg?: string; kid?: string }; let claims: OidcClaims;
    try { header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8")); claims = JSON.parse(Buffer.from(encodedClaims, "base64url").toString("utf8")); }
    catch { throw new HttpException("Resposta de identidade inválida.", 401); }
    if (!(header.alg === "RS256" || header.alg === "ES256") || !header.kid) throw new HttpException("Algoritmo de identidade não aceito.", 401);
    const response = await this.fetcher(metadata.jwks_uri, { signal: AbortSignal.timeout(10_000), headers: { Accept: "application/json" } }).catch(() => null);
    if (!response?.ok) throw new HttpException("Não foi possível validar a identidade do provedor.", 502);
    const jwks = await response.json() as { keys?: OidcJwk[] };
    const jwk = jwks.keys?.find((key) => key.kid === header.kid && (!key.alg || key.alg === header.alg) && (!key.use || key.use === "sig"));
    if (!jwk) throw new HttpException("Chave de assinatura do provedor não encontrada.", 401);
    const publicKey = createPublicKey({ key: jwk, format: "jwk" });
    const valid = header.alg === "RS256"
      ? verifySignature("RSA-SHA256", Buffer.from(`${encodedHeader}.${encodedClaims}`), publicKey, Buffer.from(encodedSignature, "base64url"))
      : verifySignature("sha256", Buffer.from(`${encodedHeader}.${encodedClaims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(encodedSignature, "base64url"));
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const now = Math.floor(Date.now() / 1000);
    if (!valid || claims.iss !== metadata.issuer || !audiences.includes(clientId)
      || (audiences.length > 1 && claims.azp !== clientId) || !Number.isFinite(claims.exp) || Number(claims.exp) <= now
      || !Number.isFinite(claims.iat) || Number(claims.iat) > now + 60 || !safeEqual(String(claims.nonce || ""), nonce)
      || typeof claims.sub !== "string" || !claims.sub || typeof claims.email !== "string"
      || !(claims.email_verified === true || claims.email_verified === "true") || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email))
      throw new HttpException("A identidade ou o e-mail não pôde ser confirmado pelo provedor.", 401);
    return claims;
  }

  async finish(input: string, stateInput: unknown, codeInput: unknown): Promise<LoginAccount> {
    const config = this.providerConfig(input);
    if (typeof stateInput !== "string" || !/^[A-Za-z0-9_-]{40,60}$/.test(stateInput)
      || typeof codeInput !== "string" || codeInput.length < 8 || codeInput.length > 4096)
      throw new HttpException("Resposta de login social inválida.", 400);
    const client = await this.db.pool.connect();
    let flow: { nonce: string; code_verifier: string } | undefined;
    try {
      await client.query("BEGIN");
      flow = (await client.query<{ nonce: string; code_verifier: string }>(
        `SELECT nonce,code_verifier FROM auth_social_states WHERE state_hash=$1 AND provider=$2
         AND consumed_at IS NULL AND expires_at>now() FOR UPDATE`, [sha256(stateInput), config.provider],
      )).rows[0];
      if (!flow) throw new HttpException("A tentativa de login expirou. Tente novamente.", 401);
      await client.query("UPDATE auth_social_states SET consumed_at=now() WHERE state_hash=$1", [sha256(stateInput)]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }

    const metadata = await this.metadata(config.issuer);
    let tokenResponse: Response;
    try {
      tokenResponse = await this.fetcher(metadata.token_endpoint, {
        method: "POST", signal: AbortSignal.timeout(10_000), headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ grant_type: "authorization_code", code: codeInput, redirect_uri: config.callback, client_id: config.clientId, client_secret: config.clientSecret, code_verifier: flow!.code_verifier }),
      });
    } catch { throw new HttpException("O serviço de login social está indisponível.", 502); }
    if (!tokenResponse.ok) throw new HttpException("O provedor recusou a autenticação. Tente novamente.", 401);
    const tokens = await tokenResponse.json() as { id_token?: unknown };
    const identity = await this.claims(tokens.id_token, metadata, config.clientId, flow!.nonce);
    const email = identity.email!.trim().toLowerCase();
    const identityClient = await this.db.pool.connect();
    try {
      await identityClient.query("BEGIN");
      await identityClient.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`oauth-identity:${metadata.issuer}:${identity.sub}`]);
      let row = (await identityClient.query<LoginAccount>(
        `SELECT u.id,u.name,u.email,u.avatar_url,u.preferences,u.is_root,u.disabled,u.email_verified,u.session_version,u.mfa_enabled
         FROM auth_social_identities s JOIN users u ON u.id=s.user_id
         WHERE s.issuer=$1 AND s.subject=$2 FOR UPDATE OF u`, [metadata.issuer, identity.sub],
      )).rows[0];
      if (!row) {
        const matches = await identityClient.query<LoginAccount>(
          `SELECT id,name,email,avatar_url,preferences,is_root,disabled,email_verified,session_version,mfa_enabled
           FROM users WHERE lower(email)=$1 AND email_verified=true AND NOT disabled ORDER BY id LIMIT 2 FOR UPDATE`, [email],
        );
        if (matches.rows.length > 1) throw new HttpException("Há mais de uma conta Orbit com este endereço normalizado; a equipe precisa revisar o cadastro.", 409);
        row = matches.rows[0];
        if (!row) throw new HttpException("Não há uma conta Orbit verificada para este endereço. Crie ou solicite uma conta antes de entrar com login social.", 403);
        await identityClient.query("INSERT INTO auth_social_identities(user_id,issuer,subject,email) VALUES($1,$2,$3,$4)", [row.id, metadata.issuer, identity.sub, email]);
        await identityClient.query("INSERT INTO access_audit(actor_id,action,target) VALUES($1,'account.social_identity.linked',$2)", [row.id, config.provider]);
      }
      if (row.disabled || !row.email_verified) throw new HttpException("Esta conta não pode entrar com login social.", 403);
      await identityClient.query("COMMIT");
      return row;
    } catch (error) { await identityClient.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { identityClient.release(); }
  }
}

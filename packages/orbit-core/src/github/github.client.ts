import { HttpException, Inject, Injectable } from "@nestjs/common";
import { createSign } from "node:crypto";
import { Db } from "../db";
import { SecretVault } from "../secrets";

type Credentials = { access_token?: string; refresh_token?: string; expires_at?: number; installation_token?: string; installation_expires_at?: number };
type Connection = { id: string; owner_id: string; credentials_encrypted: string; metadata: Record<string, unknown> };
const api = "https://api.github.com";
const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

@Injectable()
export class GitHubClient {
  constructor(@Inject(Db) private db: Db, @Inject(SecretVault) private vault: SecretVault) {}

  private async connection(ownerId: string, connectionId: string) {
    const row = await this.db.one<Connection>("SELECT * FROM integration_connections WHERE id=$1 AND owner_id=$2 AND plugin_id='github' AND enabled", [connectionId, ownerId]);
    if (!row) throw new HttpException("Conexão GitHub não encontrada.", 404);
    return row;
  }

  private appJwt() {
    const appId = process.env.GITHUB_APP_ID, privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n");
    if (!appId || !privateKey) throw new HttpException("GitHub App não configurado.", 503);
    const now = Math.floor(Date.now() / 1000), unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: now - 60, exp: now + 540, iss: appId })}`;
    return `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(privateKey, "base64url")}`;
  }

  private async token(ownerId: string, connectionId: string) {
    const connection = await this.connection(ownerId, connectionId), credentials = this.vault.open<Credentials>(connection.credentials_encrypted);
    const installationId = connection.metadata.installationId;
    if (installationId) {
      if (credentials.installation_token && (credentials.installation_expires_at || 0) > Date.now() + 60_000) return credentials.installation_token;
      const response = await fetch(`${api}/app/installations/${encodeURIComponent(String(installationId))}/access_tokens`, { method: "POST", headers: this.headers(this.appJwt()) });
      if (!response.ok) throw new HttpException("Não foi possível autenticar a instalação GitHub.", 401);
      const result = await response.json() as { token: string; expires_at: string };
      const next = { ...credentials, installation_token: result.token, installation_expires_at: Date.parse(result.expires_at) };
      await this.db.query("UPDATE integration_connections SET credentials_encrypted=$2,updated_at=now() WHERE id=$1 AND owner_id=$3", [connection.id, this.vault.seal(next), ownerId]);
      return result.token;
    }
    if (credentials.access_token && (!credentials.expires_at || credentials.expires_at > Date.now() + 60_000)) return credentials.access_token;
    if (!credentials.refresh_token) throw new HttpException("Reconecte o GitHub.", 401);
    const clientId = process.env.GITHUB_CLIENT_ID, clientSecret = process.env.GITHUB_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new HttpException("GitHub App não configurado.", 503);
    const response = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: credentials.refresh_token }) });
    if (!response.ok) throw new HttpException("Reconecte o GitHub.", 401);
    const result = await response.json() as { access_token: string; refresh_token?: string; expires_in?: number };
    const next = { ...credentials, access_token: result.access_token, refresh_token: result.refresh_token || credentials.refresh_token, expires_at: result.expires_in ? Date.now() + result.expires_in * 1000 : undefined };
    await this.db.query("UPDATE integration_connections SET credentials_encrypted=$2,updated_at=now() WHERE id=$1 AND owner_id=$3", [connection.id, this.vault.seal(next), ownerId]);
    return result.access_token;
  }

  private headers(token: string, extra: Record<string, string> = {}) {
    return { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2026-03-10", "User-Agent": "Orbit", ...extra };
  }

  async request<T>(ownerId: string, connectionId: string, path: string, init: RequestInit = {}) {
    const response = await fetch(path.startsWith("https://") ? path : `${api}${path}`, { ...init, headers: this.headers(await this.token(ownerId, connectionId), init.headers as Record<string, string> || {}) });
    if (!response.ok) {
      if (response.status === 401) throw new HttpException("A conexão GitHub expirou.", 401);
      if (response.status === 403) throw new HttpException("A instalação GitHub não possui esta permissão ou atingiu o limite da API.", 403);
      if (response.status === 404) throw new HttpException("Recurso GitHub não encontrado ou sem acesso.", 404);
      if (response.status === 422) throw new HttpException("O GitHub rejeitou os dados enviados.", 422);
      throw new HttpException("O GitHub não concluiu a operação.", 502);
    }
    if (response.status === 204) return undefined as T;
    if ((response.headers.get("content-type") || "").includes("json")) return await response.json() as T;
    return await response.text() as T;
  }
}

import { HttpException, Inject, Injectable } from "@nestjs/common";
import { Db } from "../db";
import { SecretVault } from "../secrets";

type Credentials = { access_token?: string; refresh_token?: string; expires_at?: number };
type Connection = { id: string; credentials_encrypted: string };

@Injectable()
export class DropboxClient {
  constructor(@Inject(Db) private db: Db, @Inject(SecretVault) private vault: SecretVault) {}

  private async connection(ownerId: string, connectionId: string) {
    const connection = await this.db.one<Connection>("SELECT id,credentials_encrypted FROM integration_connections WHERE id=$1 AND owner_id=$2 AND plugin_id='dropbox' AND enabled", [connectionId, ownerId]);
    if (!connection) throw new HttpException("Conexão Dropbox não encontrada.", 404);
    return connection;
  }

  private async token(ownerId: string, connectionId: string) {
    const connection = await this.connection(ownerId, connectionId);
    const credentials = this.vault.open<Credentials>(connection.credentials_encrypted);
    if (credentials.access_token && (credentials.expires_at || 0) > Date.now() + 60_000) return credentials.access_token;
    if (!credentials.refresh_token) throw new HttpException("Reconecte o Dropbox.", 401);
    const clientId = process.env.DROPBOX_CLIENT_ID, clientSecret = process.env.DROPBOX_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new HttpException("Dropbox não configurado.", 503);
    const response = await fetch("https://api.dropboxapi.com/oauth2/token", { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: credentials.refresh_token }) });
    const result = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number };
    if (!response.ok || !result.access_token) throw new HttpException("Reconecte o Dropbox.", 401);
    const next = { ...credentials, access_token: result.access_token, expires_at: Date.now() + (result.expires_in || 14_400) * 1000 };
    await this.db.query("UPDATE integration_connections SET credentials_encrypted=$2,updated_at=now(),status='active' WHERE id=$1", [connection.id, this.vault.seal(next)]);
    return result.access_token;
  }

  async request<T>(ownerId: string, connectionId: string, endpoint: string, input: Record<string, unknown> = {}) {
    const response = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, { method: "POST", headers: { Authorization: `Bearer ${await this.token(ownerId, connectionId)}`, "Content-Type": "application/json" }, body: JSON.stringify(input) });
    const result = await response.json().catch(() => ({})) as T & { error_summary?: string };
    if (!response.ok) {
      if (response.status === 401) throw new HttpException("A conexão Dropbox expirou. Reconecte-a.", 401);
      if (response.status === 403) throw new HttpException("O Dropbox não concedeu esta permissão.", 403);
      if (response.status === 409) throw new HttpException("Arquivo ou pasta Dropbox não encontrado.", 404);
      if (response.status === 429) throw new HttpException("O Dropbox está temporariamente limitando solicitações.", 429);
      throw new HttpException("O Dropbox não concluiu a operação.", 502);
    }
    return result as T;
  }
}

import { HttpException, Inject, Injectable } from "@nestjs/common";
import { Db } from "../db";
import { SecretVault } from "../secrets";
import {GoogleCredentials,GOOGLE_MAIL_SCOPES} from '../google/credentials';

type Credentials = {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  scope?: string;
  token_type?: string;
  capability_tokens?: { mail?: Credentials };
};
type Connection = {
  id: string;
  owner_id: string;
  plugin_id: string;
  credentials_encrypted: string;
  metadata: Record<string, unknown>;
};

@Injectable()
export class MailConnectionClient {
  constructor(@Inject(Db) private db: Db, @Inject(SecretVault) private vault: SecretVault,@Inject(GoogleCredentials) private google:GoogleCredentials) {}

  private async connection(ownerId: string, connectionId: string, providers: string[]) {
    const row = await this.db.one<Connection>(
      "SELECT * FROM integration_connections WHERE id=$1 AND owner_id=$2 AND enabled",
      [connectionId, ownerId],
    );
    if (!row || !providers.includes(row.plugin_id)) throw new HttpException("Conexão não encontrada.", 404);
    return row;
  }

  async token(ownerId: string, connectionId: string, family: "google" | "microsoft") {
    if(family==='google')return this.google.token(ownerId,connectionId,GOOGLE_MAIL_SCOPES);
    const connection = await this.connection(
      ownerId,
      connectionId,
      ["microsoft", "outlook_calendar", "outlook_mail", "teams"],
    );
    const envelope = this.vault.open<Credentials>(connection.credentials_encrypted);
    const credentials = family === "microsoft" && envelope.capability_tokens?.mail
      ? envelope.capability_tokens.mail
      : envelope;
    if (!credentials.access_token) throw new HttpException("Credencial da conexão inválida.", 401);
    if (!credentials.expires_at || credentials.expires_at > Date.now() + 60_000) return credentials.access_token;
    if (!credentials.refresh_token) throw new HttpException("Reconecte a conta para renovar o acesso.", 401);
    const refreshed = await this.refreshMicrosoft(credentials, connection.metadata);
    const stored = family === "microsoft" && envelope.capability_tokens
      ? { ...envelope, ...refreshed, capability_tokens: { ...envelope.capability_tokens, mail: refreshed } }
      : refreshed;
    await this.db.query(
      "UPDATE integration_connections SET credentials_encrypted=$2,updated_at=now() WHERE id=$1 AND owner_id=$3",
      [connectionId, this.vault.seal(stored), ownerId],
    );
    return refreshed.access_token;
  }

  private async refreshMicrosoft(credentials: Credentials, metadata: Record<string, unknown>): Promise<Credentials> {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new HttpException("Microsoft OAuth não configurado.", 503);
    const tenant = typeof metadata.tenantId === "string" ? metadata.tenantId : "common";
    const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: credentials.refresh_token!,
        grant_type: "refresh_token",
        scope: credentials.scope || "offline_access Mail.ReadWrite Mail.Send",
      }),
    });
    if (!response.ok) throw new HttpException("A conexão Microsoft expirou. Reconecte a conta.", 401);
    const body = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope?: string;
    };
    return {
      ...credentials,
      access_token: body.access_token,
      refresh_token: body.refresh_token || credentials.refresh_token,
      expires_at: Date.now() + body.expires_in * 1000,
      scope: body.scope || credentials.scope,
    };
  }

  async request<T>(family: "google" | "microsoft", ownerId: string, connectionId: string, url: string, init: RequestInit = {}) {
    const token = await this.token(ownerId, connectionId, family);
    const response = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
    });
    if (!response.ok) {
      if (response.status === 403)
        throw new HttpException(`A conexão ${family === "google" ? "Google" : "Microsoft"} não possui a permissão de e-mail necessária. Reconecte-a.`, 403);
      if (response.status === 401) throw new HttpException("A conexão expirou. Reconecte a conta.", 401);
      if (response.status === 404) throw new HttpException("Mensagem não encontrada.", 404);
      throw new HttpException("O provedor de e-mail não concluiu a operação.", 502);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

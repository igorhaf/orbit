import { HttpException, Inject, Injectable } from "@nestjs/common";
import {
  createHash,
  randomBytes,
} from "node:crypto";
import { Db } from "../db";
import { SecretVault } from "../secrets";
import {publicApiUrl} from '../public-api-url';

export type MicrosoftCapability = "calendar" | "teams" | "mail";
type MicrosoftTokenSet = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
  token_type: string;
};
export type MicrosoftTokens = MicrosoftTokenSet & {
  capability_tokens?: Partial<Record<MicrosoftCapability, MicrosoftTokenSet>>;
};
export type MicrosoftConnection = {
  id: string;
  owner_id: string;
  plugin_id: string;
  external_account_id: string;
  display_name: string;
  credentials_encrypted: string;
  enabled: boolean;
  status: string;
  capabilities: Record<string, boolean>;
  metadata: Record<string, unknown>;
};

export class MicrosoftGraphError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const graphBase = "https://graph.microsoft.com/v1.0";
const identityBase = "https://login.microsoftonline.com";
const calendarScopes = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Calendars.ReadWrite",
  "Calendars.ReadWrite.Shared",
];
const teamsScopes = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "OnlineMeetings.ReadWrite",
];
const mailScopes = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Mail.ReadWrite",
  "Mail.Send",
];

const problem = (status: number, providerCode?: string) => {
  if (status === 401) return ["AUTH_REQUIRED", "A conexão Microsoft precisa ser refeita."] as const;
  if (status === 403)
    return [
      providerCode === "Authorization_RequestDenied"
        ? "CONSENT_REQUIRED"
        : "PERMISSION_DENIED",
      "A Microsoft recusou a operação. Verifique o consentimento da capability.",
    ] as const;
  if (status === 404) return ["RESOURCE_NOT_FOUND", "O recurso Microsoft não foi encontrado."] as const;
  if (status === 409 || status === 412) return ["CONFLICT", "O recurso mudou no Microsoft 365. Atualize e tente novamente."] as const;
  if (status === 429) return ["RATE_LIMITED", "O Microsoft Graph limitou temporariamente as solicitações."] as const;
  if (status >= 500) return ["PROVIDER_UNAVAILABLE", "O Microsoft Graph está temporariamente indisponível."] as const;
  return ["VALIDATION_ERROR", "O Microsoft Graph não aceitou a operação."] as const;
};

@Injectable()
export class MicrosoftGraphClient {
  readonly connectionProviderId = "microsoft";
  constructor(
    @Inject(Db) private db: Db,
    @Inject(SecretVault) private vault: SecretVault,
  ) {}

  configured() {
    return Boolean(
      process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET,
    );
  }
  private config() {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    if (!clientId || !clientSecret)
      throw new HttpException(
        { message: "Configure MICROSOFT_CLIENT_ID e MICROSOFT_CLIENT_SECRET no servidor." },
        503,
      );
    return {
      clientId,
      clientSecret,
      tenant: process.env.MICROSOFT_TENANT || "common",
    };
  }
  redirectUri() {
    return (
      process.env.MICROSOFT_REDIRECT_URI ||
      `${publicApiUrl()}/calendar/microsoft/oauth/callback`
    );
  }
  scopes(capability: MicrosoftCapability) {
    return capability === "teams"
      ? teamsScopes
      : capability === "mail"
        ? mailScopes
        : calendarScopes;
  }
  async oauthUrl(ownerId: string, capability: MicrosoftCapability) {
    const { clientId, tenant } = this.config();
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(64).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    await this.db.query(
      "DELETE FROM oauth_states WHERE expires_at<now() OR used_at IS NOT NULL",
    );
    await this.db.query(
      `INSERT INTO oauth_states(state_hash,owner_id,plugin_id,redirect_uri,expires_at,secret_encrypted,metadata)
       VALUES($1,$2,$3,$4,now()+interval '10 minutes',$5,$6)`,
      [
        createHash("sha256").update(state).digest("hex"),
        ownerId,
        this.connectionProviderId,
        this.redirectUri(),
        this.vault.seal({ verifier }),
        JSON.stringify({ capability }),
      ],
    );
    const query = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: this.redirectUri(),
      response_mode: "query",
      scope: this.scopes(capability).join(" "),
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    return { url: `${identityBase}/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize?${query}` };
  }

  async oauthCallback(code: string, state: string) {
    if (!code || !state) throw new HttpException({ message: "Retorno OAuth inválido." }, 400);
    const stored = await this.db.one<{
      owner_id: string;
      redirect_uri: string;
      secret_encrypted: string;
      metadata: { capability?: MicrosoftCapability };
    }>(
      `UPDATE oauth_states SET used_at=now()
       WHERE state_hash=$1 AND plugin_id=$2 AND used_at IS NULL AND expires_at>now()
       RETURNING owner_id,redirect_uri,secret_encrypted,metadata`,
      [createHash("sha256").update(state).digest("hex"), this.connectionProviderId],
    );
    if (!stored) throw new HttpException({ message: "Estado OAuth inválido ou expirado." }, 401);
    const { clientId, clientSecret, tenant } = this.config();
    const verifier = this.vault.open<{ verifier: string }>(stored.secret_encrypted).verifier;
    const response = await fetch(`${identityBase}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        code_verifier: verifier,
        redirect_uri: stored.redirect_uri,
        grant_type: "authorization_code",
        scope: this.scopes(stored.metadata.capability || "calendar").join(" "),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok)
      throw new HttpException({ message: "Não foi possível concluir a autorização Microsoft." }, 502);
    const raw = (await response.json()) as Record<string, unknown>;
    if (!raw.refresh_token)
      throw new HttpException({ message: "A Microsoft não forneceu acesso offline. Refazer o consentimento é necessário." }, 409);
    const tokens: MicrosoftTokens = {
      access_token: String(raw.access_token),
      refresh_token: String(raw.refresh_token),
      expires_at: Date.now() + Number(raw.expires_in || 3600) * 1000,
      scope: String(raw.scope || ""),
      token_type: String(raw.token_type || "Bearer"),
    };
    const profileResponse = await fetch(`${graphBase}/me?$select=id,displayName,mail,userPrincipalName,userType`, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!profileResponse.ok)
      throw new HttpException({ message: "Não foi possível identificar a conta Microsoft." }, 502);
    const profile = (await profileResponse.json()) as Record<string, unknown>;
    const claims = this.jwtClaims(tokens.access_token);
    const tenantId = String(claims.tid || "personal");
    const externalUserId = String(profile.id || claims.oid || claims.sub);
    const email = String(profile.mail || profile.userPrincipalName || claims.preferred_username || "Conta Microsoft");
    const existing = await this.db.one<MicrosoftConnection>(
      "SELECT * FROM integration_connections WHERE owner_id=$1 AND plugin_id=$2 AND external_account_id=$3",
      [stored.owner_id, this.connectionProviderId, `${tenantId}:${externalUserId}`],
    );
    const capability = stored.metadata.capability || "calendar";
    const capabilities = {
      ...(existing?.capabilities || {}),
      outlookCalendar:
        capability === "calendar" || Boolean(existing?.capabilities?.outlookCalendar),
      teamsOnlineMeetings:
        capability === "teams" || Boolean(existing?.capabilities?.teamsOnlineMeetings),
      outlookMail:
        capability === "mail" || Boolean(existing?.capabilities?.outlookMail),
    };
    let storedTokens: MicrosoftTokens = {
      ...tokens,
      capability_tokens: { [capability]: tokens },
    };
    if (existing?.credentials_encrypted) {
      try {
        const previous = this.vault.open<MicrosoftTokens>(
          existing.credentials_encrypted,
        );
        const capabilityTokens = { ...(previous.capability_tokens || {}) };
        if (!previous.capability_tokens) {
          if (existing.capabilities?.outlookCalendar)
            capabilityTokens.calendar = previous;
          if (existing.capabilities?.teamsOnlineMeetings)
            capabilityTokens.teams = previous;
          if (existing.capabilities?.outlookMail)
            capabilityTokens.mail = previous;
        }
        storedTokens = {
          ...tokens,
          capability_tokens: { ...capabilityTokens, [capability]: tokens },
        };
      } catch {
        storedTokens = {
          ...tokens,
          capability_tokens: { [capability]: tokens },
        };
      }
    }
    return this.db.one<MicrosoftConnection>(
      `INSERT INTO integration_connections(owner_id,plugin_id,external_account_id,display_name,credentials_encrypted,status,capabilities,metadata)
       VALUES($1,$2,$3,$4,$5,'connected',$6,$7)
       ON CONFLICT(owner_id,plugin_id,external_account_id) DO UPDATE SET
         display_name=excluded.display_name,credentials_encrypted=excluded.credentials_encrypted,
         enabled=true,status='connected',capabilities=integration_connections.capabilities||excluded.capabilities,
         metadata=integration_connections.metadata||excluded.metadata,updated_at=now()
       RETURNING *`,
      [
        stored.owner_id,
        this.connectionProviderId,
        `${tenantId}:${externalUserId}`,
        email,
        this.vault.seal(storedTokens),
        JSON.stringify(capabilities),
        JSON.stringify({
          tenantId,
          externalUserId,
          email,
          displayName: profile.displayName,
          accountType: tenantId === "personal" || claims.tid === "9188040d-6c67-4c5b-b112-36a304b66dad" ? "personal" : "work_or_school",
          scopes: tokens.scope.split(/\s+/).filter(Boolean),
        }),
      ],
    );
  }

  private jwtClaims(token: string): Record<string, unknown> {
    try {
      return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  connections(ownerId: string) {
    return this.db.query(
      `SELECT id,display_name,enabled,status,capabilities,metadata,created_at,updated_at
       FROM integration_connections WHERE owner_id=$1 AND plugin_id=$2 ORDER BY created_at`,
      [ownerId, this.connectionProviderId],
    );
  }
  async disconnect(id: string, ownerId: string) {
    await this.connection(id, ownerId);
    await this.db.query(
      `UPDATE integration_connections SET enabled=false,status='disconnected',
       credentials_encrypted=$3,updated_at=now() WHERE id=$1 AND owner_id=$2`,
      [id, ownerId, this.vault.seal({ disconnectedAt: new Date().toISOString() })],
    );
  }
  async connection(id: string, ownerId?: string) {
    const connection = await this.db.one<MicrosoftConnection>(
      `SELECT * FROM integration_connections WHERE id=$1 AND plugin_id=$2 AND enabled${ownerId ? " AND owner_id=$3" : ""}`,
      ownerId ? [id, this.connectionProviderId, ownerId] : [id, this.connectionProviderId],
    );
    if (!connection) throw new MicrosoftGraphError("AUTH_REQUIRED", 404, "Conexão Microsoft não encontrada.");
    return connection;
  }
  async accessToken(
    connection: MicrosoftConnection,
    capability: MicrosoftCapability = "calendar",
  ) {
    const envelope = this.vault.open<MicrosoftTokens>(
      connection.credentials_encrypted,
    );
    let tokens: MicrosoftTokenSet =
      envelope.capability_tokens?.[capability] || envelope;
    if (tokens.expires_at > Date.now() + 60_000) return tokens.access_token;
    const { clientId, clientSecret, tenant } = this.config();
    const response = await fetch(`${identityBase}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokens.refresh_token,
        grant_type: "refresh_token",
        scope: tokens.scope,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      await this.db.query("UPDATE integration_connections SET status='needs_reauth',updated_at=now() WHERE id=$1", [connection.id]);
      throw new MicrosoftGraphError("AUTH_REQUIRED", 401, "A conexão Microsoft precisa ser refeita.");
    }
    const raw = (await response.json()) as Record<string, unknown>;
    tokens = {
      ...tokens,
      access_token: String(raw.access_token),
      refresh_token: String(raw.refresh_token || tokens.refresh_token),
      expires_at: Date.now() + Number(raw.expires_in || 3600) * 1000,
      scope: String(raw.scope || tokens.scope),
    };
    const updated: MicrosoftTokens = envelope.capability_tokens
      ? {
          ...envelope,
          ...tokens,
          capability_tokens: {
            ...envelope.capability_tokens,
            [capability]: tokens,
          },
        }
      : { ...tokens };
    const encrypted = this.vault.seal(updated);
    await this.db.query(
      "UPDATE integration_connections SET credentials_encrypted=$2,status='connected',updated_at=now() WHERE id=$1",
      [connection.id, encrypted],
    );
    connection.credentials_encrypted = encrypted;
    return tokens.access_token;
  }

  async request<T>(
    connection: MicrosoftConnection,
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const url = /^https:\/\//.test(path) ? path : `${graphBase}/${path.replace(/^\//, "")}`;
    const capability: MicrosoftCapability = url.includes("/onlineMeetings")
      ? "teams"
      : "calendar";
    if (!url.startsWith(`${graphBase}/`) && url !== graphBase)
      throw new MicrosoftGraphError("VALIDATION_ERROR", 400, "URL Graph inválida.");
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(url, {
        ...init,
        headers: {
          authorization: `Bearer ${await this.accessToken(connection, capability)}`,
          "content-type": "application/json",
          ...(init.headers || {}),
        },
        signal: AbortSignal.timeout(25_000),
      });
      if (response.ok) {
        if (response.status === 204) return undefined as T;
        return response.json() as Promise<T>;
      }
      let providerCode: string | undefined;
      try {
        const body = (await response.json()) as { error?: { code?: string } };
        providerCode = body.error?.code;
      } catch {
        providerCode = undefined;
      }
      if ((response.status === 429 || response.status === 503) && attempt < 2) {
        const retry = Number(response.headers.get("retry-after"));
        const delay = Number.isFinite(retry) ? retry * 1000 : 500 * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, Math.min(delay, 30_000)));
        continue;
      }
      const [code, message] = problem(response.status, providerCode);
      throw new MicrosoftGraphError(code, response.status, message);
    }
    throw new MicrosoftGraphError("PROVIDER_UNAVAILABLE", 503, "O Microsoft Graph está indisponível.");
  }
}

import { HttpException, Inject, Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { Db } from "../db";
import { SecretVault } from "../secrets";
import { publicApiUrl } from "../public-api-url";

const PLUGIN_ID = "zoom";
const TOKEN_URL = "https://zoom.us/oauth/token";
const API_BASE = "https://api.zoom.us/v2";
const SCOPES = ["meeting:write", "meeting:read", "user:read"];
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

type Tokens = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
  token_type: string;
};
type Connection = {
  id: string;
  owner_id: string;
  external_account_id: string;
  display_name: string;
  credentials_encrypted: string;
  enabled: boolean;
  metadata: Record<string, unknown>;
};
type Meeting = { id: string; topic: string; start_time: string; duration: number; join_url: string };
export type ZoomPastParticipant = { id?: string; user_id?: string; user_email?: string; email?: string; join_time?: string; leave_time?: string; duration?: number };

export type ZoomMeetingInput = { topic: string; start: string | Date; end: string | Date };
export type ZoomMeetingResult = { id: string; topic: string; start_time: string; duration: number; join_url: string };

/** Orbit-level Zoom OAuth and scheduled-meeting adapter. Tokens remain encrypted in integration_connections. */
@Injectable()
export class ZoomMeetings {
  constructor(@Inject(Db) private readonly db: Db, @Inject(SecretVault) private readonly vault: SecretVault) {}

  configured() {
    return Boolean(process.env.ZOOM_CLIENT_ID && process.env.ZOOM_CLIENT_SECRET);
  }

  private config() {
    const clientId = process.env.ZOOM_CLIENT_ID;
    const clientSecret = process.env.ZOOM_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new HttpException("Configure ZOOM_CLIENT_ID e ZOOM_CLIENT_SECRET no servidor.", 503);
    return { clientId, clientSecret };
  }

  private redirectUri() {
    return process.env.ZOOM_REDIRECT_URI || `${publicApiUrl()}/zoom/oauth/callback`;
  }

  async oauthUrl(ownerId: string) {
    const { clientId } = this.config();
    if (!ownerId) throw new HttpException("Usuário inválido.", 400);
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(64).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    await this.db.query("DELETE FROM oauth_states WHERE expires_at<now() OR used_at IS NOT NULL");
    await this.db.query(
      `INSERT INTO oauth_states(state_hash,owner_id,plugin_id,redirect_uri,expires_at,secret_encrypted,metadata)
       VALUES($1,$2,$3,$4,now()+interval '10 minutes',$5,'{}'::jsonb)`,
      [sha(state), ownerId, PLUGIN_ID, this.redirectUri(), this.vault.seal({ verifier })],
    );
    const query = new URLSearchParams({
      response_type: "code", client_id: clientId, redirect_uri: this.redirectUri(), state,
      code_challenge: challenge, code_challenge_method: "S256",
    });
    return { url: `https://zoom.us/oauth/authorize?${query}` };
  }

  async oauthCallback(code: string, state: string) {
    if (!code || !state) throw new HttpException("Retorno OAuth inválido.", 400);
    const pending = await this.db.one<{ owner_id: string; redirect_uri: string; secret_encrypted: string }>(
      `UPDATE oauth_states SET used_at=now()
       WHERE state_hash=$1 AND plugin_id=$2 AND used_at IS NULL AND expires_at>now()
       RETURNING owner_id,redirect_uri,secret_encrypted`, [sha(state), PLUGIN_ID],
    );
    if (!pending) throw new HttpException("Estado OAuth inválido ou expirado.", 401);
    const { clientId, clientSecret } = this.config();
    const verifier = this.vault.open<{ verifier: string }>(pending.secret_encrypted).verifier;
    const raw = await this.tokenRequest({
      grant_type: "authorization_code", code, redirect_uri: pending.redirect_uri, code_verifier: verifier,
    }, clientId, clientSecret);
    if (!raw.access_token || !raw.refresh_token) throw new HttpException("O Zoom não forneceu tokens de acesso offline.", 502);
    const tokens = this.tokens(raw);
    if (!SCOPES.every((scope) => new Set(tokens.scope.split(/\s+/)).has(scope))) {
      throw new HttpException("A conta Zoom não autorizou as permissões de reuniões necessárias.", 403);
    }
    const profileResponse = await this.apiFetch(`${API_BASE}/users/me`, tokens.access_token);
    if (!profileResponse.ok) throw new HttpException("Não foi possível identificar a conta Zoom.", 502);
    const profile = await profileResponse.json() as { id?: string; email?: string; first_name?: string; last_name?: string; account_id?: string };
    if (!profile.id) throw new HttpException("A conta Zoom não retornou um identificador.", 502);
    const label = profile.email || [profile.first_name, profile.last_name].filter(Boolean).join(" ") || "Conta Zoom";
    const row = await this.db.one<{ id: string }>(
      `INSERT INTO integration_connections(owner_id,plugin_id,external_account_id,display_name,label,credentials_encrypted,status,capabilities,metadata)
       VALUES($1,$2,$3,$4,$4,$5,'connected',$6,$7)
       ON CONFLICT(owner_id,plugin_id,external_account_id) DO UPDATE SET
         display_name=excluded.display_name,label=excluded.label,credentials_encrypted=excluded.credentials_encrypted,
         enabled=true,status='connected',capabilities=integration_connections.capabilities||excluded.capabilities,
         metadata=integration_connections.metadata||excluded.metadata,updated_at=now()
       RETURNING id`,
      [pending.owner_id, PLUGIN_ID, profile.id, label, this.vault.seal(tokens), JSON.stringify({ zoomMeetings: true }), JSON.stringify({ email: profile.email || null, accountId: profile.account_id || null, scopes: tokens.scope.split(/\s+/).filter(Boolean) })],
    );
    return { id: row!.id, ownerId: pending.owner_id };
  }

  connections(ownerId: string) {
    return this.db.query(
      `SELECT id,display_name,enabled,status,capabilities,metadata,created_at,updated_at
       FROM integration_connections WHERE owner_id=$1 AND plugin_id=$2 ORDER BY created_at`, [ownerId, PLUGIN_ID],
    );
  }

  async disconnect(ownerId: string, connectionId: string) {
    await this.connection(ownerId, connectionId);
    await this.db.query(
      `UPDATE integration_connections SET enabled=false,status='disconnected',credentials_encrypted=$3,updated_at=now()
       WHERE id=$1 AND owner_id=$2 AND plugin_id=$4`,
      [connectionId, ownerId, this.vault.seal({ disconnectedAt: new Date().toISOString() }), PLUGIN_ID],
    );
  }

  async create(ownerId: string, connectionId: string, input: ZoomMeetingInput, operationKey: string): Promise<ZoomMeetingResult> {
    if (!operationKey || operationKey.length > 200) throw new HttpException("Chave de operação inválida.", 400);
    const { topic, start, end } = input;
    if (typeof topic !== "string" || !topic.trim() || topic.length > 200) throw new HttpException("Informe um título de reunião válido.", 400);
    const startDate = start instanceof Date ? new Date(start.getTime()) : new Date(start);
    const endDate = end instanceof Date ? new Date(end.getTime()) : new Date(end);
    if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime()) || endDate <= startDate) {
      throw new HttpException("O horário final deve ser posterior ao horário inicial.", 400);
    }
    const duration = Math.ceil((endDate.getTime() - startDate.getTime()) / 60_000);
    if (duration > 24 * 60) throw new HttpException("A duração máxima da reunião é de 24 horas.", 400);
    const connection = await this.connection(ownerId, connectionId);
    const operationId = sha(operationKey);
    const requestHash = sha(JSON.stringify({ topic: topic.trim(), start: startDate.toISOString(), end: endDate.toISOString() }));
    const existingOperation = await this.operation(ownerId, connectionId, operationId);
    if (existingOperation?.requestHash && existingOperation.requestHash !== requestHash) {
      throw new HttpException("A chave de operação já foi usada com outros dados.", 409);
    }
    // Store operation state in the purpose-built resource table instead of token connection metadata.
    // A crash or timeout leaves a pending marker and prevents a duplicate meeting POST.
    const claimed = await this.db.one<{ metadata: Record<string, unknown> }>(
      `INSERT INTO external_resources(owner_id,plugin_id,connection_id,resource_type,external_id,metadata)
       VALUES($1,$2,$3,'meeting_operation',$4,$5::jsonb)
       ON CONFLICT(owner_id,plugin_id,connection_id,resource_type,external_id) DO UPDATE SET
         metadata=EXCLUDED.metadata,updated_at=now()
       WHERE external_resources.metadata->>'status'='rejected'
         AND external_resources.metadata->>'requestHash'=EXCLUDED.metadata->>'requestHash'
       RETURNING metadata`,
      [ownerId, PLUGIN_ID, connectionId, operationId, JSON.stringify({ status: "pending", requestHash, startedAt: new Date().toISOString() })],
    );
    if (!claimed) {
      const current = await this.operation(ownerId, connectionId, operationId);
      if (current?.status === "created" && current.result) return current.result;
      throw new HttpException({ message: "A criação desta reunião está pendente ou precisa de reconciliação. Não repita a operação automaticamente.", code: "ZOOM_MEETING_PENDING", operationId }, 409);
    }

    let meetingRequestStarted = false;
    try {
      const token = await this.accessToken(connection);
      meetingRequestStarted = true;
      const response = await this.apiFetch(`${API_BASE}/users/me/meetings`, token, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic: topic.trim(), type: 2, start_time: startDate.toISOString(), duration, timezone: "UTC" }),
      });
      if (!response.ok) {
        // A provider rejection is a known non-success; mark it retryable only for explicit 4xx.
        const body = await response.json().catch(() => ({})) as { code?: number; message?: string };
        if (response.status >= 400 && response.status < 500) {
          await this.setOperation(ownerId, connectionId, operationId, { status: "rejected", requestHash, at: new Date().toISOString(), providerCode: body.code || response.status });
          throw new HttpException({ message: "O Zoom recusou a criação da reunião.", code: "ZOOM_MEETING_REJECTED" }, response.status === 401 ? 401 : 400);
        }
        throw new HttpException({ message: "O resultado da criação não pôde ser confirmado. A operação permanece pendente para evitar duplicação.", code: "ZOOM_MEETING_PENDING", operationId }, 409);
      }
      const meeting = await response.json() as Meeting;
      const result = this.safeMeeting(meeting);
      await this.setOperation(ownerId, connectionId, operationId, { status: "created", requestHash, at: new Date().toISOString(), result });
      return result;
    } catch (error) {
      if (!meetingRequestStarted) {
        await this.setOperation(ownerId, connectionId, operationId, { status: "rejected", requestHash, at: new Date().toISOString(), reason: "authorization_failed" });
        if (error instanceof HttpException) throw error;
        throw new HttpException("Não foi possível preparar a conexão Zoom.", 502);
      }
      if (error instanceof HttpException && (error.getStatus() === 400 || error.getStatus() === 401)) throw error;
      if (error instanceof HttpException && error.getStatus() === 409) throw error;
      // Network errors and malformed responses are ambiguous once POST may have reached Zoom.
      throw new HttpException({ message: "O resultado da criação não pôde ser confirmado. A operação permanece pendente para evitar duplicação.", code: "ZOOM_MEETING_PENDING", operationId }, 409);
    }
  }

  /**
   * Manually recover an ambiguous create after a host has found the meeting in Zoom.
   * This is deliberately read-only against Zoom: it never creates, edits, or deletes a meeting.
   */
  async reconcile(
    ownerId: string,
    connectionId: string,
    operationKey: string,
    meetingId: string,
    expected: { topic: string; start: string | Date; end: string | Date },
  ): Promise<ZoomMeetingResult> {
    if (!operationKey || operationKey.length > 200) throw new HttpException("Chave de operação inválida.", 400);
    // Zoom meeting IDs are decimal identifiers. Restrict before interpolating into the API path.
    if (typeof meetingId !== "string" || !/^\d{1,32}$/.test(meetingId)) throw new HttpException("Identificador de reunião Zoom inválido.", 400);
    if (!expected || typeof expected.topic !== "string" || !expected.topic.trim() || expected.topic.length > 200) {
      throw new HttpException("Dados esperados da reunião inválidos.", 400);
    }
    const startDate = expected.start instanceof Date ? new Date(expected.start.getTime()) : new Date(expected.start);
    const endDate = expected.end instanceof Date ? new Date(expected.end.getTime()) : new Date(expected.end);
    if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime()) || endDate <= startDate || endDate.getTime() - startDate.getTime() > 24 * 60 * 60_000) {
      throw new HttpException("Intervalo esperado da reunião inválido.", 400);
    }

    // Both lookups are owner scoped. The connection check also supplies the renewable token.
    const connection = await this.connection(ownerId, connectionId);
    const operationId = sha(operationKey);
    const operation = await this.operation(ownerId, connectionId, operationId);
    if (!operation || operation.status !== "pending") throw new HttpException("A operação não existe ou não está pendente para reconciliação.", 409);
    const requestHash = sha(JSON.stringify({ topic: expected.topic.trim(), start: startDate.toISOString(), end: endDate.toISOString() }));
    if (!operation.requestHash || operation.requestHash !== requestHash) {
      throw new HttpException("Os dados esperados não correspondem à operação pendente.", 409);
    }

    const token = await this.accessToken(connection);
    const response = await this.apiFetch(`${API_BASE}/meetings/${meetingId}`, token);
    if (!response.ok) throw new HttpException("Não foi possível consultar a reunião informada no Zoom.", response.status === 404 ? 404 : 502);
    const providerMeeting = await response.json() as Meeting;
    const result = this.safeMeeting(providerMeeting);
    const actualStart = Date.parse(result.start_time);
    const actualDuration = result.duration;
    const expectedDurationMs = endDate.getTime() - startDate.getTime();
    if (result.id !== meetingId || result.topic !== expected.topic.trim() || !Number.isFinite(actualStart) ||
        Math.abs(actualStart - startDate.getTime()) > 60_000 || !Number.isFinite(actualDuration) || actualDuration <= 0 ||
        Math.abs(actualDuration * 60_000 - expectedDurationMs) > 60_000) {
      throw new HttpException("A reunião encontrada no Zoom diverge dos dados esperados; a operação continua pendente.", 409);
    }

    // Compare-and-set ensures only one concurrent reconciler can transition pending -> created.
    const updated = await this.db.one<{ id: string }>(
      `UPDATE external_resources SET metadata=$5::jsonb,url=$6,updated_at=now()
       WHERE owner_id=$1 AND plugin_id=$2 AND connection_id=$3
         AND resource_type='meeting_operation' AND external_id=$4 AND metadata->>'status'='pending'
       RETURNING id`,
      [ownerId, PLUGIN_ID, connectionId, operationId, JSON.stringify({ status: "created", requestHash, at: new Date().toISOString(), result }), result.join_url],
    );
    if (!updated) throw new HttpException("A operação foi reconciliada por outra solicitação ou deixou de estar pendente.", 409);
    return result;
  }

  private safeMeeting(meeting: Meeting): ZoomMeetingResult {
    if (!meeting?.id || !meeting.join_url || !this.isZoomJoinUrl(meeting.join_url)) {
      throw new HttpException("O Zoom retornou um link de participante inválido; a operação precisa de reconciliação.", 409);
    }
    // Intentionally discard start_url, password, host key, and all unrecognized provider fields.
    return { id: String(meeting.id), topic: String(meeting.topic || ""), start_time: String(meeting.start_time || ""), duration: Number(meeting.duration || 0), join_url: meeting.join_url };
  }

  private isZoomJoinUrl(value: string) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && !url.port &&
        (url.hostname === "zoom.us" || url.hostname.endsWith(".zoom.us")) && url.pathname.startsWith("/j/");
    } catch { return false; }
  }

  /** Reads a completed meeting's report through the existing meeting:read permission. */
  async pastParticipants(ownerId: string, connectionId: string, meetingId: string) {
    const connection = await this.connection(ownerId, connectionId);
    const tokens = this.vault.open<Tokens>(connection.credentials_encrypted);
    if (!new Set(tokens.scope.split(/\s+/)).has("meeting:read"))
      throw new HttpException("A conexão Zoom precisa ser reconectada com a permissão meeting:read.", 403);
    const token = await this.accessToken(connection);
    const detailsResponse = await this.apiFetch(`${API_BASE}/past_meetings/${encodeURIComponent(meetingId)}`, token);
    if (!detailsResponse.ok) {
      if ([400, 404].includes(detailsResponse.status)) throw new HttpException("O Zoom ainda não disponibilizou o relatório desta reunião encerrada.", 409);
      throw new HttpException("Não foi possível confirmar os dados da reunião encerrada no Zoom.", detailsResponse.status === 401 ? 401 : detailsResponse.status === 403 ? 403 : 502);
    }
    const details = await detailsResponse.json() as { id?: string; uuid?: string; topic?: string; start_time?: string; duration?: number };
    if (String(details.id || "") !== meetingId || !details.start_time || !Number.isFinite(Number(details.duration)))
      throw new HttpException("Os dados retornados pelo Zoom não correspondem ao identificador da reunião.", 409);
    const participants: ZoomPastParticipant[] = [];
    let nextPageToken = "";
    do {
      const query = new URLSearchParams({ page_size: "300" });
      if (nextPageToken) query.set("next_page_token", nextPageToken);
      const participantId = encodeURIComponent(encodeURIComponent(details.uuid || meetingId));
      const response = await this.apiFetch(`${API_BASE}/past_meetings/${participantId}/participants?${query}`, token);
      if (!response.ok) throw new HttpException(response.status === 403
        ? "A conta Zoom não tem autorização para consultar participantes desta reunião. Verifique meeting:read e o papel da conta anfitriã."
        : "Não foi possível consultar os participantes da reunião Zoom.", response.status === 401 ? 401 : response.status === 403 ? 403 : 502);
      const page = await response.json() as { participants?: ZoomPastParticipant[]; next_page_token?: string };
      if (!Array.isArray(page.participants)) throw new HttpException("O Zoom retornou um relatório de participantes inválido.", 502);
      participants.push(...page.participants);
      nextPageToken = page.next_page_token || "";
      if (participants.length > 5000) throw new HttpException("O relatório de participantes excede o limite de segurança.", 413);
    } while (nextPageToken);
    return { details, participants };
  }

  private async operation(ownerId: string, connectionId: string, key: string) {
    const row = await this.db.one<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM external_resources WHERE owner_id=$1 AND plugin_id=$2 AND connection_id=$3
       AND resource_type='meeting_operation' AND external_id=$4`, [ownerId, PLUGIN_ID, connectionId, key],
    );
    return row?.metadata as { status?: string; requestHash?: string; result?: ZoomMeetingResult } | undefined;
  }

  private async setOperation(ownerId: string, connectionId: string, key: string, value: unknown) {
    await this.db.query(
      `UPDATE external_resources SET metadata=$5::jsonb,url=$6,updated_at=now()
       WHERE owner_id=$1 AND plugin_id=$2 AND connection_id=$3
         AND resource_type='meeting_operation' AND external_id=$4`,
      [ownerId, PLUGIN_ID, connectionId, key, JSON.stringify(value), (value as { result?: ZoomMeetingResult })?.result?.join_url || null],
    );
  }

  private async connection(ownerId: string, connectionId: string) {
    const connection = await this.db.one<Connection>(
      "SELECT id,owner_id,external_account_id,display_name,credentials_encrypted,enabled,metadata FROM integration_connections WHERE id=$1 AND owner_id=$2 AND plugin_id=$3 AND enabled",
      [connectionId, ownerId, PLUGIN_ID],
    );
    if (!connection) throw new HttpException("Conexão Zoom não encontrada.", 404);
    return connection;
  }

  private async accessToken(connection: Connection) {
    let tokens = this.vault.open<Tokens>(connection.credentials_encrypted);
    if (tokens.expires_at > Date.now() + 60_000) return tokens.access_token;
    const { clientId, clientSecret } = this.config();
    const raw = await this.tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token }, clientId, clientSecret);
    if (!raw.access_token || !raw.refresh_token) {
      await this.db.query("UPDATE integration_connections SET status='needs_reauth',updated_at=now() WHERE id=$1 AND owner_id=$2", [connection.id, connection.owner_id]);
      throw new HttpException("A conexão Zoom precisa ser refeita.", 401);
    }
    tokens = this.tokens(raw);
    await this.db.query(
      "UPDATE integration_connections SET credentials_encrypted=$3,status='connected',updated_at=now() WHERE id=$1 AND owner_id=$2",
      [connection.id, connection.owner_id, this.vault.seal(tokens)],
    );
    connection.credentials_encrypted = this.vault.seal(tokens);
    return tokens.access_token;
  }

  private tokens(raw: Record<string, unknown>): Tokens {
    return {
      access_token: String(raw.access_token || ""), refresh_token: String(raw.refresh_token || ""),
      expires_at: Date.now() + Number(raw.expires_in || 3600) * 1000,
      scope: String(raw.scope || ""), token_type: String(raw.token_type || "Bearer"),
    };
  }

  private async tokenRequest(fields: Record<string, string>, clientId: string, clientSecret: string) {
    const response = await fetch(TOKEN_URL, {
      method: "POST", headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      }, body: new URLSearchParams(fields), signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new HttpException("Não foi possível concluir a autorização Zoom.", 502);
    return await response.json() as Record<string, unknown>;
  }

  private apiFetch(url: string, token: string, init: RequestInit = {}) {
    if (!url.startsWith(`${API_BASE}/`)) throw new HttpException("URL da API Zoom inválida.", 400);
    return fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers || {}) }, signal: AbortSignal.timeout(25_000) });
  }
}

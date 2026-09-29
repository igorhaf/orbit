import { Body, Controller, Get, HttpException, Inject, Injectable, Param, Post, Query, Req, Res } from "@nestjs/common";
import { Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { Db } from "../db";
import { FeaturesService } from "../features";
import { PluginActionContext, PluginDefinition } from "../plugins/contract";
import { SecretVault } from "../secrets";
import { DropboxClient } from "./dropbox.client";

type DropboxEntry = { ".tag": "file" | "folder"; id: string; name: string; path_display?: string; path_lower?: string; size?: number; server_modified?: string; client_modified?: string; rev?: string };
type Account = { account_id: string; name: { display_name: string }; email?: string };
const uid = (input: unknown, label = "ID") => { if (typeof input !== "string" || !/^[0-9a-f-]{36}$/i.test(input)) throw new HttpException(`${label} inválido.`, 400); return input; };
const text = (input: unknown, label: string, max = 2000) => { if (typeof input !== "string" || !input.trim() || input.trim().length > max) throw new HttpException(`${label} inválido.`, 400); return input.trim(); };
const path = (input: unknown, required = false) => { if (input === undefined || input === null || input === "") { if (required) throw new HttpException("Caminho inválido.", 400); return ""; } const result = text(input, "Caminho", 4096); if (!result.startsWith("/")) throw new HttpException("Caminho Dropbox deve começar com '/'.", 400); return result; };

@Injectable()
export class DropboxPlugin {
  constructor(@Inject(Db) private db: Db, @Inject(SecretVault) private vault: SecretVault, @Inject(DropboxClient) private client: DropboxClient, @Inject(FeaturesService) private features: FeaturesService) {}

  configured() { return Boolean(process.env.DROPBOX_CLIENT_ID && process.env.DROPBOX_CLIENT_SECRET); }
  connections(ownerId: string) { return this.db.query("SELECT id,display_name,label,status,metadata,created_at FROM integration_connections WHERE owner_id=$1 AND plugin_id='dropbox' AND enabled ORDER BY created_at", [ownerId]); }
  async oauthUrl(ownerId: string) {
    const clientId = process.env.DROPBOX_CLIENT_ID;
    if (!clientId) throw new HttpException("Dropbox não configurado.", 503);
    const state = randomBytes(32).toString("base64url"), redirect = process.env.DROPBOX_REDIRECT_URI || `${process.env.API_PUBLIC_URL || "http://localhost:4000"}/dropbox/oauth/callback`;
    await this.db.query("INSERT INTO oauth_states(state_hash,owner_id,plugin_id,redirect_uri,expires_at) VALUES($1,$2,'dropbox',$3,now()+interval '10 minutes')", [createHash("sha256").update(state).digest("hex"), ownerId, redirect]);
    const params = new URLSearchParams({ client_id: clientId, response_type: "code", redirect_uri: redirect, state, token_access_type: "offline", scope: "account_info.read files.metadata.read sharing.read sharing.write" });
    return { url: `https://www.dropbox.com/oauth2/authorize?${params}` };
  }
  async oauthCallback(code: string, state: string) {
    const pending = await this.db.one<{ owner_id: string; redirect_uri: string }>("UPDATE oauth_states SET used_at=now() WHERE state_hash=$1 AND plugin_id='dropbox' AND used_at IS NULL AND expires_at>now() RETURNING owner_id,redirect_uri", [createHash("sha256").update(state || "").digest("hex")]);
    if (!pending) throw new HttpException("Estado OAuth inválido ou expirado.", 400);
    const clientId = process.env.DROPBOX_CLIENT_ID || "", clientSecret = process.env.DROPBOX_CLIENT_SECRET || "";
    const response = await fetch("https://api.dropboxapi.com/oauth2/token", { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, grant_type: "authorization_code", redirect_uri: pending.redirect_uri }) });
    const token = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
    if (!response.ok || !token.access_token || !token.refresh_token) throw new HttpException(token.error_description || "Falha ao autorizar Dropbox.", 400);
    const accountResponse = await fetch("https://api.dropboxapi.com/2/users/get_current_account", { method: "POST", headers: { Authorization: `Bearer ${token.access_token}` } });
    const account = await accountResponse.json().catch(() => ({})) as Account;
    if (!accountResponse.ok || !account.account_id) throw new HttpException("Não foi possível obter a conta Dropbox.", 400);
    const credentials = this.vault.seal({ access_token: token.access_token, refresh_token: token.refresh_token, expires_at: Date.now() + (token.expires_in || 14_400) * 1000 });
    return this.db.one("INSERT INTO integration_connections(owner_id,plugin_id,external_account_id,display_name,label,credentials_encrypted,metadata) VALUES($1,'dropbox',$2,$3,$3,$4,$5) ON CONFLICT(owner_id,plugin_id,external_account_id) DO UPDATE SET display_name=EXCLUDED.display_name,label=EXCLUDED.label,credentials_encrypted=EXCLUDED.credentials_encrypted,enabled=true,status='active',metadata=EXCLUDED.metadata,updated_at=now() RETURNING id", [pending.owner_id, account.account_id, account.name.display_name || account.email || "Dropbox", credentials, JSON.stringify({ email: account.email || null })]);
  }
  listFolder(ownerId: string, connectionId: string, folderPath = "") { return this.client.request<{ entries: DropboxEntry[]; cursor: string; has_more: boolean }>(ownerId, connectionId, "files/list_folder", { path: path(folderPath), recursive: false, include_deleted: false }); }
  search(ownerId: string, connectionId: string, query: string) { return this.client.request<{ matches: Array<{ metadata: { metadata: DropboxEntry } }>; has_more: boolean }>(ownerId, connectionId, "files/search_v2", { query: text(query, "Busca", 256), options: { file_status: "active", filename_only: false, max_results: 100 } }); }
  metadata(ownerId: string, connectionId: string, filePath: string) { return this.client.request<DropboxEntry>(ownerId, connectionId, "files/get_metadata", { path: path(filePath, true), include_deleted: false }); }
  async sharedLink(ownerId: string, connectionId: string, filePath: string) {
    const input = { path: path(filePath, true), direct_only: true }, existing = await this.client.request<{ links: Array<{ url: string }> }>(ownerId, connectionId, "sharing/list_shared_links", input);
    if (existing.links[0]?.url) return existing.links[0].url;
    return (await this.client.request<{ url: string }>(ownerId, connectionId, "sharing/create_shared_link_with_settings", { path: input.path })).url;
  }
  async link(ownerId: string, connectionId: string, cardId: string, filePath: string) {
    await this.features.cardBoard(cardId, ownerId);
    const file = await this.metadata(ownerId, connectionId, filePath);
    if (file[".tag"] !== "file") throw new HttpException("Selecione um arquivo Dropbox, não uma pasta.", 400);
    const url = await this.sharedLink(ownerId, connectionId, file.path_lower || filePath);
    return this.db.one("INSERT INTO external_resources(owner_id,plugin_id,connection_id,resource_type,external_id,external_parent_id,url,etag,orbit_entity_type,orbit_entity_id,metadata) VALUES($1,'dropbox',$2,'file',$3,$4,$5,$6,'card',$7,$8) ON CONFLICT(owner_id,plugin_id,connection_id,resource_type,external_id) DO UPDATE SET orbit_entity_type='card',orbit_entity_id=$7,url=EXCLUDED.url,etag=EXCLUDED.etag,metadata=EXCLUDED.metadata,updated_at=now() RETURNING *", [ownerId, connectionId, file.id, file.path_lower || null, url, file.rev || null, cardId, JSON.stringify({ name: file.name, path: file.path_display || file.path_lower, size: file.size || 0, modifiedAt: file.server_modified || null })]);
  }
}

const schema = (required: string[], properties: Record<string, unknown>) => ({ type: "object", required, properties, additionalProperties: false });
const string = { type: "string", minLength: 1 };
export const dropboxPluginDefinition = (dropbox: DropboxPlugin): PluginDefinition => {
  const action = (id: string, name: string, capability: string, inputSchema: Record<string, unknown>, run: (owner: string, connection: string, input: Record<string, unknown>) => Promise<unknown>) => ({ id, name, permissions: [capability], requiredCapabilities: [capability], inputSchema, execute: async (input: Record<string, unknown>, context: PluginActionContext) => { if (!context.userId || !context.connectionId) throw new Error("Conexão Dropbox obrigatória."); return { type: "dropbox", label: name, value: await run(context.userId, context.connectionId, input) }; } });
  return { id: "dropbox", name: "Dropbox", version: "1.0.0", scope: "account", capabilities: [{ id: "files.read", name: "Ler arquivos", permissions: ["files.read"] }, { id: "sharing.write", name: "Criar links compartilháveis", permissions: ["sharing.write"] }], actions: [action("list_folder", "Listar pasta", "files.read", schema([], { path: string }), (u, c, i) => dropbox.listFolder(u, c, String(i.path || ""))), action("search_files", "Buscar arquivos", "files.read", schema(["query"], { query: string }), (u, c, i) => dropbox.search(u, c, String(i.query))), action("get_metadata", "Obter detalhes do arquivo", "files.read", schema(["path"], { path: string }), (u, c, i) => dropbox.metadata(u, c, String(i.path))), action("create_shared_link", "Criar link compartilhável", "sharing.write", schema(["path"], { path: string }), (u, c, i) => dropbox.sharedLink(u, c, String(i.path)))], connectionProvider: { id: "dropbox-oauth", name: "Dropbox OAuth", supportsMultiple: true, capabilities: ["files.read", "sharing.write"] }, contributions: { cardActions: [{ id: "dropbox.link", label: "Vincular arquivo Dropbox" }], automationActions: ["create_shared_link"].map(id => ({ id: `dropbox.${id}`, label: id })), resourceRenderers: [{ resourceTypes: ["file"], component: "dropbox-resource" }], settings: [{ id: "dropbox", label: "Dropbox", href: "/profile?tab=integrations&integration=dropbox" }] } };
};

@Controller("dropbox")
export class DropboxController {
  constructor(@Inject(DropboxPlugin) private dropbox: DropboxPlugin, @Inject(FeaturesService) private features: FeaturesService) {}
  @Get("status") async status(@Req() req: Request) { return { configured: this.dropbox.configured(), connections: await this.dropbox.connections(this.features.user(req)) }; }
  @Get("oauth/start") start(@Req() req: Request) { return this.dropbox.oauthUrl(this.features.user(req)); }
  @Get("oauth/callback") async callback(@Query("code") code: string, @Query("state") state: string, @Res() response: Response) { try { await this.dropbox.oauthCallback(code, state); response.redirect(`${process.env.WEB_ORIGIN || "http://localhost:3000"}/profile?tab=integrations&integration=dropbox&connected=true`); } catch (error) { response.redirect(`${process.env.WEB_ORIGIN || "http://localhost:3000"}/profile?tab=integrations&integration=dropbox&error=${encodeURIComponent((error as Error).message)}`); } }
  @Get("files") files(@Req() req: Request, @Query("connectionId") connection: string, @Query("path") folderPath?: string) { return this.dropbox.listFolder(this.features.user(req), uid(connection, "Conexão"), folderPath || ""); }
  @Get("search") search(@Req() req: Request, @Query("connectionId") connection: string, @Query("query") query: string) { return this.dropbox.search(this.features.user(req), uid(connection, "Conexão"), query); }
  @Post("cards/:cardId/link") link(@Req() req: Request, @Param("cardId") cardId: string, @Body() body: Record<string, unknown>) { return this.dropbox.link(this.features.user(req), uid(body.connectionId, "Conexão"), uid(cardId, "Cartão"), path(body.path, true)); }
}

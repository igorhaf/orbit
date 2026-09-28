import { Body, Controller, Get, Headers, HttpException, Inject, Injectable, Param, Post, Query, RawBodyRequest, Req, Res } from "@nestjs/common";
import { Request, Response } from "express";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Db } from "../db";
import { FeaturesService } from "../features";
import { OrbitEvents } from "../orbit-events";
import { PluginActionContext, PluginDefinition } from "../plugins/contract";
import { SecretVault } from "../secrets";
import { GitHubClient } from "./github.client";

type Repository = { id: number; full_name: string; name: string; owner: { login: string }; default_branch: string; html_url: string; private: boolean; permissions?: Record<string, boolean> };
type Issue = { id: number; number: number; title: string; body?: string | null; state: string; html_url: string; updated_at: string; labels?: unknown[]; assignees?: unknown[]; pull_request?: unknown };
type PullRequest = Issue & { head?: { ref: string }; base?: { ref: string }; merged?: boolean; draft?: boolean; mergeable?: boolean | null; requested_reviewers?: unknown[] };
const uid = (value: unknown, label = "ID") => { if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) throw new HttpException(`${label} inválido.`, 400); return value; };
const value = (input: unknown, label: string, max = 500) => { if (typeof input !== "string" || !input.trim() || input.length > max) throw new HttpException(`${label} inválido.`, 400); return input.trim(); };
const repo = (input: unknown) => { const result = value(input, "Repositório", 300); if (!/^[\w.-]+\/[\w.-]+$/.test(result)) throw new HttpException("Repositório inválido.", 400); return result; };
const number = (input: unknown, label: string) => { const result = Number(input); if (!Number.isInteger(result) || result < 1) throw new HttpException(`${label} inválido.`, 400); return result; };

@Injectable()
export class GitHubPlugin {
  constructor(@Inject(Db) private db: Db, @Inject(SecretVault) private vault: SecretVault, @Inject(GitHubClient) private client: GitHubClient, @Inject(FeaturesService) private features: FeaturesService, @Inject(OrbitEvents) private events: OrbitEvents) {}

  configured() { return Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET && process.env.GITHUB_WEBHOOK_SECRET); }
  connections(ownerId: string) { return this.db.query("SELECT id,display_name,label,status,metadata,created_at FROM integration_connections WHERE owner_id=$1 AND plugin_id='github' AND enabled ORDER BY created_at", [ownerId]); }
  async oauthUrl(ownerId: string) {
    if (!process.env.GITHUB_CLIENT_ID) throw new HttpException("GitHub App não configurado.", 503);
    const state = randomBytes(32).toString("base64url"), redirect = `${process.env.API_PUBLIC_URL || "http://localhost:4000"}/github/oauth/callback`;
    await this.db.query("INSERT INTO oauth_states(state_hash,owner_id,plugin_id,redirect_uri,expires_at) VALUES($1,$2,'github',$3,now()+interval '10 minutes')", [createHash("sha256").update(state).digest("hex"), ownerId, redirect]);
    return { url: `https://github.com/login/oauth/authorize?${new URLSearchParams({ client_id: process.env.GITHUB_CLIENT_ID, redirect_uri: redirect, state })}` };
  }
  async oauthCallback(code: string, state: string) {
    const hash = createHash("sha256").update(state || "").digest("hex"), pending = await this.db.one<{ owner_id: string; redirect_uri: string }>("UPDATE oauth_states SET used_at=now() WHERE state_hash=$1 AND plugin_id='github' AND used_at IS NULL AND expires_at>now() RETURNING owner_id,redirect_uri", [hash]);
    if (!pending) throw new HttpException("Estado OAuth inválido ou expirado.", 400);
    const response = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: process.env.GITHUB_CLIENT_ID || "", client_secret: process.env.GITHUB_CLIENT_SECRET || "", code, redirect_uri: pending.redirect_uri }) });
    const tokens = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
    if (!response.ok || !tokens.access_token) throw new HttpException(tokens.error_description || "Falha ao autorizar GitHub.", 400);
    const profile = await fetch("https://api.github.com/user", { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${tokens.access_token}`, "X-GitHub-Api-Version": "2026-03-10", "User-Agent": "Orbit" } });
    if (!profile.ok) throw new HttpException("Não foi possível obter a conta GitHub.", 400);
    const account = await profile.json() as { id: number; login: string; name?: string };
    const credentials = this.vault.seal({ access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_at: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined });
    return this.db.one(`INSERT INTO integration_connections(owner_id,plugin_id,external_account_id,display_name,label,credentials_encrypted,metadata) VALUES($1,'github',$2,$3,$3,$4,$5)
      ON CONFLICT(owner_id,plugin_id,external_account_id) DO UPDATE SET display_name=EXCLUDED.display_name,label=EXCLUDED.label,credentials_encrypted=EXCLUDED.credentials_encrypted,enabled=true,status='active',metadata=EXCLUDED.metadata,updated_at=now() RETURNING id`, [pending.owner_id, String(account.id), account.name || account.login, credentials, JSON.stringify({ login: account.login, authType: "github_app_user" })]);
  }

  repositories(ownerId: string, connectionId: string) { return this.client.request<Repository[]>(ownerId, connectionId, "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member"); }
  getIssue(ownerId: string, connectionId: string, repository: string, issue: number) { return this.client.request<Issue>(ownerId, connectionId, `/repos/${repo(repository)}/issues/${issue}`); }
  createIssue(ownerId: string, connectionId: string, input: Record<string, unknown>) { return this.client.request<Issue>(ownerId, connectionId, `/repos/${repo(input.repository)}/issues`, { method: "POST", body: JSON.stringify({ title: value(input.title, "Título", 256), body: typeof input.body === "string" ? input.body.slice(0, 100_000) : undefined, labels: Array.isArray(input.labels) ? input.labels.slice(0, 50) : undefined, assignees: Array.isArray(input.assignees) ? input.assignees.slice(0, 50) : undefined }) }); }
  updateIssue(ownerId: string, connectionId: string, input: Record<string, unknown>) { return this.client.request<Issue>(ownerId, connectionId, `/repos/${repo(input.repository)}/issues/${number(input.number, "Issue")}`, { method: "PATCH", body: JSON.stringify({ title: typeof input.title === "string" ? input.title.slice(0, 256) : undefined, body: typeof input.body === "string" ? input.body.slice(0, 100_000) : undefined, state: input.state === "closed" ? "closed" : input.state === "open" ? "open" : undefined }) }); }
  async createBranch(ownerId: string, connectionId: string, input: Record<string, unknown>) { const repository = repo(input.repository), source = value(input.source || "main", "Branch base", 255), name = value(input.name, "Branch", 255); const ref = await this.client.request<{ object: { sha: string } }>(ownerId, connectionId, `/repos/${repository}/git/ref/heads/${encodeURIComponent(source)}`); return this.client.request(ownerId, connectionId, `/repos/${repository}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${name}`, sha: ref.object.sha }) }); }
  getPullRequest(ownerId: string, connectionId: string, repository: string, pull: number) { return this.client.request<PullRequest>(ownerId, connectionId, `/repos/${repo(repository)}/pulls/${pull}`); }
  createPullRequest(ownerId: string, connectionId: string, input: Record<string, unknown>) { return this.client.request<PullRequest>(ownerId, connectionId, `/repos/${repo(input.repository)}/pulls`, { method: "POST", body: JSON.stringify({ title: value(input.title, "Título", 256), head: value(input.head, "Branch", 255), base: value(input.base, "Branch base", 255), body: typeof input.body === "string" ? input.body.slice(0, 100_000) : undefined, draft: input.draft === true }) }); }
  commentPullRequest(ownerId: string, connectionId: string, input: Record<string, unknown>) { return this.client.request(ownerId, connectionId, `/repos/${repo(input.repository)}/issues/${number(input.number, "Pull request")}/comments`, { method: "POST", body: JSON.stringify({ body: value(input.body, "Comentário", 65_000) }) }); }
  pullFiles(ownerId: string, connectionId: string, repository: string, pull: number) { return this.client.request(ownerId, connectionId, `/repos/${repo(repository)}/pulls/${pull}/files?per_page=100`); }
  pullDiff(ownerId: string, connectionId: string, repository: string, pull: number) { return this.client.request<string>(ownerId, connectionId, `/repos/${repo(repository)}/pulls/${pull}`, { headers: { Accept: "application/vnd.github.diff" } }); }

  private normalize(resourceType: "issue" | "pull_request", repository: string, item: Issue | PullRequest) { const pull = item as PullRequest; return { resourceType, externalId: `${repository}#${item.number}`, externalParentId: repository, url: item.html_url, etag: item.updated_at, metadata: { repository, number: item.number, title: item.title, state: item.state, merged: pull.merged || false, draft: pull.draft || false, reviewState: pull.requested_reviewers?.length ? "review_requested" : "none" } }; }
  async link(ownerId: string, connectionId: string, cardId: string, resourceType: "issue" | "pull_request", repository: string, itemNumber: number) { await this.features.cardBoard(cardId, ownerId); const item = resourceType === "issue" ? await this.getIssue(ownerId, connectionId, repository, itemNumber) : await this.getPullRequest(ownerId, connectionId, repository, itemNumber), resource = this.normalize(resourceType, repository, item); return this.db.one(`INSERT INTO external_resources(owner_id,plugin_id,connection_id,resource_type,external_id,external_parent_id,url,etag,orbit_entity_type,orbit_entity_id,metadata) VALUES($1,'github',$2,$3,$4,$5,$6,$7,'card',$8,$9)
    ON CONFLICT(owner_id,plugin_id,connection_id,resource_type,external_id) DO UPDATE SET orbit_entity_type='card',orbit_entity_id=$8,url=EXCLUDED.url,etag=EXCLUDED.etag,metadata=EXCLUDED.metadata,updated_at=now() RETURNING *`, [ownerId, connectionId, resource.resourceType, resource.externalId, resource.externalParentId, resource.url, resource.etag, cardId, JSON.stringify(resource.metadata)]); }
  async cardToIssue(ownerId: string, connectionId: string, cardId: string, repository: string) { await this.features.cardBoard(cardId, ownerId); const card = await this.db.one<{ title: string; description: string }>("SELECT title,description FROM cards WHERE id=$1", [cardId]); const issue = await this.createIssue(ownerId, connectionId, { repository, title: card!.title, body: card!.description }); return this.link(ownerId, connectionId, cardId, "issue", repository, issue.number); }
  async cardToPullRequest(ownerId: string, connectionId: string, cardId: string, input: Record<string, unknown>) { await this.features.cardBoard(cardId, ownerId); const card = await this.db.one<{ title: string; description: string }>("SELECT title,description FROM cards WHERE id=$1", [cardId]); const pull = await this.createPullRequest(ownerId, connectionId, { ...input, title: input.title || card!.title, body: input.body || card!.description }); return this.link(ownerId, connectionId, cardId, "pull_request", repo(input.repository), pull.number); }

  async webhook(raw: Buffer, signature: string | undefined, delivery: string | undefined, event: string | undefined, payload: Record<string, unknown>) {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret || !signature || !delivery || !event) throw new HttpException("Webhook GitHub não autorizado.", 401);
    const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`, left = Buffer.from(expected), right = Buffer.from(signature);
    if (left.length !== right.length || !timingSafeEqual(left, right)) throw new HttpException("Assinatura GitHub inválida.", 401);
    const inserted = await this.db.one("INSERT INTO github_webhook_deliveries(delivery_id,event_name,action) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING delivery_id", [delivery, event, typeof payload.action === "string" ? payload.action : null]);
    if (!inserted) return { ok: true, duplicate: true };
    try {
      const repository = (payload.repository as { full_name?: string } | undefined)?.full_name, action = typeof payload.action === "string" ? payload.action : "updated";
      const rawResource = event === "pull_request" ? payload.pull_request : event === "issues" ? payload.issue : undefined;
      if (repository && rawResource && typeof rawResource === "object") {
        const item = rawResource as Issue | PullRequest, type = event === "pull_request" ? "pull_request" : "issue", externalId = `${repository}#${item.number}`;
        const links = await this.db.query<{ owner_id: string; connection_id: string; orbit_entity_id: string; board_id: string }>(`SELECT er.owner_id,er.connection_id,er.orbit_entity_id,l.board_id FROM external_resources er JOIN cards c ON c.id=er.orbit_entity_id JOIN lists l ON l.id=c.list_id WHERE er.plugin_id='github' AND er.resource_type=$1 AND er.external_id=$2 AND er.orbit_entity_type='card'`, [type, externalId]);
        for (const link of links) { const normalized = this.normalize(type, repository, item); await this.db.query("UPDATE external_resources SET url=$2,etag=$3,metadata=$4,updated_at=now() WHERE owner_id=$1 AND plugin_id='github' AND resource_type=$5 AND external_id=$6", [link.owner_id, normalized.url, normalized.etag, JSON.stringify(normalized.metadata), type, externalId]); const kind = event === "pull_request" && action === "closed" && (item as PullRequest).merged ? "github.pull_request.merged" : `github.${event === "issues" ? "issue" : "pull_request"}.${action}`; await this.events.publish({ boardId: link.board_id, cardId: link.orbit_entity_id, kind, sourcePlugin: "github", operationId: delivery, payload: { connectionId: link.connection_id, resource: normalized } }); }
      }
      await this.db.query("UPDATE github_webhook_deliveries SET processed_at=now() WHERE delivery_id=$1", [delivery]); return { ok: true };
    } catch (error) { await this.db.query("UPDATE github_webhook_deliveries SET error=$2 WHERE delivery_id=$1", [delivery, (error as Error).message.slice(0, 1000)]); throw error; }
  }
}

const schema = (required: string[], properties: Record<string, unknown>) => ({ type: "object", required, properties, additionalProperties: false });
const string = { type: "string", minLength: 1 }, integer = { type: "integer", minimum: 1 }, output = { type: "object", required: ["type", "value"], properties: { type: { type: "string" }, label: { type: "string" }, value: {} } };
export const githubPluginDefinition = (github: GitHubPlugin): PluginDefinition => {
  const action = (id: string, name: string, capability: string, inputSchema: Record<string, unknown>, run: (owner: string, connection: string, input: Record<string, unknown>) => Promise<unknown>) => ({ id, name, permissions: [capability], requiredCapabilities: [capability], inputSchema, outputSchema: output, execute: async (input: Record<string, unknown>, context: PluginActionContext) => { if (!context.userId || !context.connectionId) throw new Error("Conexão GitHub obrigatória."); return { type: "github", label: name, value: await run(context.userId, context.connectionId, input) }; } });
  return { id: "github", name: "GitHub", version: "1.0.0", scope: "account", capabilities: [
    { id: "repository.read", name: "Ler repositórios", permissions: ["repository.read"] }, { id: "repository.write", name: "Alterar repositórios", permissions: ["repository.write"] }, { id: "issues.read", name: "Ler issues", permissions: ["issues.read"] }, { id: "issues.write", name: "Alterar issues", permissions: ["issues.write"] }, { id: "pull_requests.read", name: "Ler pull requests", permissions: ["pull_requests.read"] }, { id: "pull_requests.write", name: "Alterar pull requests", permissions: ["pull_requests.write"] }, { id: "branches.read", name: "Ler branches", permissions: ["branches.read"] }, { id: "branches.write", name: "Criar branches", permissions: ["branches.write"] },
  ], actions: [
    action("list_repositories", "Listar repositórios", "repository.read", schema([], {}), (u,c) => github.repositories(u,c)),
    action("get_issue", "Obter issue", "issues.read", schema(["repository","number"], { repository:string, number:integer }), (u,c,i) => github.getIssue(u,c,String(i.repository),Number(i.number))),
    action("create_issue", "Criar issue", "issues.write", schema(["repository","title"], { repository:string,title:string,body:{type:"string"},labels:{type:"array"},assignees:{type:"array"} }), (u,c,i) => github.createIssue(u,c,i)),
    action("update_issue", "Atualizar issue", "issues.write", schema(["repository","number"], { repository:string,number:integer,title:{type:"string"},body:{type:"string"},state:{enum:["open","closed"]} }), (u,c,i) => github.updateIssue(u,c,i)),
    action("create_branch", "Criar branch", "branches.write", schema(["repository","name"], { repository:string,name:string,source:string }), (u,c,i) => github.createBranch(u,c,i)),
    action("get_pull_request", "Obter pull request", "pull_requests.read", schema(["repository","number"], { repository:string,number:integer }), (u,c,i) => github.getPullRequest(u,c,String(i.repository),Number(i.number))),
    action("create_pull_request", "Criar pull request", "pull_requests.write", schema(["repository","title","head","base"], { repository:string,title:string,head:string,base:string,body:{type:"string"},draft:{type:"boolean"} }), (u,c,i) => github.createPullRequest(u,c,i)),
    action("comment_pull_request", "Comentar pull request", "pull_requests.write", schema(["repository","number","body"], { repository:string,number:integer,body:string }), (u,c,i) => github.commentPullRequest(u,c,i)),
    action("list_pull_request_files", "Listar arquivos do pull request", "pull_requests.read", schema(["repository","number"], { repository:string,number:integer }), (u,c,i) => github.pullFiles(u,c,String(i.repository),Number(i.number))),
    action("get_pull_request_diff", "Obter diff do pull request", "pull_requests.read", schema(["repository","number"], { repository:string,number:integer }), (u,c,i) => github.pullDiff(u,c,String(i.repository),Number(i.number))),
  ], triggers: ["issue.created","issue.updated","pull_request.opened","pull_request.updated","pull_request.merged","pull_request.review_requested","check.completed"].map(id => ({ id, name: id, eventSchema: { type:"object", required:["connectionId","resource"], properties:{connectionId:{type:"string"},resource:{type:"object"}} }, metadata:{event:`github.${id}`} })), connectionProvider: { id:"github-app", name:"GitHub App", supportsMultiple:true, capabilities:["repository.read","repository.write","issues.read","issues.write","pull_requests.read","pull_requests.write","branches.read","branches.write"] }, contributions: { cardActions:[{id:"github.create_issue",label:"Criar GitHub Issue"},{id:"github.create_pull_request",label:"Criar GitHub Pull Request"},{id:"github.link",label:"Vincular recurso GitHub"}], automationActions:["create_issue","update_issue","create_branch","create_pull_request","comment_pull_request"].map(id=>({id:`github.${id}`,label:id})), automationTriggers:["issue.created","issue.updated","pull_request.opened","pull_request.updated","pull_request.merged","pull_request.review_requested","check.completed"].map(id=>({id:`github.${id}`,label:id})), resourceRenderers:[{resourceTypes:["repository","issue","pull_request","branch","commit"],component:"github-resource"}], settings:[{id:"github",label:"GitHub",href:"/profile?integration=github"}] } };
};

@Controller("github")
export class GitHubController {
  constructor(@Inject(GitHubPlugin) private github: GitHubPlugin, @Inject(FeaturesService) private features: FeaturesService) {}
  @Get("status") async status(@Req() req: Request) { return { configured:this.github.configured(), connections:await this.github.connections(this.features.user(req)) }; }
  @Get("oauth/start") start(@Req() req: Request) { return this.github.oauthUrl(this.features.user(req)); }
  @Get("oauth/callback") async callback(@Query("code") code:string,@Query("state") state:string,@Res() response:Response) { try { await this.github.oauthCallback(code,state); response.redirect(`${process.env.WEB_ORIGIN||"http://localhost:3000"}/profile?integration=github&connected=true`); } catch(error) { response.redirect(`${process.env.WEB_ORIGIN||"http://localhost:3000"}/profile?integration=github&error=${encodeURIComponent((error as Error).message)}`); } }
  @Get("repositories") repositories(@Req() req:Request,@Query("connectionId") connection:string) { return this.github.repositories(this.features.user(req),uid(connection,"Conexão")); }
  @Post("cards/:cardId/issues") issue(@Req() req:Request,@Param("cardId") card:string,@Body() body:Record<string,unknown>) { return this.github.cardToIssue(this.features.user(req),uid(body.connectionId,"Conexão"),uid(card,"Cartão"),repo(body.repository)); }
  @Post("cards/:cardId/pull-requests") pull(@Req() req:Request,@Param("cardId") card:string,@Body() body:Record<string,unknown>) { return this.github.cardToPullRequest(this.features.user(req),uid(body.connectionId,"Conexão"),uid(card,"Cartão"),body); }
  @Post("cards/:cardId/link") link(@Req() req:Request,@Param("cardId") card:string,@Body() body:Record<string,unknown>) { const type=body.resourceType==='pull_request'?'pull_request':'issue'; return this.github.link(this.features.user(req),uid(body.connectionId,"Conexão"),uid(card,"Cartão"),type,repo(body.repository),number(body.number,type)); }
  @Post("webhook") webhook(@Req() req:RawBodyRequest<Request>,@Headers("x-hub-signature-256") signature?:string,@Headers("x-github-delivery") delivery?:string,@Headers("x-github-event") event?:string) { return this.github.webhook(req.rawBody||Buffer.from(JSON.stringify(req.body)),signature,delivery,event,req.body as Record<string,unknown>); }
}

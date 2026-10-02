import { Body, Controller, Get, HttpException, Inject, Injectable, Param, Post, Query, Req } from "@nestjs/common";
import { Request } from "express";
import { Db } from "../db";
import { FeaturesService } from "../features";
import { PluginDefinition } from "../plugins/contract";
import { MailProviderRegistry } from "./provider-registry";
import { validateCompose } from "./security";
import { MailMessage, MailThread } from "./types";

const id = (value: unknown, label = "ID") => {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) throw new HttpException(`${label} inválido.`, 400);
  return value;
};
const text = (value: unknown, label: string, max: number) => {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new HttpException(`${label} inválido.`, 400);
  return value.trim();
};

@Injectable()
export class MailService {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(FeaturesService) private features: FeaturesService,
    @Inject(MailProviderRegistry) private providers: MailProviderRegistry,
  ) {}

  catalog() {
    return this.providers.list();
  }
  connections(ownerId: string, providerId?: string) {
    const aliases = providerId === "gmail" ? ["google", "google_calendar", "gmail"] : providerId === "outlook_mail" ? ["microsoft", "outlook_calendar", "outlook_mail", "teams"] : [];
    if (!aliases.length) return [];
    return this.db.query(
      "SELECT id,plugin_id,display_name,label,status,metadata,created_at FROM integration_connections WHERE owner_id=$1 AND enabled AND plugin_id=ANY($2::text[]) ORDER BY created_at",
      [ownerId, aliases],
    );
  }
  list(ownerId: string, providerId: string, connectionId: string, query?: string, cursor?: string) {
    const provider = this.providers.get(providerId);
    return query ? provider.search(ownerId, id(connectionId, "Conexão"), text(query, "Busca", 500), cursor) : provider.listThreads(ownerId, id(connectionId, "Conexão"), cursor);
  }
  thread(ownerId: string, providerId: string, connectionId: string, threadId: string) {
    return this.providers.get(providerId).getThread(ownerId, id(connectionId, "Conexão"), text(threadId, "Conversa", 1000));
  }
  message(ownerId: string, providerId: string, connectionId: string, messageId: string) {
    return this.providers.get(providerId).getMessage(ownerId, id(connectionId, "Conexão"), text(messageId, "Mensagem", 1000));
  }
  compose(ownerId: string, providerId: string, connectionId: string, operation: "draft" | "send" | "reply", body: unknown) {
    const provider = this.providers.get(providerId), message = validateCompose(body);
    if (operation === "draft") return provider.createDraft(ownerId, id(connectionId, "Conexão"), message);
    if (operation === "reply") return provider.reply(ownerId, id(connectionId, "Conexão"), message);
    return provider.send(ownerId, id(connectionId, "Conexão"), message);
  }

  private resource(value: MailThread | MailMessage) {
    const isThread = !("threadId" in value);
    const message = isThread ? value.messages?.at(-1) : value;
    return {
      externalId: value.id,
      externalParentId: isThread ? null : value.threadId,
      resourceType: isThread ? "mail_thread" : "mail_message",
      subject: value.subject,
      preview: value.preview || message?.preview || "",
      sender: isThread ? message?.from : value.from,
      receivedAt: isThread ? value.lastMessageAt : value.receivedAt,
      url: value.externalUrl || message?.externalUrl,
    };
  }

  async link(ownerId: string, body: Record<string, unknown>) {
    const providerId = text(body.providerId, "Provider", 80), connectionId = id(body.connectionId, "Conexão"), cardId = id(body.cardId, "Cartão");
    await this.features.cardBoard(cardId, ownerId);
    const provider = this.providers.get(providerId);
    const value = body.resourceType === "message"
      ? await provider.getMessage(ownerId, connectionId, text(body.externalId, "Mensagem", 1000))
      : await provider.getThread(ownerId, connectionId, text(body.externalId, "Conversa", 1000));
    const resource = this.resource(value);
    return this.db.one(
      `INSERT INTO external_resources(owner_id,plugin_id,connection_id,resource_type,external_id,external_parent_id,url,orbit_entity_type,orbit_entity_id,metadata)
       VALUES($1,$2,$3,$4,$5,$6,$7,'card',$8,$9)
       ON CONFLICT(owner_id,plugin_id,connection_id,resource_type,external_id) DO UPDATE SET orbit_entity_type='card',orbit_entity_id=$8,url=EXCLUDED.url,metadata=EXCLUDED.metadata,updated_at=now() RETURNING *`,
      [ownerId, providerId, connectionId, resource.resourceType, resource.externalId, resource.externalParentId, resource.url || null, cardId, JSON.stringify({ subject: resource.subject, preview: resource.preview, sender: resource.sender, receivedAt: resource.receivedAt })],
    );
  }

  async createCard(ownerId: string, body: Record<string, unknown>) {
    const listId = id(body.listId, "Lista"), providerId = text(body.providerId, "Provider", 80), connectionId = id(body.connectionId, "Conexão");
    const list = await this.db.one<{ board_id: string }>("SELECT board_id FROM lists WHERE id=$1 AND archived_at IS NULL", [listId]);
    if (!list) throw new HttpException("Lista não encontrada.", 404);
    await this.features.member(list.board_id, ownerId);
    const provider = this.providers.get(providerId);
    const value = body.resourceType === "message"
      ? await provider.getMessage(ownerId, connectionId, text(body.externalId, "Mensagem", 1000))
      : await provider.getThread(ownerId, connectionId, text(body.externalId, "Conversa", 1000));
    const resource = this.resource(value);
    const client = await this.db.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        "SELECT orbit_entity_id FROM external_resources WHERE owner_id=$1 AND plugin_id=$2 AND connection_id=$3 AND resource_type=$4 AND external_id=$5 AND orbit_entity_type='card'",
        [ownerId, providerId, connectionId, resource.resourceType, resource.externalId],
      );
      if (existing.rows[0]) {
        await client.query("COMMIT");
        return { cardId: existing.rows[0].orbit_entity_id, created: false };
      }
      const card = (await client.query(
        "INSERT INTO cards(list_id,title,description,position) VALUES($1,$2,$3,COALESCE((SELECT max(position)+1 FROM cards WHERE list_id=$1),0)) RETURNING id",
        [listId, resource.subject.slice(0, 300), resource.preview.slice(0, 10_000)],
      )).rows[0];
      await client.query(
        `INSERT INTO external_resources(owner_id,plugin_id,connection_id,resource_type,external_id,external_parent_id,url,orbit_entity_type,orbit_entity_id,metadata)
         VALUES($1,$2,$3,$4,$5,$6,$7,'card',$8,$9)`,
        [ownerId, providerId, connectionId, resource.resourceType, resource.externalId, resource.externalParentId, resource.url || null, card.id, JSON.stringify({ subject: resource.subject, preview: resource.preview, sender: resource.sender, receivedAt: resource.receivedAt })],
      );
      await client.query("COMMIT");
      return { cardId: card.id, created: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

const objectSchema = { type: "object", additionalProperties: true };
const composeSchema = {
  type: "object",
  required: ["to", "subject"],
  properties: {
    to: { type: "array", minItems: 1, items: { type: "object", required: ["address"], properties: { address: { type: "string" }, name: { type: "string" } } } },
    cc: { type: "array", items: { type: "object" } },
    bcc: { type: "array", items: { type: "object" } },
    subject: { type: "string", maxLength: 998 },
    text: { type: "string", maxLength: 200000 },
    html: { type: "string", maxLength: 200000 },
    threadId: { type: "string" },
    replyToMessageId: { type: "string" },
  },
};

export const mailPluginDefinition = (providerId: "gmail" | "outlook_mail", name: string, service: MailService): PluginDefinition => {
  const execute = (operation: "draft" | "send" | "reply") => async (input: Record<string, unknown>, context: { userId?: string; connectionId?: string }) => {
    if (!context.userId || !context.connectionId) throw new Error("Conexão de e-mail obrigatória.");
    return { type: "mail", label: operation, value: await service.compose(context.userId, providerId, context.connectionId, operation, input) };
  };
  const read = (action: "search" | "get_thread" | "get_message") => async (input: Record<string, unknown>, context: { userId?: string; connectionId?: string }) => {
    if (!context.userId || !context.connectionId) throw new Error("Conexão de e-mail obrigatória.");
    const value = action === "search"
      ? await service.list(context.userId, providerId, context.connectionId, String(input.query || ""))
      : action === "get_thread"
        ? await service.thread(context.userId, providerId, context.connectionId, String(input.threadId || ""))
        : await service.message(context.userId, providerId, context.connectionId, String(input.messageId || ""));
    return { type: "mail", label: action, value };
  };
  return {
    id: providerId,
    name,
    version: "1.0.0",
    scope: "account",
    capabilities: [
      { id: "mail.read", name: "Ler e pesquisar mensagens", permissions: ["mail.read"] },
      { id: "mail.draft", name: "Criar rascunhos", permissions: ["mail.draft"] },
      { id: "mail.send", name: "Enviar e responder mensagens", permissions: ["mail.send"] },
    ],
    actions: [
      { id: "search", name: "Pesquisar e-mail", permissions: ["mail.read"], requiredCapabilities: ["mail.read"], inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string", minLength: 1, maxLength: 500 } }, additionalProperties: false }, outputSchema: objectSchema, execute: read("search") },
      { id: "get_thread", name: "Obter conversa", permissions: ["mail.read"], requiredCapabilities: ["mail.read"], inputSchema: { type: "object", required: ["threadId"], properties: { threadId: { type: "string" } }, additionalProperties: false }, outputSchema: objectSchema, execute: read("get_thread") },
      { id: "get_message", name: "Obter mensagem", permissions: ["mail.read"], requiredCapabilities: ["mail.read"], inputSchema: { type: "object", required: ["messageId"], properties: { messageId: { type: "string" } }, additionalProperties: false }, outputSchema: objectSchema, execute: read("get_message") },
      { id: "create_draft", name: "Criar rascunho", permissions: ["mail.draft"], requiredCapabilities: ["mail.draft"], inputSchema: composeSchema, outputSchema: objectSchema, execute: execute("draft") },
      { id: "send", name: "Enviar e-mail", permissions: ["mail.send"], requiredCapabilities: ["mail.send"], inputSchema: composeSchema, outputSchema: objectSchema, execute: execute("send") },
      { id: "reply", name: "Responder e-mail", permissions: ["mail.send"], requiredCapabilities: ["mail.send"], inputSchema: { ...composeSchema, required: ["to", "subject", "threadId", "replyToMessageId"] }, outputSchema: objectSchema, execute: execute("reply") },
    ],
        connectionProvider: { id: providerId === "gmail" ? "google-oauth" : "microsoft-oauth", name: providerId === "gmail" ? "Google OAuth" : "Microsoft OAuth", supportsMultiple: true, capabilities: ["mail.read", "mail.draft", "mail.send"] },
    contributions: {
      cardActions: [
        { id: `${providerId}.create_draft`, label: `Criar rascunho no ${name}` },
        { id: `${providerId}.send`, label: `Enviar pelo ${name}`, confirmation: true },
        { id: `${providerId}.reply`, label: `Responder pelo ${name}`, confirmation: true },
      ],
                  notifications: [{ id: "new_email", label: "Novo e-mail" }],
      resourceRenderers: [{ resourceTypes: ["mail_thread", "mail_message"], component: "mail-preview" }],
      settings: [{ id: providerId, label: name, href: `/profile?integration=${providerId}` }],
    },
  };
};

@Controller("mail")
export class MailController {
  constructor(@Inject(MailService) private service: MailService, @Inject(FeaturesService) private features: FeaturesService) {}
  @Get("providers") catalog() { return this.service.catalog(); }
  @Get("connections") connections(@Req() req: Request, @Query("provider") provider?: string) { return this.service.connections(this.features.user(req), provider); }
  @Get(":provider/threads") list(@Req() req: Request, @Param("provider") provider: string, @Query("connectionId") connection: string, @Query("q") query?: string, @Query("cursor") cursor?: string) { return this.service.list(this.features.user(req), provider, connection, query, cursor); }
  @Get(":provider/threads/:id") thread(@Req() req: Request, @Param("provider") provider: string, @Param("id") thread: string, @Query("connectionId") connection: string) { return this.service.thread(this.features.user(req), provider, connection, thread); }
  @Get(":provider/messages/:id") message(@Req() req: Request, @Param("provider") provider: string, @Param("id") message: string, @Query("connectionId") connection: string) { return this.service.message(this.features.user(req), provider, connection, message); }
  @Post(":provider/drafts") draft(@Req() req: Request, @Param("provider") provider: string, @Body() body: Record<string, unknown>) { return this.service.compose(this.features.user(req), provider, id(body.connectionId, "Conexão"), "draft", body); }
  @Post(":provider/send") send(@Req() req: Request, @Param("provider") provider: string, @Body() body: Record<string, unknown>) { return this.service.compose(this.features.user(req), provider, id(body.connectionId, "Conexão"), "send", body); }
  @Post(":provider/reply") reply(@Req() req: Request, @Param("provider") provider: string, @Body() body: Record<string, unknown>) { return this.service.compose(this.features.user(req), provider, id(body.connectionId, "Conexão"), "reply", body); }
  @Post("resources/link") link(@Req() req: Request, @Body() body: Record<string, unknown>) { return this.service.link(this.features.user(req), body); }
  @Post("resources/create-card") createCard(@Req() req: Request, @Body() body: Record<string, unknown>) { return this.service.createCard(this.features.user(req), body); }
}

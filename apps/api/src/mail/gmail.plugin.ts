import { Inject, Injectable } from "@nestjs/common";
import { Buffer } from "node:buffer";
import { MailConnectionClient } from "./connection-client";
import { plainText, sanitizeMailHtml } from "./security";
import { MailAddress, MailCompose, MailMessage, MailPage, MailProvider, MailThread } from "./types";

type GmailHeader = { name: string; value: string };
type GmailPart = {
  mimeType?: string;
  filename?: string;
  body?: { attachmentId?: string; data?: string; size?: number };
  parts?: GmailPart[];
};
type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart & { headers?: GmailHeader[] };
};
type GmailThread = { id: string; messages?: GmailMessage[] };

const api = "https://gmail.googleapis.com/gmail/v1/users/me";
const decode = (value?: string) =>
  value ? Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8") : "";
const header = (message: GmailMessage, name: string) =>
  message.payload?.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value || "";
const addresses = (value: string): MailAddress[] =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const match = item.match(/^(.*?)\s*<([^>]+)>$/);
      return match ? { name: match[1].replace(/^"|"$/g, "").trim(), address: match[2] } : { address: item };
    });
const parts = (part?: GmailPart): GmailPart[] => (part ? [part, ...(part.parts || []).flatMap(parts)] : []);
const mailBody = (message: GmailMessage) => {
  const all = parts(message.payload);
  const html = decode(all.find((item) => item.mimeType === "text/html")?.body?.data);
  const text = decode(all.find((item) => item.mimeType === "text/plain")?.body?.data);
  return { html: html ? sanitizeMailHtml(html) : undefined, text: text || (html ? plainText(html) : undefined) };
};

@Injectable()
export class GmailProvider implements MailProvider {
  readonly id = "gmail" as const;
  readonly name = "Gmail";
  constructor(@Inject(MailConnectionClient) private client: MailConnectionClient) {}

  private message(value: GmailMessage): MailMessage {
    const body = mailBody(value);
    return {
      id: value.id,
      threadId: value.threadId,
      subject: header(value, "Subject") || "(sem assunto)",
      from: addresses(header(value, "From"))[0],
      to: addresses(header(value, "To")),
      cc: addresses(header(value, "Cc")),
      sentAt: header(value, "Date") || undefined,
      receivedAt: value.internalDate ? new Date(Number(value.internalDate)).toISOString() : undefined,
      preview: value.snippet?.slice(0, 500),
      ...body,
      unread: value.labelIds?.includes("UNREAD") || false,
      attachments: parts(value.payload)
        .filter((item) => Boolean(item.filename && item.body?.attachmentId))
        .map((item) => ({
          id: item.body!.attachmentId!,
          name: item.filename!,
          contentType: item.mimeType,
          size: item.body?.size,
        })),
      externalUrl: `https://mail.google.com/mail/u/0/#all/${value.threadId}`,
      metadata: { labels: value.labelIds || [] },
    };
  }

  private async thread(ownerId: string, connectionId: string, id: string) {
    return this.client.request<GmailThread>("google", ownerId, connectionId, `${api}/threads/${encodeURIComponent(id)}?format=full`);
  }

  private normalizeThread(value: GmailThread): MailThread {
    const messages = (value.messages || []).map((item) => this.message(item));
    const last = messages.at(-1);
    return {
      id: value.id,
      subject: messages[0]?.subject || "(sem assunto)",
      participants: [...new Map(messages.flatMap((item) => [item.from, ...item.to].filter(Boolean) as MailAddress[]).map((item) => [item.address, item])).values()],
      lastMessageAt: last?.receivedAt || last?.sentAt,
      preview: last?.preview,
      unread: messages.some((item) => item.unread),
      messages,
      externalUrl: last?.externalUrl,
      metadata: {},
    };
  }

  private async list(ownerId: string, connectionId: string, query?: string, cursor?: string): Promise<MailPage<MailThread>> {
    const params = new URLSearchParams({ maxResults: "25" });
    if (query) params.set("q", query);
    if (cursor) params.set("pageToken", cursor);
    const result = await this.client.request<{ threads?: { id: string }[]; nextPageToken?: string }>(
      "google",
      ownerId,
      connectionId,
      `${api}/threads?${params}`,
    );
    const items = await Promise.all((result.threads || []).map(async ({ id }) => this.normalizeThread(await this.thread(ownerId, connectionId, id))));
    return { items, nextCursor: result.nextPageToken };
  }

  listThreads(ownerId: string, connectionId: string, cursor?: string) {
    return this.list(ownerId, connectionId, undefined, cursor);
  }
  search(ownerId: string, connectionId: string, query: string, cursor?: string) {
    return this.list(ownerId, connectionId, query, cursor);
  }
  async getThread(ownerId: string, connectionId: string, threadId: string) {
    return this.normalizeThread(await this.thread(ownerId, connectionId, threadId));
  }
  async getMessage(ownerId: string, connectionId: string, messageId: string) {
    const message = await this.client.request<GmailMessage>("google", ownerId, connectionId, `${api}/messages/${encodeURIComponent(messageId)}?format=full`);
    return this.message(message);
  }

  private raw(message: MailCompose) {
    const list = (items?: MailAddress[]) => items?.map((item) => (item.name ? `"${item.name.replace(/"/g, "")}" <${item.address}>` : item.address)).join(", ");
    const headers = [`To: ${list(message.to)}`, `Subject: ${message.subject}`, "MIME-Version: 1.0"];
    if (message.cc?.length) headers.push(`Cc: ${list(message.cc)}`);
    if (message.bcc?.length) headers.push(`Bcc: ${list(message.bcc)}`);
    if (message.replyToMessageId) headers.push(`In-Reply-To: ${message.replyToMessageId}`, `References: ${message.replyToMessageId}`);
    if (message.html) headers.push("Content-Type: text/html; charset=UTF-8", "", message.html);
    else headers.push("Content-Type: text/plain; charset=UTF-8", "", message.text || "");
    return Buffer.from(headers.join("\r\n")).toString("base64url");
  }

  private async compose(ownerId: string, connectionId: string, message: MailCompose, draft: boolean) {
    const body = { message: { raw: this.raw(message), ...(message.threadId ? { threadId: message.threadId } : {}) } };
    const result = await this.client.request<{ id?: string; message?: GmailMessage }>(
      "google",
      ownerId,
      connectionId,
      `${api}/${draft ? "drafts" : "messages/send"}`,
      { method: "POST", body: JSON.stringify(draft ? body : body.message) },
    );
    const value = result.message || (result as unknown as GmailMessage);
    return value.id ? this.getMessage(ownerId, connectionId, value.id) : {
      id: result.id || "draft",
      threadId: message.threadId || "",
      subject: message.subject,
      to: message.to,
      cc: message.cc || [],
      unread: false,
      attachments: [],
      metadata: { draft },
    };
  }
  createDraft(ownerId: string, connectionId: string, message: MailCompose) {
    return this.compose(ownerId, connectionId, message, true);
  }
  send(ownerId: string, connectionId: string, message: MailCompose) {
    return this.compose(ownerId, connectionId, message, false);
  }
  reply(ownerId: string, connectionId: string, message: MailCompose) {
    if (!message.threadId || !message.replyToMessageId) throw new Error("Informe a conversa e a mensagem respondida.");
    return this.send(ownerId, connectionId, message);
  }
}

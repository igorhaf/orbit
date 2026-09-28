import { Inject, Injectable } from "@nestjs/common";
import { MailConnectionClient } from "./connection-client";
import { plainText, sanitizeMailHtml } from "./security";
import { MailAddress, MailCompose, MailMessage, MailPage, MailProvider, MailThread } from "./types";

type GraphAddress = { emailAddress?: { name?: string; address?: string } };
type GraphMessage = {
  id: string;
  conversationId?: string;
  subject?: string;
  from?: GraphAddress;
  toRecipients?: GraphAddress[];
  ccRecipients?: GraphAddress[];
  receivedDateTime?: string;
  sentDateTime?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  isRead?: boolean;
  hasAttachments?: boolean;
  webLink?: string;
  internetMessageId?: string;
  parentFolderId?: string;
};
const api = "https://graph.microsoft.com/v1.0/me";
const address = (value?: GraphAddress): MailAddress | undefined => {
  const item = value?.emailAddress;
  return item?.address ? { address: item.address, name: item.name } : undefined;
};
const recipients = (values?: GraphAddress[]) => values?.map(address).filter(Boolean) as MailAddress[] || [];
const graphRecipients = (values?: MailAddress[]) => values?.map((item) => ({ emailAddress: item }));

@Injectable()
export class OutlookMailProvider implements MailProvider {
  readonly id = "outlook_mail" as const;
  readonly name = "Outlook Mail";
  constructor(@Inject(MailConnectionClient) private client: MailConnectionClient) {}

  private message(value: GraphMessage): MailMessage {
    const html = value.body?.contentType?.toLowerCase() === "html" ? sanitizeMailHtml(value.body.content || "") : undefined;
    const text = value.body?.contentType?.toLowerCase() === "text" ? value.body.content?.slice(0, 100_000) : html ? plainText(html) : undefined;
    return {
      id: value.id,
      threadId: value.conversationId || value.id,
      subject: value.subject || "(sem assunto)",
      from: address(value.from),
      to: recipients(value.toRecipients),
      cc: recipients(value.ccRecipients),
      sentAt: value.sentDateTime,
      receivedAt: value.receivedDateTime,
      preview: value.bodyPreview?.slice(0, 500),
      text,
      html,
      unread: value.isRead === false,
      attachments: value.hasAttachments ? [{ id: "available", name: "Anexos disponíveis" }] : [],
      externalUrl: value.webLink,
      metadata: { internetMessageId: value.internetMessageId, parentFolderId: value.parentFolderId },
    };
  }

  private thread(messages: GraphMessage[]): MailThread {
    const normalized = messages.map((item) => this.message(item));
    const last = normalized.at(-1);
    return {
      id: last?.threadId || "",
      subject: normalized[0]?.subject || "(sem assunto)",
      participants: [...new Map(normalized.flatMap((item) => [item.from, ...item.to].filter(Boolean) as MailAddress[]).map((item) => [item.address, item])).values()],
      lastMessageAt: last?.receivedAt || last?.sentAt,
      preview: last?.preview,
      unread: normalized.some((item) => item.unread),
      messages: normalized,
      externalUrl: last?.externalUrl,
      metadata: {},
    };
  }

  private async list(ownerId: string, connectionId: string, search?: string, cursor?: string): Promise<MailPage<MailThread>> {
    const url = cursor || `${api}/messages?$top=50&$select=id,conversationId,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,bodyPreview,isRead,hasAttachments,webLink,internetMessageId,parentFolderId&$orderby=receivedDateTime desc${search ? `&$search=${encodeURIComponent(`"${search}"`)}` : ""}`;
    const result = await this.client.request<{ value: GraphMessage[]; "@odata.nextLink"?: string }>("microsoft", ownerId, connectionId, url, search ? { headers: { ConsistencyLevel: "eventual" } } : {});
    const grouped = new Map<string, GraphMessage[]>();
    for (const message of result.value || []) {
      const id = message.conversationId || message.id;
      grouped.set(id, [...(grouped.get(id) || []), message]);
    }
    return { items: [...grouped.values()].map((items) => this.thread(items.reverse())), nextCursor: result["@odata.nextLink"] };
  }
  listThreads(ownerId: string, connectionId: string, cursor?: string) {
    return this.list(ownerId, connectionId, undefined, cursor);
  }
  search(ownerId: string, connectionId: string, query: string, cursor?: string) {
    return this.list(ownerId, connectionId, query, cursor);
  }
  async getThread(ownerId: string, connectionId: string, threadId: string) {
    const filter = encodeURIComponent(`conversationId eq '${threadId.replace(/'/g, "''")}'`);
    const result = await this.client.request<{ value: GraphMessage[] }>("microsoft", ownerId, connectionId, `${api}/messages?$filter=${filter}&$orderby=receivedDateTime`);
    return this.thread(result.value || []);
  }
  async getMessage(ownerId: string, connectionId: string, messageId: string) {
    return this.message(await this.client.request<GraphMessage>("microsoft", ownerId, connectionId, `${api}/messages/${encodeURIComponent(messageId)}`));
  }
  private payload(message: MailCompose) {
    return {
      subject: message.subject,
      body: { contentType: message.html ? "HTML" : "Text", content: message.html || message.text || "" },
      toRecipients: graphRecipients(message.to),
      ccRecipients: graphRecipients(message.cc),
      bccRecipients: graphRecipients(message.bcc),
    };
  }
  async createDraft(ownerId: string, connectionId: string, message: MailCompose) {
    const result = await this.client.request<GraphMessage>("microsoft", ownerId, connectionId, `${api}/messages`, { method: "POST", body: JSON.stringify(this.payload(message)) });
    return this.message(result);
  }
  async send(ownerId: string, connectionId: string, message: MailCompose) {
    await this.client.request<void>("microsoft", ownerId, connectionId, `${api}/sendMail`, { method: "POST", body: JSON.stringify({ message: this.payload(message), saveToSentItems: true }) });
    return { id: "sent", threadId: message.threadId || "", subject: message.subject, to: message.to, cc: message.cc || [], unread: false, attachments: [], metadata: { sent: true } };
  }
  async reply(ownerId: string, connectionId: string, message: MailCompose) {
    if (!message.replyToMessageId) throw new Error("Informe a mensagem respondida.");
    const draft = await this.client.request<GraphMessage>("microsoft", ownerId, connectionId, `${api}/messages/${encodeURIComponent(message.replyToMessageId)}/createReply`, { method: "POST", body: JSON.stringify({}) });
    const updated = await this.client.request<GraphMessage>("microsoft", ownerId, connectionId, `${api}/messages/${encodeURIComponent(draft.id)}`, { method: "PATCH", body: JSON.stringify(this.payload(message)) });
    await this.client.request<void>("microsoft", ownerId, connectionId, `${api}/messages/${encodeURIComponent(draft.id)}/send`, { method: "POST", body: JSON.stringify({}) });
    return this.message(updated);
  }
}

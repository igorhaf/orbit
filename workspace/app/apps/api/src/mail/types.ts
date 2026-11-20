export type MailAddress = { name?: string; address: string };

export type MailAttachment = {
  id: string;
  name: string;
  contentType?: string;
  size?: number;
};

export type MailMessage = {
  id: string;
  threadId: string;
  subject: string;
  from?: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  sentAt?: string;
  receivedAt?: string;
  preview?: string;
  text?: string;
  html?: string;
  unread: boolean;
  attachments: MailAttachment[];
  externalUrl?: string;
  metadata: Record<string, unknown>;
};

export type MailThread = {
  id: string;
  subject: string;
  participants: MailAddress[];
  lastMessageAt?: string;
  preview?: string;
  unread: boolean;
  messages?: MailMessage[];
  externalUrl?: string;
  metadata: Record<string, unknown>;
};

export type MailCompose = {
  to: MailAddress[];
  cc?: MailAddress[];
  bcc?: MailAddress[];
  subject: string;
  text?: string;
  html?: string;
  threadId?: string;
  replyToMessageId?: string;
};

export type MailPage<T> = { items: T[]; nextCursor?: string };

export interface MailProvider {
  readonly id: "gmail" | "outlook_mail";
  readonly name: string;
  listThreads(ownerId: string, connectionId: string, cursor?: string): Promise<MailPage<MailThread>>;
  getThread(ownerId: string, connectionId: string, threadId: string): Promise<MailThread>;
  getMessage(ownerId: string, connectionId: string, messageId: string): Promise<MailMessage>;
  search(ownerId: string, connectionId: string, query: string, cursor?: string): Promise<MailPage<MailThread>>;
  createDraft(ownerId: string, connectionId: string, message: MailCompose): Promise<MailMessage>;
  send(ownerId: string, connectionId: string, message: MailCompose): Promise<MailMessage>;
  reply(ownerId: string, connectionId: string, message: MailCompose): Promise<MailMessage>;
}

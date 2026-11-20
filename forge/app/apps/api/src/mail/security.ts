import { MailAddress, MailCompose } from "./types";

const entity = (value: string) =>
  value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

export const sanitizeMailHtml = (value: string) =>
  value
    .replace(/<(script|style|iframe|object|embed|form)[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)\s*=\s*(["'])\s*(javascript:|data:text\/html)[\s\S]*?\2/gi, "")
    .slice(0, 200_000);

export const plainText = (value: string) =>
  entity(value.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim()
    .slice(0, 100_000);

export const validAddress = (value: unknown): MailAddress => {
  if (!value || typeof value !== "object") throw new Error("Destinatário inválido.");
  const input = value as Record<string, unknown>;
  const address = typeof input.address === "string" ? input.address.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || address.length > 320)
    throw new Error("Endereço de e-mail inválido.");
  return { address, name: typeof input.name === "string" ? input.name.slice(0, 200) : undefined };
};

export const validateCompose = (value: unknown): MailCompose => {
  if (!value || typeof value !== "object") throw new Error("Mensagem inválida.");
  const input = value as Record<string, unknown>;
  const addresses = (key: string, required = false) => {
    const values = input[key];
    if (!Array.isArray(values)) {
      if (required) throw new Error("Informe ao menos um destinatário.");
      return undefined;
    }
    if (values.length > 100) throw new Error("Quantidade de destinatários excedida.");
    const parsed = values.map(validAddress);
    if (required && !parsed.length) throw new Error("Informe ao menos um destinatário.");
    return parsed;
  };
  const subject = typeof input.subject === "string" ? input.subject.trim().slice(0, 998) : "";
  const text = typeof input.text === "string" ? input.text.slice(0, 200_000) : undefined;
  const html = typeof input.html === "string" ? sanitizeMailHtml(input.html) : undefined;
  if (!text && !html) throw new Error("O corpo da mensagem é obrigatório.");
  return {
    to: addresses("to", true)!,
    cc: addresses("cc"),
    bcc: addresses("bcc"),
    subject,
    text,
    html,
    threadId: typeof input.threadId === "string" ? input.threadId.slice(0, 1000) : undefined,
    replyToMessageId:
      typeof input.replyToMessageId === "string" ? input.replyToMessageId.slice(0, 1000) : undefined,
  };
};

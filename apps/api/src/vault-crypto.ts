import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

type VaultPayload = Record<string, unknown>;

function vaultKey() {
  const secret = process.env.VAULT_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) throw new Error('Configure VAULT_ENCRYPTION_KEY para acessar o cofre.');
  return createHash('sha256').update(secret).digest();
}

export function encryptVaultPayload(payload: VaultPayload): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', vaultKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${encrypted.toString('base64')}`;
}

export function decryptVaultPayload(value: string): VaultPayload {
  const parts = value.split('.');
  if (parts.length !== 3) throw new Error('Conteúdo do cofre inválido.');
  const [iv, tag, data] = parts.map(part => Buffer.from(part, 'base64'));
  if (iv.length !== 12 || tag.length !== 16 || !data.length) throw new Error('Conteúdo do cofre inválido.');
  const decipher = createDecipheriv('aes-256-gcm', vaultKey(), iv);
  decipher.setAuthTag(tag);
  const parsed: unknown = JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Conteúdo do cofre inválido.');
  return parsed as VaultPayload;
}

export function vaultItemHtml(stored: VaultPayload, notes: string): string {
  if (typeof stored.content_html === 'string') return stored.content_html;
  const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const legacyNotes = notes ? `<p>${escape(notes).replace(/\n/g, '<br>')}</p>` : '';
  const legacyFields = Object.entries(stored).filter((entry): entry is [string, string] => typeof entry[1] === 'string').map(([label, content]) => `<h2>${escape(label)}</h2><p>${escape(content).replace(/\n/g, '<br>')}</p>`).join('');
  return legacyNotes + legacyFields;
}

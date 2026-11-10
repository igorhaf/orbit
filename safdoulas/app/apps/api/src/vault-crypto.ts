import {configuredKeys,openJson,sealJson} from './keyring-crypto';

type VaultPayload = Record<string, unknown>;

function activeVaultKey() {
  const secret = process.env.VAULT_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) throw new Error('Configure VAULT_ENCRYPTION_KEY para acessar o cofre.');
  return secret;
}

export function encryptVaultPayload(payload: VaultPayload): string {
  return sealJson(payload,activeVaultKey(),'orbit-notebook-vault');
}

export function decryptVaultPayload(value: string): VaultPayload {
  const secret=process.env.VAULT_ENCRYPTION_KEY||process.env.JWT_SECRET;
  const parsed:unknown=openJson(value,configuredKeys(secret,process.env.VAULT_ENCRYPTION_KEY_PREVIOUS,process.env.JWT_SECRET),'orbit-notebook-vault');
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

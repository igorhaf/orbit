import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export type ErasureAccountField = 'name' | 'email' | 'avatar_url' | 'preferences' | 'password_hash' | 'social_identities';
export type ErasureTarget =
  | { recordId: string; revision: number; fieldPath: string[] }
  | { recordId: string; revision: number; attachmentStore: 'record_attachment'; attachmentId: string }
  | { recordId: string; revision: number; attachmentStore: 'extension_file' };
export type ErasureLedgerInput = { operationId: string; subjectUserId: string; accountFields: ErasureAccountField[]; targets: ErasureTarget[] };
export type ErasureLedgerRecord = { operationId: string; subjectRef: string; accountFields: ErasureAccountField[]; targets: ErasureTarget[]; state: 'prepared' | 'committed' | 'cancelled' };
type RecordPayload = Omit<ErasureLedgerRecord, 'state'>;
type LedgerEvent = { type: 'prepared'; record: RecordPayload } | { type: 'committed' | 'cancelled'; operationId: string };
type Envelope = { version: 1; sequence: number; previous: string; event: LedgerEvent; mac: string };
type Head = { version: 1; sequence: number; mac: string; signature: string };
const ZERO = '0'.repeat(64);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields = new Set<ErasureAccountField>(['name', 'email', 'avatar_url', 'preferences', 'password_hash', 'social_identities']);

function key() {
  const value = process.env.ORBIT_ERASURE_LEDGER_KEY || '';
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error('ORBIT_ERASURE_LEDGER_KEY must be 64 hexadecimal characters; generate and preserve it separately from database backups.');
  if (process.env.ORBIT_BACKUP_KEY && Buffer.from(value, 'hex').equals(Buffer.from(process.env.ORBIT_BACKUP_KEY, 'hex'))) throw new Error('ORBIT_ERASURE_LEDGER_KEY must be independent from ORBIT_BACKUP_KEY.');
  return Buffer.from(value, 'hex');
}
function ledgerPath() { return resolve(process.env.ORBIT_ERASURE_LEDGER_PATH || join(process.env.ORBIT_BACKUP_DIR || resolve(__dirname, '../../../backups'), 'approved-erasures.v1.jsonl')); }
function mac(value: string, secret = key()) { return createHmac('sha256', secret).update(value).digest('hex'); }
function canonical(value: unknown) { return JSON.stringify(value); }
function safeEqual(a: string, b: string) { const x = Buffer.from(a, 'hex'); const y = Buffer.from(b, 'hex'); return x.length === y.length && timingSafeEqual(x, y); }
function validateRecord(record: RecordPayload) {
  const exactKeys = (value: object, allowed: string[]) => Object.keys(value).sort().join(',') === [...allowed].sort().join(',');
  if (!exactKeys(record, ['operationId', 'subjectRef', 'accountFields', 'targets'])) throw new Error('Erasure ledger record contains unsupported fields.');
  if (!uuid.test(record.operationId) || !/^hmac-sha256:v1:[0-9a-f]{64}$/.test(record.subjectRef)) throw new Error('Invalid erasure ledger identity.');
  if (!Array.isArray(record.accountFields) || record.accountFields.length > fields.size || record.accountFields.some(field => !fields.has(field)) || new Set(record.accountFields).size !== record.accountFields.length || !Array.isArray(record.targets) || record.targets.length > 100_000 || (!record.accountFields.length && !record.targets.length)) throw new Error('Invalid erasure ledger payload.');
  for (const target of record.targets) {
    if (!uuid.test(target.recordId) || !Number.isSafeInteger(target.revision) || target.revision < 1) throw new Error('Invalid erasure target locator.');
    if ('fieldPath' in target) {
      if (!exactKeys(target, ['recordId', 'revision', 'fieldPath']) || !Array.isArray(target.fieldPath) || !target.fieldPath.length || target.fieldPath.length > 32 || target.fieldPath.some(part => typeof part !== 'string' || !part || part.length > 200 || /^\d+$/.test(part))) throw new Error('Invalid erasure field path.');
    } else if ('attachmentStore' in target) {
      const allowed = target.attachmentStore === 'record_attachment' ? ['recordId', 'revision', 'attachmentStore', 'attachmentId'] : ['recordId', 'revision', 'attachmentStore'];
      if (!exactKeys(target, allowed) || !['record_attachment', 'extension_file'].includes(target.attachmentStore) || (target.attachmentStore === 'record_attachment' && !uuid.test(target.attachmentId))) throw new Error('Invalid erasure attachment locator.');
    } else throw new Error('Invalid erasure target type.');
  }
}
export function erasureSubjectRef(subjectUserId: string) {
  if (!uuid.test(subjectUserId)) throw new Error('Erasure subject must be a UUID.');
  return `hmac-sha256:v1:${mac(`subject-user-id:v1:${subjectUserId.toLowerCase()}`)}`;
}
function normalize(input: ErasureLedgerInput): RecordPayload {
  if (!uuid.test(input.operationId) || !uuid.test(input.subjectUserId)) throw new Error('Erasure operation and subject must be UUIDs.');
  const record: RecordPayload = {
    operationId: input.operationId.toLowerCase(),
    subjectRef: erasureSubjectRef(input.subjectUserId),
    accountFields: [...new Set(input.accountFields)].sort(),
    targets: [...input.targets].map(target => 'fieldPath' in target
      ? { recordId: target.recordId.toLowerCase(), revision: target.revision, fieldPath: [...target.fieldPath] }
      : target.attachmentStore === 'record_attachment'
        ? { recordId: target.recordId.toLowerCase(), revision: target.revision, attachmentStore: target.attachmentStore, attachmentId: target.attachmentId.toLowerCase() }
        : { recordId: target.recordId.toLowerCase(), revision: target.revision, attachmentStore: target.attachmentStore })
      .sort((a, b) => canonical(a).localeCompare(canonical(b))),
  };
  validateRecord(record);
  return record;
}
function headSignature(sequence: number, tail: string) { return mac(`head:v1:${sequence}:${tail}`); }

async function readLedgerState() {
  key();
  const path = ledgerPath();
  const [raw, headRaw] = await Promise.all([readFile(path), readFile(`${path}.head`, 'utf8')]);
  if ((raw.length > 0 && raw[raw.length - 1] !== 10) || raw.length > 50 * 1024 * 1024) throw new Error('Erasure ledger is truncated or exceeds its size limit; restore is blocked.');
  const head = JSON.parse(headRaw) as Head;
  if (head.version !== 1 || !Number.isSafeInteger(head.sequence) || head.sequence < 0 || !/^[a-f0-9]{64}$/.test(head.mac) || !safeEqual(head.signature, headSignature(head.sequence, head.mac))) throw new Error('Erasure ledger head is invalid; restore is blocked.');
  const lines = raw.length ? raw.toString('utf8').slice(0, -1).split('\n') : [];
  const records = new Map<string, ErasureLedgerRecord>();
  let prior = ZERO;
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index] || lines[index].length > 1024 * 1024) throw new Error('Erasure ledger contains an invalid line; restore is blocked.');
    const item = JSON.parse(lines[index]) as Envelope;
    const expected = mac(canonical({ version: item.version, sequence: item.sequence, previous: item.previous, event: item.event }));
    if (item.version !== 1 || item.sequence !== index + 1 || item.previous !== prior || !safeEqual(item.mac, expected)) throw new Error('Erasure ledger chain is invalid; restore is blocked.');
    if (item.event.type === 'prepared') {
      validateRecord(item.event.record);
      const operationId = item.event.record.operationId;
      if (records.has(operationId)) throw new Error('Erasure ledger repeats a prepared operation.');
      records.set(operationId, { ...item.event.record, state: 'prepared' });
    } else if (item.event.type === 'committed' || item.event.type === 'cancelled') {
      if (!uuid.test(item.event.operationId)) throw new Error('Erasure ledger status event has an invalid operation ID.');
      const existing = records.get(item.event.operationId);
      if (!existing || existing.state !== 'prepared') throw new Error('Erasure ledger has an invalid state transition.');
      records.set(item.event.operationId, { ...existing, state: item.event.type });
    } else throw new Error('Erasure ledger has an unsupported event type.');
    prior = item.mac;
  }
  if (head.sequence !== lines.length || head.mac !== prior) throw new Error('Erasure ledger and signed head disagree; explicit recovery is required before restore.');
  return { records: [...records.values()], sequence: lines.length, tail: prior };
}

export async function readErasureLedger(): Promise<ErasureLedgerRecord[]> {
  key();
  return (await readLedgerState()).records;
}

/** Repairs only a valid, authenticated append whose fsynced ledger entry outlived the old signed HEAD. */
export async function recoverErasureLedgerHead() {
  key();
  const path = ledgerPath();
  const raw = await readFile(path);
  const head = JSON.parse(await readFile(`${path}.head`, 'utf8')) as Head;
  if ((raw.length > 0 && raw[raw.length - 1] !== 10) || raw.length > 50 * 1024 * 1024) throw new Error('Erasure ledger is truncated; automatic head recovery refused.');
  if (head.version !== 1 || !Number.isSafeInteger(head.sequence) || head.sequence < 0 || !/^[a-f0-9]{64}$/.test(head.mac) || !safeEqual(head.signature, headSignature(head.sequence, head.mac))) throw new Error('Existing signed head is invalid; automatic recovery refused.');
  const lines = raw.length ? raw.toString('utf8').slice(0, -1).split('\n') : [];
  let prior = ZERO;
  const tails = [ZERO];
  const records = new Map<string, 'prepared' | 'committed' | 'cancelled'>();
  for (let index = 0; index < lines.length; index++) {
    const item = JSON.parse(lines[index]) as Envelope;
    const expected = mac(canonical({ version: item.version, sequence: item.sequence, previous: item.previous, event: item.event }));
    if (!lines[index] || lines[index].length > 1024 * 1024 || item.version !== 1 || item.sequence !== index + 1 || item.previous !== prior || !safeEqual(item.mac, expected)) throw new Error('Erasure ledger chain is corrupt; automatic head recovery refused.');
    if (item.event.type === 'prepared') {
      validateRecord(item.event.record);
      if (records.has(item.event.record.operationId)) throw new Error('Erasure ledger repeats a prepared operation; recovery refused.');
      records.set(item.event.record.operationId, 'prepared');
    } else if (item.event.type === 'committed' || item.event.type === 'cancelled') {
      if (records.get(item.event.operationId) !== 'prepared') throw new Error('Erasure ledger state transition is invalid; recovery refused.');
      records.set(item.event.operationId, item.event.type);
    } else throw new Error('Erasure ledger event is unsupported; recovery refused.');
    prior = item.mac;
    tails.push(prior);
  }
  if (head.sequence > lines.length || tails[head.sequence] !== head.mac) throw new Error('Signed head is not a valid prefix of the ledger; automatic recovery refused.');
  if (head.sequence === lines.length) return { recovered: false, entries: lines.length };
  await writeHead(path, lines.length, prior);
  return { recovered: true, entries: lines.length };
}

async function writeHead(path: string, sequence: number, tail: string) {
  const temp = `${path}.head.${process.pid}.tmp`;
  const data: Head = { version: 1, sequence, mac: tail, signature: headSignature(sequence, tail) };
  const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(`${canonical(data)}\n`); await handle.sync(); } finally { await handle.close(); }
  await rename(temp, `${path}.head`);
  const dir = await open(dirname(path), 'r'); try { await dir.sync(); } finally { await dir.close(); }
}

export async function initializeErasureLedger() {
  key();
  const path = ledgerPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmodPrivate(dirname(path));
  const handle = await open(path, 'wx', 0o600);
  try { await handle.sync(); } finally { await handle.close(); }
  await writeHead(path, 0, ZERO);
  return { path, entries: 0 };
}
async function chmodPrivate(path: string) { const { chmod } = await import('node:fs/promises'); await chmod(path, 0o700); }

async function appendEvent(event: LedgerEvent): Promise<void> {
  key();
  const path = ledgerPath();
  const lock = `${path}.lock`;
  try { await mkdir(lock, { mode: 0o700 }); } catch { throw new Error('Erasure ledger is locked or a previous writer crashed; inspect and recover the lock explicitly.'); }
  try {
    const state = await readLedgerState();
    if (event.type === 'prepared') {
      const existing = state.records.find(item => item.operationId === event.record.operationId);
      if (existing) {
        const { state: status, ...prior } = existing;
        if (canonical(prior) !== canonical(event.record)) throw new Error('Erasure operation ID already exists with different targets.');
        if (status === 'cancelled') throw new Error('Erasure operation was cancelled and cannot be prepared again.');
        return;
      }
    } else {
      const existing = state.records.find(item => item.operationId === event.operationId);
      if (!existing) throw new Error('Erasure operation is missing from the ledger.');
      if (existing.state === event.type) return;
      if (existing.state !== 'prepared') throw new Error(`Erasure operation is already ${existing.state}.`);
    }
    const previous = state.tail;
    const body = { version: 1 as const, sequence: state.sequence + 1, previous, event };
    const envelope: Envelope = { ...body, mac: mac(canonical(body)) };
    const handle = await open(path, 'a', 0o600);
    try { await handle.writeFile(`${canonical(envelope)}\n`); await handle.sync(); } finally { await handle.close(); }
    await writeHead(path, envelope.sequence, envelope.mac);
  } finally { await rm(lock, { recursive: true, force: true }); }
}

export async function appendErasureLedger(input: ErasureLedgerInput): Promise<void> {
  const record = normalize(input);
  await appendEvent({ type: 'prepared', record });
}

async function markErasureLedgerState(operationId: string, next: 'committed' | 'cancelled') {
  if (!uuid.test(operationId)) throw new Error('Erasure operation ID must be a UUID.');
  await appendEvent({ type: next, operationId: operationId.toLowerCase() });
}
export async function markErasureLedgerCommitted(operationId: string) { await markErasureLedgerState(operationId, 'committed'); }
export async function markErasureLedgerCancelled(operationId: string) { await markErasureLedgerState(operationId, 'cancelled'); }

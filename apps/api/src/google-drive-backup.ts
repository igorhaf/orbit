import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { basename } from 'node:path';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';

function configuration() {
  const { ORBIT_DRIVE_CLIENT_ID, ORBIT_DRIVE_CLIENT_SECRET, ORBIT_DRIVE_REFRESH_TOKEN, ORBIT_DRIVE_FOLDER_ID } = process.env;
  if (!ORBIT_DRIVE_CLIENT_ID || !ORBIT_DRIVE_CLIENT_SECRET || !ORBIT_DRIVE_REFRESH_TOKEN || !ORBIT_DRIVE_FOLDER_ID) {
    throw new Error('Configure ORBIT_DRIVE_CLIENT_ID, ORBIT_DRIVE_CLIENT_SECRET, ORBIT_DRIVE_REFRESH_TOKEN and ORBIT_DRIVE_FOLDER_ID before creating backups.');
  }
  return { clientId: ORBIT_DRIVE_CLIENT_ID, clientSecret: ORBIT_DRIVE_CLIENT_SECRET, refreshToken: ORBIT_DRIVE_REFRESH_TOKEN, folderId: ORBIT_DRIVE_FOLDER_ID };
}

async function accessToken() {
  const config = configuration();
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: config.refreshToken, grant_type: 'refresh_token' }),
  });
  const result = await response.json() as { access_token?: string; error_description?: string };
  if (!response.ok || !result.access_token) throw new Error(`Google Drive OAuth failed: ${result.error_description || response.statusText}`);
  return result.access_token;
}

async function uploadFile(token: string, folderId: string, path: string, mimeType: string) {
  const name = basename(path);
  const size = (await stat(path)).size;
  const start = await fetch(`${DRIVE_API}/files?uploadType=resumable&fields=id,name,size,md5Checksum`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-upload-content-type': mimeType, 'x-upload-content-length': String(size) },
    body: JSON.stringify({ name, parents: [folderId], mimeType }),
  });
  if (!start.ok) throw new Error(`Google Drive upload session failed (${start.status}): ${(await start.text()).slice(0, 1000)}`);
  const session = start.headers.get('location');
  if (!session) throw new Error('Google Drive did not return a resumable upload URL.');
  const file = await open(path, 'r');
  const chunkSize = 8 * 1024 * 1024;
  let uploaded: { size?: string; md5Checksum?: string } | undefined;
  try {
    for (let offset = 0; offset < size; offset += chunkSize) {
      const length = Math.min(chunkSize, size - offset);
      const chunk = Buffer.alloc(length);
      await file.read(chunk, 0, length, offset);
      const response = await fetch(session, {
        method: 'PUT', headers: { 'content-length': String(length), 'content-range': `bytes ${offset}-${offset + length - 1}/${size}` }, body: chunk,
      });
      if (response.status === 308 && offset + length < size) continue;
      if (!response.ok) throw new Error(`Google Drive rejected backup data (${response.status}): ${(await response.text()).slice(0, 1000)}`);
      uploaded = await response.json() as { size?: string; md5Checksum?: string };
    }
  } finally { await file.close(); }
  const md5 = createHash('md5');
  for await (const chunk of createReadStream(path)) md5.update(chunk as Buffer);
  if (!uploaded || uploaded.size !== String(size) || uploaded.md5Checksum !== md5.digest('hex')) {
    throw new Error(`Google Drive did not confirm the complete contents of ${name}.`);
  }
}

export async function uploadBackupToGoogleDrive(archivePath: string) {
  const config = configuration();
  const token = await accessToken();
  await uploadFile(token, config.folderId, archivePath, 'application/octet-stream');
  await uploadFile(token, config.folderId, `${archivePath}.manifest.json`, 'application/json');
}

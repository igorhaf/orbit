import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { PoolConfig } from 'pg';
import type { Db } from '../db';
import type { PluginRegistry } from '../execution/registries';
import { PluginSettingsService } from './plugin-settings';
import { createPluginSettingsPrivatePool, type PluginSettingsApproval } from './plugin-settings-boundary';

type RuntimeConfiguration =
  | { mode: 'legacy' }
  | { mode: 'paused' }
  | { mode: 'participant'; approvalFile: string; credentialFile: string };

const identifier = /^[a-z_][a-z_0-9]{0,62}$/;
const domain = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

export function pluginSettingsRuntimeConfiguration(env: NodeJS.ProcessEnv): RuntimeConfiguration {
  const mode = env.ORBIT_PLUGIN_SETTINGS_MODE;
  const approval = env.ORBIT_PLUGIN_SETTINGS_APPROVAL_FILE;
  const credential = env.ORBIT_PLUGIN_SETTINGS_WRITER_CREDENTIAL_FILE;
  const anyFile = approval !== undefined || credential !== undefined;
  if ((mode === undefined || mode === 'legacy') && !anyFile) return { mode: 'legacy' };
  if (mode === 'paused' || (mode === undefined && anyFile)) return { mode: 'paused' };
  if (mode === 'participant' && approval && credential && approval !== credential
    && isAbsolute(approval) && isAbsolute(credential)) {
    return { mode, approvalFile: approval, credentialFile: credential };
  }
  throw new Error('plugin_settings_host_configuration_invalid');
}

async function hostFile(path: string): Promise<Record<string, unknown>> {
  // Open once, then validate the actual descriptor. Reject symlinks and devices.
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await fd.stat();
    const uid = process.getuid?.();
    if (!stat.isFile() || uid === undefined || stat.uid !== uid || (stat.mode & 0o7777) !== 0o600
      || stat.size > 4096 || stat.size === 0) throw new Error('plugin_settings_host_file_invalid');
    const bytes = Buffer.alloc(4097);
    const { bytesRead } = await fd.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== stat.size) throw new Error('plugin_settings_host_file_invalid');
    const parsed: unknown = JSON.parse(bytes.toString('utf8', 0, bytesRead));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('plugin_settings_host_file_invalid');
    return parsed as Record<string, unknown>;
  } finally { await fd.close(); }
}

function proof(input: Record<string, unknown>): PluginSettingsApproval {
  const { version, database, generalRole, writerRole, ownerRole, generationDomain, minimumRevision } = input;
  const allowed = ['version', 'database', 'generalRole', 'writerRole', 'ownerRole', 'generationDomain', 'minimumRevision'];
  if (Object.keys(input).some(key => !allowed.includes(key)) || version !== 1
    || (database !== 'orbit_native_dev' && database !== 'orbit_r5ca_fixture')
    || typeof generalRole !== 'string' || !identifier.test(generalRole)
    || typeof writerRole !== 'string' || !identifier.test(writerRole)
    || typeof ownerRole !== 'string' || !identifier.test(ownerRole)
    || new Set([generalRole, writerRole, ownerRole]).size !== 3
    || typeof generationDomain !== 'string' || !domain.test(generationDomain)
    || (minimumRevision === undefined && database === 'orbit_native_dev')
    || (minimumRevision !== undefined && (typeof minimumRevision !== 'string'
      || !/^(0|[1-9][0-9]{0,18})$/.test(minimumRevision) || BigInt(minimumRevision) > 9223372036854775807n))) {
    throw new Error('plugin_settings_host_approval_invalid');
  }
  return { database, generalRole, writerRole, ownerRole, generationDomain, minimumRevision };
}

function writerConnection(input: Record<string, unknown>, approval: PluginSettingsApproval): PoolConfig {
  const { host, port, database, user, password } = input;
  if (Object.keys(input).some(key => !['host', 'port', 'database', 'user', 'password'].includes(key))
    || typeof host !== 'string'
    || !(host === '127.0.0.1' || host === '::1' || /^\/[a-zA-Z0-9_./-]+$/.test(host))
    || typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535
    || database !== approval.database || user !== approval.writerRole
    || (password !== undefined && (typeof password !== 'string' || password.length === 0))
    || (!host.startsWith('/') && (typeof password !== 'string' || database === 'orbit_r5ca_fixture'))) {
    throw new Error('plugin_settings_writer_credential_invalid');
  }
  return { host, port, database, user, password: typeof password === 'string' ? password : async () => '' };
}

export async function composePluginSettingsHost(
  db: Db, registry: PluginRegistry, defaults: ReadonlyMap<string, boolean>,
  notify: (id: string) => void | Promise<void>, env: NodeJS.ProcessEnv,
) {
  const config = pluginSettingsRuntimeConfiguration(env);
  if (config.mode === 'legacy' || config.mode === 'paused') {
    return PluginSettingsService.beforeCutover(db, registry, defaults, notify, config.mode);
  }
  try {
    const approval = proof(await hostFile(config.approvalFile));
    const credentials = writerConnection(await hostFile(config.credentialFile), approval);
    return await PluginSettingsService.participant(db, createPluginSettingsPrivatePool(credentials),
      registry, defaults, notify, 5000, approval);
  } catch {
    // Credentials and file paths must not be included in startup logs.
    throw new Error('plugin_settings_participant_startup_refused');
  }
}

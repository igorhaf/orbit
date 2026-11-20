export const PLUGIN_ID = 'cloudflare-tunnel';
export type TunnelConfig = {
  tunnelName: string; tunnelId: string; publicHostname: string;
  mode: 'remote' | 'local' | 'quick'; executablePath: string; configPath: string; quickUrl: string;
  managedBy: 'orbit' | 'system'; autoStart: boolean; restartOnFailure: boolean;
  restartDelaySeconds: number; maxRestartAttempts: number; restartWindowSeconds: number; logLimit: number;
};
export const defaults: TunnelConfig = {
  tunnelName: '', tunnelId: '', publicHostname: '',
  mode: 'remote', executablePath: 'auto', configPath: '', quickUrl: 'http://127.0.0.1:4000',
  managedBy: 'orbit', autoStart: false, restartOnFailure: true,
  restartDelaySeconds: 5, maxRestartAttempts: 5, restartWindowSeconds: 300, logLimit: 1000,
};
export function parseConfiguration(input: unknown): TunnelConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Configuração inválida.');
  const values = input as Record<string, unknown>;
  if (Object.keys(values).some(key => !Object.hasOwn(defaults,key))) throw new Error('Campo de configuração desconhecido.');
  const config = {...defaults, ...values};
  if (!['remote', 'local', 'quick'].includes(config.mode) || !['orbit', 'system'].includes(config.managedBy)) throw new Error('Modo ou administrador inválido.');
  for (const key of ['autoStart', 'restartOnFailure'] as const) if (typeof config[key] !== 'boolean') throw new Error('Opção de execução inválida.');
  for (const key of ['tunnelName', 'tunnelId', 'publicHostname', 'executablePath', 'configPath', 'quickUrl'] as const) if (typeof config[key] !== 'string' || config[key].length > 4096 || /[\r\n\0]/.test(config[key])) throw new Error('Caminho ou URL inválido.');
  if(config.tunnelId&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(config.tunnelId))throw new Error('ID do tunnel inválido.');
  if(config.publicHostname&&(config.publicHostname.length>253||!config.publicHostname.includes('.')||!config.publicHostname.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))))throw new Error('Hostname público inválido. Use somente o domínio, sem protocolo ou caminho.');
  if (config.executablePath !== 'auto' && !config.executablePath.startsWith('/')) throw new Error('Use auto ou um caminho absoluto para cloudflared.');
  for (const [key, min, max] of [['restartDelaySeconds',1,300],['maxRestartAttempts',0,20],['restartWindowSeconds',10,86400],['logLimit',50,1000]] as const) {
    if (!Number.isInteger(config[key]) || config[key] < min || config[key] > max) throw new Error(`Valor inválido: ${key}.`);
  }
  if (config.mode === 'quick' && config.autoStart) throw new Error('Quick Tunnel é temporário e não permite inicialização automática.');
  return config;
}
export function validateOrigin(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('URL local inválida.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash || (url.port && (+url.port < 1 || +url.port > 65535))) throw new Error('Use uma URL HTTP/HTTPS com porta válida e sem credenciais ou parâmetros.');
  return url.toString();
}
export type ProcessIdentity = {pid: number; executable: string; startTicks: string; marker: string; metricsPort: number; startedAt: string};
export type TunnelState = 'DISABLED' | 'NOT_INSTALLED' | 'NOT_CONFIGURED' | 'STOPPED' | 'STARTING' | 'CONNECTED' | 'STOPPING' | 'DEGRADED' | 'ERROR';

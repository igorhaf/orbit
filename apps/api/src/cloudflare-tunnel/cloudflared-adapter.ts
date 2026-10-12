import {spawn, execFile, ChildProcess} from 'node:child_process';
import {promisify} from 'node:util';
import {access, readFile, realpath, readlink, readdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {homedir} from 'node:os';
import {basename, join, resolve, dirname, isAbsolute} from 'node:path';
import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import {parse} from 'yaml';
import {ProcessIdentity, TunnelConfig, validateOrigin} from './configuration';
import {redact} from './redaction';

export type Detection = {installed: boolean; path: string | null; version: string | null};
export type Launch = {process: ChildProcess; identity: ProcessIdentity};
export interface ProcessAdapter {
  detect(path: string): Promise<Detection>;
  validate(config: TunnelConfig, token: string, detection: Detection): Promise<void>;
  launch(config: TunnelConfig, token: string, detection: Detection): Promise<Launch>;
  matches(identity: ProcessIdentity): Promise<boolean>;
  stop(identity: ProcessIdentity): Promise<void>;
  external(): Promise<number | null>;
  ready(identity: ProcessIdentity): Promise<boolean>;
}
export const parseVersion = (output: string) => /cloudflared version\s+([\w.+-]+)/i.exec(output)?.[1] || null;
const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
const expand = (path: string) => path.startsWith('~/') ? join(homedir(),path.slice(2)) : resolve(path);
async function readable(path: string, message: string) {try {await access(path, constants.R_OK);} catch {throw new Error(message);}}
async function identity(pid: number) {
  try {
    const [stat, executable, env] = await Promise.all([readFile(`/proc/${pid}/stat`, 'utf8'), realpath(`/proc/${pid}/exe`), readFile(`/proc/${pid}/environ`, 'utf8')]);
    const startTicks = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[19];
    const marker = env.split('\0').find(value => value.startsWith('ORBIT_CLOUDFLARED_INSTANCE='))?.slice('ORBIT_CLOUDFLARED_INSTANCE='.length);
    return startTicks && marker ? {pid, executable, startTicks, marker} : null;
  } catch {return null;}
}
export class CloudflaredAdapter implements ProcessAdapter {
  constructor(private execute: (binary:string,args:string[],options:{timeout:number;maxBuffer:number;shell:false;cwd?:string})=>Promise<{stdout:string;stderr:string}> = (binary,args,options)=>promisify(execFile)(binary,args,options)) {}
  async detect(path: string): Promise<Detection> {
    const candidates = path === 'auto' ? (process.env.PATH || '').split(':').filter(Boolean).map(folder => join(folder,'cloudflared')) : [path];
    for (const candidate of candidates) {
      try {
        await access(candidate, constants.X_OK); const binary = await realpath(candidate);
        const result = await this.execute(binary, ['version'], {timeout:5000, maxBuffer:16384, shell:false});
        const version = parseVersion(result.stdout + result.stderr);
        if (version) return {installed:true, path:binary, version};
      } catch {continue;}
    }
    return {installed:false, path:null, version:null};
  }
  async validate(config: TunnelConfig, token: string, detection: Detection) {
    if (!detection.installed || !detection.path) throw new Error('cloudflared não encontrado. Instale-o explicitamente ou informe o caminho correto.');
    if (config.mode === 'remote') {if (!token || /\s/.test(token)) throw new Error('Configure um Tunnel Token válido.'); return;}
    if (config.mode === 'quick') {validateOrigin(config.quickUrl); return;}
    if (!config.configPath) throw new Error('Informe o arquivo de configuração local.');
    const configPath = expand(config.configPath);
    await readable(configPath, 'Arquivo de configuração local ausente ou sem permissão.');
    let value: {tunnel?:unknown; 'credentials-file'?:unknown; ingress?:Array<{service?:unknown;originRequest?:{noTLSVerify?:unknown}}>;originRequest?:{noTLSVerify?:unknown}};
    try {const content = await readFile(configPath,'utf8'); if (content.length > 1_000_000) throw new Error(); value = parse(content);} catch {throw new Error('Arquivo YAML inválido.');}
    if (!value || typeof value.tunnel !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.tunnel) || typeof value['credentials-file'] !== 'string') throw new Error('A configuração local exige UUID do tunnel e credentials-file.');
    const credentialsPath = value['credentials-file'].startsWith('~/') ? expand(value['credentials-file']) : isAbsolute(value['credentials-file']) ? value['credentials-file'] : resolve(dirname(configPath), value['credentials-file']);
    await readable(credentialsPath, 'Arquivo de credenciais ausente ou sem permissão.');
    try {const credentials = JSON.parse(await readFile(credentialsPath,'utf8')); if (credentials.TunnelID !== value.tunnel || !credentials.TunnelSecret || !credentials.AccountTag) throw new Error();} catch {throw new Error('Credenciais locais inválidas ou de outro tunnel.');}
    if (!Array.isArray(value.ingress) || !value.ingress.length) throw new Error('Configure ao menos uma regra ingress.');
    if (value.originRequest?.noTLSVerify === true || value.ingress.some(rule => rule.originRequest?.noTLSVerify === true)) throw new Error('A validação TLS deve permanecer habilitada.');
    for (const rule of value.ingress) {
      if (typeof rule.service !== 'string') throw new Error('Regra ingress sem serviço.');
      if (/^https?:/.test(rule.service)) validateOrigin(rule.service);
    }
    try {await this.execute(detection.path, ['tunnel','--config',configPath,'ingress','validate'], {timeout:10000,maxBuffer:65536,shell:false});} catch {throw new Error('cloudflared rejeitou a configuração ingress. Confira o arquivo e a versão instalada.');}
  }
  async launch(config: TunnelConfig, token: string, detection: Detection): Promise<Launch> {
    if (!detection.path) throw new Error('cloudflared não encontrado.');
    if (process.platform !== 'linux') throw new Error('Gerenciamento seguro de processos requer Linux com /proc.');
    const server = createServer();
    await new Promise<void>((done,reject) => {server.once('error',reject);server.listen(0,'127.0.0.1',done);});
    const metricsPort = (server.address() as {port:number}).port;
    await new Promise<void>(done => server.close(() => done()));
    const marker = randomUUID();
    const args = ['tunnel','--no-autoupdate','--metrics',`127.0.0.1:${metricsPort}`];
    if (config.mode === 'local') args.push('--config',expand(config.configPath),'run');
    else if (config.mode === 'quick') args.push('--url',config.quickUrl);
    else args.push('run');
    const env: NodeJS.ProcessEnv = {PATH:process.env.PATH, HOME:homedir(), LANG:process.env.LANG || 'C.UTF-8', TMPDIR:process.env.TMPDIR, ORBIT_CLOUDFLARED_INSTANCE:marker};
    if (config.mode === 'remote') env.TUNNEL_TOKEN = token;
    const child = spawn(detection.path,args,{env,cwd:config.mode==='local'?dirname(expand(config.configPath)):undefined,stdio:['ignore','pipe','pipe'],shell:false});
    // Attach immediately: an asynchronous spawn error must never reach the Orbit process unhandled.
    child.on('error', () => {});
    await new Promise<void>((done,reject) => {child.once('spawn',done);child.once('error',() => reject(new Error('Não foi possível iniciar cloudflared.')));});
    for (let attempt=0;attempt<10;attempt++) {
      const found = child.pid ? await identity(child.pid) : null;
      if (found && found.marker === marker && found.executable === detection.path) return {process:child,identity:{...found,metricsPort,startedAt:new Date().toISOString()}};
      await sleep(20);
    }
    child.kill('SIGTERM');
    throw new Error('Não foi possível comprovar a identidade do processo iniciado.');
  }
  async matches(expected: ProcessIdentity) {const actual = await identity(expected.pid);return Boolean(actual && actual.startTicks === expected.startTicks && actual.executable === expected.executable && actual.marker === expected.marker);}
  async stop(expected: ProcessIdentity) {
    if (!await this.matches(expected)) throw new Error('A identidade do processo mudou; nenhum sinal foi enviado.');
    process.kill(expected.pid,'SIGTERM');
    for (let n=0;n<50;n++) {if (!await this.matches(expected)) return; await sleep(100);}
    if (await this.matches(expected)) process.kill(expected.pid,'SIGKILL');
    for (let n=0;n<20;n++) {if (!await this.matches(expected)) return; await sleep(100);}
    throw new Error('cloudflared não confirmou o encerramento.');
  }
  async external() {
    if (process.platform !== 'linux') return null;
    try {for (const pid of await readdir('/proc')) {if (!/^\d+$/.test(pid)) continue; try {if (basename(await readlink(`/proc/${pid}/exe`)) === 'cloudflared') return +pid;} catch {continue;}}} catch {return null;}
    return null;
  }
  async ready(expected: ProcessIdentity) {
    try {const result = await fetch(`http://127.0.0.1:${expected.metricsPort}/ready`,{signal:AbortSignal.timeout(1500)});return result.status === 200;} catch {return false;}
  }
}
export const safeProcessError = (error: unknown, token: string) => redact(error instanceof Error ? error.message : 'Falha no processo cloudflared.',token).slice(0,300);

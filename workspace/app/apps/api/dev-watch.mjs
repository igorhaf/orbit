import { watch } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Client } from 'pg';

const apiRoot = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(apiRoot, '../..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const debounceMs = 1_500;
const pollMs = 2_000;

let apiProcess;
let stopping = false;
let rebuilding = false;
let restartPending = false;
let waitingMessageShown = false;
let changeRevision = 0;
let debounceTimer;
let pollTimer;
let killTimer;
const watchers = [];

function launchApi() {
  if (stopping) return;
  console.log('[DEV API] Iniciando API compilada.');
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: apiRoot,
    env: process.env,
    stdio: 'inherit',
  });
  apiProcess = child;
  child.once('error', error => console.error('[DEV API] Não foi possível iniciar a API.', error));
  child.once('exit', (code, signal) => {
    if (apiProcess !== child) return;
    apiProcess = undefined;
    if (stopping || rebuilding) return;
    console.error(`[DEV API] Processo encerrou (código ${code ?? '-'}, sinal ${signal ?? '-'}). Reiniciando em 2s.`);
    setTimeout(launchApi, 2_000).unref();
  });
}

function runApiBuild() {
  return new Promise(resolveBuild => {
    console.log('[DEV API] Compilando alterações…');
    const build = spawn(npm, ['run', 'build', '-w', 'apps/api'], {
      cwd: appRoot,
      env: process.env,
      stdio: 'inherit',
    });
    build.once('error', error => {
      console.error('[DEV API] Não foi possível iniciar o build.', error);
      resolveBuild(false);
    });
    build.once('exit', code => resolveBuild(code === 0));
  });
}

async function hasActiveCardWork() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 3_000,
    query_timeout: 3_000,
  });
  try {
    await client.connect();
    const result = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM card_ai_runs WHERE status IN ('queued', 'running')
        UNION ALL
        SELECT 1 FROM card_runs WHERE status IN ('queued', 'running')
      ) AS active
    `);
    return Boolean(result.rows[0]?.active);
  } finally {
    await client.end().catch(() => undefined);
  }
}

function scheduleCheck() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void reconcileChanges(), debounceMs);
}

function deferUntilIdle() {
  if (!waitingMessageShown) {
    console.log('[DEV API] Alteração detectada; aguardando as execuções de cartão terminarem antes de reiniciar.');
    waitingMessageShown = true;
  }
  if (!pollTimer) {
    pollTimer = setInterval(() => void reconcileChanges(), pollMs);
    pollTimer.unref();
  }
}

async function stopApi() {
  const child = apiProcess;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(resolveStop => {
    const finish = () => {
      clearTimeout(killTimer);
      resolveStop();
    };
    child.once('exit', finish);
    child.kill('SIGTERM');
    killTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      killTimer = setTimeout(finish, 1_000);
    }, 5_000);
    killTimer.unref();
  });
}

async function reconcileChanges() {
  if (stopping || rebuilding || !restartPending) return;
  let active;
  try {
    active = await hasActiveCardWork();
  } catch (error) {
    console.error('[DEV API] Não foi possível consultar execuções ativas; mantendo a API e tentando novamente.', error);
    deferUntilIdle();
    return;
  }
  if (active) {
    deferUntilIdle();
    return;
  }

  rebuilding = true;
  const builtRevision = changeRevision;
  const built = await runApiBuild();
  if (!built) {
    console.error('[DEV API] Build falhou; a instância atual continua ativa. Corrija o erro para tentar novamente.');
    restartPending = false;
    rebuilding = false;
    return;
  }
  if (builtRevision !== changeRevision) {
    rebuilding = false;
    scheduleCheck();
    return;
  }

  try {
    // Recheck after compilation so a prompt started during the build is not interrupted.
    if (await hasActiveCardWork()) {
      rebuilding = false;
      deferUntilIdle();
      return;
    }
  } catch (error) {
    console.error('[DEV API] Não foi possível confirmar que a fila está livre; mantendo a API ativa.', error);
    rebuilding = false;
    deferUntilIdle();
    return;
  }

  restartPending = false;
  waitingMessageShown = false;
  clearInterval(pollTimer);
  pollTimer = undefined;
  await stopApi();
  rebuilding = false;
  launchApi();
  console.log('[DEV API] Alterações compiladas e API recarregada.');
  if (builtRevision !== changeRevision) {
    restartPending = true;
    scheduleCheck();
  }
}

function sourceChanged(_event, filename) {
  if (filename && String(filename).startsWith('.')) return;
  changeRevision++;
  restartPending = true;
  scheduleCheck();
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearTimeout(debounceTimer);
  clearInterval(pollTimer);
  for (const watcher of watchers) watcher.close();
  await stopApi();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

try {
  watchers.push(watch(resolve(apiRoot, 'src'), { recursive: true }, sourceChanged));
  watchers.push(watch(resolve(apiRoot, 'package.json'), sourceChanged));
  watchers.push(watch(resolve(apiRoot, 'tsconfig.json'), sourceChanged));
} catch (error) {
  console.error('[DEV API] Não foi possível iniciar a observação dos arquivos.', error);
  process.exit(1);
}

console.log('[DEV API] Observando apps/api/src; alterações aguardam a fila de cartões ficar livre.');
if (await runApiBuild()) launchApi();
else {
  console.error('[DEV API] Build inicial falhou; tentando iniciar a última versão compilada.');
  launchApi();
}

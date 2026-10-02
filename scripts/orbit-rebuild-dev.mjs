import { spawn } from 'node:child_process';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(process.env.ORBIT_DEVELOPMENT_ROOT || scriptRoot);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const clean = process.argv.includes('--clean');
const fronts = [
  ['Banco', ['run', 'db:prepare']],
  ['API', ['run', 'build', '-w', 'apps/api']],
  ['Web', ['run', 'build', '-w', 'apps/web']],
];

const database = async () => {
  let connection = process.env.DATABASE_URL || '';
  try {
    const env = await readFile(resolve(root, 'apps/api/.env'), 'utf8');
    connection ||= env.match(/^DATABASE_URL=(?:"([^"]+)"|'([^']+)'|([^\n]+))/m)?.slice(1).find(Boolean) || '';
  } catch {
    // DATABASE_URL is optional when the caller provides PG* variables.
  }
  let parsed;
  try {
    parsed = connection ? new URL(connection) : null;
  } catch {
    throw new Error('DATABASE_URL inválida.');
  }
  const host = process.env.PGHOST || parsed?.hostname || '127.0.0.1';
  const port = process.env.PGPORT || parsed?.port || '5432';
  const name = process.env.PGDATABASE || (parsed?.pathname ? parsed.pathname.slice(1) : 'orbit');
  const ready = () => new Promise((resolveReady, reject) => {
    const child = spawn('pg_isready', ['-h', host, '-p', port, '-d', name], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let error = '';
    child.stderr.on('data', chunk => { error += chunk; });
    child.on('error', errorValue => reject(new Error(`Não foi possível verificar o PostgreSQL: ${errorValue.message}`)));
    child.on('close', code => code === 0 ? resolveReady() : reject(new Error(`PostgreSQL indisponível em ${host}:${port}${error.trim() ? ` — ${error.trim()}` : '.'}`)));
  });
  const start = (command, args) => new Promise(resolveStart => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let error = '';
    child.stderr.on('data', chunk => { error += chunk; });
    const timer = setTimeout(() => { child.kill('SIGTERM'); resolveStart(`${command}: tempo esgotado`); }, 10_000);
    child.on('error', errorValue => { clearTimeout(timer); resolveStart(`${command}: ${errorValue.message}`); });
    child.on('close', code => { clearTimeout(timer); resolveStart(code === 0 ? '' : `${command}: código ${code}${error.trim() ? ` — ${error.trim()}` : ''}`); });
  });
  console.log(`[rebuild-dev] Banco: verificando PostgreSQL em ${host}:${port}/${name}`);
  try {
    await ready();
  } catch (initialError) {
    console.log('[rebuild-dev] Banco: indisponível; tentando iniciar o serviço PostgreSQL');
    const commands = process.platform === 'darwin'
      ? [['brew', ['services', 'start', 'postgresql']]]
      : [['systemctl', ['start', 'postgresql']], ['service', ['postgresql', 'start']]];
    const failures = [];
    for (const [command, args] of commands) {
      const result = await start(command, args);
      if (!result) break;
      failures.push(result);
    }
    for (let attempt = 0; attempt < 15; attempt++) {
      try { await ready(); console.log('[rebuild-dev] Banco: serviço iniciado e disponível'); return; } catch { await new Promise(resolveDelay => setTimeout(resolveDelay, 1000)); }
    }
    throw new Error(`${initialError.message} Não foi possível iniciar o serviço automaticamente${failures.length ? ` (${failures.join('; ')})` : '.'}`);
  }
  console.log('[rebuild-dev] Banco: disponível');
};

const run = (name, args) => new Promise((resolveRun, reject) => {
  console.log(`[rebuild-dev] ${name}: iniciando`);
  const child = spawn(npm, args, { cwd: root, stdio: 'inherit', env: process.env });
  child.on('error', reject);
  child.on('close', code => {
    if (code === 0) {
      console.log(`[rebuild-dev] ${name}: concluído`);
      resolveRun();
      return;
    }
    reject(new Error(`${name} terminou com código ${code ?? 'desconhecido'}.`));
  });
});

let failed = false;
try {
  await database();
} catch (error) {
  failed = true;
  console.error(`[rebuild-dev] Banco: falhou — ${error instanceof Error ? error.message : error}`);
}
if(!failed&&clean){
  console.log('[rebuild-dev] Limpeza: removendo artefatos compilados da API e da Web');
  try{
    await Promise.all([
      rm(resolve(root,'apps/api/dist'),{recursive:true,force:true}),
      rm(resolve(root,'apps/web/.next'),{recursive:true,force:true}),
    ]);
    console.log('[rebuild-dev] Limpeza: concluída');
  }catch(error){
    failed=true;
    console.error(`[rebuild-dev] Limpeza: falhou — ${error instanceof Error?error.message:error}`);
  }
}
for (const [name, args] of fronts) {
  if (failed) break;
  try {
    await run(name, args);
  } catch (error) {
    failed = true;
    console.error(`[rebuild-dev] ${name}: falhou — ${error instanceof Error ? error.message : error}`);
    break;
  }
}

if (failed) {
  console.error('[rebuild-dev] rebuild interrompido.');
  process.exitCode = 1;
} else {
  const requestId=`${process.pid}-${Date.now()}`;
  const request=resolve(root,'.orbit-dev-restart-request');
  const temporaryRequest=`${request}.${requestId}.tmp`;
  const acknowledgement=resolve(root,'.orbit-dev-restart-ack');
  await writeFile(temporaryRequest,`${requestId}\n`,'utf8');
  await rename(temporaryRequest,request);
  for(let attempt=0;attempt<20;attempt++){
    try{if((await readFile(acknowledgement,'utf8')).trim()===requestId)break;}catch{/* The manager has not acknowledged it yet. */}
    await new Promise(resolveDelay=>setTimeout(resolveDelay,250));
    if(attempt===19)throw new Error('O gerenciador do Orbit DEV não confirmou o reinício.');
  }
  console.log('[rebuild-dev] todas as frentes foram recompiladas; o gerenciador confirmou o reinício do dev.');
}

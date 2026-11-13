import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { captureFileScope } from './file-scope';
import { runManagedProcess } from './managed-process';
import { runProjectChecks } from './project-checks';
import { redact } from './security';
import { extractPromptQuestion } from '../prompt-question';

export type AutomationReview = { accepted: boolean; note: string; [key: string]: unknown };
type AutomationResult = { ok?: boolean; blocked?: boolean; repairable?: boolean; repairPrompt?: string; error?: string; diagnostics?: unknown; status?: string; [key: string]: unknown };
export type OrbitAutomationOptions = {
  projectRoot: string;
  request: string;
  mode?: 'implementation' | 'read-only';
  permissions?: string[];
  writeScope?: string[];
  multipleAgents?: boolean;
  runId?: string;
  signal?: AbortSignal;
  onHeartbeat?: () => Promise<boolean | void> | boolean | void;
  progress?: (message: string) => void;
};
export interface OrbitAutomationDriver {
  id: string;
  prompt: string;
  maxRepairs: number;
  reconcile(): Promise<AutomationResult>;
  finish(review: AutomationReview | null, summary: string, requiredChecksPassed: boolean): Promise<AutomationResult>;
  pause(): Promise<void>;
  abort(message: string): Promise<void>;
  close(): Promise<void>;
}

async function isFile(path: string) { try { return (await stat(path)).isFile(); } catch { return false; } }

/** Locates the actual checkout from either its root or an individual product. */
export async function findOrbitWorkspace(projectPath: string): Promise<string | null> {
  const project = await realpath(projectPath);
  let current = project;
  while (true) {
    if (await isFile(join(current, 'orbit.workspace.json')) && await isFile(join(current, 'tools/orbit/cli.mjs'))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const configured = process.env.ORBIT_WORKSPACE_ROOT;
  if (configured) {
    const root = await realpath(configured);
    const child = relative(root, project);
    if (child !== '..' && !child.startsWith('../') && await isFile(join(root, 'orbit.workspace.json')) && await isFile(join(root, 'tools/orbit/cli.mjs'))) return root;
  }
  return null;
}

export function automationReview(text: string): { output: string; review: AutomationReview | null } {
  const pattern = /\[\[ORBIT_AUTOMATION_REVIEW\]\]\s*([\s\S]*?)\s*\[\[\/ORBIT_AUTOMATION_REVIEW\]\]/g;
  const matches = [...text.matchAll(pattern)];
  const output = text.replace(pattern, '').trim();
  if (matches.length !== 1 || matches[0][1].length > 20_000) return { output, review: null };
  try {
    const value = JSON.parse(matches[0][1]) as AutomationReview;
    if (!value || typeof value !== 'object' || typeof value.accepted !== 'boolean' || typeof value.note !== 'string' || !value.note.trim() || value.note.length > 8_000) return { output, review: null };
    return { output, review: value };
  } catch { return { output, review: null }; }
}

export async function prepareOrbitAutomation(options: OrbitAutomationOptions): Promise<OrbitAutomationDriver | null> {
  const permissions = options.permissions || ['filesystem.read', 'filesystem.write', 'process.execute'];
  if (!permissions.includes('filesystem.read') || !permissions.includes('process.execute')) return null;
  const root = await findOrbitWorkspace(options.projectRoot);
  if (!root) return null;
  const config = JSON.parse(await readFile(join(root, 'orbit.workspace.json'), 'utf8')) as { automation?: { enabled?: boolean; maxRepairAttempts?: number } };
  if (config.automation?.enabled === false) return null;
  const directory = await mkdtemp(join(tmpdir(), 'orbit-automation-'));
  const file = join(directory, 'request.json');
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const payload = { id: options.runId || randomUUID(), projectPath: await realpath(options.projectRoot), request: options.request, permissions, writeScope: options.writeScope, multipleAgents: options.multipleAgents === true, mode: options.mode || 'implementation' };
  const call = async (operation: string, extra: Record<string, unknown> = {}): Promise<AutomationResult> => {
    await writeFile(file, JSON.stringify({ ...payload, ...extra }), { mode: 0o600 });
    const heartbeat = setInterval(() => { void Promise.resolve(options.onHeartbeat?.()).then(active => { if (active === false) controller.abort(); }).catch(() => controller.abort()); }, 5_000);
    heartbeat.unref();
    try {
      const result = await runManagedProcess(process.execPath, [join(root, 'tools/orbit/cli.mjs'), 'workflow', operation, '--input-file', file], { cwd: root, timeoutMs: 180_000, maxOutputBytes: 512 * 1024, signal: controller.signal });
      try {
        const value = JSON.parse(result.stdout) as AutomationResult;
        if (result.code !== 0 && value.ok !== false) throw new Error(result.stderr || 'Workflow exited without a valid failure report.');
        return value;
      } catch (error) { throw new Error(`Automação Orbit: ${redact((result.stderr || (error as Error).message).slice(-3_000))}`); }
    } finally { clearInterval(heartbeat); }
  };
  const cleanup = async () => { options.signal?.removeEventListener('abort', abort); await rm(directory, { recursive: true, force: true }); };
  try {
    options.progress?.('Preparando automaticamente capacidades e contexto do projeto…');
    const prepared = await call('prepare');
    if (prepared.ok === false) throw new Error(`Preparação automática bloqueada: ${String(prepared.error || prepared.diagnostics || prepared.status || 'verifique o relatório do workflow')}`);
    const id = typeof prepared.id === 'string' ? prepared.id : payload.id;
    payload.id = id;
    const configuredRetries = config.automation?.maxRepairAttempts ?? 2;
    return {
      id,
      prompt: typeof prepared.prompt === 'string' ? prepared.prompt : '',
      maxRepairs: Math.max(0, Math.min(3, Number.isInteger(configuredRetries) ? configuredRetries : 2)),
      reconcile: () => call('reconcile'),
      finish: (review, summary, requiredChecksPassed) => call('finish', { review, summary, requiredChecksPassed }),
      pause: async () => { await call('pause'); },
      abort: async message => { if (!controller.signal.aborted) await call('abort', { error: message }); },
      close: cleanup,
    };
  } catch (error) { await cleanup(); throw error; }
}

type DevelopmentExecution<T> = OrbitAutomationOptions & {
  run: (prompt: string, previous?: T) => Promise<T>;
  getText: (result: T) => string;
  setText?: (result: T, text: string) => T;
  checks?: string[][];
  allowQuestions?: boolean;
  /** Internal adapter injection for deterministic tests and other local executors. */
  automationFactory?: (options: OrbitAutomationOptions) => Promise<OrbitAutomationDriver | null>;
};

/** One demand, same actor/scope; automatic resource preparation, checks and bounded repair. */
export async function executeOrbitDevelopment<T>(options: DevelopmentExecution<T>): Promise<T> {
  const permissions = options.permissions || ['filesystem.read', 'filesystem.write', 'process.execute'];
  const readOnly = options.mode === 'read-only' || !permissions.includes('filesystem.write');
  const mode = readOnly ? 'read-only' : 'implementation';
  const driver = await (options.automationFactory || prepareOrbitAutomation)({ ...options, permissions, mode });
  const scope = readOnly ? [] : options.writeScope;
  const verify = scope === undefined ? null : await captureFileScope(options.projectRoot, scope);
  const checks = options.checks || [];
  let previous: T | undefined;
  let repair = '';
  let sourceViolation = false;
  const assertActive = () => { if (options.signal?.aborted) throw new Error('Execução cancelada.'); };
  const verifyScope = async () => { if (verify) try { await verify(); } catch (error) { sourceViolation = true; throw error; } };
  try {
    for (let attempt = 0; attempt <= (driver?.maxRepairs || 0); attempt++) {
      assertActive();
      const scoped = scope === undefined ? '' : `ESCRITA LIMITADA A ESTES ARQUIVOS (alterações externas serão revertidas e falharão a execução):\n${scope.join('\n') || '(nenhum arquivo; análise somente leitura)'}\n\n`;
      const instruction = `${scoped}${driver?.prompt || ''}\n\n${options.request}${repair ? `\n\nCORREÇÃO AUTOMÁTICA DA MESMA DEMANDA:\n${repair}\nCorrija dentro das mesmas permissões e escopo. Preserve o trabalho aprovado e revalide apenas o impacto da correção.` : ''}`;
      const result = await options.run(instruction, previous);
      previous = result;
      await verifyScope();
      const parsed = automationReview(options.getText(result));
      if (options.allowQuestions && extractPromptQuestion(parsed.output)) {
        await driver?.pause();
        return options.setText ? options.setText(result, parsed.output) : result;
      }
      try {
        if (!readOnly && driver) {
          const reconciliation = await driver.reconcile();
          if (reconciliation.ok === false) {
            sourceViolation = reconciliation.blocked === true;
            throw new Error(`Sincronização automática bloqueada: ${String(reconciliation.error || reconciliation.diagnostics || JSON.stringify(reconciliation))}`);
          }
          await verifyScope();
        }
        if (checks.length) {
          options.progress?.('Executando as verificações obrigatórias do projeto…');
          const heartbeat = setInterval(() => { void Promise.resolve(options.onHeartbeat?.()).catch(() => undefined); }, 5_000);
          heartbeat.unref();
          try { await runProjectChecks(options.projectRoot, checks); } finally { clearInterval(heartbeat); }
          await verifyScope();
        }
        assertActive();
        if (driver) {
          options.progress?.('Verificando automaticamente as alterações e as evidências…');
          const finished = await driver.finish(parsed.review, parsed.output, true);
          if (finished.ok === false) {
            if (finished.repairable === false || finished.blocked) sourceViolation = true;
            throw new Error(finished.repairPrompt || finished.error || JSON.stringify(finished.diagnostics || finished));
          }
        }
        await verifyScope();
        return options.setText ? options.setText(result, parsed.output) : result;
      } catch (error) {
        if (!driver || sourceViolation || attempt >= driver.maxRepairs || readOnly || options.signal?.aborted) throw error;
        repair = redact((error instanceof Error ? error.message : String(error)).slice(-8_000));
        options.progress?.(`A verificação encontrou uma pendência; corrigindo automaticamente (${attempt + 1}/${driver.maxRepairs})…`);
      }
    }
    throw new Error('A execução não produziu uma entrega verificada.');
  } catch (error) {
    if (verify) {
      if (checks.length || driver) { const restored = await verify.rollback(); if (restored.length) options.progress?.('As alterações da tentativa reprovada foram restauradas.'); }
      else await verify();
    }
    await driver?.abort(redact((error instanceof Error ? error.message : String(error)).slice(-4_000))).catch(() => undefined);
    throw error;
  } finally { await driver?.close(); }
}

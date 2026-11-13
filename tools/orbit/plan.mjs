import { readFileSync } from 'node:fs';
import { safePath } from './shared.mjs';

const finite = (value, label) => {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a nonnegative number.`);
  return value;
};
const prefix = path => path.replace(/\/+$/, '').replace(/\*.*$/, '');
const conflict = (left, right) => {
  const a = prefix(left), b = prefix(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`) || (left.includes('*') && b.startsWith(a)) || (right.includes('*') && a.startsWith(b));
};

export function planDemand(spec) {
  if (!spec || !Array.isArray(spec.tasks) || !spec.tasks.length) throw new Error('A demand requires a nonempty tasks array.');
  const tasks = spec.tasks.map(task => {
    if (!task.id || typeof task.id !== 'string' || !Array.isArray(task.files) || !task.files.length) throw new Error('Each task requires id and explicit files.');
    for (const path of task.files) if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) throw new Error(`Invalid task scope: ${path}`);
    if (spec.writeScope && task.files.some(path => !spec.writeScope.includes(path))) throw new Error(`Task ${task.id} exceeds context.write_scope; use exact authorized file paths.`);
    return { ...task, dependsOn: task.dependsOn || [], minutes: finite(task.minutes, `${task.id}.minutes`), tokens: finite(task.tokens, `${task.id}.tokens`) };
  });
  const byId = new Map(tasks.map(task => [task.id, task]));
  if (byId.size !== tasks.length) throw new Error('Task identifiers must be unique.');
  for (const task of tasks) for (const dependency of task.dependsOn) if (!byId.has(dependency) || dependency === task.id) throw new Error(`Invalid dependency: ${task.id} -> ${dependency}`);
  const slots = spec.maxAgents ?? 3;
  if (!Number.isInteger(slots) || slots < 1 || slots > 32) throw new Error('maxAgents must be an integer from 1 to 32.');
  function schedule(limit) {
    const complete = new Set(), waves = [], collisions = [];
    while (complete.size < tasks.length) {
      const ready = tasks.filter(task => !complete.has(task.id) && task.dependsOn.every(id => complete.has(id)));
      if (!ready.length) throw new Error('Task dependency cycle.');
      const wave = [];
      for (const task of ready) {
        const blocking = wave.find(other => task.files.some(path => other.files.some(otherPath => conflict(path, otherPath))));
        if (blocking) collisions.push({ tasks: [blocking.id, task.id], reason: 'Overlapping write scopes require sequential integration.' });
        else if (wave.length < limit) wave.push(task);
      }
      wave.forEach(task => complete.add(task.id));
      waves.push(wave);
    }
    return { waves, collisions };
  }
  const sequentialMinutes = spec.singleAgentMinutes ?? tasks.reduce((sum, task) => sum + task.minutes, 0);
  const coordinationMinutes = finite(spec.coordinationMinutes ?? 0, 'coordinationMinutes');
  const coordinationTokens = finite(spec.coordinationTokens ?? 0, 'coordinationTokens');
  finite(sequentialMinutes, 'singleAgentMinutes');
  if (spec.singleAgentTokens !== undefined) finite(spec.singleAgentTokens, 'singleAgentTokens');
  const parallelTokens = tasks.reduce((sum, task) => sum + task.tokens, 0) + coordinationTokens;
  const enabled = spec.multipleAgents !== false;
  const tokenEvidence = spec.singleAgentTokens !== undefined;
  const candidates = Array.from({ length: slots }, (_, i) => schedule(i + 1));
  const elapsed = entry => entry.waves.reduce((sum, wave) => sum + Math.max(...wave.map(task => task.minutes)), 0) + coordinationMinutes;
  const selected = enabled && tokenEvidence && parallelTokens < spec.singleAgentTokens ? candidates.find(entry => entry.waves.some(wave => wave.length > 1) && elapsed(entry) < sequentialMinutes) : null;
  const { waves, collisions } = selected || candidates.at(-1);
  const parallelMinutes = elapsed(selected || candidates.at(-1));
  const qualifies = Boolean(selected);
  const reason = !enabled ? 'The card disabled multiple agents.' : !tokenEvidence ? 'Provide singleAgentTokens to assess total token savings before delegating.' : qualifies ? 'Independent scopes and supplied estimates predict lower elapsed time and fewer total tokens.' : 'The supplied estimates do not establish savings in both time and total tokens.';
  return {
    recommendation: qualifies ? 'multiple_agents' : 'single_agent', reason,
    estimates: { measured: false, sequentialMinutes, sequentialTokens: spec.singleAgentTokens ?? null, parallelMinutes, parallelTokens, coordinationMinutes, coordinationTokens },
    maxConcurrentWorkers: qualifies ? Math.max(...waves.map(wave => wave.length)) : 1,
    waves: qualifies ? waves.map(wave => wave.map(task => task.id)) : waves.flat().map(task => [task.id]), collisions,
    integrator: 'Responsible for the complete objective, contracts, integration, required checks and final review.',
    requiredChecks: spec.requiredChecks || [],
    functionalReview: 'Required at each delivery milestone; completed commands do not prove all acceptance criteria.',
    permissionPolicy: 'Delegation preserves card permissions, exact write_scope, checks, and budgets. Git and deployment require their own authorization.',
  };
}

export async function execute(command, args, { root }) {
  const index = args.indexOf('--spec');
  if (index < 0 || !args[index + 1]) throw new Error('Use plan --spec <relative-demand.json>. Estimates are supplied data, not measurements.');
  return planDemand(JSON.parse(readFileSync(safePath(root, args[index + 1]), 'utf8')));
}

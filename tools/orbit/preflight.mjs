import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { inspectShared, safePath } from './shared.mjs';
import { buildCatalog, runtimeImports } from './catalog.mjs';

const ranks = { PASS: 0, WARN: 1, NOT_VERIFIED: 2, BLOCK: 3 };
export const aggregate = findings => findings.reduce((status, item) => ranks[item.status] > ranks[status] ? item.status : status, 'PASS');

/** No cache, application import, external process except read-only Git, or mutation. */
export function preflight({ root, config }, runtimeId) {
  const findings = [], projections = [], imports = [], runtimes = [];
  const add = (status, code, detail = {}) => findings.push({ status, code, ...detail });
  const selected = config.runtimes.filter(item => !runtimeId || item.id === runtimeId);
  if (!selected.length) throw new Error(`Unknown runtime: ${runtimeId}`);
  // Validate paths before any scanner reads them. Do not accept runtime symlinks.
  for (const runtime of selected) safePath(root, `${runtime.app}/apps/api/src`);
  let git;
  try {
    const readGit = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
    const changes = readGit(['status', '--porcelain=v1', '-z', '--untracked-files=all']).split('\0').filter(Boolean);
    git = { head: readGit(['rev-parse', 'HEAD']).trim(), branch: readGit(['branch', '--show-current']).trim(), changes };
    add(changes.length ? 'WARN' : 'PASS', 'working-tree', { changes, message: 'Local changes are preserved; no update is authorized by preflight.' });
  } catch { add('NOT_VERIFIED', 'git-unavailable'); }
  for (const runtime of selected) {
    try {
      const state = inspectShared({ root, config }, runtime.id);
      for (const item of state.diagnostics) add('BLOCK', item.code, item);
      for (const file of state.projectionStates) {
        const status = file.actual === file.canonical ? 'PASS' : 'BLOCK';
        const classification = status === 'PASS' ? 'synchronized' : file.actual === file.locked && file.locked !== null ? 'stale-projection' : 'independent-change-unclassified';
        projections.push({ ...file, status, classification, automaticUpdate: false });
        if (status !== 'PASS') add(status, file.actual === null ? 'missing-projection' : classification, { runtime: runtime.id, path: file.path, message: 'Declared canonical ownership conflicts with runtime. BLOCK prevents overwriting, not a claim that product behavior is wrong.' });
      }
      for (const lock of state.locks) add('BLOCK', 'stale-lock', { runtime: runtime.id, path: lock.path });
      if (!state.diagnostics.length && !state.projections.length && !state.locks.length) add('PASS', 'shared-integrity', { runtime: runtime.id });
    } catch (error) { add('BLOCK', 'shared-inspection-failed', { runtime: runtime.id, message: error.message }); }
  }
  let catalog;
  try {
    catalog = buildCatalog(root, { ...config, runtimes: selected }, undefined, { cache: false });
    for (const item of catalog.diagnostics) {
      // Different product contracts require review, not automatic normalization.
      const status = item.code === 'divergent-plugin-contract' ? 'WARN' : /unresolved|unavailable/.test(item.code) ? 'NOT_VERIFIED' : item.severity === 'error' ? 'BLOCK' : 'WARN';
      add(status, item.code, item);
    }
    for (const runtime of catalog.runtimes) {
      runtimes.push({ id: runtime.id, coreVersion: runtime.coreVersion, plugins: runtime.plugins });
      if (!runtime.diagnostics.length) add('PASS', 'declared-plugin-contracts', { runtime: runtime.id });
      let ajv;
      try { const require = createRequire(resolve(root, selected.find(item => item.id === runtime.id).app, 'package.json')); const Ajv = require('ajv'); ajv = new Ajv({ allErrors: true }); }
      catch { add('NOT_VERIFIED', 'schema-validator-unavailable', { runtime: runtime.id }); }
      for (const plugin of runtime.plugins) if (plugin.unresolvedContracts.length) add('NOT_VERIFIED', 'unresolved-contract-fields', { runtime: runtime.id, plugin: plugin.id, fields: plugin.unresolvedContracts });
      if (ajv) for (const plugin of runtime.plugins) {
        if (plugin.unresolvedContracts.length) continue;
        const known = new Set(plugin.capabilities.map(item => item.id));
        for (const action of plugin.actions) {
          for (const capability of action.requiredCapabilities || []) if (!known.has(capability)) add('BLOCK', 'missing-action-capability', { runtime: runtime.id, plugin: plugin.id, action: action.id, capability });
          for (const field of ['inputSchema', 'outputSchema']) {
            if (action[field] === undefined && field === 'outputSchema') continue;
            if (action[field] === undefined) { add('NOT_VERIFIED', 'unresolved-action-schema', { runtime: runtime.id, plugin: plugin.id, action: action.id, field }); continue; }
            try { ajv.compile(action[field]); } catch (error) { add('BLOCK', 'invalid-action-schema', { runtime: runtime.id, plugin: plugin.id, action: action.id, field, message: error.message }); }
          }
        }
      }
      if (ajv) for (const plugin of runtime.plugins.filter(item => !item.unresolvedContracts.length)) for (const [kind, definition] of Object.entries(plugin.contributions.recordKinds || {})) {
        if (definition.schema === undefined) { add('NOT_VERIFIED', 'unresolved-record-schema', { runtime: runtime.id, plugin: plugin.id, kind }); continue; }
        try { ajv.compile(definition.schema); } catch (error) { add('BLOCK', 'invalid-record-schema', { runtime: runtime.id, plugin: plugin.id, kind, message: error.message }); }
      }
      const entry = selected.find(item => item.id === runtime.id);
      const edges = runtimeImports(root, entry);
      // Imports are compile dependencies; do not equate them to declared runtime dependencies.
      const aiPrefix = `${entry.app}/apps/api/src/plugins/ai/`;
      const direct = edges.filter(edge => edge.to.startsWith(aiPrefix) && !edge.from.startsWith(aiPrefix));
      imports.push(...direct.map(edge => ({ runtime: runtime.id, kind: 'direct-ai-import', ...edge })));
      if (direct.length) add('WARN', 'direct-ai-imports', { runtime: runtime.id, count: direct.length, message: 'Compilation edges, not proof of missing declarative dependency or authorization failure.' });
      add('NOT_VERIFIED', 'live-plugin-state', { runtime: runtime.id, message: 'Database enablement, installation, Nest bootstrap and provider availability are not inspected.' });
    }
  } catch (error) { add('NOT_VERIFIED', 'catalog-inspection-failed', { message: error.message }); }
  add('NOT_VERIFIED', 'runtime-owned-product-differences', { message: 'Unmapped runtime files have no canonical ownership assertion; product-specific differences require review, never automatic copying.' });
  const requiredChecks = [
    { command: 'node --test tools/orbit/preflight.test.mjs tools/orbit/catalog.test.mjs tools/orbit/shared.test.mjs', safety: 'isolated filesystem fixtures' },
    { command: 'node scripts/verify-plugin-compatibility.mjs', safety: 'static read-only checker; existing failures are preserved' },
    { command: 'node --test tools/orbit/registry-foundation.test.mjs', safety: 'synthetic PluginRegistry; no application bootstrap or database' },
  ];
  const status = aggregate(findings);
  return { schemaVersion: 1, operation: 'preflight', readOnly: true, written: false, ok: status !== 'BLOCK' && status !== 'NOT_VERIFIED', status, target: runtimeId || 'all', git, summary: Object.fromEntries(Object.keys(ranks).map(status => [status, findings.filter(item => item.status === status).length])), findings, projections, runtimes, imports, requiredChecks, promotionReady: false };
}

export function formatText(result) {
  return [`Orbit preflight: ${result.status} (target=${result.target}, readOnly=true)`, ...result.findings.map(item => `${item.status} ${item.code}${item.runtime ? ` [${item.runtime}]` : ''}${item.path ? ` ${item.path}` : ''}${item.message ? `: ${item.message}` : ''}`), 'Checks recommended (not executed):', ...result.requiredChecks.map(item => `  ${item.command}`)].join('\n');
}
export async function execute(command, args, context) {
  let runtime;
  for (let i = 0; i < args.length; i++) {
    const key = args[i], value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`${key} requires a value`);
    if (key === '--runtime') runtime = value;
    else if (key === '--format' && ['json', 'text'].includes(value)) { /* CLI renders without changing the result schema. */ }
    else throw new Error(`Unknown preflight argument: ${key} ${value}`);
  }
  return preflight(context, runtime);
}

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { isReusableFile } from './generate.mjs';

const ignoredDirectories = new Set(['node_modules', '.next', '.next-native-dev', '.next-native-build', 'dist', 'coverage', '.git', 'data', 'backups', 'sessions', 'validations', 'secrets', 'credentials', 'cache']);
const hash = value => createHash('sha256').update(value).digest('hex');

export function classifyReconciliationFile({ baselineHash = null, targetHash = null, sourceHash = null, transformed = false, productManaged = false, migration = false }) {
  if (transformed) return 'generated-transformation';
  if (migration) return 'migration-review';
  if (productManaged) return 'product-managed';
  if (targetHash && sourceHash && targetHash === sourceHash) return 'aligned';
  if (!sourceHash) return targetHash ? 'target-only' : 'removed-upstream';
  if (!targetHash) return baselineHash ? 'target-deleted' : 'source-only';
  if (baselineHash && targetHash === baselineHash) return 'upstream-change';
  if (baselineHash && sourceHash === baselineHash) return 'target-change';
  return 'conflict';
}

function isProductManagedPath(path) {
  return path === '.env.example' || path === '.orbit/runtime.json' || path === 'orbit.shared-lock.json'
    || path === 'package.json' || path === 'package-lock.json' || /(?:^|\/)package(?:-lock)?\.json$/.test(path)
    || /(?:^|\/)next-env\.d\.ts$/.test(path);
}

function isMigrationPath(path) {
  return /^apps\/api\/sql\/migrations\/.+\.sql$/.test(path) || path === 'apps/api/sql/schema.sql';
}

function safePath(root, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || relativePath.includes('\\') || relativePath.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid reconciliation path: ${relativePath}`);
  }
  const base = resolve(root), full = resolve(base, relativePath);
  if (full === base || !full.startsWith(base + sep)) throw new Error(`Path escapes root: ${relativePath}`);
  let part = base;
  for (const segment of relative(base, full).split(sep)) {
    part = resolve(part, segment);
    if (existsSync(part) && lstatSync(part).isSymbolicLink()) throw new Error(`Symlink in reconciliation path: ${relativePath}`);
  }
  return full;
}

function scanFiles(root, directory, prefix = '') {
  const files = new Set();
  if (!existsSync(directory)) return files;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) for (const file of scanFiles(root, resolve(directory, entry.name), rel)) files.add(file);
    } else if (entry.isFile() && isReusableFile(rel)
      && (!/^\.env(?:\..*)?$/.test(entry.name) || entry.name === '.env.example')
      && !/^\.orbit-(?:deploy|dev|restart|manager)/.test(entry.name)) files.add(rel);
  }
  return files;
}

function fileHash(root, path) {
  const absolute = safePath(root, path);
  return existsSync(absolute) && lstatSync(absolute).isFile() ? hash(readFileSync(absolute)) : null;
}

function pushSample(samples, status, path) {
  if (!samples[status]) samples[status] = [];
  if (samples[status].length < 30) samples[status].push(path);
}

export function auditProductReconciliation({ root, runtime, baseRuntime }) {
  if (!runtime || !baseRuntime || runtime.id === baseRuntime.id) throw new Error('A target runtime and a distinct base runtime are required.');
  const productRoot = dirname(safePath(root, runtime.app));
  const profilePath = resolve(productRoot, 'product.profile.json');
  const manifestPath = resolve(productRoot, 'generation.manifest.json');
  if (!existsSync(profilePath) || !existsSync(manifestPath)) throw new Error(`Generated product profile and lineage manifest are required for ${runtime.id}.`);
  const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (profile.id !== runtime.id || profile.app !== runtime.app) throw new Error(`Product profile does not match configured runtime ${runtime.id}.`);
  if (manifest.generator !== 'orbit.generate.product' || !Array.isArray(manifest.files)) throw new Error(`Unsupported lineage manifest for ${runtime.id}.`);

  const baseline = new Map(manifest.files.filter(item => item.path.startsWith('app/')).map(item => [item.path.slice(4), item.sha256]));
  const transformed = new Set((manifest.transformations || []).map(item => item.path.startsWith('app/') ? item.path.slice(4) : item.path));
  const targetRoot = safePath(root, runtime.app);
  const baseRoot = safePath(root, baseRuntime.app);
  const sourceFiles = scanFiles(root, baseRoot);
  const targetFiles = scanFiles(root, targetRoot);
  const knownPaths = new Set([...baseline.keys(), ...sourceFiles, ...targetFiles]);
  const counts = {};
  const samples = {};
  let generatedBaselineCurrent = 0;
  let generatedBaselineChanged = 0;

  for (const path of [...knownPaths].sort()) {
    const baselineHash = baseline.get(path) || null;
    const targetHash = targetFiles.has(path) ? fileHash(root, `${runtime.app}/${path}`) : null;
    const sourceHash = sourceFiles.has(path) ? fileHash(root, `${baseRuntime.app}/${path}`) : null;
    if (baselineHash) {
      if (targetHash === baselineHash) generatedBaselineCurrent++;
      else generatedBaselineChanged++;
    }
    const status = classifyReconciliationFile({ baselineHash, targetHash, sourceHash, transformed: transformed.has(path), productManaged: isProductManagedPath(path), migration: isMigrationPath(path) });
    counts[status] = (counts[status] || 0) + 1;
    pushSample(samples, status, path);
  }

  return {
    ok: true,
    mode: 'read-only-audit',
    target: runtime.id,
    base: baseRuntime.id,
    lineage: { basedOn: profile.basedOn, sourceApp: manifest.source?.app, sourceCommit: manifest.source?.commit, sourceMode: manifest.source?.mode, sourceDirty: manifest.source?.dirty },
    baseline: { files: baseline.size, current: generatedBaselineCurrent, changed: generatedBaselineChanged },
    counts,
    samples,
    writes: [],
    note: 'No files are changed. Product-only files and upstream removals are reported for review; this command is not a merge or approval.'
  };
}

function parse(args) {
  const positionals = [], flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) { positionals.push(arg); continue; }
    const [key, ...inline] = arg.slice(2).split('=');
    if (!['runtime', 'base'].includes(key)) throw new Error(`Unknown reconciliation option: --${key}.`);
    const value = inline.length ? inline.join('=') : args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Value required for --${key}.`);
    flags[key] = value;
  }
  return { positionals, flags };
}

export async function execute(_command, args, context) {
  const { positionals, flags } = parse(args);
  if (positionals.length !== 1 || positionals[0] !== 'product' || !flags.runtime) {
    throw new Error('Use reconcile product --runtime <product-id> [--base <runtime-id>].');
  }
  const target = context.config.runtimes.find(item => item.id === flags.runtime);
  if (!target) throw new Error(`Unknown target runtime: ${flags.runtime}.`);
  const baseId = flags.base || JSON.parse(readFileSync(safePath(context.root, `${dirname(target.app)}/product.profile.json`), 'utf8')).basedOn;
  const base = context.config.runtimes.find(item => item.id === baseId);
  if (!base) throw new Error(`Unknown base runtime: ${baseId}.`);
  return auditProductReconciliation({ root: context.root, runtime: target, baseRuntime: base });
}

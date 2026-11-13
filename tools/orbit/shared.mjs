import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const digest = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const compareVersion = (left, right) => {
  const a = left.split('.').map(Number), b = right.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

export function safePath(root, value) {
  if (typeof value !== 'string' || !value || isAbsolute(value) || value.includes('\\') || value.split('/').some(part => part === '..' || part === '.git')) throw new Error(`Unsafe workspace path: ${value}`);
  const target = resolve(root, value);
  if (target === resolve(root) || relative(root, target).startsWith(`..${sep}`)) throw new Error(`Path escapes workspace: ${value}`);
  let current = target;
  while (current !== resolve(root)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error(`Symlink is not a source or projection: ${value}`);
    current = dirname(current);
  }
  return target;
}

function atomic(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const mode = existsSync(path) ? lstatSync(path).mode & 0o777 : undefined;
    writeFileSync(temporary, contents, { flag: 'wx', ...(mode === undefined ? {} : { mode }) });
    renameSync(temporary, path);
  } finally { if (existsSync(temporary)) rmSync(temporary, { force: true }); }
}

/** Persists an already authorized plan, restoring every attempted destination on failure. */
export function persistSharedPlan(root, entries, { atomicWrite = atomic } = {}) {
  const originals = new Map();
  for (const entry of entries) {
    const path = safePath(root, entry.path);
    const contents = existsSync(path) ? readFileSync(path) : null;
    if ((contents === null ? null : digest(contents)) !== entry.before) throw new Error(`Shared release precondition changed: ${entry.path}`);
    originals.set(entry.path, contents);
  }
  const attempted = [];
  try {
    for (const entry of entries) {
      const path = safePath(root, entry.path);
      const current = existsSync(path) ? digest(readFileSync(path)) : null;
      if (current !== entry.before) throw new Error(`Shared release precondition changed: ${entry.path}`);
      attempted.push(entry);
      atomicWrite(path, entry.contents);
    }
  } catch (cause) {
    const rollbackFailures = [];
    for (const entry of attempted.reverse()) {
      try {
        const path = safePath(root, entry.path), original = originals.get(entry.path);
        const current = existsSync(path) ? digest(readFileSync(path)) : null;
        if (current !== digest(entry.contents) && current !== entry.before) throw new Error('Destination changed independently during persistence; preserve the newer contents.');
        if (original === null) rmSync(path, { force: true });
        else atomic(path, original);
      } catch (error) { rollbackFailures.push({ path: entry.path, message: error.message }); }
    }
    const error = new Error(`Shared release persistence failed: ${cause.message}${rollbackFailures.length ? '; some originals could not be restored' : '; original destinations restored'}`, { cause });
    error.rollbackFailures = rollbackFailures;
    throw error;
  }
}

export function packageSnapshot(root, pkg) {
  const metadata = JSON.parse(readFileSync(safePath(root, `${pkg.path}/package.json`), 'utf8'));
  if (metadata.name !== pkg.id || metadata.version !== pkg.version || !/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error(`Package identity/version differs from workspace: ${pkg.id}`);
  if (JSON.stringify(metadata.orbit?.files) !== JSON.stringify(pkg.files)) throw new Error(`Package projection manifest differs from workspace: ${pkg.id}`);
  const files = pkg.files.map(file => {
    safePath(root, file.target);
    const contents = readFileSync(safePath(root, `${pkg.path}/${file.source}`));
    return { ...file, sha256: digest(contents), contents };
  });
  const integrity = digest(json(files.map(({ source, target, sha256 }) => ({ source, target, sha256 }))));
  return { id: pkg.id, version: pkg.version, integrity, files };
}

export function inspectShared({ root, config }, selected) {
  const packages = config.sharedPackages.map(pkg => packageSnapshot(root, pkg));
  const runtimes = selected ? config.runtimes.filter(runtime => runtime.id === selected) : config.runtimes;
  if (!runtimes.length) throw new Error(`Unknown runtime: ${selected}`);
  const diagnostics = [], projections = [], locks = [];
  const targets = new Set();
  for (const pkg of packages) for (const file of pkg.files) {
    if (targets.has(file.target)) throw new Error(`Two packages own the same projection: ${file.target}`);
    targets.add(file.target);
  }
  for (const runtime of runtimes) {
    const path = `${runtime.app}/orbit.shared-lock.json`;
    const lockPath = safePath(root, path);
    const old = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : null;
    const next = { schemaVersion: 1, runtime: runtime.id, packages: [] };
    for (const pkg of packages) {
      const previous = old?.packages?.find(item => item.id === pkg.id);
      if (previous && compareVersion(pkg.version, previous.version) < 0) diagnostics.push({ code: 'version-regression', runtime: runtime.id, package: pkg.id, message: 'A shared source version cannot be downgraded implicitly.' });
      if (previous && previous.integrity !== pkg.integrity && previous.version === pkg.version) diagnostics.push({ code: 'version-not-bumped', runtime: runtime.id, package: pkg.id, message: `Bump ${pkg.id} version before publishing changed sources.` });
      for (const target of Object.keys(previous?.files || {})) if (!pkg.files.some(file => file.target === target)) diagnostics.push({ code: 'removed-projection', runtime: runtime.id, package: pkg.id, path: `${runtime.app}/${target}`, message: 'Removing a projection requires an explicit migration of its imports and ownership.' });
      const entry = { id: pkg.id, version: pkg.version, integrity: pkg.integrity, files: {} };
      for (const file of pkg.files) {
        const target = `${runtime.app}/${file.target}`;
        const targetPath = safePath(root, target);
        const actual = existsSync(targetPath) ? digest(readFileSync(targetPath)) : null;
        const before = previous?.files?.[file.target];
        const changed = actual !== file.sha256;
        if (changed && actual !== null && actual !== before) diagnostics.push({ code: 'local-drift', runtime: runtime.id, path: target, message: 'Projection has independent changes; reconcile with canonical source before synchronizing.' });
        if (changed) projections.push({ path: target, contents: file.contents, package: pkg.id });
        entry.files[file.target] = file.sha256;
      }
      next.packages.push(entry);
    }
    if (json(old) !== json(next)) locks.push({ path, contents: json(next) });
  }
  return { packages, diagnostics, projections, locks };
}

const validVersion = value => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
function incrementVersion(version, release) {
  const parts = version.split('.').map(Number), index = ['major', 'minor', 'patch'].indexOf(release);
  parts[index]++;
  for (let position = index + 1; position < 3; position++) parts[position] = 0;
  return parts.join('.');
}

/** Finishes a shared source edit inside the execution's existing file and project boundaries. */
export async function reconcileShared(context, options = {}) {
  const { root } = context;
  const release = options.release || 'patch';
  const diagnostics = [], releases = [], entries = [], requiredScope = [];
  const result = () => ({ ok: diagnostics.length === 0 && requiredScope.length === 0, mode: options.allowWrite === true ? 'apply' : 'plan', written: false, changedPaths: entries.map(entry => entry.path), writePaths: entries.map(entry => entry.path), requiresWrite: entries.length > 0, requiredScope, diagnostics, releases });
  const diagnostic = (code, message, extra = {}) => diagnostics.push({ code, message, ...extra });
  if (!['patch', 'minor', 'major'].includes(release)) { diagnostic('invalid-release', 'Use patch, minor or major for a shared release.'); return { ...result(), blocked: 'diagnostics' }; }
  let raw, rawHash, configPath, projectRoot, changedFiles;
  try {
    configPath = safePath(root, 'orbit.workspace.json');
    const rawContents = readFileSync(configPath, 'utf8');
    raw = JSON.parse(rawContents); rawHash = digest(rawContents);
    if (!Array.isArray(raw.sharedPackages) || !Array.isArray(raw.runtimes)) throw new Error('Workspace sharedPackages/runtimes must be arrays.');
    if (options.projectRoot !== undefined && !isAbsolute(options.projectRoot)) throw new Error('projectRoot must be an absolute directory.');
    projectRoot = resolve(options.projectRoot || root);
    if (existsSync(projectRoot)) projectRoot = realpathSync(projectRoot);
    if (options.changedFiles !== undefined && !Array.isArray(options.changedFiles)) throw new Error('changedFiles must be an array of exact workspace-relative file paths.');
    changedFiles = new Set((options.changedFiles || []).map(path => relative(realpathSync(root), safePath(root, path)).split(sep).join('/')));
  } catch (error) { diagnostic('invalid-context', error.message); return { ...result(), blocked: 'diagnostics' }; }

  // Runtime discovery is in-memory only: persist the raw workspace file, never its expanded products.
  const runtimes = new Map(raw.runtimes.map(runtime => [runtime.id, runtime]));
  for (const runtime of context.config.runtimes || []) {
    const previous = runtimes.get(runtime.id);
    if (previous && previous.app !== runtime.app) diagnostic('runtime-path-conflict', 'A discovered runtime changes an existing runtime path.', { runtime: runtime.id });
    else runtimes.set(runtime.id, runtime);
  }
  if (!runtimes.size) diagnostic('missing-runtimes', 'Shared reconciliation requires at least one configured runtime.');
  const locks = new Map(), snapshots = [], targets = new Set(), ownedPackages = new Set();
  for (const runtime of runtimes.values()) {
    try {
      safePath(root, runtime.app);
      const path = `${runtime.app}/orbit.shared-lock.json`, absolute = safePath(root, path);
      const contents = existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
      const lock = contents === null ? null : JSON.parse(contents);
      if (lock && (lock.schemaVersion !== 1 || lock.runtime !== runtime.id || !Array.isArray(lock.packages))) throw new Error('Invalid shared lock identity/schema.');
      locks.set(runtime.id, { path, value: lock, before: contents === null ? null : digest(contents) });
    } catch (error) { diagnostic('invalid-lock', error.message, { runtime: runtime.id }); }
  }
  for (const pkg of raw.sharedPackages) {
    try {
      if (ownedPackages.has(pkg.id)) throw new Error('Duplicate shared package identity.');
      ownedPackages.add(pkg.id);
      const snapshot = packageSnapshot(root, pkg);
      for (const file of snapshot.files) {
        if (targets.has(file.target)) throw new Error(`Multiple packages own projection ${file.target}.`);
        targets.add(file.target);
      }
      const metadataContents = readFileSync(safePath(root, `${pkg.path}/package.json`), 'utf8');
      snapshots.push({ pkg, snapshot, metadataPath: `${pkg.path}/package.json`, metadata: JSON.parse(metadataContents), metadataHash: digest(metadataContents) });
    } catch (error) { diagnostic('invalid-package', error.message, { package: pkg.id }); }
  }
  for (const [runtime, lock] of locks) for (const previous of lock.value?.packages || []) {
    if (!ownedPackages.has(previous.id)) diagnostic('removed-package', 'Removing shared ownership requires an explicit migration; no projected code will be deleted.', { runtime, package: previous.id });
    if (!validVersion(previous.version) || typeof previous.integrity !== 'string' || !previous.files || typeof previous.files !== 'object' || Array.isArray(previous.files)) diagnostic('invalid-lock-package', 'Shared lock package metadata is invalid.', { runtime, package: previous.id });
  }
  if (diagnostics.length) return { ...result(), blocked: 'diagnostics' };

  function add(path, contents, owner) {
    const absolute = safePath(root, path);
    if (existsSync(absolute) && !lstatSync(absolute).isFile()) throw new Error(`Shared destination is not a regular file: ${path}`);
    const current = existsSync(absolute) ? readFileSync(absolute) : null;
    if (current !== null && digest(current) === digest(contents)) return;
    const previous = entries.find(entry => entry.path === path);
    if (previous) {
      if (digest(previous.contents) !== digest(contents)) throw new Error(`Conflicting shared writes: ${path}`);
      return;
    }
    entries.push({ path, contents, before: current === null ? null : digest(current), owner });
  }

  let workspaceChanged = false;
  for (const state of snapshots) {
    const { pkg, snapshot, metadata, metadataPath } = state;
    const previous = [...locks].flatMap(([runtime, lock]) => (lock.value?.packages || []).filter(item => item.id === pkg.id).map(item => ({ ...item, runtime })));
    const latestVersion = previous.reduce((version, item) => version === null || compareVersion(item.version, version) > 0 ? item.version : version, null);
    const latest = previous.filter(item => item.version === latestVersion);
    if (new Set(latest.map(item => item.integrity)).size > 1) diagnostic('conflicting-lock-integrity', 'Runtimes disagree on a shared package release; reconcile its history explicitly.', { package: pkg.id });
    if (latestVersion && compareVersion(pkg.version, latestVersion) < 0) diagnostic('version-regression', 'A shared source version cannot be downgraded implicitly.', { package: pkg.id, version: pkg.version, previous: latestVersion });
    for (const item of previous) for (const target of Object.keys(item.files)) if (!snapshot.files.some(file => file.target === target)) diagnostic('removed-projection', 'Removing a projection requires an explicit migration of its imports and ownership.', { package: pkg.id, runtime: item.runtime, path: `${runtimes.get(item.runtime).app}/${target}` });
    const baseline = latest[0];
    const sourceChanged = !baseline || baseline.integrity !== snapshot.integrity;
    const metadataAttributed = changedFiles.has(metadataPath) || changedFiles.has('orbit.workspace.json');
    if (sourceChanged) {
      const differences = snapshot.files.filter(file => baseline?.files[file.target] !== file.sha256);
      for (const file of differences) {
        const source = `${pkg.path}/${file.source}`;
        const newMapping = baseline && baseline.files[file.target] === undefined;
        if (!changedFiles.has(source) && !(newMapping && metadataAttributed)) diagnostic('unattributed-source-change', 'This canonical source change is not attributed to the current execution; leave it untouched.', { package: pkg.id, path: source });
      }
      if (!differences.length && !metadataAttributed) diagnostic('unattributed-mapping-change', 'The canonical mapping changed outside the current execution.', { package: pkg.id, path: metadataPath });
    } else if (latestVersion && pkg.version !== latestVersion && !metadataAttributed) {
      diagnostic('unattributed-version-change', 'The pending version change is not attributed to the current execution.', { package: pkg.id, path: metadataPath });
    }
    if (sourceChanged && latestVersion && pkg.version === latestVersion && !diagnostics.some(item => item.package === pkg.id)) {
      const next = incrementVersion(pkg.version, release);
      releases.push({ id: pkg.id, previous: pkg.version, next, increment: release, automatic: true });
      pkg.version = next; metadata.version = next; snapshot.version = next; workspaceChanged = true;
      try { add(metadataPath, json(metadata), pkg.id); } catch (error) { diagnostic('invalid-destination', error.message, { package: pkg.id, path: metadataPath }); }
    } else if (latestVersion && compareVersion(pkg.version, latestVersion) > 0 && !diagnostics.some(item => item.package === pkg.id)) {
      releases.push({ id: pkg.id, previous: latestVersion, next: pkg.version, automatic: false });
    }
    for (const runtime of runtimes.values()) {
      const before = locks.get(runtime.id)?.value?.packages.find(item => item.id === pkg.id);
      for (const file of snapshot.files) {
        const path = `${runtime.app}/${file.target}`;
        try {
          const absolute = safePath(root, path);
          if (existsSync(absolute) && !lstatSync(absolute).isFile()) throw new Error('Projected destination is not a regular file.');
          const actual = existsSync(absolute) ? digest(readFileSync(absolute)) : null;
          const oldHash = before?.files[file.target];
          if (actual !== file.sha256 && ((actual !== null && actual !== oldHash) || (actual === null && oldHash !== undefined))) {
            diagnostic('local-drift', 'Projection has an independent edit or deletion; reconcile it explicitly before releasing.', { runtime: runtime.id, package: pkg.id, path });
          } else if (actual !== file.sha256) add(path, file.contents, pkg.id);
        } catch (error) { diagnostic('invalid-destination', error.message, { runtime: runtime.id, package: pkg.id, path }); }
      }
    }
    const pendingPriorRelease = [...locks.values()].some(lock => {
      const before = lock.value?.packages.find(item => item.id === pkg.id);
      return !before || before.version !== snapshot.version || before.integrity !== snapshot.integrity;
    });
    const attributed = metadataAttributed || snapshot.files.some(file => changedFiles.has(`${pkg.path}/${file.source}`));
    if (!sourceChanged && pendingPriorRelease && !attributed) diagnostic('unattributed-pending-release', 'A prior release has pending runtimes outside the current execution; leave them unchanged.', { package: pkg.id });
  }
  if (!diagnostics.length) {
    try {
      if (workspaceChanged) add('orbit.workspace.json', json(raw), 'workspace');
      for (const runtime of runtimes.values()) {
        const next = { schemaVersion: 1, runtime: runtime.id, packages: snapshots.map(({ snapshot }) => ({ id: snapshot.id, version: snapshot.version, integrity: snapshot.integrity, files: Object.fromEntries(snapshot.files.map(file => [file.target, file.sha256])) })) };
        const lock = locks.get(runtime.id);
        if (!isDeepStrictEqual(lock.value, next)) add(lock.path, json(next), 'lock');
      }
    } catch (error) { diagnostic('invalid-destination', error.message); }
  }
  if (diagnostics.length) return { ...result(), blocked: 'diagnostics' };

  let scope;
  try {
    if (options.writeScope !== undefined) {
      if (!Array.isArray(options.writeScope)) throw new Error('writeScope must be an array of exact workspace-relative file paths.');
      scope = new Set(options.writeScope.map(path => relative(realpathSync(root), safePath(root, path)).split(sep).join('/')));
    }
    for (const entry of entries) {
      const outside = relative(projectRoot, safePath(root, entry.path));
      if (outside === '..' || outside.startsWith(`..${sep}`) || isAbsolute(outside) || scope && !scope.has(entry.path)) requiredScope.push(entry.path);
    }
  } catch (error) { diagnostic('invalid-scope', error.message); }
  if (diagnostics.length || requiredScope.length) return { ...result(), blocked: requiredScope.length ? 'write-scope' : 'diagnostics' };
  if (options.allowWrite !== true || !entries.length) return result();
  try {
    if (digest(readFileSync(configPath)) !== rawHash) throw new Error('Workspace configuration changed while the release was being planned.');
    for (const state of snapshots) {
      if (digest(readFileSync(safePath(root, state.metadataPath))) !== state.metadataHash) throw new Error(`Package metadata changed while planning: ${state.metadataPath}`);
      for (const file of state.snapshot.files) if (digest(readFileSync(safePath(root, `${state.pkg.path}/${file.source}`))) !== file.sha256) throw new Error(`Canonical source changed while planning: ${state.pkg.path}/${file.source}`);
    }
    for (const lock of locks.values()) {
      const path = safePath(root, lock.path), current = existsSync(path) ? digest(readFileSync(path)) : null;
      if (current !== lock.before) throw new Error(`Shared lock changed while planning: ${lock.path}`);
    }
    persistSharedPlan(root, entries);
    context.config.sharedPackages = structuredClone(raw.sharedPackages);
    return { ...result(), written: true };
  } catch (error) {
    diagnostic('persistence-failed', error.message, { rollbackFailures: error.rollbackFailures || [] });
    return { ...result(), blocked: 'persistence' };
  }
}

export function auditShared({ root, config }) {
  const base = config.runtimes.find(runtime => runtime.id === 'dev');
  if (!base) throw new Error('The shared audit requires a DEV source runtime.');
  const prefix = `${base.app}/`;
  const files = execFileSync('git', ['ls-files', '-z', '--', `${base.app}/apps/api/src`, `${base.app}/apps/web`], { cwd: root, encoding: 'utf8' }).split('\0').filter(path => path && /\.(?:ts|tsx|css)$/.test(path) && !path.endsWith('next-env.d.ts'));
  const owned = new Map(config.sharedPackages.flatMap(pkg => pkg.files.map(file => [file.target, pkg.id])));
  const candidates = [], divergent = [], productSpecific = [], missing = [];
  for (const path of files) {
    const target = path.slice(prefix.length);
    const variants = config.runtimes.map(runtime => {
      const file = safePath(root, `${runtime.app}/${target}`);
      return { runtime: runtime.id, sha256: existsSync(file) ? digest(readFileSync(file)) : null };
    });
    if (variants.some(variant => variant.sha256 === null)) { missing.push({ target, variants }); continue; }
    if (new Set(variants.map(variant => variant.sha256)).size > 1) { divergent.push({ target, variants, policy: 'runtime-owned; preserve until reviewed and extracted behind compatible adapters' }); continue; }
    if (owned.has(target)) continue;
    if (/safdoulas|suinda/i.test(target) || /safdoulas|suinda/i.test(readFileSync(safePath(root, path), 'utf8'))) { productSpecific.push(target); continue; }
    candidates.push(target);
  }
  return { ok: true, promotedFiles: owned.size, unpromotedIdenticalFiles: candidates, divergentFiles: divergent, productSpecificFiles: productSpecific, missingInSomeRuntime: missing, policy: 'Only proven identical generic sources can be promoted automatically. Differences are preserved explicitly; this audit does not prove behavioral equivalence.' };
}

export async function execute(command, args, context) {
  const operation = args[0] || 'check';
  if (operation === 'audit') return auditShared(context);
  if (operation === 'reconcile') {
    const flags = {};
    for (let index = 1; index < args.length; index++) {
      const flag = args[index];
      if (flag === '--write') { flags.write = true; continue; }
      if (!['--files', '--scope', '--project-root', '--release'].includes(flag)) throw new Error(`Unknown reconcile argument: ${flag}`);
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
      flags[flag.slice(2)] = value;
    }
    return reconcileShared(context, { changedFiles: flags.files?.split(',').filter(Boolean), writeScope: flags.scope?.split(',').filter(Boolean), projectRoot: flags['project-root'], allowWrite: flags.write === true, release: flags.release });
  }
  if (operation === 'bump') {
    const [ , id, increment] = args;
    if (!['patch', 'minor', 'major'].includes(increment) || args.slice(3).some(arg => arg !== '--write')) throw new Error('Use shared bump <package-id> patch|minor|major [--write].');
    const configPath = safePath(context.root, 'orbit.workspace.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    const pkg = config.sharedPackages.find(item => item.id === id);
    if (!pkg) throw new Error(`Unknown source package: ${id}`);
    const path = safePath(context.root, `${pkg.path}/package.json`);
    const metadata = JSON.parse(readFileSync(path, 'utf8'));
    if (metadata.version !== pkg.version || !/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('Align the current package/workspace versions before bumping.');
    const previous = pkg.version, parts = previous.split('.').map(Number);
    const position = ['major', 'minor', 'patch'].indexOf(increment);
    parts[position]++; for (let i = position + 1; i < 3; i++) parts[i] = 0;
    pkg.version = parts.join('.'); metadata.version = pkg.version;
    const written = args.includes('--write');
    if (written) { atomic(path, json(metadata)); atomic(configPath, json(config)); }
    return { ok: true, package: id, previous, next: pkg.version, written, nextStep: 'shared sync --write, then shared check and impact' };
  }
  if (!['check', 'sync'].includes(operation)) throw new Error('Use shared check or shared sync [--write] [--runtime id].');
  const selectedIndex = args.indexOf('--runtime');
  const selected = selectedIndex < 0 ? undefined : args[selectedIndex + 1];
  if (selectedIndex >= 0 && (!selected || selected.startsWith('--'))) throw new Error('--runtime requires an id.');
  const unknown = args.slice(1).filter((arg, index) => arg !== '--write' && arg !== '--runtime' && args[index] !== '--runtime');
  if (unknown.length) throw new Error(`Unknown shared arguments: ${unknown.join(' ')}`);
  if (operation === 'check' && args.includes('--write')) throw new Error('Use shared sync --write to update projections.');
  const state = inspectShared(context, selected);
  const result = { operation, written: false, ok: state.diagnostics.length === 0 && state.projections.length === 0 && state.locks.length === 0, packages: state.packages.map(({ files, ...pkg }) => ({ ...pkg, fileCount: files.length })), updates: state.projections.map(({ path, package: owner }) => ({ path, package: owner })), locks: state.locks.map(item => item.path), diagnostics: state.diagnostics };
  if (operation === 'sync' && args.includes('--write')) {
    if (state.diagnostics.length) throw new Error(state.diagnostics.map(item => `${item.path || item.package}: ${item.message}`).join('\n'));
    for (const entry of [...state.projections, ...state.locks]) atomic(safePath(context.root, entry.path), entry.contents);
    result.written = true;
    result.ok = true;
  }
  return result;
}

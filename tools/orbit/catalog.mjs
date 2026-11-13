import { readFileSync, existsSync, readdirSync, statSync, lstatSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, relative, dirname, extname, join, sep } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const UNKNOWN = Symbol('unresolved static expression');
const ORIGIN = Symbol('source');
const slash = value => value.split(sep).join('/');
const unique = values => [...new Set(values)];
const toolHash = createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex');
const excluded = new Set(['node_modules', '.git', '.next', 'dist', 'data', 'backups', '.cache', 'sessions']);

function walk(root, accept, output = []) {
  if (!existsSync(root)) return output;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (excluded.has(entry.name) || entry.name.startsWith('.next') || entry.name === 'coverage' || entry.isSymbolicLink()) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) walk(path, accept, output);
    else if (accept(path)) output.push(path);
  }
  return output;
}
function parser(root) {
  for (const base of unique([root, join(root, 'dev/app'), resolve(import.meta.dirname, '../../dev/app')])) {
    try { return createRequire(join(base, 'package.json'))('typescript'); } catch { /* try next local installation */ }
  }
  throw new Error('TypeScript parser unavailable. Run npm install in dev/app before building the catalog.');
}
function inside(root, path) {
  const result = relative(root, resolve(root, path));
  return result === '' || (!result.startsWith(`..${sep}`) && result !== '..' && !result.startsWith(sep));
}
function resolveImport(file, specifier, root) {
  let base;
  if (specifier.startsWith('.')) base = resolve(dirname(file), specifier);
  else if (specifier.startsWith('@/')) {
    const marker = `${sep}apps${sep}web${sep}`;
    const position = file.indexOf(marker);
    if (position >= 0) base = resolve(file.slice(0, position + marker.length), specifier.slice(2));
  }
  if (!base || !inside(root, base)) return null;
  const withoutJs = /\.[cm]?js$/.test(base) ? base.replace(/\.[cm]?js$/, '') : base;
  for (const candidate of unique([base, ...['.ts', '.tsx', '.mjs', '.js', '.json'].map(extension => withoutJs + extension), ...['index.ts', 'index.tsx', 'index.mjs', 'index.js'].map(name => join(base, name))])) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** A bounded TypeScript AST interpreter for metadata. It never evaluates source JavaScript. */
function scanner(root) {
  const ts = parser(root), modules = new Map();
  const load = path => {
    if (modules.has(path)) return modules.get(path);
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const module = { path, source, declarations: new Map(), imports: new Map() };
    modules.set(path, module);
    for (const statement of source.statements) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) module.declarations.set(declaration.name.text, declaration.initializer);
      } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) module.declarations.set(statement.name.text, statement);
      else if (ts.isImportDeclaration(statement) && statement.importClause && ts.isStringLiteral(statement.moduleSpecifier)) {
        const target = resolveImport(path, statement.moduleSpecifier.text, root);
        const bindings = statement.importClause.namedBindings;
        if (target && bindings && ts.isNamedImports(bindings)) {
          for (const item of bindings.elements) module.imports.set(item.name.text, { target, name: item.propertyName?.text || item.name.text });
        }
      }
    }
    return module;
  };
  function evaluate(node, module, scope = {}, depth = 0, stack = new Set()) {
    if (!node || depth > 45) return UNKNOWN;
    const next = (child, locals = scope) => evaluate(child, module, locals, depth + 1, stack);
    if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) return next(node.expression);
    if (ts.isIdentifier(node)) {
      if (Object.hasOwn(scope, node.text)) return scope[node.text];
      // DI factory parameters expose metadata through their declared class fields.
      let ancestor = node.parent;
      while (ancestor && ancestor !== module.source) {
        if (ancestor.parameters) {
          const parameter = ancestor.parameters.find(item => ts.isIdentifier(item.name) && item.name.text === node.text);
          if (parameter && parameter.type && ts.isTypeReferenceNode(parameter.type) && ts.isIdentifier(parameter.type.typeName)) return next(parameter.type.typeName);
        }
        ancestor = ancestor.parent;
      }
      const key = `${module.path}:${node.text}`;
      if (stack.has(key)) return UNKNOWN;
      stack.add(key);
      let result;
      const imported = module.imports.get(node.text);
      if (imported) {
        const target = load(imported.target);
        result = evaluate(target.declarations.get(imported.name), target, {}, depth + 1, stack);
      } else result = next(module.declarations.get(node.text));
      stack.delete(key);
      return result ?? UNKNOWN;
    }
    if (ts.isClassDeclaration(node)) {
      const instance = {};
      for (const member of node.members) if (ts.isPropertyDeclaration(member) && member.name?.text && member.initializer) instance[member.name.text] = next(member.initializer);
      return instance;
    }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) return { callable: node, module, scope };
    if (ts.isArrayLiteralExpression(node)) {
      const values = [];
      for (const element of node.elements) {
        const value = next(ts.isSpreadElement(element) ? element.expression : element);
        if (ts.isSpreadElement(element) && Array.isArray(value)) values.push(...value); else values.push(value);
      }
      return values;
    }
    if (ts.isObjectLiteralExpression(node)) {
      const object = {};
      Object.defineProperty(object, ORIGIN, { value: { path: slash(relative(root, module.path)), line: module.source.getLineAndCharacterOfPosition(node.getStart()).line + 1 } });
      for (const property of node.properties) {
        if (ts.isSpreadAssignment(property)) { const value = next(property.expression); if (value && typeof value === 'object' && value !== UNKNOWN) Object.assign(object, value); }
        else if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
          const name = property.name?.text;
          if (name) object[name] = next(ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer);
        }
      }
      return object;
    }
    if (ts.isPropertyAccessExpression(node)) {
      const value = next(node.expression);
      return value && value !== UNKNOWN ? value[node.name.text] ?? UNKNOWN : UNKNOWN;
    }
    if (ts.isElementAccessExpression(node)) { const value = next(node.expression), key = next(node.argumentExpression); return value && key !== UNKNOWN ? value[key] ?? UNKNOWN : UNKNOWN; }
    if (ts.isTemplateExpression(node)) {
      let value = node.head.text;
      for (const span of node.templateSpans) { const item = next(span.expression); if (item === UNKNOWN) return UNKNOWN; value += String(item) + span.literal.text; }
      return value;
    }
    if (ts.isConditionalExpression(node)) { const condition = next(node.condition); return condition === UNKNOWN ? UNKNOWN : next(condition ? node.whenTrue : node.whenFalse); }
    if (ts.isBinaryExpression(node)) {
      const left = next(node.left), right = next(node.right);
      if (left === UNKNOWN || right === UNKNOWN) return UNKNOWN;
      switch (node.operatorToken.kind) {
        case ts.SyntaxKind.PlusToken: return left + right;
        case ts.SyntaxKind.EqualsEqualsEqualsToken: case ts.SyntaxKind.EqualsEqualsToken: return left === right;
        case ts.SyntaxKind.ExclamationEqualsEqualsToken: return left !== right;
        case ts.SyntaxKind.BarBarToken: return left || right;
        case ts.SyntaxKind.AmpersandAmpersandToken: return left && right;
        case ts.SyntaxKind.QuestionQuestionToken: return left ?? right;
        default: return UNKNOWN;
      }
    }
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && /^define(?:Plugin|Capability|Action|Contribution|CardLayout|CardType|BoardView)$/.test(node.expression.text)) return next(node.arguments[0]);
      if (ts.isPropertyAccessExpression(node.expression)) {
        const receiver = next(node.expression.expression), method = node.expression.name.text;
        if (typeof receiver === 'string' && ['startsWith', 'endsWith', 'includes'].includes(method)) {
          const argument = next(node.arguments[0]);
          return typeof argument === 'string' ? receiver[method](argument) : UNKNOWN;
        }
        if (Array.isArray(receiver) && ['map', 'flatMap', 'filter', 'find'].includes(method)) {
          const callback = next(node.arguments[0]);
          const values = receiver.map((value, index) => invoke(callback, [value, index], depth + 1, stack));
          if (method === 'map') return values;
          if (method === 'flatMap') return values.flat();
          if (method === 'find') return receiver.find((_, index) => values[index] === true) ?? UNKNOWN;
          return receiver.filter((_, index) => values[index] === true);
        }
        if (node.expression.expression.getText(module.source) === 'Object' && ['freeze', 'seal'].includes(method)) return next(node.arguments[0]);
      }
      return invoke(next(node.expression), node.arguments.map(argument => next(argument)), depth + 1, stack);
    }
    return UNKNOWN;
  }
  function invoke(fn, args, depth, stack) {
    if (!fn?.callable || depth > 45) return UNKNOWN;
    const { callable, module } = fn, scope = { ...fn.scope };
    callable.parameters.forEach((parameter, index) => { if (ts.isIdentifier(parameter.name)) scope[parameter.name.text] = args[index] === undefined || args[index] === UNKNOWN ? evaluate(parameter.initializer, module, scope, depth + 1, stack) : args[index]; });
    const evaluateLocal = node => evaluate(node, module, scope, depth + 1, stack);
    if (!callable.body) return UNKNOWN;
    if (!ts.isBlock(callable.body)) return evaluateLocal(callable.body);
    for (const statement of callable.body.statements) {
      if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) scope[declaration.name.text] = evaluateLocal(declaration.initializer);
      if (ts.isReturnStatement(statement)) return evaluateLocal(statement.expression);
    }
    return UNKNOWN;
  }
  return { ts, load, evaluate, modules };
}

function serializable(value) {
  if (value === UNKNOWN || typeof value === 'function' || value?.callable) return undefined;
  if (Array.isArray(value)) return value.map(serializable).filter(item => item !== undefined);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializable(item)]).filter(([, item]) => item !== undefined));
  return value;
}
function pluginMetadata(value, fallback, symbol) {
  if (!value || typeof value.id !== 'string' || typeof value.version !== 'string') return null;
  const capabilities = serializable(value.capabilities) || [];
  const actions = serializable(value.actions) || [];
  const contributions = serializable(value.contributions) || {};
  const declaredPermissions = [];
  const collectPermissions = item => {
    if (!item || typeof item !== 'object') return;
    for (const [key, entry] of Object.entries(item)) {
      if (['schema', 'inputSchema', 'outputSchema', 'example'].includes(key)) continue;
      if (['permission', 'managePermission'].includes(key) && typeof entry === 'string') declaredPermissions.push(entry);
      else if (key === 'permissions' && Array.isArray(entry)) declaredPermissions.push(...entry.filter(value => typeof value === 'string'));
      else collectPermissions(entry);
    }
  };
  collectPermissions({ capabilities, actions, contributions, recordEvents: serializable(value.recordEvents) });
  const permissions = unique(declaredPermissions).sort();
  return {
    id: value.id, name: typeof value.name === 'string' ? value.name : value.id, version: value.version,
    parentPlugin: typeof value.parentPlugin === 'string' ? value.parentPlugin : undefined,
    dependencies: serializable(value.dependencies) || [], coreCompatibility: serializable(value.coreCompatibility),
    capabilities, permissions, actions, events: serializable(value.recordEvents?.events) || [],
    contributions, path: value[ORIGIN]?.path || fallback, line: value[ORIGIN]?.line, symbol,
  };
}
function semver(value) { return typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : null; }
function compare(left, right) { for (let index = 0; index < 3; index++) if (left[index] !== right[index]) return left[index] - right[index]; return 0; }
export function diagnosePlugins(plugins, coreVersion) {
  const diagnostics = [], byId = new Map();
  for (const plugin of plugins) {
    for (const field of ['capabilities', 'actions', 'events']) {
      const ids = new Set();
      for (const item of plugin[field] || []) {
        const id = typeof item === 'string' ? item : field === 'events' ? item.type : item.id;
        if (!id || ids.has(id)) diagnostics.push({ severity: 'error', code: `invalid-or-duplicate-${field}`, plugin: plugin.id, id });
        ids.add(id);
      }
    }
    if (!Array.isArray(plugin.dependencies) || plugin.dependencies.some(dependency => typeof dependency !== 'string')) diagnostics.push({ severity: 'error', code: 'invalid-dependencies', plugin: plugin.id });
    if (byId.has(plugin.id)) diagnostics.push({ severity: 'error', code: 'duplicate-plugin', plugin: plugin.id, paths: [byId.get(plugin.id).path, plugin.path] });
    else byId.set(plugin.id, plugin);
    const compatibility = plugin.coreCompatibility || { minVersion: '1.0.0', maxExclusive: '2.0.0', pluginApiVersion: 1 };
    const core = semver(coreVersion?.version), min = semver(compatibility.minVersion), max = compatibility.maxExclusive ? semver(compatibility.maxExclusive) : null;
    if (!semver(plugin.version) || !min || (compatibility.maxExclusive && !max) || (min && max && compare(min, max) >= 0)) diagnostics.push({ severity: 'error', code: 'invalid-version', plugin: plugin.id });
    else if (core && (compare(core, min) < 0 || (max && compare(core, max) >= 0) || (compatibility.pluginApiVersion !== undefined && compatibility.pluginApiVersion !== coreVersion.pluginApiVersion))) diagnostics.push({ severity: 'error', code: 'incompatible-core', plugin: plugin.id, compatibility });
  }
  for (const plugin of plugins) {
    for (const dependency of Array.isArray(plugin.dependencies) ? plugin.dependencies : []) if (!byId.has(dependency)) diagnostics.push({ severity: 'error', code: 'missing-dependency', plugin: plugin.id, dependency });
    if (plugin.parentPlugin && !(Array.isArray(plugin.dependencies) ? plugin.dependencies : []).includes(plugin.parentPlugin)) diagnostics.push({ severity: 'error', code: 'parent-without-dependency', plugin: plugin.id, parentPlugin: plugin.parentPlugin });
  }
  const visited = new Set(), visiting = new Set(), cycles = new Set();
  function visit(id, path = []) {
    if (visiting.has(id)) { const cycle = [...path.slice(path.indexOf(id)), id]; const key = [...new Set(cycle)].sort().join(','); if (!cycles.has(key)) { cycles.add(key); diagnostics.push({ severity: 'error', code: 'dependency-cycle', plugins: cycle }); } return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of Array.isArray(byId.get(id)?.dependencies) ? byId.get(id).dependencies : []) visit(dependency, [...path, id]);
    visiting.delete(id); visited.add(id);
  }
  for (const id of byId.keys()) visit(id);
  return diagnostics;
}

function metadataCache(root, runtime, sources, versionPath) {
  const directory = resolve(root, '.orbit/cache/catalog');
  const key = createHash('sha256').update(`${runtime.id}:${runtime.app}`).digest('hex').slice(0, 20);
  const path = join(directory, `${key}.json`);
  const hash = createHash('sha256').update(toolHash);
  for (const file of [...sources, ...(existsSync(versionPath) ? [versionPath] : [])].sort()) hash.update(relative(root, file)).update('\0').update(readFileSync(file)).update('\0');
  const fingerprint = hash.digest('hex');
  const hashFile = file => createHash('sha256').update(readFileSync(file)).digest('hex');
  const safeDirectory = () => [resolve(root, '.orbit'), resolve(root, '.orbit/cache'), directory].every(parent => !existsSync(parent) || !lstatSync(parent).isSymbolicLink());
  let cached;
  try {
    if (safeDirectory() && existsSync(path) && !lstatSync(path).isSymbolicLink() && statSync(path).size < 16 * 1024 * 1024) {
      const stored = JSON.parse(readFileSync(path, 'utf8'));
      if (stored.fingerprint === fingerprint && Array.isArray(stored.dependencies) && stored.dependencies.every(entry => inside(root, entry.path) && existsSync(resolve(root, entry.path)) && hashFile(resolve(root, entry.path)) === entry.hash)) cached = stored.result;
    }
  } catch { /* Corrupt or unavailable caches are never acceptance evidence. */ }
  return {
    cached, fingerprint,
    save(result, loadedModules) {
      try {
        if (!safeDirectory()) return;
        const dependencies = [...loadedModules].filter(file => !sources.includes(file)).map(file => ({path: slash(relative(root, file)), hash: hashFile(file)}));
        mkdirSync(directory, {recursive:true});
        const temporary = `${path}.${process.pid}.tmp`;
        writeFileSync(temporary, JSON.stringify({fingerprint, dependencies, result}), {flag:'wx'});
        renameSync(temporary, path);
      } catch { /* Read-only workspaces can still build an uncached catalog. */ }
    },
  };
}

export function catalogRuntime(root, runtime, existingScan) {
  const app = resolve(root, runtime.app), base = join(app, 'apps/api/src');
  const sources = walk(base, path => /\.[cm]?tsx?$/.test(path) && !/\.(?:spec|test)\.tsx?$/.test(path));
  const versionPath = join(app, 'apps/api/core-version.json');
  const cache = metadataCache(root, runtime, sources, versionPath);
  if (cache.cached) return {...cache.cached, cache:{hit:true, fingerprint:cache.fingerprint}};
  const scan = existingScan || scanner(root), {ts} = scan;
  const plugins = [], seen = new Map(), diagnostics = [];
  const add = (value, path, symbol, registered = false) => {
    const plugin = pluginMetadata(value, slash(relative(root, path)), symbol);
    if (!plugin) return;
    const key = `${plugin.id}:${plugin.path}`;
    if (seen.has(key)) {
      const previous = seen.get(key);
      if ((registered && previous.registered) || (!registered && !previous.registered && previous.symbol !== symbol)) diagnostics.push({ severity: 'error', code: 'duplicate-plugin-definition', plugin: plugin.id, path: plugin.path, symbols: [previous.symbol, symbol] });
      return;
    }
    if (value.dependencies === UNKNOWN || value.coreCompatibility === UNKNOWN) diagnostics.push({ severity: 'error', code: 'unresolved-plugin-contract', plugin: plugin.id, path: plugin.path });
    seen.set(key, { registered, symbol }); plugins.push({ ...plugin, registered });
  };
  // Resolve actual register(...) arguments, including factories and for-of registries.
  const main = join(base, 'main.ts');
  if (existsSync(main)) {
    const module = scan.load(main);
    const visit = node => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'register' && node.arguments.length === 1) {
        let scope = {}, enclosing = node.parent;
        while (enclosing && enclosing !== module.source) {
          if (ts.isForOfStatement(enclosing) && ts.isVariableDeclarationList(enclosing.initializer)) {
            const variable = enclosing.initializer.declarations[0]?.name;
            const iterable = scan.evaluate(enclosing.expression, module);
            if (variable && ts.isIdentifier(variable) && Array.isArray(iterable)) {
              for (const item of iterable) add(scan.evaluate(node.arguments[0], module, { ...scope, [variable.text]: item }), main, node.arguments[0].getText(module.source), true);
              return;
            }
          }
          enclosing = enclosing.parent;
        }
        const expression = node.arguments[0].getText(module.source);
        const value = scan.evaluate(node.arguments[0], module, scope);
        add(value, main, expression, true);
        if ((!value || value.id === UNKNOWN || value.version === UNKNOWN) && /plugin/i.test(expression)) diagnostics.push({ severity: 'error', code: 'unresolved-plugin-registration', path: slash(relative(root, main)), expression });
      }
      ts.forEachChild(node, visit);
    };
    visit(module.source);
  }
  // Include exported definitions not yet wired into a runtime, making generated plugins visible.
  for (const file of sources) {
    // Only potential definition modules need an AST; regular domain code is hash-checked.
    if (!/\b(?:PluginDefinition|RecordPlugin|definePlugin)\b|export\s+(?:const|function)\s+\w*plugin/i.test(readFileSync(file, 'utf8'))) continue;
    const module = scan.load(file);
    for (const [name, declaration] of module.declarations) {
      if (!declaration || (!/plugin/i.test(name) && !/PluginDefinition/.test(declaration.parent?.type?.getText(module.source) || ''))) continue;
      const value = scan.evaluate(declaration, module);
      if (Array.isArray(value)) for (const item of value) add(item?.plugin || item, file, name);
      else add(value?.plugin || value, file, name);
    }
  }
  let coreVersion;
  if (existsSync(versionPath)) coreVersion = JSON.parse(readFileSync(versionPath, 'utf8'));
  else diagnostics.push({ severity: 'warning', code: 'core-version-unavailable', path: slash(relative(root, versionPath)) });
  plugins.sort((left, right) => left.id.localeCompare(right.id));
  diagnostics.push(...diagnosePlugins(plugins, coreVersion));
  const result = { id: runtime.id, app: runtime.app, coreVersion, plugins, diagnostics };
  cache.save(result, scan.modules.keys());
  return {...result, cache:{hit:false, fingerprint:cache.fingerprint}};
}

function stable(value) { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])); return value; }
export function buildCatalog(root, config, runtimeId) {
  const selected = config.runtimes.filter(runtime => !runtimeId || runtime.id === runtimeId);
  if (runtimeId && !selected.length) throw new Error(`Unknown runtime: ${runtimeId}`);
  const runtimes = selected.map(runtime => catalogRuntime(root, runtime));
  const diagnostics = runtimes.flatMap(runtime => runtime.diagnostics.map(item => ({ runtime: runtime.id, ...item })));
  const versions = new Map();
  for (const runtime of runtimes) for (const plugin of runtime.plugins) {
    const signature = JSON.stringify(stable({ version: plugin.version, dependencies: [...plugin.dependencies].sort(), parentPlugin: plugin.parentPlugin, coreCompatibility: plugin.coreCompatibility || { minVersion: '1.0.0', maxExclusive: '2.0.0', pluginApiVersion: 1 }, capabilities: plugin.capabilities, actions: plugin.actions, events: plugin.events, contributions: plugin.contributions }));
    const previous = versions.get(plugin.id);
    if (previous && previous.signature !== signature) diagnostics.push({ severity: 'error', code: 'divergent-plugin-contract', plugin: plugin.id, runtimes: [previous.runtime, runtime.id], paths: [previous.path, plugin.path] });
    else if (!previous) versions.set(plugin.id, { runtime: runtime.id, signature, path: plugin.path });
  }
  return { runtimes, diagnostics, ok: !diagnostics.some(item => item.severity === 'error') };
}

function option(args, name) { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; }
function explicitFiles(args) {
  const index = args.indexOf('--files');
  if (index < 0) return null;
  const files = [];
  for (let position = index + 1; position < args.length && !args[position].startsWith('--'); position++) files.push(...args[position].split(','));
  return files.filter(Boolean);
}
function changedFiles(root, args) {
  const supplied = explicitFiles(args);
  if (supplied) return supplied;
  const git = argv => execFileSync('git', argv, { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).split('\0').filter(Boolean);
  const requested = option(args, '--base');
  const files = [...git(['diff', '--name-only', '-z', '--no-renames']), ...git(['diff', '--cached', '--name-only', '-z', '--no-renames']), ...git(['ls-files', '--others', '--exclude-standard', '-z'])];
  if (requested) {
    const hash = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${requested}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
    files.push(...git(['diff', '--name-only', '-z', '--no-renames', hash, 'HEAD', '--']));
  }
  return unique(files);
}
function check(id, cwd, command, reason, extra = {}) { return { id, cwd, command, reason, ...extra }; }
export function analyzeImpact(root, config, inputFiles) {
  for (const path of inputFiles) if (!inside(root, path)) throw new Error(`Changed path escapes the repository: ${path}`);
  const files = unique(inputFiles.map(path => slash(relative(root, resolve(root, path))))).sort();
  const toolingTests = () => walk(resolve(root, 'tools/orbit'), path => /\.test\.mjs$/.test(path)).map(path => slash(relative(root, path)));
  const passive = path => /^(?:docs\/|tools\/orbit\/|README|MONOREPO|AGENTS\.md)/.test(path);
  if (files.every(passive)) {
    const checks = [];
    if (files.length && existsSync(resolve(root, 'scripts/verify-plugin-compatibility.mjs'))) checks.push(check('plugin-compatibility', '.', ['node', 'scripts/verify-plugin-compatibility.mjs'], 'Common plugin contracts must remain compatible across runtimes.'));
    const tests = toolingTests();
    if (files.some(path => path.startsWith('tools/orbit/')) && tests.length) checks.push(check('orbit-tooling', '.', ['node', '--test', ...tests], 'Development tooling changed.'));
    return {files, impactedFiles:files, runtimes:[], checks, unknownFiles:[], conservative:false, requiresMilestone:files.length>0, notes:['Tooling/documentation fast path: application ASTs are not loaded.', 'Existing mandatory card checks still apply.']};
  }
  const ts = parser(root), reverse = new Map(), sourceFiles = [];
  for (const runtime of config.runtimes) sourceFiles.push(...walk(resolve(root, runtime.app, 'apps'), path => /\.[cm]?[jt]sx?$/.test(path)));
  for (const shared of config.sharedPackages || []) {
    const sharedPath = shared.path || shared.source || shared.root;
    if (typeof sharedPath === 'string') sourceFiles.push(...walk(resolve(root, sharedPath), path => /\.[cm]?[jt]sx?$/.test(path)));
  }
  for (const file of unique(sourceFiles)) {
    // preProcessFile scans imports without allocating or retaining a full syntax tree.
    const imports = ts.preProcessFile(readFileSync(file, 'utf8'), true, true).importedFiles;
    for (const specifier of imports) {
      const target = resolveImport(file, specifier.fileName, root);
      if (target) {
        const key = slash(relative(root, target));
        if (!reverse.has(key)) reverse.set(key, new Set());
        reverse.get(key).add(slash(relative(root, file)));
      }
    }
  }
  const pluginCatalogs = new Map();
  for (const runtime of config.runtimes) {
    const catalog = catalogRuntime(root, runtime);
    pluginCatalogs.set(runtime.id, catalog);
    const byId = new Map(catalog.plugins.map(plugin => [plugin.id, plugin]));
    for (const plugin of catalog.plugins) for (const dependency of Array.isArray(plugin.dependencies) ? plugin.dependencies : []) {
      const owner = byId.get(dependency);
      if (!owner) continue;
      if (!reverse.has(owner.path)) reverse.set(owner.path, new Set());
      reverse.get(owner.path).add(plugin.path);
    }
  }
  const sharedRoots = [];
  for (const shared of config.sharedPackages || []) {
    if (shared.path) sharedRoots.push(slash(shared.path));
    const mappedSources = new Set((shared.files || []).map(mapping => slash(join(shared.path, mapping.source))));
    const packageChanges = files.filter(path => shared.path && path.startsWith(`${slash(shared.path)}/`) && !mappedSources.has(path));
    for (const path of packageChanges) {
      if (!reverse.has(path)) reverse.set(path, new Set());
      for (const source of mappedSources) reverse.get(path).add(source);
    }
    for (const mapping of shared.files || []) {
      if (!shared.path || !mapping.source || !mapping.target) continue;
      const source = slash(join(shared.path, mapping.source));
      if (!reverse.has(source)) reverse.set(source, new Set());
      for (const runtime of config.runtimes) reverse.get(source).add(slash(join(runtime.app, mapping.target)));
    }
  }
  const impacted = new Set(files), queue = [...files];
  while (queue.length) for (const dependent of reverse.get(queue.shift()) || []) if (!impacted.has(dependent)) { impacted.add(dependent); queue.push(dependent); }
  const unknown = files.filter(path => !config.runtimes.some(runtime => path.startsWith(`${runtime.app}/`))
    && !sharedRoots.some(base => path.startsWith(`${base}/`))
    && !/^(?:docs\/|tools\/orbit\/|scripts\/verify-plugin-compatibility\.mjs$|README|MONOREPO|AGENTS\.md)/.test(path));
  const runtimes = [], checks = [];
  if (files.length && existsSync(resolve(root, 'scripts/verify-plugin-compatibility.mjs'))) checks.push(check('plugin-compatibility', '.', ['node', 'scripts/verify-plugin-compatibility.mjs'], 'Common plugin contracts must remain compatible across runtimes.'));
  for (const runtime of config.runtimes) {
    const affected = [...impacted].filter(path => path.startsWith(`${runtime.app}/`));
    const broad = unknown.length > 0;
    if (!affected.length && !broad) continue;
    const api = broad || affected.some(path => path.includes('/apps/api/') || /(?:package(?:-lock)?\.json|tsconfig\.json)$/.test(path));
    const web = broad || affected.some(path => path.includes('/apps/web/') || /(?:package(?:-lock)?\.json|tsconfig\.json)$/.test(path));
    const entry = { id: runtime.id, files: affected.sort(), plugins: (pluginCatalogs.get(runtime.id)?.plugins || []).filter(plugin => impacted.has(plugin.path)).map(plugin => plugin.id), conservative: broad, reasons: broad ? [`Unclassified repository changes: ${unknown.join(', ')}`] : ['Changed source, transitive import, or runtime configuration.'] };
    runtimes.push(entry);
    if (api && existsSync(resolve(root, runtime.app, 'apps/api/tsconfig.json'))) checks.push(check(`${runtime.id}:api:typecheck`, runtime.app, ['node', 'node_modules/typescript/bin/tsc', '--noEmit', '-p', 'apps/api/tsconfig.json'], 'API source or a dependency changed.'));
    if (web && existsSync(resolve(root, runtime.app, 'apps/web/tsconfig.json'))) checks.push(check(`${runtime.id}:web:typecheck`, runtime.app, ['node', 'node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false', '-p', 'apps/web/tsconfig.json'], 'Web source or a dependency changed.'));
    const unitTests = affected.filter(path => /\.(?:spec|test)\.tsx?$/.test(path) && !/\.(?:integration|browser)\.spec\./.test(path));
    if (api && broad) {
      if (existsSync(resolve(root, runtime.app, 'apps/api/package.json')) && JSON.parse(readFileSync(resolve(root, runtime.app, 'apps/api/package.json'), 'utf8')).scripts?.test) checks.push(check(`${runtime.id}:api:unit`, `${runtime.app}/apps/api`, ['npm', 'test'], 'Conservative API coverage for an unclassified shared change.'));
    } else if (unitTests.length) checks.push(check(`${runtime.id}:unit:affected`, runtime.app, ['node', '--import', 'tsx', '--test', '--test-concurrency=1', ...unitTests.map(path => path.slice(runtime.app.length + 1))], 'These test files import affected code.'));
    if (affected.some(path => path.includes('/sql/migrations/'))) entry.reasons.push('Database changes require migration review and an isolated integration milestone.');
  }
  const toolTests = toolingTests();
  if (files.some(path => /^(?:tools\/orbit\/|orbit\.workspace\.json|package\.json)/.test(path)) && toolTests.length) checks.push(check('orbit-tooling', '.', ['node', '--test', ...toolTests], 'Development tooling changed.'));
  return { files, impactedFiles: [...impacted].sort(), runtimes, checks, unknownFiles: unknown, conservative: unknown.length > 0, requiresMilestone: files.length > 0, notes: ['Checks are recommendations only; no process is executed.', 'Existing card write_scope and post_execution_checks remain mandatory.', 'The milestone broadens functional and integration coverage; service lifecycle and browser execution follow project authorization rules.'] };
}

export async function execute(command, args, context) {
  if (command === 'catalog') return buildCatalog(context.root, context.config, option(args, '--runtime'));
  if (command === 'impact') return analyzeImpact(context.root, context.config, changedFiles(context.root, args));
  throw new Error(`Unsupported catalog command: ${command}`);
}

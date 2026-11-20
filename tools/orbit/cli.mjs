#!/usr/bin/env node
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [command = 'help', ...args] = process.argv.slice(2);
const modules = {
  catalog: './catalog.mjs', impact: './catalog.mjs', generate: './generate.mjs', migrate: './generate.mjs', reconcile: './reconcile.mjs',
  knowledge: './knowledge.mjs', metrics: './knowledge.mjs', delivery: './knowledge.mjs',
  preflight: './preflight.mjs', shared: './shared.mjs', plan: './plan.mjs', check: './verify.mjs', verify: './verify.mjs',
};

if (command === 'help' || command === '--help') {
  console.log(`Orbit development tools (Node.js; no Docker or external AI service required)

  preflight [--runtime id] [--format json|text]  Read-only architecture readiness
  catalog [--runtime id]                 Discover real plugin definitions and contracts
  impact [--files path,...] [--base ref] Identify dependent files/runtimes and checks
  shared check|sync [--write]            Verify or update versioned source projections
  generate product <slug> [--write]     Create an isolated product from Workspace by default
  generate plugin <id> [--write]        Generate plugin/child, contract fixture and stub
  reconcile product --runtime id [--base id]  Audit product/base drift without writes
  migrate imports ... | rollback ...    Plan/apply/revert import adaptations
  knowledge index|query|context ...     Retrieve local development context with citations
  plan --spec <file.json>               Assess independent tasks, time and token estimates
  check [--milestone] [--run]           Plan checks or run selected checks sequentially
  delivery init|check|evidence|report    Record a milestone and actual verification evidence
  metrics start|stop|report             Measure actual development phases

See docs/acceleration/README.md. Generators and migrations preview changes by default.
`);
} else {
  try {
    if (!modules[command]) throw new Error(`Unknown command: ${command}. Use help.`);
    const config = JSON.parse(readFileSync(resolve(root, 'orbit.workspace.json'), 'utf8'));
    if (config.schemaVersion !== 1 || !Array.isArray(config.runtimes) || !Array.isArray(config.sharedPackages)) throw new Error('Unsupported orbit.workspace.json.');
    const products = resolve(root, config.productsDirectory || 'products');
    if (existsSync(products) && !lstatSync(products).isSymbolicLink()) for (const entry of readdirSync(products, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const path = resolve(products, entry.name, 'product.profile.json');
      if (!existsSync(path) || lstatSync(path).isSymbolicLink()) continue;
      const profile = JSON.parse(readFileSync(path, 'utf8'));
      const expectedApp = `${config.productsDirectory || 'products'}/${entry.name}/app`;
      if (profile.id !== entry.name || profile.app !== expectedApp || config.runtimes.some(runtime => runtime.id === profile.id)) throw new Error(`Invalid or duplicate generated product profile: ${entry.name}`);
      config.runtimes.push({ id: profile.id, app: profile.app, webPort: profile.ports.web, apiPort: profile.ports.api });
    }
    const { execute, formatText } = await import(modules[command]);
    const result = await execute(command, args, { root, config });
    console.log(command === 'preflight' && args[args.indexOf('--format') + 1] === 'text' && formatText ? formatText(result) : JSON.stringify(result, null, 2));
    if (result?.ok === false || (result?.check && result.check.status !== 'passed')) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  }
}

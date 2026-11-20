import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { catalogRuntime, diagnosePlugins, buildCatalog, analyzeImpact, execute } from './catalog.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'orbit-catalog-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, content) => { const absolute = join(root, path); mkdirSync(dirname(absolute), { recursive: true }); writeFileSync(absolute, content); };
  const runtime = (id = 'dev') => {
    const app = id === 'dev' ? 'forge/app' : id === 'prod' ? 'workspace/app' : `${id}/app`;
    const result = { id, app };
    write(`${result.app}/apps/api/core-version.json`, JSON.stringify({ version: '1.2.0', pluginApiVersion: 1 }));
    write(`${result.app}/apps/api/package.json`, JSON.stringify({ scripts: { test: 'tsx --test src/a.spec.ts' } }));
    write(`${result.app}/apps/api/tsconfig.json`, '{}');
    write(`${result.app}/apps/web/tsconfig.json`, '{}');
    return result;
  };
  return { root, write, runtime };
}

test('catalog resolves factory parameters, class metadata, helpers, imports and capability permissions without executing source', t => {
  const { root, write, runtime } = fixture(t), dev = runtime();
  write('forge/app/apps/api/src/plugins/all.ts', `
    throw new Error('Catalog must never execute application code');
    export const basePlugin = {id:'base',name:'Base',version:'1.0.0'};
    function plugin(id:string) { return {plugin:{id,name:id,version:'1.0.0',dependencies:['base'],capabilities:['read','write'].map(action=>({id:action,name:action,permissions:[\`plugin.\${id}.\${action}\`]}))}}; }
    export const genericPlugins = [basePlugin,...['forms','documents'].map(id=>plugin(id).plugin)];
    export const providerDefinition=(id:string)=>({id,name:id,version:'1.0.0',dependencies:['base']});
    export class Calendar { readonly id='calendar'; readonly name='Calendar'; }
    export const calendarPluginDefinition=(calendar:Calendar)=>({id:calendar.id,name:calendar.name,version:'1.0.0',dependencies:['base']});
  `);
  write('forge/app/apps/api/src/main.ts', `
    import {genericPlugins,providerDefinition,calendarPluginDefinition,Calendar} from './plugins/all';
    const create=(calendar:Calendar)=>{for(const plugin of genericPlugins)registry.register(plugin);registry.register(providerDefinition('mail'));registry.register(calendarPluginDefinition(calendar));};
  `);
  const result = catalogRuntime(root, dev);
  assert.deepEqual(result.plugins.map(plugin => plugin.id), ['base', 'calendar', 'documents', 'forms', 'mail']);
  assert.deepEqual(result.plugins.find(plugin => plugin.id === 'forms').permissions, ['plugin.forms.read', 'plugin.forms.write']);
  assert.equal(result.plugins.every(plugin => plugin.registered), true);
  assert.deepEqual(result.diagnostics, []);
});

test('reports missing dependencies, duplicate ids, incompatible versions, missing parent and dependency cycles', () => {
  const plugins = [
    { id:'a', version:'1.0.0', path:'a.ts', dependencies:['b'] },
    { id:'b', version:'1.0.0', path:'b.ts', dependencies:['a', 'missing'] },
    { id:'a', version:'1.0.0', path:'a-copy.ts', dependencies:[] },
    { id:'child', version:'1.0.0', path:'child.ts', dependencies:[], parentPlugin:'a', coreCompatibility:{minVersion:'3.0.0'} },
  ];
  const diagnostics = diagnosePlugins(plugins, {version:'1.2.0', pluginApiVersion:1});
  for (const code of ['duplicate-plugin', 'missing-dependency', 'dependency-cycle', 'parent-without-dependency', 'incompatible-core']) assert.ok(diagnostics.some(item=>item.code===code), code);
});

test('compares contracts across runtimes and reports unresolved declared dependencies', t => {
  const { root, write, runtime } = fixture(t), dev = runtime(), prod = runtime('prod');
  write('forge/app/apps/api/src/plugins/feature.ts', "export const featurePlugin={id:'feature',name:'Feature',version:'1.0.0',dependencies:[]};");
  write('workspace/app/apps/api/src/plugins/feature.ts', "export const featurePlugin={id:'feature',name:'Feature',version:'1.1.0',dependencies:[]}; export const unknownPlugin={id:'unknown',name:'Unknown',version:'1.0.0',dependencies:externalDependencies()};");
  const result = buildCatalog(root, {runtimes:[dev,prod]});
  assert.equal(result.ok,false);
  assert.ok(result.diagnostics.some(item=>item.code==='divergent-plugin-contract'));
  assert.ok(result.diagnostics.some(item=>item.code==='unresolved-plugin-contract'));
  assert.throws(()=>buildCatalog(root,{runtimes:[dev]},'missing'),/Unknown runtime/);
});

test('follows transitive imports and shared projections to recommend impacted tests in all consumers', t => {
  const { root, write, runtime } = fixture(t), dev = runtime(), prod = runtime('prod');
  for (const entry of [dev,prod]) {
    write(`${entry.app}/apps/api/src/core.ts`, 'export const x=1;');
    write(`${entry.app}/apps/api/src/wrapper.ts`, "export {x} from './core';");
    write(`${entry.app}/apps/api/src/wrapper.spec.ts`, "import {x} from './wrapper';");
    write(`${entry.app}/apps/api/src/wrapper.integration.spec.ts`, "import {x} from './wrapper';");
  }
  write('packages/core/src/core.ts', 'export const x=1;');
  const result = analyzeImpact(root,{runtimes:[dev,prod],sharedPackages:[{path:'packages/core',files:[{source:'src/core.ts',target:'apps/api/src/core.ts'}]}]},['packages/core/src/core.ts']);
  assert.deepEqual(result.runtimes.map(runtime=>runtime.id),['dev','prod']);
  assert.ok(result.impactedFiles.includes('workspace/app/apps/api/src/wrapper.spec.ts'));
  const commands=result.checks.flatMap(check=>check.command);
  assert.ok(commands.some(value=>value.endsWith('wrapper.spec.ts')));
  assert.ok(!commands.some(value=>value.endsWith('wrapper.integration.spec.ts')));
  assert.throws(()=>analyzeImpact(root,{runtimes:[dev]},['../secret']),/escapes/);
});

test('uses conservative impact for unknown shared configuration and scopes known runtime changes', t => {
  const { root, write, runtime } = fixture(t), dev = runtime(), prod = runtime('prod');
  write('forge/app/apps/api/src/feature.ts', 'export const x=1;');
  const config={runtimes:[dev,prod]};
  const scoped=analyzeImpact(root,config,['forge/app/apps/api/src/feature.ts']);
  assert.deepEqual(scoped.runtimes.map(runtime=>runtime.id),['dev']);
  assert.equal(scoped.conservative,false);
  const broad=analyzeImpact(root,config,['infrastructure/unknown.json']);
  assert.deepEqual(broad.runtimes.map(runtime=>runtime.id),['dev','prod']);
  assert.equal(broad.conservative,true);
});

test('default impact includes staged, unstaged and untracked files without reading their contents', async t => {
  const {root,write,runtime}=fixture(t),dev=runtime();
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'});
  git('init','--quiet');
  write('.gitignore','.env\n');
  write('forge/app/apps/api/src/tracked.ts','export const x=1;');
  git('add','.');
  git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','baseline');
  write('forge/app/apps/api/src/tracked.ts','export const x=2;');
  write('forge/app/apps/api/src/staged.ts','export const y=1;');
  git('add','forge/app/apps/api/src/staged.ts');
  write('forge/app/apps/api/src/untracked.ts','export const z=1;');
  write('.env','SECRET=not-indexed');
  const result=await execute('impact',[],{root,config:{runtimes:[dev]}});
  assert.deepEqual(result.files,['forge/app/apps/api/src/staged.ts','forge/app/apps/api/src/tracked.ts','forge/app/apps/api/src/untracked.ts']);
});

test('plugin dependency edges include consumers without source imports, while tooling changes avoid runtime-wide test runs', t => {
  const {root,write,runtime}=fixture(t), dev=runtime();
  write('forge/app/apps/api/src/plugins/base.ts', "export const basePlugin={id:'base',name:'Base',version:'1.0.0',dependencies:[]};");
  write('forge/app/apps/api/src/plugins/child.ts', "export const childPlugin={id:'child',name:'Child',version:'1.0.0',dependencies:['base']};");
  write('forge/app/apps/api/src/child.spec.ts', "import {childPlugin} from './plugins/child';");
  const impact=analyzeImpact(root,{runtimes:[dev]},['forge/app/apps/api/src/plugins/base.ts']);
  assert.ok(impact.impactedFiles.includes('forge/app/apps/api/src/child.spec.ts'));
  assert.deepEqual(impact.runtimes[0].plugins,['base','child']);
  write('tools/orbit/feature.test.mjs','');
  const tooling=analyzeImpact(root,{runtimes:[dev]},['tools/orbit/feature.mjs']);
  assert.deepEqual(tooling.runtimes,[]);
  assert.equal(tooling.conservative,false);
  assert.ok(tooling.checks.some(check=>check.id==='orbit-tooling'));
});

test('metadata cache invalidates both runtime source and imported shared metadata changes', t => {
  const {root,write,runtime}=fixture(t), dev=runtime();
  write('packages/shared/version.ts', "export const pluginVersion='1.0.0';");
  write('forge/app/apps/api/src/plugins/feature.ts', "import {pluginVersion} from '../../../../../../packages/shared/version'; export const featurePlugin={id:'feature',name:'Feature',version:pluginVersion,dependencies:[]};");
  const first=catalogRuntime(root,dev);
  assert.equal(first.plugins[0].version,'1.0.0');
  assert.equal(first.cache.hit,false);
  assert.equal(catalogRuntime(root,dev).cache.hit,true);
  write('packages/shared/version.ts', "export const pluginVersion='1.1.0';");
  const sharedChange=catalogRuntime(root,dev);
  assert.equal(sharedChange.cache.hit,false);
  assert.equal(sharedChange.plugins[0].version,'1.1.0');
  write('forge/app/apps/api/src/plugins/feature.ts', "export const featurePlugin={id:'feature',name:'Feature',version:'1.2.0',dependencies:[]};");
  const sourceChange=catalogRuntime(root,dev);
  assert.equal(sourceChange.cache.hit,false);
  assert.equal(sourceChange.plugins[0].version,'1.2.0');
});

test('impact ignores generated .next variants and returns tooling fast path without creating application catalogs', t => {
  const {root,write,runtime}=fixture(t), dev=runtime();
  write('forge/app/apps/api/src/core.ts','export const x=1;');
  write('forge/app/apps/web/.next-native-dev/generated.js', "import {x} from '../../api/src/core';");
  const result=analyzeImpact(root,{runtimes:[dev]},['forge/app/apps/api/src/core.ts']);
  assert.ok(!result.impactedFiles.some(path=>path.includes('.next')));
  const tooling=analyzeImpact(root,{runtimes:[{id:'missing',app:'absent/app'}]},['docs/note.md']);
  assert.deepEqual(tooling.runtimes,[]);
  assert.match(tooling.notes[0],/fast path/);
});

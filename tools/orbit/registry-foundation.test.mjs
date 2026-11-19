import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('real DEV registry preserves deterministic protections with AI disabled', t => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const temporary = mkdtempSync(join(tmpdir(), 'orbit-registry-foundation-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const script = join(temporary, 'registry.test.ts');
  writeFileSync(script, `
    import assert from 'node:assert/strict';
    import {PluginRegistry} from ${JSON.stringify(resolve(root, 'dev/app/apps/api/src/execution/registries.ts'))};
    const registry = new PluginRegistry();
    const action = {id:'echo', name:'Echo', permissions:['core.write'], inputSchema:{type:'object',additionalProperties:false},execute:async()=>({type:'text',value:'ok'})};
    registry.register({id:'ai',name:'AI',version:'1.0.0'});
    registry.register({id:'specialized',name:'Specialized',version:'1.0.0',dependencies:['ai']});
    registry.register({id:'integrity',name:'Integrity',version:'1.0.0',actions:[action]});
    registry.setEnabled('ai',false);
    assert.equal(registry.isEnabled('ai'),false);
    assert.equal(registry.isEnabled('specialized'),false);
    assert.equal(registry.isEnabled('integrity'),true);
    assert.throws(()=>registry.validate({plugin:'integrity',action:'echo',config:{}},[]),/Permissão/);
    assert.throws(()=>registry.validate({plugin:'integrity',action:'echo',config:{extra:true}},['core.write']),/Configuração/);
    assert.ok(registry.validate({plugin:'integrity',action:'echo',config:{}},['core.write']));
    registry.register({id:'missing',name:'Missing',version:'1.0.0',dependencies:['absent']});
    assert.equal(registry.isEnabled('missing'),false);
    assert.throws(()=>registry.dependencyChain('missing'),/não instalada/);
    registry.register({id:'cycle-a',name:'A',version:'1.0.0',dependencies:['cycle-b']});
    assert.throws(()=>registry.register({id:'cycle-b',name:'B',version:'1.0.0',dependencies:['cycle-a']}),/circular/);
    assert.throws(()=>registry.register({id:'incompatible',name:'Bad',version:'1.0.0',coreCompatibility:{minVersion:'99.0.0'}}),/incompatível/);
  `);
  assert.doesNotThrow(() => execFileSync(process.execPath, ['--import', resolve(root, 'dev/app/node_modules/tsx/dist/loader.mjs'), script], { cwd: temporary, env: { ...process.env, ORBIT_HIDDEN_PLUGINS: '', TSX_DISABLE_CACHE: '1' }, stdio: 'pipe', timeout: 30_000 }));
});

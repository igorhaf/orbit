import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCoreCompatibility} from './core-compatibility';
import {PluginRegistry} from '../execution/registries';
import {definePlugin} from './sdk';

test('legacy plugins inherit the supported Orbit core and plugin API range',()=>{
  assert.doesNotThrow(()=>assertCoreCompatibility({id:'legacy'}));
  assert.throws(()=>assertCoreCompatibility({id:'legacy'},{version:'2.0.0',pluginApiVersion:1,releaseFormat:1}),/incompatível/);
});

test('SDK and registry reject plugins whose declared core range does not include this runtime',()=>{
  const plugin={id:'future',name:'Future',version:'1.0.0',coreCompatibility:{minVersion:'2.0.0'}};
  assert.throws(()=>definePlugin(plugin),/incompatível/);
  assert.throws(()=>new PluginRegistry().register(plugin),/incompatível/);
  assert.throws(()=>assertCoreCompatibility({id:'invalid',coreCompatibility:{minVersion:'1.0.0',maxExclusive:'0.0.1'}}),/Faixa/);
});

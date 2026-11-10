import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCoreCompatibility} from './core-compatibility';
import {PluginRegistry} from '../execution/registries';
import {definePlugin} from './sdk';
import {environmentManagementPlugin} from './environment-management/environment-management.plugin';
test('existing plugins inherit a conservative major-version compatibility boundary',()=>{assert.doesNotThrow(()=>assertCoreCompatibility({id:'legacy'}));assert.throws(()=>assertCoreCompatibility({id:'legacy'},{version:'2.0.0',pluginApiVersion:1,releaseFormat:1}),/incompatível/)});
test('registration and SDK reject incompatible plugin contracts before execution',()=>{const plugin={id:'future',name:'Future',version:'1.0.0',coreCompatibility:{minVersion:'2.0.0'}};assert.throws(()=>new PluginRegistry().register(plugin),/incompatível/);assert.throws(()=>definePlugin(plugin),/incompatível/);assert.throws(()=>assertCoreCompatibility({id:'invalid',coreCompatibility:{minVersion:'1.0.0',maxExclusive:'0.0.1'}}),/Faixa/)});
test('environment management is suspended when Delivery is disabled',()=>{const registry=new PluginRegistry();registry.register({id:'delivery',name:'Delivery',version:'1.0.0'});registry.register(environmentManagementPlugin);assert.equal(registry.isEnabled('environment-management'),true);registry.setEnabled('delivery',false);assert.equal(registry.isEnabled('environment-management'),false);assert.equal(registry.routePlugin('/environment-management/jobs'),'environment-management');assert.equal(environmentManagementPlugin.routePermission?.('/environment-management','GET'),'environments.read');assert.equal(environmentManagementPlugin.routePermission?.('/environment-management/jobs','POST'),'environments.manage')});

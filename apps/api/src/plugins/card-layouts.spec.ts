import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PluginRegistry} from '../execution/registries';
import {CardLayoutsService} from './card-layouts';
import {aiPlugin} from './ai/ai.plugin';
import {softwareDevelopmentPlugin} from './software-development/software-development.plugin';
import {CodexAiService} from './ai/codex-provider';
import {isAiRoute} from './ai/routes';
import {defineCardLayout,definePlugin} from './sdk';
const samplePlugin={id:'sample',name:'Sample',version:'1.0.0',dependencies:['workspaces']};
import {workspacesPlugin} from '../workspaces/workspaces.plugin';

test('dependency selection, suspension and reactivation preserve independent configured state',()=>{
 const registry=new PluginRegistry();registry.register(definePlugin(aiPlugin));registry.register(definePlugin(softwareDevelopmentPlugin));
 assert.deepEqual(registry.selection(['software-development']),['ai','software-development']);
 registry.setEnabled('ai',false);assert.equal(registry.isEnabled('software-development'),false);
 assert.equal(registry.catalog().find(plugin=>plugin.id==='software-development')?.configuredEnabled,true);
 assert.throws(()=>registry.selection(['software-development']),/desativada/);
 registry.setEnabled('ai',true);assert.equal(registry.isEnabled('software-development'),true);
 registry.setEnabled('software-development',false);assert.equal(registry.isEnabled('ai'),true);
});
test('missing dependencies and cycles cannot execute; registering the missing dependency repairs availability',()=>{
 const registry=new PluginRegistry();registry.register({...softwareDevelopmentPlugin,dependencies:['ai']});assert.equal(registry.isEnabled('software-development'),false);assert.throws(()=>registry.selection(['software-development']));
 registry.register(aiPlugin);assert.equal(registry.isEnabled('software-development'),true);
 const cycle=new PluginRegistry();cycle.register({id:'a',name:'A',version:'1.0.0',dependencies:['b']});assert.throws(()=>cycle.register({id:'b',name:'B',version:'1.0.0',dependencies:['a']}),/circular/);assert.equal(cycle.isEnabled('a'),false);
 assert.throws(()=>definePlugin({id:'self',name:'Self',version:'1.0.0',dependencies:['self']}),/si mesmo/);
});
test('an unavailable optional external provider does not suspend the sample domain plugin',()=>{
 const registry=new PluginRegistry();
 registry.register(workspacesPlugin);registry.register(samplePlugin);
 registry.register({id:'google',name:'Google core',version:'1.0.0'});
 registry.register({id:'google-drive',name:'Google Drive',version:'1.0.0',dependencies:['google']});
 registry.setEnabled('google',false);
 assert.equal(registry.isEnabled('sample'),true);
 assert.equal(registry.catalog().find(plugin=>plugin.id==='sample')?.status,'active');
 assert.equal(registry.catalog().find(plugin=>plugin.id==='google-drive')?.status,'blocked');
});
test('layout fields are plugin owned, reject unknown fields and retain data when layout is removed',async()=>{
 const registry=new PluginRegistry();registry.register({id:'notes',name:'Notes',version:'1.0.0',contributions:{cardLayouts:[defineCardLayout({id:'notes.card',name:'Notes',slots:[],fields:[{key:'requirements',label:'Requirements',type:'textarea',maxLength:20}]})]}});
 let selected:string[]=[];let data:Record<string,Record<string,string>>={};
 const db={one:async(sql:string)=>sql.includes('vault_items')?null:{plugin_ids:selected,data},query:async(sql:string,args:unknown[])=>{if(sql.startsWith('INSERT'))selected=args[1] as string[];if(sql.startsWith('UPDATE'))data={...data,[String(args[1])]:{...data[String(args[1])],...JSON.parse(String(args[2]))}};return []}};
 const layouts=new CardLayoutsService(db as never,{cardBoard:async()=> 'board'} as never,registry);
 assert.deepEqual((await layouts.get('card','user')).selected,[]);
 await layouts.set('card','user',{plugins:['notes']});await layouts.fields('card','user','notes',{requirements:'Preserve layout'});
 await assert.rejects(()=>layouts.fields('card','user','notes',{invented:'x'}));await assert.rejects(()=>layouts.fields('card','user','notes',{requirements:'x'.repeat(21)}));
 await layouts.set('card','user',{plugins:[]});assert.equal((await layouts.get('card','user')).data.notes.requirements,'Preserve layout');
 await assert.rejects(()=>layouts.fields('card','user','notes',{requirements:'hidden'}));
 await layouts.set('card','user',{plugins:['notes']});assert.equal((await layouts.get('card','user')).data.notes.requirements,'Preserve layout');
 await assert.rejects(()=>layouts.set('card','user',{plugins:['notes'],invented:true}));
});
test('disabling AI prevents provider process launch while core project routes remain available',async()=>{
 const provider=new CodexAiService();provider.setAvailability(()=>false);await assert.rejects(()=>provider.complete('Never spawn'),/desativado/);
 for(const route of ['/ai/models','/ai/settings','/cards/x/ai','/cards/x/comments/ai','/cards/x/prompt-runs','/cards/x/prompt-settings','/comments/x/execute','/codex/queue'])assert.equal(isAiRoute(route),true,route);
 for(const route of ['/ai/projects','/ai/projects/x','/ai/projects/directories','/ai/execution-projects','/cards/x/plugins','/cards/x/comments','/boards'])assert.equal(isAiRoute(route),false,route);
});

test('catalogue explains transitive suspension and leaves explicitly disabled dependents off',()=>{
 const registry=new PluginRegistry();registry.register({id:'base',name:'Base',version:'1.0.0'});registry.register({id:'service',name:'Service',version:'1.0.0',dependencies:['base']});registry.register({id:'layout',name:'Layout',version:'1.0.0',dependencies:['service']});registry.register({id:'missing',name:'Missing',version:'1.0.0',dependencies:['uninstalled']});
 assert.deepEqual(registry.dependents('base'),['service','layout']);registry.setEnabled('base',false);
 let catalogue=registry.catalog();assert.equal(catalogue.find(p=>p.id==='base')?.status,'disabled');assert.equal(catalogue.find(p=>p.id==='layout')?.status,'blocked');assert.deepEqual(catalogue.find(p=>p.id==='layout')?.blockedBy,['base']);assert.deepEqual(catalogue.find(p=>p.id==='missing')?.blockedBy,['uninstalled']);
 registry.setEnabled('service',false);registry.setEnabled('base',true);catalogue=registry.catalog();assert.equal(catalogue.find(p=>p.id==='service')?.status,'disabled');assert.equal(catalogue.find(p=>p.id==='layout')?.status,'blocked');assert.deepEqual(catalogue.find(p=>p.id==='layout')?.blockedBy,['service']);registry.setEnabled('service',true);assert.equal(registry.catalog().find(p=>p.id==='layout')?.status,'active');
});

test('development classification labels context, denies execution and retains the classification',async()=>{
 const registry=new PluginRegistry();registry.register(aiPlugin);registry.register(softwareDevelopmentPlugin);
 let data={ 'software-development':{role:'context'} };
 const db={one:async(sql:string)=>sql.includes('vault_items')||sql.includes('SELECT 1 FROM card_ai_runs')?null:{plugin_ids:['software-development','ai'],data},query:async(sql:string,args:unknown[])=>{if(sql.startsWith('UPDATE'))data={'software-development':{...data['software-development'],...JSON.parse(String(args[2]))}};return []}};
 const layouts=new CardLayoutsService(db as never,{cardBoard:async()=> 'board'} as never,registry);
 const context=await layouts.get('card','user');assert.equal(context.badges[0].label,'Contexto');assert.equal(context.executionBlocked,true);assert.equal(context.slots.includes('ai.execution'),false);
 const child=layouts.childData(data);assert.equal(child['software-development'].role,'executable');assert.equal(data['software-development'].role,'context');
 await assert.rejects(()=>layouts.assertExecutionAllowed('card','user'),/Contexto/);
 await assert.rejects(()=>layouts.fields('card','user','software-development',{role:'invented'}));
 await layouts.fields('card','user','software-development',{role:'executable'});
 assert.equal((await layouts.get('card','user')).badges[0].label,'Executável');await layouts.assertExecutionAllowed('card','user');
});

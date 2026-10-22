import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { AccessService } from '../../access/access';
import type { Db } from '../../db';
import { PluginRegistry } from '../../execution/registries';
import { collectionsPlugin, installCollectionsAccess } from './collections.plugin';
import { processBoardPlugin } from '../process-board/process-board.plugin';
import { structuredViewPlugin } from '../board-views/board-view.plugins';

test('collections detach without AI, block root by plugin state and preserve normal board access', async () => {
  const registry = new PluginRegistry(); registry.register(collectionsPlugin);
  const db = { async one(sql:string,args:unknown[]) { if(sql.includes('FROM users')) return {id:args[0],is_root:args[0]==='root',disabled:false}; return {is_collection:args[0]==='collection',role:'member',workspace_id:null}; } } as unknown as Db;
  const access = new AccessService(db);
  let writes = true;
  access.has = async (_user, permission) => permission !== 'plugin.collections.write' || writes;
  installCollectionsAccess(db,registry,access);
  assert.equal(await access.boardPermission('collection','root'),true);
  writes=false;assert.equal(await access.boardPermission('collection','member','boards.write'),false);
  registry.setEnabled('collections',false);
  assert.equal(await access.boardPermission('collection','root'),false);
  assert.equal(await access.boardPermission('normal','root'),true);
  assert.deepEqual(await access.availableBoards([{id:'collection',is_collection:true},{id:'normal'}],'root'),[{id:'normal'}]);
  registry.setEnabled('collections',true);
  assert.equal(await access.boardPermission('collection','root'),true);
});

test('process-board adapters suspend with their generic base and respect an explicit child disable', () => {
  const registry=new PluginRegistry();
  registry.register({id:'versioned-records',name:'Records',version:'1.0.0'});
  registry.register(structuredViewPlugin);registry.register(processBoardPlugin);
  registry.register({id:'sample-casework',name:'Casework',version:'1.0.0',dependencies:['process-board'],contributions:{processBoards:[{id:'sample-board',name:'Casework board',href:'/sample/processes',permission:'plugin.process-board.read'}]}});
  assert.equal(registry.isEnabled('sample-casework'),true);
  registry.setEnabled('structured-view',false);assert.equal(registry.isEnabled('sample-casework'),false);
  registry.setEnabled('structured-view',true);assert.equal(registry.isEnabled('sample-casework'),true);
  registry.setEnabled('sample-casework',false);registry.setEnabled('process-board',false);registry.setEnabled('process-board',true);
  assert.equal(registry.isEnabled('sample-casework'),false);
  assert.throws(()=>registry.register({id:'bad-casework',name:'Bad',version:'1.0.0',contributions:{processBoards:[{id:'bad-board',name:'Unsafe',href:'//external.test',permission:'plugin.process-board.read'}]}}),/Quadro de processos inválido/);
});

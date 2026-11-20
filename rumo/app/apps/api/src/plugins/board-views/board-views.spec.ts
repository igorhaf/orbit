import test from 'node:test';
import assert from 'node:assert/strict';
import {HttpException} from '@nestjs/common';
import {BoardViewsService} from './board-views';
import {visualBoardPlugin,structuredViewPlugin} from './board-view.plugins';
import {PluginRegistry} from '../../execution/registries';
import {Db} from '../../db';
import {FeaturesService} from '../../features';
import {AccessService} from '../../access/access';
import {hasBoardViewAfterChange} from './required-views';

function fixture(grants=['boards.read','views.board.use'],root=false){
  const registry=new PluginRegistry();registry.register(visualBoardPlugin);registry.register(structuredViewPlugin);
  let preference:{view_id:string;saved_filters:unknown[]}|null=null;
  const access={async has(_user:string,permission:string){return root||grants.includes(permission)},async boardPermission(_board:string,user:string,permission:string){return this.has(user,permission)},async require(user:string,permission:string){if(!await this.has(user,permission))throw new HttpException('Denied',403)}};
  const db={async one(){return preference},async query(_sql:string,args:unknown[]){preference={view_id:String(args[2]),saved_filters:JSON.parse(String(args[3]))};return []}};
  const features={async member(_board:string,user:string){if(user==='outsider')throw new HttpException('Denied',403)}};
  const service=new BoardViewsService(db as unknown as Db,features as unknown as FeaturesService,registry,access as unknown as AccessService);
  return {service,registry};
}
const denied=(error:unknown)=>error instanceof HttpException&&error.getStatus()===403;

test('at least one board view must remain enabled',()=>{
 assert.equal(hasBoardViewAfterChange(new Map([['board-view',true],['structured-view',true]]),'board-view',false),true);
 assert.equal(hasBoardViewAfterChange(new Map([['board-view',true],['structured-view',false]]),'board-view',false),false);
 assert.equal(hasBoardViewAfterChange(new Map([['board-view',false],['structured-view',true]]),'structured-view',false),false);
 assert.equal(hasBoardViewAfterChange(new Map(),'unrelated-plugin',false),true);
});

test('view access requires its own privilege and board access; Root can use both',async()=>{
  const ordinary=fixture();assert.deepEqual((await ordinary.service.available('board','user')).views.map(view=>view.id),['board']);
  await assert.rejects(ordinary.service.save('board','user',{viewId:'structured'}),denied);
  await assert.rejects(ordinary.service.relations('board','user','structured'),denied);
  await assert.rejects(ordinary.service.available('board','outsider'),denied);
  await assert.rejects(fixture(['views.structured.use']).service.available('board','user'),denied);
  assert.equal((await fixture([],true).service.available('board','root')).views.length,2);
});
test('disabling a view blocks direct API use and falls back without discarding preference',async()=>{
  const {service,registry}=fixture(['boards.read','views.board.use','views.structured.use']);
  await service.save('board','user',{viewId:'structured'});registry.setEnabled('structured-view',false);
  assert.equal((await service.available('board','user')).preferredViewId,'board');
  await assert.rejects(service.relations('board','user','structured'),denied);
  registry.setEnabled('structured-view',true);assert.equal((await service.available('board','user')).preferredViewId,'structured');
  registry.setEnabled('board-view',false);assert.deepEqual((await service.available('board','user')).views.map(view=>view.id),['structured']);
});
test('read-only members can save private filters; invalid filter payloads are rejected',async()=>{
  const {service}=fixture();const filter={id:'one',name:'Minhas demandas',query:'',listId:'',assignee:'me',labelId:'',due:''};
  const saved=await service.save('board','user',{viewId:'board',savedFilters:[filter]});assert.deepEqual(saved.savedFilters,[filter]);
  await assert.rejects(service.save('board','user',{savedFilters:[{...filter,invented:'x'}]}));
  await assert.rejects(service.save('board','user',{savedFilters:[filter,filter]}));
  await assert.rejects(service.save('board','user',{savedFilters:[{...filter,due:'invented'}]}));
  await assert.rejects(service.save('board','user',{enabled:true}));
  assert.equal(new AccessService({} as Db).permission('/boards/board/views','PATCH'),'boards.read');
});

test('hierarchy changes require write permission and structured-view access',async()=>{
 const card='00000000-0000-0000-0000-000000000001';
 await assert.rejects(fixture().service.setParent('board','user',card,{parentId:null}),denied);
 await assert.rejects(fixture(['boards.read','views.structured.use']).service.setParent('board','user',card,{parentId:null}),denied);
 const root=fixture([],true);root.registry.setEnabled('structured-view',false);
 await assert.rejects(root.service.setParent('board','root',card,{parentId:null}),denied);
});
test('primary-parent input rejects self parenting, unknown fields and malformed IDs',async()=>{
 const {service}=fixture([],true),card='00000000-0000-0000-0000-000000000001';
 await assert.rejects(service.setParent('board','root',card,{parentId:card}),/próprio pai/);
 for(const body of [{},{parentId:'bad'},{parentId:null,extra:true}])await assert.rejects(service.setParent('board','root',card,body),/inválido/);
});

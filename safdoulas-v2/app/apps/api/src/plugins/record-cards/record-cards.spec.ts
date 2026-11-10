import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import {HttpException} from '@nestjs/common';
import {PluginRegistry} from '../../execution/registries';
import {RecordCardsService,recordCardsPlugin} from './record-cards.plugin';
import type {Db} from '../../db';
import type {AccessService} from '../../access/access';
import type {ExtensionRecords} from '../records/records.service';

function fixture(){
 const registry=new PluginRegistry();registry.register({id:'versioned-records',name:'Records',version:'1.0.0'});registry.register(recordCardsPlugin);
 registry.register({id:'sample-records',name:'Sample',version:'1.0.0',contributions:{recordCards:[{kind:'case',label:'Case',titleReference:{plugin:'sample-records',idField:'source_id',revisionField:'source_revision',titleField:'name'}}],recordKinds:{case:{label:'Case',schema:{type:'object'},initial:'draft',transitions:{draft:[]},example:{}}}}});
 let confidential=true;const providers:Array<(board:string,user:string,permission:string)=>Promise<boolean|null>>=[];const listings:Array<(board:string,user:string)=>Promise<boolean>>=[];
 const mapping={record_id:'00000000-0000-4000-8000-000000000001',card_id:'card',board_id:'protected',plugin_id:'sample-records',kind:'case'};
 const db={one:async(sql:string,args:string[])=>sql.includes('record_card_links')?args[0]==='protected'||args[0]===mapping.record_id?mapping:null:null} as unknown as Db;
 const records={detail:async()=>({id:mapping.record_id,kind:'case',title:'Case',workspace_id:'workspace',payload:{source_id:'source',source_revision:1}}),versionSnapshot:async()=>{if(!confidential)throw new HttpException('Private source',403);return{title:'Source',payload:{name:'Course'}}}} as unknown as ExtensionRecords;
 const access={require:async()=>undefined,has:async()=>true,registerBoardMembersProvider:()=>undefined,registerBoardListProvider:()=>undefined,registerBoardScopeProvider:()=>undefined,registerBoardAccessProvider:(provider:typeof providers[number])=>providers.push(provider),registerBoardListingPolicy:(policy:typeof listings[number])=>listings.push(policy)} as unknown as AccessService;
 const service=new RecordCardsService(db,records,access,registry);service.install();return{service,registry,providers,listings,denySource:()=>{confidential=false}};
}
test('record cards reuse one stored card and never grant visibility to its backing board',async()=>{
 const {service,providers,listings}=fixture();
 const one=await service.card('sample-records','00000000-0000-4000-8000-000000000001','root');assert.equal(one.card_id,'card');assert.equal(one.title,'Course');
 assert.equal(await providers[0]('protected','root','boards.read'),true);assert.equal(await listings[0]('protected','root'),false);assert.equal(await listings[0]('ordinary','root'),true);assert.equal(await providers[0]('ordinary','root','boards.read'),null);
});
test('revoking a confidential reference or disabling the plugin immediately suspends ROOT native access',async()=>{
 const {providers,registry,denySource}=fixture();assert.equal(await providers[0]('protected','root','boards.read'),true);
 registry.setEnabled('record-cards',false);assert.equal(await providers[0]('protected','root','boards.read'),false);
 registry.setEnabled('record-cards',true);denySource();assert.equal(await providers[0]('protected','root','boards.read'),false);
});

test('fixed board definitions reject templates assigned to undeclared phases',()=>{
 const {registry}=fixture();assert.throws(()=>registry.register({id:'scoped-records',name:'Scoped',version:'1.0.0',contributions:{recordKinds:{case:{label:'Case',schema:{type:'object'},initial:'draft',transitions:{draft:[]},example:{}}},recordCards:[{kind:'case',label:'Case',board:{visible:true,fixedScope:true,phases:[{id:'draft',label:'Draft'}],templates:[{id:'work',name:'Work',phase:'unknown',description:'Task',checklist:[]}]}}]}}),/Modelo de cartão inválido/);
});

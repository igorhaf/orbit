import assert from 'node:assert/strict';
import test from 'node:test';
import {HttpException} from '@nestjs/common';
import {CardTypesService} from './card-types';

const board='00000000-0000-0000-0000-000000000001';
const card='00000000-0000-0000-0000-000000000002';
const declarations=[
 {id:'plugin-a',name:'Plugin A',contributions:{cardTypes:[{id:'type-a',name:'Tipo A',description:'A',slots:[]}]}},
 {id:'plugin-b',name:'Plugin B',contributions:{cardTypes:[{id:'type-b',name:'Tipo B',description:'B',slots:[]}]}}
];

function fixture({root=false,grants=['cards.type.type-a.use'],enabled=['plugin-a','plugin-b'],settings=[{type_id:'type-a',scope_key:'*',enabled:true},{type_id:'type-b',scope_key:'*',enabled:true}]}:{root?:boolean;grants?:string[];enabled?:string[];settings?:{type_id:string;scope_key:string;enabled:boolean}[]}={}){
 const storedSettings=[...settings];let storedType:string|null=null;const audits:unknown[][]=[];
 const db={
  async one(sql:string,args:unknown[]=[]){
   if(sql.includes('FROM card_plugin_layouts'))return{card_type_id:storedType,plugin_ids:[]};
   if(sql.includes('FROM boards WHERE id=$1'))return args[0]===board?{id:board}:null;
   return null;
  },
  async query(sql:string,args:unknown[]=[]){
   if(sql.includes('FROM card_type_settings'))return storedSettings;
   if(sql.includes('FROM boards WHERE NOT is_inbox'))return[{id:board,title:'Quadro de exemplo'}];
   if(sql.startsWith('INSERT INTO card_type_settings')){
    const [type_id,scope_key,enabled]=args as [string,string,boolean];
    const index=storedSettings.findIndex(row=>row.type_id===type_id&&row.scope_key===scope_key);
    if(index<0)storedSettings.push({type_id,scope_key,enabled});else storedSettings[index]={type_id,scope_key,enabled};
   }
   if(sql.startsWith('DELETE FROM card_type_settings')){
    const [type_id,scope_key]=args;for(let index=storedSettings.length-1;index>=0;index--)if(storedSettings[index]?.type_id===type_id&&storedSettings[index]?.scope_key===scope_key)storedSettings.splice(index,1);
   }
   if(sql.startsWith('INSERT INTO card_plugin_layouts'))storedType=String(args[1]);
   return[];
  }
 };
 const features={async member(){},async cardBoard(){return board}};
 const registry={list(){return declarations},isEnabled(id:string){return enabled.includes(id)}};
 const access={async account(){return{id:'actor',is_root:root}},async has(_user:string,permission:string){return root||grants.includes(permission)},async audit(...args:unknown[]){audits.push(args)}};
 const service=new CardTypesService(db as never,features as never,registry as never,access as never);
 return{service,audits,getStoredType:()=>storedType,storedSettings};
}
const forbidden=(status:number)=>(error:unknown)=>error instanceof HttpException&&error.getStatus()===status;

test('single authorized type suppresses selection and is assigned automatically',async()=>{
 const {service}=fixture();
 const types=await service.boardTypes(board,'member');
 assert.deepEqual(types.types.map(type=>type.id),['type-a']);
 assert.equal(types.configuredCount,2);
 assert.equal(types.requiresSelection,false);
 assert.equal(await service.resolveForCreate(board,'member',undefined),'type-a');
 await assert.rejects(service.resolveForCreate(board,'member','type-b'),forbidden(409));
});

test('multiple allowed types require a choice and inaccessible types cannot be selected',async()=>{
 const multiple=fixture({grants:['cards.type.type-a.use','cards.type.type-b.use']});
 assert.equal((await multiple.service.boardTypes(board,'member')).requiresSelection,true);
 await assert.rejects(multiple.service.resolveForCreate(board,'member',undefined),forbidden(400));
 const restricted=fixture({grants:['cards.type.type-a.use']});
 await assert.rejects(restricted.service.select(card,'member','type-b'),forbidden(403));
 const selected=await multiple.service.select(card,'member','type-a');
 assert.equal(selected.currentTypeId,'type-a');
 assert.equal(multiple.getStoredType(),'type-a');
});

test('ROOT alone configures instance or board card types and changes are audited',async()=>{
 const regular=fixture();
 await assert.rejects(regular.service.config('member'),forbidden(403));
 await assert.rejects(regular.service.setConfig('member',{typeId:'type-a',enabled:false}),forbidden(403));
 const root=fixture({root:true});
 await root.service.setConfig('root',{typeId:'type-a',boardId:board,enabled:false});
 assert.equal(root.storedSettings.find(row=>row.type_id==='type-a'&&row.scope_key===board)?.enabled,false);
 assert.deepEqual(root.audits.map(entry=>entry[1]),['card_type.settings.updated']);
});

test('disabled plugins and disabled global types are absent from available type choices',async()=>{
 const disabled=fixture({enabled:['plugin-a'],settings:[{type_id:'type-a',scope_key:'*',enabled:false},{type_id:'type-b',scope_key:'*',enabled:true}]});
 const result=await disabled.service.boardTypes(board,'member');
 assert.deepEqual(result.types,[]);
 assert.equal(result.requiresSelection,false);
 assert.equal(result.configuredCount,0);
});

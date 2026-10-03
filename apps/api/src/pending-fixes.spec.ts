import assert from 'node:assert/strict';
import { test } from 'node:test';
import { codexErrorMessage } from './codex-ai';
import { PromptSessionsService } from './prompt-sessions';
import { TrelloSyncService } from './trello-sync';

test('Codex errors distinguish account quota, context tokens and timeouts',()=>{
  assert.match(codexErrorMessage('You have exceeded your current quota: insufficient_quota'),/limite de uso ou de tokens/);
  assert.match(codexErrorMessage('maximum context length and too many tokens'),/limite de tokens do modelo/);
  assert.equal(codexErrorMessage('A resposta do Codex excedeu o tempo limite.'),'A resposta do Codex excedeu o tempo limite.');
});

test('project creation reports a duplicate path instead of an internal error',async()=>{
  const service=new PromptSessionsService({one:async()=>null} as never,{} as never,{} as never,{} as never);
  await assert.rejects(
    ()=>service.createProject('user-1',{name:'Duplicate',local_path:'/tmp'}),
    (error:unknown)=>{const detail=error as {status?:number;response?:{message?:string}};return detail.status===409&&String(detail.response?.message).includes('já está cadastrada');},
  );
});

test('card prompt settings inherit the board default project',async()=>{
  const db={one:async(sql:string)=>sql.includes('SELECT c.id')?{id:'card-1',title:'Card',description:'',ai_project_id:null,ai_model:null,ai_effort:null,ai_default_project_id:'project-1',ai_default_model:'gpt-6-luna',ai_default_effort:'high'}:null};
  const service=new PromptSessionsService(db as never,{cardBoard:async()=> 'board-1'} as never,{} as never,{} as never);
  assert.deepEqual(await service.settingsForCard('card-1','user-1'),{projectId:'project-1',model:'gpt-6-luna',effort:'high'});
});

test('connecting Trello only registers the board and does not import cards',async()=>{
  const writes:string[]=[];
  const db={
    one:async(sql:string)=>{writes.push(sql);if(sql.includes('INSERT INTO trello_connections'))return {id:'connection-1',board_id:'board-1',trello_board_id:'remote-board',trello_board_name:'Remote',created_by:'user-1',created_at:new Date()};return {id:'connection-1'};},
    query:async()=>[],
  };
  const features={member:async()=>undefined};
  const service=new TrelloSyncService(db as never,features as never,{} as never);
  (service as unknown as {request:<T>()=>Promise<T>}).request=async<T>()=>({id:'remoteboard',name:'Remote',closed:false} as T);
  let syncs=0;
  (service as unknown as {sync:(id:string)=>Promise<unknown>}).sync=async()=>{syncs++;return {};};
  await service.connect('board-1','user-1','remoteboard');
  assert.equal(syncs,0);
  assert.equal(writes.some(sql=>sql.includes('INSERT INTO cards')),false);
});

test('Trello sync pulls only explicitly mapped columns',async()=>{
  const requested:string[]=[],queries:string[]=[];
  const db={
    one:async(sql:string)=>{queries.push(sql);if(sql.includes('SELECT * FROM trello_connections'))return {id:'connection-1',board_id:'board-1',trello_board_id:'remote-board',trello_board_name:'Remote',created_by:'user-1',created_at:new Date()};if(sql.includes('SELECT id FROM labels'))return {id:'label-1'};if(sql.includes('SELECT orbit_card_id'))return {orbit_card_id:'card-1',last_trello_activity:null};return null;},
    query:async(sql:string)=>{queries.push(sql);if(sql.includes('FROM trello_list_mappings WHERE connection_id'))return [{trello_list_id:'mapped-list',orbit_list_id:'local-list'}];if(sql.includes('SELECT c.id'))return [];return [];},
  };
  const service=new TrelloSyncService(db as never,{} as never,{boardChanged:()=>undefined} as never);
  (service as unknown as {request:<T>(path:string)=>Promise<T>}).request=async<T>(path:string)=>{requested.push(path);return path.includes('/cards')?[{id:'remote-card',name:'Changed remotely',dateLastActivity:new Date().toISOString()}] as T:({} as T);};
  const result=await service.sync('connection-1') as {lists:number;cards:number};
  assert.deepEqual(requested,['lists/mapped-list/cards']);
  assert.deepEqual(result,{id:'connection-1',status:'ok',lists:1,cards:1});
  assert.equal(queries.some(sql=>sql.includes('INSERT INTO lists')),false);
  assert.equal(queries.some(sql=>sql.includes('UPDATE cards SET list_id')),true);
});

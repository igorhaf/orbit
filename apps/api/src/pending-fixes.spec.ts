import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexAiService, codexErrorMessage } from './codex-ai';
import { PromptSessionsService } from './prompt-sessions';
import { TrelloSyncService } from './trello-sync';
import { orbitArchitecturePrompt } from './orbit-architecture';

test('Codex errors distinguish account quota, context tokens and timeouts',()=>{
  assert.match(codexErrorMessage('You have exceeded your current quota: insufficient_quota'),/limite de uso ou de tokens/);
  assert.match(codexErrorMessage('maximum context length and too many tokens'),/limite de tokens do modelo/);
  assert.equal(codexErrorMessage('A resposta do Codex excedeu o tempo limite.'),'A resposta do Codex excedeu o tempo limite.');
});

test('Codex errors explain authentication, unavailable models and CLI incompatibility',()=>{
  assert.match(codexErrorMessage('Error: not logged in; run codex login'),/codex login/);
  assert.match(codexErrorMessage('model_not_found: gpt-6-luna'),/Escolha outro modelo/);
  assert.match(codexErrorMessage('unknown argument --new-option'),/Atualize o Codex CLI/);
});

test('Codex receives long prompts through stdin instead of process arguments',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'orbit-codex-test-'));
  const executable=join(directory,'fake-codex.mjs');
  const previousBin=process.env.CODEX_BIN;const previousHome=process.env.CODEX_HOME;
  const prompt='context '.repeat(20_000);
  try{
    await writeFile(executable,`#!/usr/bin/env node\nimport {writeFile} from 'node:fs/promises';\nconst args=process.argv.slice(2);\nconst output=args[args.indexOf('--output-last-message')+1];\nif(args.at(-1)!=='-'||args.includes('--dangerously-bypass-approvals-and-sandbox')||args[args.indexOf('--sandbox')+1]!=='read-only')process.exit(2);\nlet prompt='';for await(const chunk of process.stdin)prompt+=chunk;\nawait writeFile(output,String(prompt.length));\n`);
    await chmod(executable,0o755);
    process.env.CODEX_BIN=executable;process.env.CODEX_HOME=directory;
    assert.equal(await new CodexAiService().complete(prompt,'gpt-6-luna','high'),String(`${orbitArchitecturePrompt}\n\n${prompt}`.length));
  }finally{
    if(previousBin===undefined)delete process.env.CODEX_BIN;else process.env.CODEX_BIN=previousBin;
    if(previousHome===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previousHome;
    await rm(directory,{recursive:true,force:true});
  }
});

test('Codex kills a silent process after the inactivity deadline',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'orbit-codex-idle-'));
  const executable=join(directory,'silent-codex.mjs');
  const previous={bin:process.env.CODEX_BIN,home:process.env.CODEX_HOME,idle:process.env.CODEX_AI_TIMEOUT_MS,max:process.env.CODEX_AI_MAX_RUNTIME_MS};
  try{
    await writeFile(executable,`#!/usr/bin/env node\nawait new Promise(resolve=>setTimeout(resolve,5000));\n`);
    await chmod(executable,0o755);
    process.env.CODEX_BIN=executable;process.env.CODEX_HOME=directory;process.env.CODEX_AI_TIMEOUT_MS='120';process.env.CODEX_AI_MAX_RUNTIME_MS='2000';
    await assert.rejects(()=>new CodexAiService().complete('travou','gpt-6-luna','low'),/inatividade/);
  }finally{
    if(previous.bin===undefined)delete process.env.CODEX_BIN;else process.env.CODEX_BIN=previous.bin;
    if(previous.home===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous.home;
    if(previous.idle===undefined)delete process.env.CODEX_AI_TIMEOUT_MS;else process.env.CODEX_AI_TIMEOUT_MS=previous.idle;
    if(previous.max===undefined)delete process.env.CODEX_AI_MAX_RUNTIME_MS;else process.env.CODEX_AI_MAX_RUNTIME_MS=previous.max;
    await rm(directory,{recursive:true,force:true});
  }
});

test('Codex enforces an absolute deadline even when a process keeps producing output',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'orbit-codex-deadline-'));
  const executable=join(directory,'chatty-codex.mjs');
  const previous={bin:process.env.CODEX_BIN,home:process.env.CODEX_HOME,idle:process.env.CODEX_AI_TIMEOUT_MS,max:process.env.CODEX_AI_MAX_RUNTIME_MS};
  try{
    await writeFile(executable,`#!/usr/bin/env node\nsetInterval(()=>process.stdout.write('still alive\\n'),15);\n`);
    await chmod(executable,0o755);
    process.env.CODEX_BIN=executable;process.env.CODEX_HOME=directory;process.env.CODEX_AI_TIMEOUT_MS='500';process.env.CODEX_AI_MAX_RUNTIME_MS='160';
    await assert.rejects(()=>new CodexAiService().execute('travou',directory,'gpt-6-luna','low',()=>undefined),/tempo máximo/);
  }finally{
    if(previous.bin===undefined)delete process.env.CODEX_BIN;else process.env.CODEX_BIN=previous.bin;
    if(previous.home===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous.home;
    if(previous.idle===undefined)delete process.env.CODEX_AI_TIMEOUT_MS;else process.env.CODEX_AI_TIMEOUT_MS=previous.idle;
    if(previous.max===undefined)delete process.env.CODEX_AI_MAX_RUNTIME_MS;else process.env.CODEX_AI_MAX_RUNTIME_MS=previous.max;
    await rm(directory,{recursive:true,force:true});
  }
});

test('Codex stops promptly when the run is no longer owned by its worker',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'orbit-codex-orphan-'));
  const executable=join(directory,'orphan-codex.mjs');
  const previous={bin:process.env.CODEX_BIN,home:process.env.CODEX_HOME,idle:process.env.CODEX_AI_TIMEOUT_MS,max:process.env.CODEX_AI_MAX_RUNTIME_MS,heartbeat:process.env.CODEX_AI_HEARTBEAT_INTERVAL_MS};
  try{
    await writeFile(executable,`#!/usr/bin/env node\nsetInterval(()=>process.stdout.write('still alive\\n'),15);\n`);
    await chmod(executable,0o755);
    process.env.CODEX_BIN=executable;process.env.CODEX_HOME=directory;process.env.CODEX_AI_TIMEOUT_MS='1000';process.env.CODEX_AI_MAX_RUNTIME_MS='2000';process.env.CODEX_AI_HEARTBEAT_INTERVAL_MS='100';
    await assert.rejects(()=>new CodexAiService().execute('órfão',directory,'gpt-6-luna','low',()=>undefined,null,undefined,()=>false),/não está mais ativa/);
  }finally{
    if(previous.bin===undefined)delete process.env.CODEX_BIN;else process.env.CODEX_BIN=previous.bin;
    if(previous.home===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous.home;
    if(previous.idle===undefined)delete process.env.CODEX_AI_TIMEOUT_MS;else process.env.CODEX_AI_TIMEOUT_MS=previous.idle;
    if(previous.max===undefined)delete process.env.CODEX_AI_MAX_RUNTIME_MS;else process.env.CODEX_AI_MAX_RUNTIME_MS=previous.max;
    if(previous.heartbeat===undefined)delete process.env.CODEX_AI_HEARTBEAT_INTERVAL_MS;else process.env.CODEX_AI_HEARTBEAT_INTERVAL_MS=previous.heartbeat;
    await rm(directory,{recursive:true,force:true});
  }
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

test('mounted project paths remain executable without mapping the container prefix twice',async()=>{
  const previousHostRoot=process.env.ORBIT_HOST_PROJECTS_ROOT;
  const previousContainerRoot=process.env.ORBIT_CONTAINER_PROJECTS_ROOT;
  const directory=await mkdtemp(join(process.cwd(),'.orbit-project-path-'));
  const service=new PromptSessionsService({} as never,{} as never,{} as never,{} as never);
  const paths=service as unknown as {projectPathToContainer:(value:string)=>string;localPath:(value:string)=>Promise<string>};
  try{
    process.env.ORBIT_HOST_PROJECTS_ROOT='/';
    process.env.ORBIT_CONTAINER_PROJECTS_ROOT='/host-filesystem';
    assert.equal(paths.projectPathToContainer('/home/projects/site'),'/host-filesystem/home/projects/site');
    assert.equal(paths.projectPathToContainer('/host-filesystem/home/projects/site'),'/host-filesystem/home/projects/site');
    assert.equal(paths.projectPathToContainer('/host-filesystem-other/site'),'/host-filesystem/host-filesystem-other/site');
    process.env.ORBIT_CONTAINER_PROJECTS_ROOT=process.cwd();
    assert.equal(await paths.localPath(directory),directory);
    process.env.ORBIT_HOST_PROJECTS_ROOT='/home/projects';
    process.env.ORBIT_CONTAINER_PROJECTS_ROOT='/mounted/projects';
    assert.equal(paths.projectPathToContainer('/home/projects/site'),'/mounted/projects/site');
    assert.equal(paths.projectPathToContainer('/mounted/projects/site'),'/mounted/projects/site');
    assert.equal(paths.projectPathToContainer('/other/site'),'/other/site');
  }finally{
    if(previousHostRoot===undefined)delete process.env.ORBIT_HOST_PROJECTS_ROOT;else process.env.ORBIT_HOST_PROJECTS_ROOT=previousHostRoot;
    if(previousContainerRoot===undefined)delete process.env.ORBIT_CONTAINER_PROJECTS_ROOT;else process.env.ORBIT_CONTAINER_PROJECTS_ROOT=previousContainerRoot;
    await rm(directory,{recursive:true,force:true});
  }
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

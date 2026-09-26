import 'reflect-metadata';
import 'dotenv/config';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {Pool} from 'pg';
import {Db} from '../db';
import {FeaturesService} from '../features';
import {OrbitEvents} from '../orbit-events';
import {ActionDispatcher} from '../action-dispatcher';
import {AutomationsService} from '../automations';
import {migrateVersions} from '../migrations';
import {ProjectRegistry} from './project-registry';
import {CardExecutionService} from './execution.service';
import {emptyConfig} from './types';

test('executable cards preserve normal cards and persist audited runs',async t=>{
  const db=new Db(),schema='execution_test_'+randomUUID().replaceAll('-',''),root=await mkdtemp(join(tmpdir(),'orbit-execution-test-'));
  await db.query(`CREATE SCHEMA ${schema}`);await db.pool.end();db.pool=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema},public`});
  const features=new FeaturesService(db),projects=new ProjectRegistry(db),dispatcher=new ActionDispatcher(),service=new CardExecutionService(db,features,projects,new OrbitEvents(),dispatcher),automations=new AutomationsService(db,features,dispatcher);
  try{
    await db.query(await readFile(resolve(__dirname,'../../sql/schema.sql'),'utf8'));await db.query(await readFile(resolve(__dirname,'../../sql/automations.sql'),'utf8'));
    await migrateVersions(db.pool);await migrateVersions(db.pool);assert.equal((await db.one('SELECT count(*)::int n FROM schema_migrations'))?.n,2);
    const user=(await db.one("INSERT INTO users(name,email,password_hash) VALUES('Test',$1,'test') RETURNING id",[randomUUID()+'@example.invalid']))!.id;
    const board=(await db.one("INSERT INTO boards(title,owner_id) VALUES('Test',$1) RETURNING id",[user]))!.id;
    await db.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'owner')",[board,user]);
    const list=(await db.one("INSERT INTO lists(board_id,title,position) VALUES($1,'Ready',0) RETURNING id",[board]))!.id;
    const review=(await db.one("INSERT INTO lists(board_id,title,position) VALUES($1,'Review',1) RETURNING id",[board]))!.id;
    const card=(await db.one("INSERT INTO cards(list_id,title,description) VALUES($1,'Card','Description') RETURNING id",[list]))!.id;
    const project=(await db.one("INSERT INTO ai_projects(owner_id,name,local_path) VALUES($1,'Project',$2) RETURNING id",[user,root]))!.id;
    await mkdir(join(root,'agents'));await mkdir(join(root,'skills'));
    await writeFile(join(root,'orbit.yaml'),'default_executor: fixture\nplugins: [filesystem]\npermissions: [filesystem.read, execution.automatic]\nagents: [developer, qa]\nexecution:\n  agent: developer\n  executor: fixture\n  action: analyze\n  skills: [review]\n  permissions: [filesystem.read]\n  context:\n    files: [selected.txt]\n');
    await writeFile(join(root,'agents/developer.md'),'---\nid: developer\nexecutor: fixture\nskills: [review]\npermissions: [filesystem.read]\n---\nDeveloper instructions');
    await writeFile(join(root,'agents/qa.md'),'---\nid: qa\nexecutor: fixture\naction: analyze\npermissions: [filesystem.read]\n---\nQA instructions');
    await writeFile(join(root,'skills/review.md'),'---\nid: review\n---\nReview');await writeFile(join(root,'selected.txt'),'Project content');
    await db.query('UPDATE cards SET ai_project_id=$2 WHERE id=$1',[card,project]);
    service.executors.register({id:'fixture',name:'Fixture',actions:[{id:'analyze',name:'Analyze',permissions:[]},{id:'fail',name:'Fail',permissions:[]},{id:'wait',name:'Wait',permissions:[]}],async execute(input){
      if(input.action==='fail')throw new Error('Expected executor failure');
      if(input.action==='wait')await new Promise<void>(resolve=>input.signal.addEventListener('abort',()=>resolve(),{once:true}));
      return {summary:'Done',outputs:[{type:'json',value:{ok:true,token:'do-not-expose'}}]};
    }});
    service.onModuleInit();automations.onModuleInit();
    const config={...emptyConfig(),enabled:true,project_id:project,agent:'developer',executor:'fixture',action:'analyze',permissions:['filesystem.read'],context:{files:['selected.txt']},integrations:[{plugin:'filesystem',action:'read',config:{path:'selected.txt'}}]};
    await t.test('project defaults prefill card execution and can be published globally',async()=>{
      const details=await service.details(card,user);assert.equal(details.execution.project_id,project);assert.equal(details.execution.agent,'developer');assert.deepEqual(details.execution.context.files,['selected.txt']);
      await service.save(card,user,{...config,context:{knowledge:[],rules:[],files:['selected.txt'],instructions:'Shared context'},save_as_project_default:true});
      assert.match(await readFile(join(root,'orbit.yaml'),'utf8'),/Shared context/);
      const refreshed=await service.details(card,user);assert.equal(refreshed.execution.context.instructions,'Shared context');
      await service.save(card,user,{...emptyConfig(),project_id:project});
    });
    await t.test('normal card needs no execution configuration',async()=>{const data=await service.details(card,user);assert.equal(data.execution.enabled,false);assert.equal(data.result.status,'idle');assert.deepEqual(data.runs,[]);await assert.rejects(()=>service.enqueue(card,user,{}));assert.equal((await db.one('SELECT title FROM cards WHERE id=$1',[card]))?.title,'Card')});
    await t.test('permissions and paths are validated before persistence',async()=>{
      await assert.rejects(()=>service.save(card,user,{...config,permissions:['filesystem.write']}));
      await assert.rejects(()=>service.save(card,user,{...config,context:{files:['/etc/passwd']}}));
      await assert.rejects(()=>service.save(card,user,{...config,integrations:[{plugin:'filesystem',action:'read',config:{token:'secret'}}]}));
      await assert.rejects(()=>service.save(card,user,{...config,executor:'unknown'}));
      await service.save(card,user,config);
    });
    await t.test('concurrent clicks create one active run and identical keys are idempotent',async()=>{
      const results=await Promise.allSettled([service.enqueue(card,user,{request_key:'one'}),service.enqueue(card,user,{request_key:'two'})]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
      const run=(await db.one("SELECT id,request_key FROM card_runs WHERE status='queued'"))!;
      assert.equal((await service.enqueue(card,user,{request_key:run.request_key})).id,run.id);
      await service.tick();const data=await service.runDetail(run.id,user);assert.equal(data.status,'success');assert.ok(data.logs.some(x=>x.stage==='resources'));
      const result=(await service.details(card,user)).result;assert.ok(result.outputs.some((x:{type:string})=>x.type==='text'));assert.ok(!JSON.stringify(result).includes('do-not-expose'));
    });
    await t.test('failures preserve history, error and stage',async()=>{await service.save(card,user,{...config,action:'fail'});const run=await service.enqueue(card,user,{});await service.tick();const data=await service.runDetail(run.id,user);assert.equal(data.status,'failed');assert.equal(data.stage,'executor');assert.match(String((data as unknown as {error:string}).error),/Expected executor failure/);assert.equal((await service.details(card,user)).runs.length,2)});
    await t.test('queued and running cancellation persist terminal state',async()=>{
      await service.save(card,user,config);const queued=await service.enqueue(card,user,{});await service.cancel(queued.id,user);assert.equal((await service.runDetail(queued.id,user)).status,'cancelled');
      await service.save(card,user,{...config,action:'wait'});const running=await service.enqueue(card,user,{}),task=service.tick();
      for(let i=0;i<100;i++){if((await db.one('SELECT stage FROM card_runs WHERE id=$1',[running.id]))?.stage==='executor')break;await new Promise(r=>setTimeout(r,10))}
      await service.cancel(running.id,user);await task;assert.equal((await service.runDetail(running.id,user)).status,'cancelled');
    });
    await t.test('results move cards and emit events handled by existing automations',async()=>{
      await service.save(card,user,{...config,automation:{on_success_list_id:review}});
      const rule=await automations.save(board,user,{name:'On complete',definition:{trigger:{type:'event',event:'execution.completed'},conditions:[],actions:[{type:'comment',value:'Execution completed'}]}});assert.ok(rule);
      const run=await service.enqueue(card,user,{});await service.tick();await automations.tick();
      assert.equal((await service.runDetail(run.id,user)).status,'success');assert.equal((await db.one('SELECT list_id FROM cards WHERE id=$1',[card]))?.list_id,review);
      assert.equal((await db.one("SELECT count(*)::int n FROM comments WHERE card_id=$1 AND body='Execution completed'",[card]))?.n,1);
    });
    await t.test('automatic rules enqueue only explicitly authorized cards and prevent cycles',async()=>{
      await service.save(card,user,{...config,mode:'automatic',permissions:['filesystem.read','execution.automatic']});
      await automations.save(board,user,{name:'Run QA',definition:{trigger:{type:'event',event:'execution.completed'},conditions:[],actions:[{type:'run_agent',value:'qa'}]}});
      await service.enqueue(card,user,{});await service.tick();await automations.tick();
      const queued=await db.one("SELECT agent FROM card_runs WHERE status='queued'");assert.equal(queued?.agent,'qa');
      await service.tick();await automations.tick();assert.equal((await db.one("SELECT count(*)::int n FROM card_runs WHERE status='queued'"))?.n,0);
    });
    await t.test('invalid project YAML is visible but does not crash the catalog',async()=>{await writeFile(join(root,'orbit.yaml'),'permissions: [');const catalog=await service.catalog(user,project);assert.ok(catalog.project!.warnings.length);await assert.rejects(()=>service.save(card,user,config))});
    await t.test('a board can have one completion list and it determines card completion',async()=>{
      const done=(await db.one("INSERT INTO lists(board_id,title,position) VALUES($1,'Done',2) RETURNING id",[board]))!.id;
      await db.query('UPDATE lists SET is_completion_list=true WHERE id=$1',[done]);
      await db.query('UPDATE cards SET list_id=$2 WHERE id=$1',[card,done]);
      assert.equal((await db.one('SELECT completed FROM cards WHERE id=$1',[card]))?.completed,true);
      await assert.rejects(()=>db.query('UPDATE lists SET is_completion_list=true WHERE id=$1',[review]));
      await db.query('UPDATE cards SET list_id=$2 WHERE id=$1',[card,list]);
      assert.equal((await db.one('SELECT completed FROM cards WHERE id=$1',[card]))?.completed,false);
    });
  }finally{service.onModuleDestroy();automations.onModuleDestroy();await db.query(`DROP SCHEMA ${schema} CASCADE`);await db.onModuleDestroy();await rm(root,{recursive:true,force:true})}
});

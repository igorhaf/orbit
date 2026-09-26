import 'reflect-metadata';
import 'dotenv/config';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Pool} from 'pg';
import {Db} from './db';
import {FeaturesService} from './features';
import {AutomationsService} from './automations';
import {Definition} from './automation-rules';

test('automation engine persists events, rolls back errors and isolates boards',async t=>{
  const db=new Db(),service=new AutomationsService(db,new FeaturesService(db));
  const schema='automation_test_'+randomUUID().replaceAll('-','');
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.pool.end();
  db.pool=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema},public`});
  await db.query(readFileSync(resolve(__dirname,'../sql/schema.sql'),'utf8'));
  await db.query(readFileSync(resolve(__dirname,'../sql/automations.sql'),'utf8'));
  const user=(await db.one('INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id',['Automation test',`automation-${randomUUID()}@example.invalid`,'test-only']))!.id;
  const boards:string[]=[];
  async function newBoard(){const b=(await db.one("INSERT INTO boards(title,owner_id) VALUES('Automation test',$1) RETURNING id",[user]))!.id;boards.push(b);await db.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'owner')",[b,user]);return b}
  try{
    const board=await newBoard(),other=await newBoard();
    const list=(await db.one("INSERT INTO lists(board_id,title,position) VALUES($1,'Todo',0) RETURNING id",[board]))!.id;
    const dest=(await db.one("INSERT INTO lists(board_id,title,position) VALUES($1,'Done',1) RETURNING id",[board]))!.id;
    const foreign=(await db.one("INSERT INTO lists(board_id,title,position) VALUES($1,'Foreign',0) RETURNING id",[other]))!.id;
    const label=(await db.one("INSERT INTO labels(board_id,name) VALUES($1,'Urgent') RETURNING id",[board]))!.id;
    const field=(await db.one("INSERT INTO custom_fields(board_id,name,type) VALUES($1,'Cost','number') RETURNING id",[board]))!.id;
    const card=(await db.one("INSERT INTO cards(list_id,title) VALUES($1,'Original') RETURNING id",[list]))!.id;
    const related=(await db.one("INSERT INTO cards(list_id,title) VALUES($1,'Related') RETURNING id",[list]))!.id;
    const make=async(name:string,d:Definition)=>{const rule=await service.save(board,user,{name,definition:d});assert.ok(rule);return rule.id as string};
    await t.test('executes twenty sequential actions and deduplicates button requests',async()=>{
      const actions:Definition['actions']=[{type:'move',value:dest},{type:'label_add',value:label},{type:'assign',value:user},{type:'field',field,value:'42'},{type:'due',value:'now + 2 business_days'},...Array.from({length:15},(_,i)=>({type:'comment' as const,value:`Step ${i}: {{title}}`}))];
      const rule=await make('Button',{trigger:{type:'card_button'},conditions:[],actions});
      const requestId=randomUUID(),result=await service.run(rule,user,{cardId:card,requestId});assert.equal(result.status,'success',JSON.stringify(result));
      assert.equal((await service.run(rule,user,{cardId:card,requestId})).status,'skipped');
      assert.equal((await db.one('SELECT list_id FROM cards WHERE id=$1',[card]))?.list_id,dest);
      assert.equal((await db.one('SELECT count(*)::int AS n FROM comments WHERE card_id=$1',[card]))?.n,15);
      assert.ok(await db.one('SELECT 1 FROM card_watchers WHERE card_id=$1 AND user_id=$2',[card,user]));
      assert.equal((await db.one('SELECT value FROM card_custom_values WHERE card_id=$1 AND field_id=$2',[card,field]))?.value,42);
    });
    await t.test('rolls back earlier actions on error and records the failure',async()=>{
      const rule=await make('Atomic failure',{trigger:{type:'card_button'},conditions:[],actions:[{type:'rename',value:'Must roll back'},{type:'field',field,value:'not a number'}]});
      assert.equal((await service.run(rule,user,{cardId:card})).status,'error');
      assert.equal((await db.one('SELECT title FROM cards WHERE id=$1',[card]))?.title,'Original');
      assert.equal((await service.logs(rule,user)).runs[0].status,'error');
    });
    await t.test('rejects foreign references and cards; supports explicit mapping for copies',async()=>{
      await assert.rejects(()=>make('Invalid',{trigger:{type:'card_button'},conditions:[],actions:[{type:'move',value:foreign}]}));
      const rule=await make('Mappable',{trigger:{type:'card_button'},conditions:[],actions:[{type:'move',value:dest}]});
      await assert.rejects(()=>service.copy(rule,user,{boardId:other}));
      const copy=await service.copy(rule,user,{boardId:other,mapping:{[dest]:foreign}});assert.ok(copy);assert.equal(copy.enabled,false);assert.equal(copy.definition.actions[0].value,foreign);
      const outsider=(await db.one("INSERT INTO cards(list_id,title) VALUES($1,'Other') RETURNING id",[foreign]))!.id;
      await assert.rejects(()=>service.run(rule,user,{cardId:outsider}));
    });
    await t.test('cascades only to cards linked by attachments',async()=>{
      await db.query("INSERT INTO attachments(card_id,kind,name,target_id) VALUES($1,'card','Related',$2)",[card,related]);
      const rule=await make('Cascade',{trigger:{type:'card_button'},conditions:[],actions:[{type:'complete',value:'true',target:'related'}]});
      assert.equal((await service.run(rule,user,{cardId:card})).status,'success');
      assert.equal((await db.one('SELECT completed FROM cards WHERE id=$1',[related]))?.completed,true);
      assert.equal((await db.one('SELECT completed FROM cards WHERE id=$1',[card]))?.completed,false);
    });
    await t.test('keeps selected cards through a sequence that changes matching conditions',async()=>{
      const rule=await make('Stable selection',{trigger:{type:'board_button'},conditions:[{field:'completed',op:'eq',value:'false'}],actions:[{type:'complete',target:'board',value:'true'},{type:'description',target:'board',value:'Still selected'}]});
      assert.equal((await service.run(rule,user,{})).status,'success');
      assert.equal((await db.one('SELECT description FROM cards WHERE id=$1',[card]))?.description,'Still selected');
      assert.equal((await db.one('SELECT description FROM cards WHERE id=$1',[related]))?.description,'');
      await db.query('UPDATE cards SET completed=false WHERE id=$1',[card]);
    });
    await t.test('processes event rules exactly once and prevents self-triggered loops',async()=>{
      const rule=await make('Event',{trigger:{type:'event',event:'card_updated'},conditions:[{field:'title',op:'eq',value:'Start'}],actions:[{type:'rename',value:'Finished'}]});
      await db.query("UPDATE cards SET title='Start' WHERE id=$1",[card]);await service.tick();await service.tick();
      assert.equal((await db.one('SELECT title FROM cards WHERE id=$1',[card]))?.title,'Finished');
      assert.equal((await db.one("SELECT count(*)::int AS n FROM automation_runs WHERE automation_id=$1 AND status='success'",[rule]))?.n,1);
    });
    await t.test('scheduled, due and reports use persistent occurrence keys',async()=>{
      const scheduled=await make('Schedule',{trigger:{type:'scheduled',frequency:'interval',intervalMinutes:60},conditions:[{field:'list_id',op:'eq',value:dest}],actions:[{type:'comment',target:'board',value:'Scheduled'}]});
      await db.query("UPDATE automations SET next_run_at=now()-interval '1 minute' WHERE id=$1",[scheduled]);
      const due=await make('Due',{trigger:{type:'due',offsetMinutes:0},conditions:[],actions:[{type:'comment',value:'Due now'}]});
      await db.query("UPDATE automations SET created_at=now()-interval '2 minutes' WHERE id=$1",[due]);
      await db.query("UPDATE cards SET due_date=now()-interval '1 minute' WHERE id=$1",[card]);
      await service.tick();await service.tick();
      for(const id of [scheduled,due])assert.equal((await db.one("SELECT count(*)::int AS n FROM automation_runs WHERE automation_id=$1 AND status='success'",[id]))?.n,1);
      const report=await make('Report',{trigger:{type:'board_button'},conditions:[],actions:[{type:'report',target:'board',report:'overdue',recipients:'test@example.invalid',subject:'{{board}}',template:'{{title}}: {{custom:'+field+'}}'}]});
      assert.equal((await service.run(report,user,{})).status,'success');
      const mail=await db.one('SELECT body FROM automation_mail WHERE automation_id=$1',[report]);assert.ok(mail?.body.includes('Finished: 42'));assert.ok(!mail?.body.includes('Related'));
      // Never deliver test messages to an external SMTP server.
      await db.query('DELETE FROM automation_mail WHERE automation_id=$1',[report]);
    });
  }finally{await db.query(`DROP SCHEMA ${schema} CASCADE`);await db.onModuleDestroy()}
});

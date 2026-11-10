import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Pool} from 'pg';
import {Db} from './db';
import {FeaturesService} from './features';
import {AccessService} from './access/access';
import {migrateVersions} from './migrations';

test('Inbox assignment preserves the original board, hierarchy and other assignees and respects revocation',async()=>{
 const db=new Db(),schema='inbox_test_'+randomUUID().replaceAll('-','');
 await db.query(`CREATE SCHEMA ${schema}`);await db.pool.end();
 db.pool=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema},public`});
 try{
  await db.query(await readFile(resolve(__dirname,'../sql/schema.sql'),'utf8'));
  await db.query(await readFile(resolve(__dirname,'../sql/pre-022-compat.sql'),'utf8'));await migrateVersions(db.pool);
  const user=(await db.one("INSERT INTO users(name,email,password_hash,is_root) VALUES('Inbox user',$1,'x',true) RETURNING id",[randomUUID()+'@example.invalid']))!.id;
  const other=(await db.one("INSERT INTO users(name,email,password_hash) VALUES('Other assignee',$1,'x') RETURNING id",[randomUUID()+'@example.invalid']))!.id;
  const board=(await db.one("INSERT INTO boards(title,owner_id) VALUES('Source board',$1) RETURNING id",[user]))!.id;
  const list=(await db.one("INSERT INTO lists(board_id,title) VALUES($1,'Review') RETURNING id",[board]))!.id;
  const parent=(await db.one("INSERT INTO cards(list_id,title) VALUES($1,'Context') RETURNING id",[list]))!.id;
  const card=(await db.one("INSERT INTO cards(list_id,title,position,description) VALUES($1,'Review task',7,'Keep source data') RETURNING id",[list]))!.id;
  await db.query('INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,\'owner\')',[board,user]);
  await db.query('INSERT INTO card_assignees(card_id,user_id) VALUES($1,$2)',[card,other]);
  await db.query('INSERT INTO structured_view_parents(card_id,parent_card_id) VALUES($1,$2)',[card,parent]);
  await db.query('INSERT INTO card_contexts(card_id,context_card_id) VALUES($1,$2)',[card,parent]);
  const access=new AccessService(db),features=new FeaturesService(db,undefined,access);let enabled=true;
  // This also exercises private boards whose access is supplied by a plugin, for ROOT.
  access.registerBoardAccessProvider(async(key,actor)=>key===board?enabled&&actor===user:null);
  const before=await db.one('SELECT list_id,position,description FROM cards WHERE id=$1',[card]);
  await features.assignToInbox(user,{card_ids:[card,card]});await features.assignToInbox(user,{card_ids:[card]});
  assert.deepEqual(await db.one('SELECT list_id,position,description FROM cards WHERE id=$1',[card]),before);
  assert.equal((await db.one('SELECT parent_card_id FROM structured_view_parents WHERE card_id=$1',[card]))!.parent_card_id,parent);
  assert.equal((await db.one('SELECT context_card_id FROM card_contexts WHERE card_id=$1',[card]))!.context_card_id,parent);
  assert.deepEqual(new Set((await db.query('SELECT user_id FROM card_assignees WHERE card_id=$1',[card])).map(row=>row.user_id)),new Set([user,other]));
  assert.equal((await db.one('SELECT count(*)::int AS count FROM card_watchers WHERE card_id=$1 AND user_id=$2',[card,user]))!.count,1);
  assert.equal((await db.one("SELECT count(*)::int AS count FROM activities WHERE card_id=$1 AND kind='assigned'",[card]))!.count,1);
  assert.deepEqual((await features.assignedCards(user)).map(row=>row.id),[card]);
  await assert.rejects(()=>features.assignToInbox(other,{card_ids:[card]}));
  enabled=false;assert.deepEqual(await features.assignedCards(user),[]);await assert.rejects(()=>features.assignToInbox(user,{card_ids:[card]}));
  enabled=true;
  const archived=(await db.one("INSERT INTO cards(list_id,title,archived_at) VALUES($1,'Archived',now()) RETURNING id",[list]))!.id;
  await assert.rejects(()=>features.assignToInbox(user,{card_ids:[parent,archived]}));
  assert.equal(await db.one('SELECT 1 FROM card_assignees WHERE card_id=$1 AND user_id=$2',[parent,user]),null);
  await assert.rejects(()=>features.assignToInbox(user,{card_ids:[card],user_id:other}),/Selecione/);
  await assert.rejects(()=>features.assignToInbox(user,{card_ids:[]}),/Selecione/);
 }finally{await db.query(`DROP SCHEMA ${schema} CASCADE`);await db.onModuleDestroy()}
});

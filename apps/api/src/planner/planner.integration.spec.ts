import "reflect-metadata";
import "dotenv/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { Db } from "../db";
import { FeaturesService } from "../features";
import { CodexAiService } from "../codex-ai";
import { PluginRegistry } from "../execution/registries";
import { migrateVersions } from "../migrations";
import { PlannerPlugin, plannerPluginDefinition } from "./planner.plugin";

test("Planner plugin owns focus blocks, preserves legacy blocks and isolates boards", async () => {
  const schema = "planner_test_" + randomUUID().replaceAll("-", "");
  const db = new Db();
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.pool.end();
  db.pool = new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema},public`});
  try {
    await db.query(readFileSync(resolve(__dirname,"../../sql/schema.sql"),"utf8"));
    const user = (await db.one<{id:string}>("INSERT INTO users(name,email,password_hash) VALUES('Planner owner',$1,'x') RETURNING id",[`planner-${randomUUID()}@example.invalid`]))!.id;
    const outsider = (await db.one<{id:string}>("INSERT INTO users(name,email,password_hash) VALUES('Planner outsider',$1,'x') RETURNING id",[`outsider-${randomUUID()}@example.invalid`]))!.id;
    const board = (await db.one<{id:string}>("INSERT INTO boards(title,owner_id) VALUES('Planner board',$1) RETURNING id",[user]))!.id;
    const privateBoard = (await db.one<{id:string}>("INSERT INTO boards(title,owner_id) VALUES('Private board',$1) RETURNING id",[outsider]))!.id;
    await db.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'owner'),($3,$4,'owner')",[board,user,privateBoard,outsider]);
    const list = (await db.one<{id:string}>("INSERT INTO lists(board_id,title) VALUES($1,'Tasks') RETURNING id",[board]))!.id;
    const privateList = (await db.one<{id:string}>("INSERT INTO lists(board_id,title) VALUES($1,'Private tasks') RETURNING id",[privateBoard]))!.id;
    const card = (await db.one<{id:string}>("INSERT INTO cards(list_id,title,due_date) VALUES($1,'Review','2026-10-01T14:00:00Z') RETURNING id",[list]))!.id;
    const privateCard = (await db.one<{id:string}>("INSERT INTO cards(list_id,title,due_date) VALUES($1,'Secret','2026-10-01T14:00:00Z') RETURNING id",[privateList]))!.id;
    const old = (await db.one<{id:string}>("INSERT INTO focus_blocks(user_id,title,starts_at,ends_at) VALUES($1,'Old focus','2026-10-01T09:00:00Z','2026-10-01T10:00:00Z') RETURNING id",[user]))!.id;
    await db.query("INSERT INTO focus_block_cards(focus_block_id,card_id) VALUES($1,$2)",[old,card]);
    await migrateVersions(db.pool);
    const planner = new PlannerPlugin(db,new FeaturesService(db),new CodexAiService());
    const registry = new PluginRegistry();
    registry.register(plannerPluginDefinition(planner));
    assert.deepEqual(registry.catalog()[0].contributions.navigation,[{id:"planner",label:"Planner",href:"/planner",icon:"calendar-clock"}]);
    assert.equal(registry.getAction("planner","create_block").requiredCapabilities?.[0],"plan.write");

    const initial = await planner.workspace(user);
    assert.equal(initial.events.length,1);
    assert.equal(initial.events[0].id,old);
    assert.equal(initial.events[0].cards[0].id,card);
    assert.deepEqual(initial.cards.map(item=>item.id),[card]);
    assert.equal((await planner.workspace(user,board)).cards.length,1);
    await assert.rejects(()=>planner.workspace(user,privateBoard),/Quadro não encontrado/);
    const before = (await db.one<{count:number}>("SELECT count(*)::int AS count FROM focus_events WHERE user_id=$1",[user]))!.count;
    await assert.rejects(()=>planner.createFocus(user,{title:"Forbidden",starts_at:"2026-10-01T11:00:00Z",ends_at:"2026-10-01T12:00:00Z",card_id:privateCard}),/Quadro não encontrado/);
    assert.equal((await db.one<{count:number}>("SELECT count(*)::int AS count FROM focus_events WHERE user_id=$1",[user]))!.count,before);
    const created = await planner.createFocus(user,{title:"New focus",starts_at:"2026-10-01T11:00:00Z",ends_at:"2026-10-01T12:00:00Z",card_id:card});
    const updated = await planner.workspace(user,board);
    assert.equal(updated.events.length,2);
    assert.equal(updated.events.find(item=>item.id===created.id)?.cards[0].id,card);
    const aiCompatible = await planner.createFocusBlock(user,{title:"Suggested focus",starts_at:"2026-10-01T12:00:00Z",ends_at:"2026-10-01T13:00:00Z",card_ids:[card]});
    assert.equal((await planner.workspace(user)).events.find(item=>item.id===aiCompatible.id)?.cards[0].id,card);
    const action = registry.getAction("planner","list_blocks");
    const actionOutput = await action.execute?.({}, {userId:user});
    assert.equal(actionOutput?.type,"planner");
    await planner.unlinkFocus(user,created.id,card);
    assert.deepEqual((await planner.workspace(user)).events.find(item=>item.id===created.id)?.cards,[]);
    await planner.linkFocus(user,created.id,card);
    assert.equal((await planner.workspace(user)).events.find(item=>item.id===created.id)?.cards[0].id,card);
  } finally {
    await db.onModuleDestroy();
    const cleanup = new Db();
    try { await cleanup.query(`DROP SCHEMA ${schema} CASCADE`); } finally { await cleanup.onModuleDestroy(); }
  }
});

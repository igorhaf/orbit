import "reflect-metadata";
import "dotenv/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { Db } from "../db";
import { migrateVersions } from "../migrations";
import { OrbitCardCalendarSource } from "./orbit-card-provider";
import { CalendarService } from "./calendar.service";
import { CalendarSourceRegistry } from "./source-registry";
import { FeaturesService } from "../features";

test("calendar migration persists multiple accounts, sources, mirror items and scheduled Orbit Cards", async () => {
  const db = new Db(),
    schema = "calendar_test_" + randomUUID().replaceAll("-", "");
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.pool.end();
  db.pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schema},public`,
  });
  try {
    await db.query(
      readFileSync(resolve(__dirname, "../../sql/schema.sql"), "utf8"),
    );
    await migrateVersions(db.pool);
    const user = (await db.one<{ id: string }>(
      "INSERT INTO users(name,email,password_hash) VALUES('Calendar test',$1,'x') RETURNING id",
      [`calendar-${randomUUID()}@example.invalid`],
    ))!.id;
    const board = (await db.one<{ id: string }>(
      "INSERT INTO boards(title,owner_id) VALUES('Calendar',$1) RETURNING id",
      [user],
    ))!.id;
    await db.query(
      "INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'owner')",
      [board, user],
    );
    const list = (await db.one<{ id: string }>(
      "INSERT INTO lists(board_id,title) VALUES($1,'Scheduled') RETURNING id",
      [board],
    ))!.id;
    const card = (await db.one<{ id: string }>(
      "INSERT INTO cards(list_id,title,schedule_start_at,schedule_end_at,schedule_time_zone) VALUES($1,'Review','2026-10-01T13:00Z','2026-10-01T14:00Z','America/Recife') RETURNING id",
      [list],
    ))!.id;
    const orbit = new OrbitCardCalendarSource(db),
      sources = await orbit.listSources(user),
      items = await orbit.listItems(
        user,
        [sources[0].id],
        new Date("2026-10-01T00:00Z"),
        new Date("2026-10-02T00:00Z"),
      );
    assert.equal(items.length, 1);
    assert.equal(items[0].cardId, card);
    assert.equal(items[0].metadata.boardId, board);
    const otherBoard = (await db.one<{id:string}>("INSERT INTO boards(title,owner_id) VALUES('Other calendar board',$1) RETURNING id",[user]))!.id;
    await db.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'owner')",[otherBoard,user]);
    const otherList = (await db.one<{id:string}>("INSERT INTO lists(board_id,title) VALUES($1,'Other target') RETURNING id",[otherBoard]))!.id;
    const sourceId = (await db.one<{id:string}>("INSERT INTO calendar_sources(owner_id,provider_id,external_id,name) VALUES($1,'fixture','source','Fixture') RETURNING id",[user]))!.id;
    const calendar = new CalendarService(db,new FeaturesService(db),new CalendarSourceRegistry());
    await assert.rejects(()=>calendar.updateSource(user,sourceId,{auto_create_cards:true,target_board_id:board,target_list_id:otherList}),/pertencer ao quadro de destino/);
    await db.query("INSERT INTO calendar_source_settings(source_id,target_board_id,target_list_id) VALUES($1,$2,$3)",[sourceId,board,list]);
    await assert.rejects(()=>calendar.updateSource(user,sourceId,{target_list_id:otherList}),/pertencer ao quadro de destino/);
    const sealed = "test-ciphertext";
    const first = (await db.one<{ id: string }>(
      "INSERT INTO integration_connections(owner_id,plugin_id,external_account_id,display_name,credentials_encrypted) VALUES($1,'google_calendar','a','A',$2) RETURNING id",
      [user, sealed],
    ))!.id;
    const second = (await db.one<{ id: string }>(
      "INSERT INTO integration_connections(owner_id,plugin_id,external_account_id,display_name,credentials_encrypted) VALUES($1,'google_calendar','b','B',$2) RETURNING id",
      [user, sealed],
    ))!.id;
    assert.notEqual(first, second);
    for (const [connection, external] of [
      [first, "personal"],
      [first, "family"],
      [second, "development"],
    ])
      await db.query(
        "INSERT INTO calendar_sources(owner_id,provider_id,connection_id,external_id,name,selected) VALUES($1,'google_calendar',$2,$3,$3,true)",
        [user, connection, external],
      );
    assert.equal(
      (await db.one<{ count: number }>(
        "SELECT count(*)::int AS count FROM calendar_sources WHERE owner_id=$1 AND provider_id=$2",
        [user, "google_calendar"],
      ))!.count,
      3,
    );
    const microsoft = (await db.one<{ id: string }>(
      "INSERT INTO integration_connections(owner_id,plugin_id,external_account_id,display_name,credentials_encrypted,capabilities) VALUES($1,'microsoft','tenant:user','Microsoft',$2,$3) RETURNING id",
      [user, sealed, JSON.stringify({outlookCalendar:true,teamsOnlineMeetings:true})],
    ))!.id;
    const outlookSource = (await db.one<{id:string}>(
      "INSERT INTO calendar_sources(owner_id,provider_id,connection_id,external_id,name,selected) VALUES($1,'outlook_calendar',$2,'personal','Outlook',true) RETURNING id",
      [user,microsoft],
    ))!.id;
    await db.query(
      "INSERT INTO external_resources(owner_id,plugin_id,connection_id,resource_type,external_id) VALUES($1,'outlook_calendar',$2,'calendar_event','event-1')",
      [user,microsoft],
    );
    assert.equal((await db.one<{count:number}>("SELECT count(*)::int count FROM external_resources WHERE owner_id=$1 AND external_id='event-1'",[user]))!.count,1);
    assert.notEqual(outlookSource,sources[0].id);
    assert.equal((await db.one<{count:number}>("SELECT count(*)::int count FROM calendar_sources WHERE owner_id=$1 AND selected",[user]))!.count,5);
    await db.query(
      "INSERT INTO external_resources(owner_id,plugin_id,connection_id,resource_type,external_id,orbit_entity_type,orbit_entity_id) VALUES($1,'google_calendar',$2,'calendar_event','event-1','card',$3)",
      [user, first, card],
    );
    assert.equal(
      (await db.one<{ orbit_entity_id: string }>(
        "SELECT orbit_entity_id FROM external_resources WHERE owner_id=$1 AND plugin_id='google_calendar' AND external_id=$2",
        [user, "event-1"],
      ))!.orbit_entity_id,
      card,
    );
  } finally {
    await db.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => undefined);
    await db.onModuleDestroy();
  }
});

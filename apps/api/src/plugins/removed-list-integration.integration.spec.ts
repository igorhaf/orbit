import 'dotenv/config';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Pool} from 'pg';
test('retired list integration removal preserves linked Orbit content and other plugins',async()=>{
 const url=new URL(process.env.DATABASE_URL!);url.hostname=process.env.ORBIT_SELENIUM_DB_HOST||url.hostname;url.username=execFileSync('docker',['exec','orbit-db-dev','printenv','POSTGRES_USER'],{encoding:'utf8'}).trim();url.password=execFileSync('docker',['exec','orbit-db-dev','printenv','POSTGRES_PASSWORD'],{encoding:'utf8'}).trim();
 const pool=new Pool({connectionString:url.toString()}),client=await pool.connect(),schema=`removed_lists_${randomUUID().replaceAll('-','')}`;
 try{
  await client.query(`CREATE SCHEMA ${schema}`);await client.query(`SET search_path TO ${schema}`);
  for(const table of ['users','boards','lists','cards','checklist_items','integration_connections','oauth_states','plugin_settings'])await client.query(`CREATE TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
  await client.query(await readFile(resolve(__dirname,'../../sql/migrations/061_alexa.sql'),'utf8'));
  const owner=randomUUID(),board=randomUUID(),list=randomUUID(),card=randomUUID(),account=randomUUID();
  await client.query('INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4)',[owner,'Fixture',`${owner}@example.invalid`,'fixture']);await client.query('INSERT INTO boards(id,title,owner_id) VALUES($1,$2,$3)',[board,'Preserved',owner]);await client.query('INSERT INTO lists(id,board_id,title) VALUES($1,$2,$3)',[list,board,'Preserved']);await client.query('INSERT INTO cards(id,list_id,title) VALUES($1,$2,$3)',[card,list,'Preserved']);
  await client.query("INSERT INTO integration_connections(id,owner_id,plugin_id,external_account_id,display_name,credentials_encrypted) VALUES($1,$2,'alexa','fixture','Retired','fixture')",[account,owner]);await client.query("INSERT INTO integration_connections(owner_id,plugin_id,external_account_id,display_name,credentials_encrypted) VALUES($1,'cloudflare-tunnel','fixture','Preserved','unchanged')",[owner]);await client.query("INSERT INTO plugin_settings(plugin_id,enabled) VALUES('alexa',true),('cloudflare-tunnel',true)");
  const binding=(await client.query("INSERT INTO alexa_column_bindings(column_id,account_id,external_list_key,external_list_name,list_type) VALUES($1,$2,'fixture','Fixture','SHOP') RETURNING id",[list,account])).rows[0].id;await client.query("INSERT INTO alexa_card_bindings(binding_id,card_id,external_item_key,identity_kind,baseline_encrypted) VALUES($1,$2,'fixture','fixture','fixture')",[binding,card]);
  const sql=await readFile(resolve(__dirname,'../../sql/migrations/062_remove_alexa_lists.sql'),'utf8');await client.query(sql);await client.query(sql);
  for(const table of ['alexa_previews','alexa_card_bindings','alexa_column_bindings','alexa_exports'])assert.equal((await client.query('SELECT to_regclass($1) AS name',[`${schema}.${table}`])).rows[0].name,null);
  for(const table of ['users','boards','lists','cards'])assert.equal((await client.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,1);
  assert.deepEqual((await client.query('SELECT plugin_id,credentials_encrypted FROM integration_connections')).rows,[{plugin_id:'cloudflare-tunnel',credentials_encrypted:'unchanged'}]);assert.deepEqual((await client.query('SELECT plugin_id,enabled FROM plugin_settings')).rows,[{plugin_id:'cloudflare-tunnel',enabled:true}]);
 }finally{await client.query('SET search_path TO public');await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);client.release();await pool.end()}
});

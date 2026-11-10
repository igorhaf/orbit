import pg from 'pg';
import jwt from 'jsonwebtoken';
import assert from 'node:assert/strict';
const db=new pg.Pool({connectionString:process.env.DATABASE_URL});
try{
 const {rows:[root]}=await db.query('SELECT id,session_version FROM users WHERE is_root AND NOT disabled LIMIT 1');
 const token=jwt.sign({sub:root.id,version:root.session_version},process.env.JWT_SECRET,{expiresIn:'5m'});
 const headers={authorization:`Bearer ${token}`,'content-type':'application/json'};
 const url='http://127.0.0.1:4003';
 let response=await fetch(url+'/plugins/project-boards',{method:'PATCH',headers,body:JSON.stringify({enabled:false})});assert.equal(response.status,200,await response.text());
 const catalog=await (await fetch(url+'/plugins',{headers})).json();assert.equal(catalog.plugins.find(p=>p.id==='project-boards').enabled,false);
 const before=(await db.query('SELECT (SELECT count(*) FROM boards)::int AS boards,(SELECT count(*) FROM ai_projects)::int AS projects')).rows[0];
 for(const path of ['/boards','/boards/','/boards/495b6416-cd7d-48a4-a5d8-cc7e53de0647/copy','/ai/projects','/ai/projects/directories']){
  response=await fetch(url+path,{method:'POST',headers,body:JSON.stringify({title:'Must not be created',name:'Must not be created'})});assert.equal(response.status,409,await response.text());console.log('ROOT creation blocked:',path);
 }
 for(const path of ['/boards','/ai/projects']){response=await fetch(url+path,{headers});assert.equal(response.status,200);console.log('Read preserved:',path)}
 const after=(await db.query('SELECT (SELECT count(*) FROM boards)::int AS boards,(SELECT count(*) FROM ai_projects)::int AS projects')).rows[0];assert.deepEqual(before,after);
 const state=(await db.query("SELECT enabled FROM plugin_settings WHERE plugin_id='project-boards'")).rows[0];assert.equal(state.enabled,false);
 console.log('SafDoulas: configuration persisted, no resource created, accreditation plugin preserved:',catalog.plugins.find(p=>p.id==='safdoulas-casework').enabled);
}finally{await db.end()}

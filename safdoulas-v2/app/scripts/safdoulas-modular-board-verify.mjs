import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import pg from 'pg';
import jwt from 'jsonwebtoken';
const dir='/home/meada/projetos/orbit/safdoulas-v2/data/reports';
const manifest=JSON.parse(await readFile(join(dir,'safdoulas-demo-manifest.json'),'utf8'));
const credentials=JSON.parse(await readFile(join(dir,'safdoulas-demo-credentials.json'),'utf8'));
const db=new pg.Pool({connectionString:process.env.DATABASE_URL});
const results=[];
async function request(path,token,expected=200,body) {
 const response=await fetch('http://127.0.0.1:4003'+path,{method:body?'PATCH':'GET',headers:{authorization:`Bearer ${token}`,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
 const text=await response.text();results.push({path,status:response.status,expected});assert.equal(response.status,expected,text.slice(0,200));return text?JSON.parse(text):null;
}
try {
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/safdoulas');
 const {rows:[root]}=await db.query('SELECT id,session_version FROM users WHERE is_root AND NOT disabled LIMIT 1');
 const token=jwt.sign({sub:root.id,version:root.session_version},process.env.JWT_SECRET,{expiresIn:'5m'});
 const {rows:collections}=await db.query('SELECT id FROM boards WHERE is_collection');
 const before=Number((await db.query('SELECT count(*) FROM cards c JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id WHERE b.is_collection')).rows[0].count);
 await request('/plugins/collections',token,200,{enabled:false});
 const catalog=await request('/plugins',token);
 assert.equal(catalog.plugins.find(plugin=>plugin.id==='collections').enabled,false);
 assert.equal(catalog.plugins.find(plugin=>plugin.id==='process-board').enabled,true);
 const boards=catalog.plugins.filter(plugin=>plugin.enabled).flatMap(plugin=>plugin.contributions?.processBoards||[]);
 assert.equal(boards.length,0);assert.equal(catalog.plugins.filter(plugin=>plugin.enabled).flatMap(plugin=>plugin.contributions?.boardCreators||[]).filter(item=>item.id==='safdoulas-course').length,1);
 const native=await request('/boards',token);assert.ok(!native.some(board=>board.is_collection));
 assert.equal(native.filter(board=>board.record_scope).length,3);
 for(const collection of collections) await request(`/boards/${collection.id}`,token,404);
 const courses=await request(`/safdoulas/casework/workspaces/${manifest.workspace_id}`,token);
 assert.equal(courses.processes.length,3);assert.ok(courses.processes.every(process=>process.display_title.includes('Formação em Doulagem')));
 for(const process of courses.processes){
  const data=await request(`/safdoulas/casework/processes/${process.id}`,token);
  assert.equal(data.stage_groups.length,9);assert.equal(data.stage_groups.filter(stage=>stage.current).length,1);
  const ids=data.stage_groups.flatMap(stage=>stage.records.map(record=>record.id));assert.equal(ids.length,new Set(ids).size);
  assert.equal(ids.length,data.records.length);
 }
 const account=credentials.governanca;
 const response=await fetch('http://127.0.0.1:4003/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:account.email,password:account.password})});assert.equal(response.status,201);
 const session=await response.json();
 const me=await request('/auth/me',session.token);assert.ok(me.permissions.includes('views.structured.use'));assert.ok(me.permissions.includes('plugin.process-board.read'));
 await request(`/safdoulas/casework/workspaces/${manifest.workspace_id}`,session.token);
 const after=Number((await db.query('SELECT count(*) FROM cards c JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id WHERE b.is_collection')).rows[0].count);assert.equal(before,after);
 assert.equal(Number((await db.query('SELECT count(*) FROM authorized_board_members a JOIN boards b ON b.id=a.board_id WHERE b.is_collection')).rows[0].count),0);
 await writeFile(join(dir,'validacao-quadro-modular.json'),JSON.stringify({date:'2026-10-21',results,passed:true,groups:3,phases_per_group:9,collections_preserved:after,browser:'Não executado por restrição do host.'},null,2),{mode:0o600});
 console.log('3 quadros de curso, 9 fases fixas por quadro, RBAC e Coleções desativadas com dados preservados: validados.');
} finally {await db.end()}

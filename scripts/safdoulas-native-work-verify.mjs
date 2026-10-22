import pg from 'pg';import jwt from 'jsonwebtoken';import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';
const db=new pg.Pool({connectionString:process.env.DATABASE_URL});const credentials=JSON.parse(await readFile('/home/meada/projetos/orbit/safdoulas-v2/data/reports/safdoulas-demo-credentials.json','utf8'));
async function tokenFor(id){const{rows:[u]}=await db.query('SELECT id,session_version FROM users WHERE id=$1',[id]);return jwt.sign({sub:u.id,version:u.session_version},process.env.JWT_SECRET,{expiresIn:'10m'})}
async function request(token,path,method='GET',body){const r=await fetch('http://127.0.0.1:4003'+path,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();return{status:r.status,body:text?JSON.parse(text):null}}
try{
 const{rows:[root]}=await db.query('SELECT id FROM users WHERE is_root AND NOT disabled LIMIT 1');const rootToken=await tokenFor(root.id);const all=await request(rootToken,'/record-cards/mine');assert.equal(all.status,200);assert.equal(all.body.length,3);
 for(const card of all.body){const sync=await request(rootToken,`/record-cards/safdoulas-processes/records/${card.record_id}`,'POST',{});assert.equal(sync.status,201);assert.equal(sync.body.card_id,card.id);const scope=await request(rootToken,`/record-cards/boards/${card.board_id}`);assert.equal(scope.status,200);assert.equal(scope.body.phases.length,9);assert.equal(scope.body.templates.length,8);assert.ok(scope.body.phases.every(p=>p.list_id));const board=await request(rootToken,`/boards/${card.board_id}`);assert.equal(board.status,200);assert.equal(board.body.lists.length,9);assert.ok(board.body.record_scope.fixed_scope);const invalid=await request(rootToken,`/record-cards/boards/${card.board_id}/templates/arbitrary`,'POST',{operation_key:crypto.randomUUID()});assert.equal(invalid.status,404);}
 const visible=await request(rootToken,'/boards');assert.equal(visible.body.filter(b=>all.body.some(c=>c.board_id===b.id)).length,3);
 for(const key of ['governanca','diretoria','gt','instituicao','representante','acreditadora','observador','publico']){
  const token=await tokenFor(credentials[key].id);const mine=await request(token,'/record-cards/mine');assert.ok([200,403].includes(mine.status));const permitted=mine.status===200?mine.body:[];
  for(const card of all.body){const response=await request(token,`/cards/${card.id}/details`);const allowed=permitted.some(p=>p.id===card.id);assert.equal(response.status,allowed?200:403,`${key}: protected native card`)}
  console.log(key,'authorized native cards:',permitted.length);
 }
 const workspace=all.body[0].workspace_id;const options=await request(rootToken,`/safdoulas/casework/workspaces/${workspace}/boards`);assert.equal(options.status,200);assert.ok(options.body.rules.length);assert.ok(options.body.courses.length>=3);
 const selected=options.body.courses[0];const rules=options.body.rules[0];const existing=await request(rootToken,`/safdoulas/casework/workspaces/${workspace}/boards`,'POST',{course_id:selected.id,ruleset_id:rules.id,operation_key:crypto.randomUUID()});assert.equal(existing.status,201);assert.ok(all.body.some(card=>card.board_id===existing.body.board_id));
 const free=await request(rootToken,`/safdoulas/casework/workspaces/${workspace}/boards`,'POST',{course_id:selected.id,ruleset_id:rules.id,operation_key:crypto.randomUUID(),title:'arbitrary'});assert.equal(free.status,400);
 const phase=await request(rootToken,`/boards/${all.body[0].board_id}/lists`,'POST',{title:'arbitrary'});assert.equal(phase.status,409);
 const core=await request(rootToken,'/boards','POST',{title:'arbitrary'});assert.equal(core.status,409);
 const card=all.body.find(c=>c.state==='draft');const before=await request(rootToken,`/record-cards/safdoulas-processes/records/${card.record_id}`,'POST',{});assert.equal(before.status,201);assert.equal(before.body.card_id,card.id);
 const blocked=await request(rootToken,`/cards/${card.id}`,'PATCH',{list_id:'00000000-0000-4000-8000-000000000001'});assert.equal(blocked.status,409);
 const bulk=await request(rootToken,'/cards/move','POST',{card_ids:[card.id]});assert.equal(bulk.status,409);
 const shared=await request(rootToken,`/boards/${card.board_id}/members`,'POST',{});assert.equal(shared.status,409);
 const{rows:[counts]}=await db.query('SELECT count(*)::int AS links FROM record_card_links');assert.equal(counts.links,3);
 console.log('Native cards, idempotency, RBAC, visible scoped course boards, bulk movement and sharing: PASS');
}finally{await db.end()}

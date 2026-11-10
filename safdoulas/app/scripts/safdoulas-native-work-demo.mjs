import pg from 'pg';import jwt from 'jsonwebtoken';import assert from 'node:assert/strict';
const db=new pg.Pool({connectionString:process.env.DATABASE_URL});
try{
 const{rows:[u]}=await db.query('SELECT id,session_version FROM users WHERE is_root AND NOT disabled LIMIT 1');const token=jwt.sign({sub:u.id,version:u.session_version},process.env.JWT_SECRET,{expiresIn:'10m'});const headers={authorization:`Bearer ${token}`,'content-type':'application/json'};
 async function req(path,method='GET',body){const r=await fetch('http://127.0.0.1:4003'+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});const t=await r.text();assert.ok(r.ok,t);return t?JSON.parse(t):null}
 const courses=await req('/record-cards/mine');assert.equal(courses.length,3);
 const tasks={draft:['Conferir os dados cadastrais do curso e da instituição','Revisar a proposta pedagógica e a matriz curricular vinculadas','Conferir os documentos antes da submissão formal'],review:['Acompanhar os pareceres das acreditadoras designadas','Conferir a necessidade de complementação documental','Preparar o acompanhamento da etapa de deliberação'],decision:['Conferir a decisão e os documentos de concessão','Revisar a disponibilização das informações autorizadas','Registrar o acompanhamento posterior à concessão']};
 for(const course of courses){
  const rows=(await db.query('SELECT id FROM checklists WHERE card_id=$1',[course.id])).rows;
  if(!rows.length){const checklist=await req(`/cards/${course.id}/checklists`,'POST',{title:'Acompanhamento do curso'});const items=await req(`/checklists/${checklist.id}/items`,'POST',{text:tasks[course.state].join('\n')});assert.equal(items.length,3);if(course.state==='decision')for(const item of items)await req(`/checklist-items/${item.id}`,'PATCH',{completed:true});}
  if(!(await db.query('SELECT 1 FROM comments WHERE card_id=$1 LIMIT 1',[course.id])).rowCount)await req(`/cards/${course.id}/comments`,'POST',{body:'O acompanhamento operacional está centralizado neste cartão. Documentos, requisitos e decisões formais permanecem nos registros vinculados e conservam suas permissões e versões.'});
 }
 const draft=courses.find(c=>c.state==='draft');const current=(await db.query('SELECT schedule_start_at,due_date FROM cards WHERE id=$1',[draft.id])).rows[0];
 if(!current.schedule_start_at){const start=new Date(Date.now()+5*86400000);await req(`/cards/${draft.id}`,'PATCH',{due_date:start.toISOString(),schedule:{startAt:start.toISOString(),endAt:new Date(start.getTime()+1800000).toISOString(),allDay:false,timeZone:'America/Recife'}})}
 const overview=await req('/record-cards/mine');assert.equal(overview.reduce((sum,c)=>sum+c.pending_items,0),6);assert.ok(overview.every(c=>c.comments>=1));
 const sources=await req('/calendar/sources');const response=await req(`/calendar/items?start=${encodeURIComponent(new Date().toISOString())}&end=${encodeURIComponent(new Date(Date.now()+8*86400000).toISOString())}`);
 const calendar=Array.isArray(response)?response:response.items;assert.ok(calendar.some(item=>item.cardId===draft.id&&item.metadata.recordHref));
 console.log('3 course cards: native comments and checklists persisted; 6 pending items; completed course checklist checked; scheduled draft visible in native calendar.');
}finally{await db.end()}

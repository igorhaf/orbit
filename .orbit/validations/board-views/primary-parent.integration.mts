import fs from 'node:fs';import assert from 'node:assert/strict';
import {api,pool} from '../../planning/safdoulas/client.mjs';
import {cardHierarchy,structuredRows} from '../../../apps/web/plugins/board-views/hierarchy';
const plan=JSON.parse(fs.readFileSync('.orbit/planning/safdoulas/plan.json','utf8'));
const card=(code:string)=>plan.cards.find((c:{code:string})=>c.code===code).id;
const route=(id:string)=>`/boards/${plan.boardId}/views/structured/cards/${id}/parent`;
try{
 const relations=await api(`/boards/${plan.boardId}/views/structured/relations`);
 const board=await api(`/boards/${plan.boardId}`),cards=board.lists.flatMap((l:{cards:unknown[]})=>l.cards);
 const graph=cardHierarchy(cards,relations.links),rows=structuredRows(cards,graph,new Set(cards.map((c:{id:string})=>c.id)),true,[]);
 assert.equal(rows.length,120);assert.equal(new Set(rows.map(r=>r.card.id)).size,120);
 for(const planned of plan.cards.filter((c:{code:string})=>/^D\d+$/.test(c.code)))assert.equal(graph.parents.get(planned.id)?.[0],planned.contexts[0]);
 const a=card('REF11'),b=card('REF12'),c=card('REF13');
 const previous=new Map(relations.links.filter((link:{cardId:string})=>[a,b].includes(link.cardId)).map((link:{cardId:string;contextId:string})=>[link.cardId,link.contextId]));
 const associations=(await api(`/cards/${a}/contexts`)).selected;
 try{
  await api(route(a),'PATCH',{parentId:b});
  const inherited=(await api(`/cards/${a}/contexts`));assert.ok(inherited.inherited.some((ref:{id:string})=>ref.id===b));assert.deepEqual(inherited.selected,associations);
  await assert.rejects(()=>api(route(b),'PATCH',{parentId:a}),/409.*ciclo/);
  await assert.rejects(()=>api(route(a),'PATCH',{parentId:a}),/400.*próprio pai/);
  const orbit=await api('/boards/f4b95709-9f83-428a-9fda-7ddfedf189f8');const foreign=orbit.lists.flatMap((l:{cards:{id:string}[]})=>l.cards)[0].id;
  await assert.rejects(()=>api(route(a),'PATCH',{parentId:foreign}),/400.*disponíveis neste quadro/);
  await api(route(a),'PATCH',{parentId:c});const moved=await api(`/cards/${a}/contexts`);
  assert.ok(moved.inherited.some((ref:{id:string})=>ref.id===c));assert.ok(!moved.inherited.some((ref:{id:string})=>ref.id===b));assert.deepEqual(moved.selected,associations);
  const children=await api(`/cards/${c}/contexts`);assert.ok(children.children.some((ref:{id:string})=>ref.id===a));
 }finally{for(const id of [a,b])await api(route(id),'PATCH',{parentId:previous.get(id)||null});}
 console.log('PASS: 120 unique cards; 94 demands under planned journeys; cycles/self/foreign parents rejected; move recalculates inheritance without altering explicit contexts; test moves restored.');
}finally{await pool.end()}

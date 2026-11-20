import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Card} from '../../../apps/web/lib/api';
import {cardHierarchy,structuredRows} from '../../../apps/web/plugins/board-views/hierarchy';
const cards=(...ids:string[])=>ids.map(id=>({id,title:id}) as Card);
const link=(cardId:string,contextId:string,position=0)=>({cardId,contextId,position});
test('a primary parent organizes each card exactly once, with multiple children',()=>{
 const items=cards('root','module','a','b','reference'),graph=cardHierarchy(items,[link('module','root'),link('a','module'),link('b','module')]);
 const rows=structuredRows(items,graph,new Set(items.map(c=>c.id)),true,[]);
 assert.deepEqual(rows.map(r=>[r.card.id,r.parentId]),[['root',undefined],['module','root'],['a','module'],['b','module'],['reference',undefined]]);
 assert.equal(new Set(rows.map(r=>r.card.id)).size,rows.length);
});
test('filter retains the principal ancestors; collapsed branch hides its descendants',()=>{
 const items=cards('root','module','a','b'),graph=cardHierarchy(items,[link('module','root'),link('a','module'),link('b','module')]);
 assert.deepEqual(structuredRows(items,graph,new Set(['a']),true,[]).map(r=>r.card.id),['root','module','a']);
 assert.deepEqual(structuredRows(items,graph,new Set(['a']),true,['module']).map(r=>r.card.id),['root','module']);
 assert.deepEqual(structuredRows(items,graph,new Set(['a']),false,[]).map(r=>r.card.id),['a']);
});
test('cycles, malformed multiple parents, duplicates, self links and unknown parents are safe',()=>{
 const items=cards('a','b','c','orphan'),graph=cardHierarchy(items,[link('a','b'),link('a','c'),link('b','c'),link('c','a'),link('a','b'),link('a','a'),link('orphan','missing')]);
 const rows=structuredRows(items,graph,new Set(items.map(c=>c.id)),true,[]);
 assert.equal(rows.length,4);assert.equal(new Set(rows.map(r=>r.card.id)).size,4);assert.equal(graph.parents.get('a')?.length,1);
});

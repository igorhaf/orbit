import test from 'node:test';
import assert from 'node:assert/strict';
import {pluginNavigation} from './plugin-navigation';
const group={id:'accreditation',label:'Acreditação'};
const link=(id:string,order=0)=>({id,label:id,href:`/sample/${id}`,group,section:{id:'workflow',label:'Workflow',order:1},order});
test('plugins aggregate into one menu with stable ordered sections and unique destinations',()=>{
 const result=pluginNavigation([{enabled:true,contributions:{navigation:[link('last',2),link('first',1),{...link('overview'),section:{id:'overview',label:'Overview',order:0}},{id:'workspaces',label:'Workspaces',href:'/workspaces'}]}},{enabled:true,contributions:{navigation:[link('first')]}}],()=>true);
 assert.equal(result.menus.length,1);assert.deepEqual(result.menus[0].sections.map(s=>s.id),['overview','workflow']);
 assert.deepEqual(result.menus[0].sections[1].links.map(l=>l.id),['first','last']);assert.equal(result.standalone[0].id,'workspaces');assert.equal(result.links.length,4);
});
test('disabled or unauthorized contributions disappear without leaving an empty group',()=>{
 const plugin={enabled:true,contributions:{navigation:[{...link('protected'),permission:'sample.read'}]}};
 assert.equal(pluginNavigation([plugin],()=>false).menus.length,0);
 assert.equal(pluginNavigation([{...plugin,enabled:false}],()=>true).menus.length,0);
 assert.equal(pluginNavigation([plugin],()=>true).menus.length,1);
});
test('malformed, external and reserved destinations are discarded',()=>{
 const items=[null,{...link('unsafe'),href:'//external.test'},{...link('reserved'),href:'/boards'},{...link('broken'),group:{id:'bad',label:''}},link('safe')];
 const result=pluginNavigation([{enabled:true,contributions:{navigation:items}}],()=>true);
 assert.deepEqual(result.links.map(item=>item.id),['safe']);
});

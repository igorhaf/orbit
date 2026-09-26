import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Context,dateExpression,interpolate,matches,nextSchedule,validateDefinition} from './automation-rules';
const context:Context={title:'Entrega',description:'Texto longo',list_id:'list',list:'Fazendo',board:'Produto',user:'Igor',completed:false,due_date:'2026-09-28T12:00:00Z',labels:['urgent'],members:['member'],fields:{cost:25,approved:true}};
test('all conditions must match, with array membership, numbers and custom fields',()=>{
  assert.ok(matches(context,[{field:'labels',op:'contains',value:'urgent'},{field:'custom:cost',op:'gt',value:'20'},{field:'completed',op:'eq',value:'false'}]));
  assert.ok(!matches(context,[{field:'labels',op:'contains',value:'urgent'},{field:'custom:cost',op:'lt',value:'20'}]));
  assert.ok(!matches({...context,due_date:null},[{field:'due_date',op:'lt',value:'{{now}}'}]));
});
test('date arithmetic handles weekend crossings, subtraction and formats',()=>{
  const friday=new Date('2026-09-25T12:00:00Z');
  assert.equal(dateExpression('now + 2 business_days',friday).toISOString(),'2026-09-29T12:00:00.000Z');
  assert.equal(dateExpression('due - 1 business_day',friday,context.due_date).toISOString(),'2026-09-25T12:00:00.000Z');
  assert.equal(interpolate('{{title}}: {{now + 2 hours|time}} / {{custom:cost}}',context,friday),'Entrega: 14:00 / 25');
  assert.throws(()=>dateExpression('due + 1 day',friday,null));
  assert.throws(()=>interpolate('{{missing}}',context));
});
test('schedules respect local clock and weekdays across DST',()=>{
  assert.equal(nextSchedule({type:'scheduled',frequency:'daily',time:'09:00',timezone:'America/Recife'},new Date('2026-09-26T11:00:00Z')).toISOString(),'2026-09-26T12:00:00.000Z');
  assert.equal(nextSchedule({type:'scheduled',frequency:'weekly',weekday:1,time:'09:00',timezone:'America/Recife'},new Date('2026-09-26T13:00:00Z')).toISOString(),'2026-09-28T12:00:00.000Z');
  assert.equal(nextSchedule({type:'scheduled',frequency:'daily',time:'09:00',timezone:'America/New_York'},new Date('2026-03-07T15:00:00Z')).toISOString(),'2026-03-08T13:00:00.000Z');
});
test('invalid actions, recipients, timezones and more than twenty actions are rejected',()=>{
  const d={trigger:{type:'board_button'},conditions:[],actions:[{type:'complete',value:'true',target:'board'}]};
  assert.doesNotThrow(()=>validateDefinition(d));
  assert.throws(()=>validateDefinition({...d,actions:Array.from({length:21},()=>d.actions[0])}));
  assert.throws(()=>validateDefinition({...d,actions:[{type:'sort',value:'title; DROP TABLE cards'}]}));
  assert.throws(()=>validateDefinition({...d,actions:[{type:'report',report:'snapshot',recipients:'bad\r\nBcc: someone@example.com'}]}));
  assert.throws(()=>validateDefinition({...d,trigger:{type:'scheduled',frequency:'daily',time:'09:00',timezone:'Invalid/Timezone'}}));
});

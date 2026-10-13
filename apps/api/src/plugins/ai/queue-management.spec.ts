import {test} from 'node:test';
import assert from 'node:assert/strict';
import {QueueManagement} from './queue-management';

test('partial automatic-resume preference survives manual pause and resume; only root edits another owner',async()=>{
 let preferences:Record<string,unknown>={codexQueueAutoResume:false,codexQueuePaused:false};const updates:Array<Record<string,unknown>>=[];
 const db={one:async()=>({preferences}),query:async(sql:string,args:unknown[])=>{if(sql.startsWith('UPDATE users')){const patch=JSON.parse(String(args[1]));updates.push(patch);preferences={...preferences,...patch}}return []}};
 let root=false;const manager=new QueueManagement(db as never,{account:async()=>({is_root:root}),audit:async()=>{}} as never);
 assert.deepEqual(await manager.update('owner',{autoResume:true}),{paused:false,autoPaused:false,autoResume:true});
 assert.deepEqual(await manager.update('owner',{paused:true}),{paused:true,autoPaused:false,autoResume:true});
 await manager.update('owner',{paused:false});assert.equal((await manager.settings('owner')).autoResume,true);assert.equal(updates[1].codexQueueAutoResume,undefined);
 await assert.rejects(()=>manager.update('owner',{userId:'11111111-1111-4111-8111-111111111111',paused:true}),error=>(error as {getStatus():number}).getStatus()===403);
 root=true;await manager.update('owner',{userId:'11111111-1111-4111-8111-111111111111',autoResume:false});assert.equal((await manager.settings('owner')).autoResume,false);
 for(const body of [{},{autoResume:'true'},{paused:'false'},{paused:true,invented:1},{userId:'bad',paused:true}])await assert.rejects(()=>manager.update('owner',body),error=>(error as {getStatus():number}).getStatus()===400);
});

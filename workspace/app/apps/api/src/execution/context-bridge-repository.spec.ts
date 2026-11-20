import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ContextBridgeRepository,type BridgeAuditBinding} from './context-bridge-repository';
import type {ContextBridgeAuditEvent} from './context-bridge';

const binding=():BridgeAuditBinding=>({bridgeId:randomUUID(),manifestId:randomUUID(),queue:'card_runs',runId:randomUUID(),turn:0,runtimeId:'dev',projectId:randomUUID(),workspaceId:randomUUID(),cardId:randomUUID(),cardRevision:1,actorId:randomUUID(),ownerId:randomUUID(),contextFingerprint:'a'.repeat(64)});
const event=():ContextBridgeAuditEvent=>({phase:'response_emitted',requestId:'request-1',capability:'sources.read',sourceId:'src_'+'b'.repeat(64),sourceHash:'c'.repeat(64),sourceIdentityHash:'e'.repeat(64),sourceVersion:'1',status:'ok',responseHash:'d'.repeat(64),returnedBytes:30,chargedBytes:30,observedAt:'2026-11-14T10:00:00.000Z'});

test('bridge audit uses a metadata allowlist, independent rows and safe history DTOs',async()=>{
  const sqlCalls:Array<{sql:string;values:unknown[]}>=[],rows:Array<Record<string,unknown>>=[];
  const db={query:async(sql:string,values:unknown[]=[])=>{
    sqlCalls.push({sql,values});
    if(sql.startsWith('INSERT')){const audit=JSON.parse(String(values[26])) as unknown;const row={id:values[0],event_sequence:rows.length+1,bridge_id:values[1],manifest_id:values[2],context_fingerprint:values[13],audit,recorded_at:new Date('2026-11-14T10:00:01.000Z')};rows.push(row);return {rows:[row]}}
    return {rows:[...rows].reverse()};
  }};
  const repo=new ContextBridgeRepository(db),host=binding(),original=event(),before=JSON.stringify({host,original});
  const appended=await repo.append(host,original);
  await repo.append(host,{phase:'delivery_unverified',requestId:'request-1',status:'model_receipt_unverified',observedAt:'2026-11-14T10:00:02.000Z'});
  assert.equal(JSON.stringify({host,original}),before);assert.equal(appended.event.responseHash,original.responseHash);
  const history=await repo.history(host.manifestId);assert.deepEqual(history.map(row=>row.event.phase),['delivery_unverified','response_emitted']);
  assert.equal(history[0].sequence,'2');assert.ok(sqlCalls.every(call=>!call.sql.includes('context_manifest_verifications')));
  assert.ok(!JSON.stringify(history).includes(host.ownerId));assert.ok(!JSON.stringify(history).includes('ownerId'));
  assert.equal((JSON.parse(String(sqlCalls[0].values[26])) as {event:ContextBridgeAuditEvent}).event.sourceHash,original.sourceHash);assert.equal(sqlCalls[0].values[27],original.sourceIdentityHash);
});

test('bridge audit rejects bodies, paths, credentials and malformed metadata before database access',async()=>{
  let queries=0;const repo=new ContextBridgeRepository({query:async()=>{queries++;return []}});
  for(const extra of [{body:'secret body'},{token:'secret token'},{socketPath:'/private/socket'},{params:{path:'../secret'}}])await assert.rejects(()=>repo.append(binding(),{...event(),...extra} as ContextBridgeAuditEvent),/Invalid bridge audit event/);
  for(const invalid of [{sourceId:'file:../private'},{reason:'/private/error'},{status:'contains spaces'},{sourceVersion:'https://private'},{returnedBytes:-1},{chargedBytes:1.2},{sourceHash:'invalid'},{sourceIdentityHash:'invalid'},{observedAt:'invalid'}])await assert.rejects(()=>repo.append(binding(),{...event(),...invalid} as ContextBridgeAuditEvent));
  await assert.rejects(()=>repo.append({...binding(),ownerId:'not-a-uuid'},event()),/identity/);
  await assert.rejects(()=>repo.history(randomUUID(),501),/history/);assert.equal(queries,0);
});

test('bridge audit accepts Db array responses and does not fabricate persistence success',async()=>{
  const host=binding(),item=event();let captured:unknown[]=[];
  const repo=new ContextBridgeRepository({query:async(_sql:string,values:unknown[]=[]):Promise<Record<string,unknown>[]>=>{captured=values;return [{id:values[0],event_sequence:'123',bridge_id:host.bridgeId,manifest_id:host.manifestId,context_fingerprint:host.contextFingerprint,audit:values[26],recorded_at:'2026-11-14T10:00:01.000Z'}]}});
  assert.equal((await repo.append(host,item)).sequence,'123');assert.equal(captured[25],item.observedAt);
  await assert.rejects(()=>new ContextBridgeRepository({query:async()=>[]}).append(host,item),/not persisted/);
});


const knowledge=()=>({schemaVersion:1 as const,queryHash:'1'.repeat(64),corpusHash:'2'.repeat(64),policy:'orbit-lexical-retrieval/1',found:3,returned:1,omitted:2,sources:[{sourceId:'src_'+'3'.repeat(64),sourceIdentityHash:'4'.repeat(64),sourceHash:'5'.repeat(64),sourceVersion:'sha256:'+'6'.repeat(64)}]});
test('07B audit stores bounded dynamic knowledge separately without changing207 legacy event JSON',async()=>{
 let captured:unknown[]=[];let sqlText='';
 const host=binding(),item={...event(),capability:'knowledge.search',knowledge:knowledge()} as ContextBridgeAuditEvent;
 const repo=new ContextBridgeRepository({query:async(sql:string,values:unknown[]=[]):Promise<Record<string,unknown>[]>=>{sqlText=sql;captured=values;return [{id:values[0],event_sequence:'1',bridge_id:host.bridgeId,manifest_id:host.manifestId,context_fingerprint:host.contextFingerprint,audit:values[26],knowledge_metadata:values[28],recorded_at:'2026-11-16T10:00:00Z'}]}});
 const before=JSON.stringify(item),stored=await repo.append(host,item);
 assert.ok(sqlText.includes('knowledge_metadata'));assert.equal(captured.length,29);assert.equal((JSON.parse(String(captured[26])) as {event:ContextBridgeAuditEvent}).event.knowledge,undefined);assert.deepEqual(stored.event.knowledge,knowledge());assert.equal(JSON.stringify(item),before);
 assert.ok(!JSON.stringify(stored).includes(host.ownerId));
 for(const remainingBytes of [0,1000000]){const withEstimate={...knowledge(),remainingBytes};const estimate=await repo.append(host,{...item,knowledge:withEstimate});assert.deepEqual(estimate.event.knowledge,withEstimate);}
 await repo.append(host,event());assert.equal(captured.length,28);assert.ok(!sqlText.includes('knowledge_metadata'));
});
test('07B audit rejects query text, source bodies, invalid hashes/versions/counts and wrong capabilities before SQL',async()=>{
 let queries=0;const repo=new ContextBridgeRepository({query:async()=>{queries++;return []}}),base=knowledge();
 for(const invalid of [{...base,query:'private query'},{...base,queryHash:'invalid'},{...base,corpusHash:'invalid'},{...base,policy:'other'},{...base,found:257},{...base,returned:7},{...base,returned:2,found:1},{...base,sources:[]},{...base,sources:[{...base.sources[0],body:'PRIVATE'}]},{...base,sources:[{...base.sources[0],sourceId:'file:/private'}]},{...base,sources:[{...base.sources[0],sourceIdentityHash:'invalid'}]},{...base,sources:[{...base.sources[0],sourceVersion:'https://private'}]}])await assert.rejects(()=>repo.append(binding(),{...event(),capability:'knowledge.search',knowledge:invalid} as ContextBridgeAuditEvent),/knowledge/);
 for(const remainingBytes of [-1,0.5,1000001,'8',null])await assert.rejects(()=>repo.append(binding(),{...event(),capability:'knowledge.search',knowledge:{...base,remainingBytes}} as unknown as ContextBridgeAuditEvent),/remaining byte/);
 await assert.rejects(()=>repo.append(binding(),{...event(),knowledge:base} as ContextBridgeAuditEvent),/capability/);assert.equal(queries,0);
});


test('07B top-level source audit preserves07A bounded sha256 versions and refuses arbitrary colon values',async()=>{
 const host=binding();let count=0;
 const repo=new ContextBridgeRepository({query:async(_sql,values=[])=>{count++;return [{id:values[0],event_sequence:'1',bridge_id:host.bridgeId,manifest_id:host.manifestId,context_fingerprint:host.contextFingerprint,audit:values[26],recorded_at:'2026-11-16T10:00:00Z'}]}});
 const version='sha256:'+'a'.repeat(64);assert.equal((await repo.append(host,{...event(),sourceVersion:version})).event.sourceVersion,version);
 for(const sourceVersion of ['sha256:short','sha256:'+'A'.repeat(64),'internal:private','sha256:'+'0'.repeat(65)])await assert.rejects(()=>repo.append(host,{...event(),sourceVersion}),/source version/);
 assert.equal(count,1);
});

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  assertContextManifestIntegrity,canonicalContextJson,compareContextManifest,ContextManifestError,
  ContextManifestRepository,createContextManifest,hashContextText,hashContextValue,
  type ContextSource,type CreateContextManifestInput,type ContextQueryClient,type ContextQueryResponse,type ContextQueryRow,
} from './context-manifest';

const scope={runtimeId:'dev',projectId:'project-a',workspaceId:'workspace-a',actorId:'actor-a'};
function source(id='rules',content='policy'):ContextSource{return {
  schemaVersion:1,id,type:'project-rule',origin:'project',resourceId:id,ownerId:'project-a',scope:{...scope},
  version:'1',contentHash:hashContextText(content),availability:'available',required:true,
  selectionReason:'Explicit project selection',dependencies:[],trust:'documental',observedAt:'2026-01-01T00:00:00Z',
}}
function input(sources=[source()]):CreateContextManifestInput{return {
  identity:{...scope,queue:'card_runs',runId:'run-a',cardId:'card-a',cardRevision:3,executor:'fake',executionType:'analysis'},
  sources,configuration:{plugins:{core:'1.6.2'},permissions:['read']},git:{reference:'HEAD',baseCommit:'a'.repeat(40)},
  checkout:null,assemblyPolicy:{version:1,selection:'explicit'},material:{contextHash:hashContextText('context'),promptHash:hashContextText('prompt')},capturedAt:'2026-01-01T00:00:00Z',
}}
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));

test('T1: canonical JSON sorts object keys and preserves arrays and Unicode',()=>{
  assert.equal(hashContextValue({z:2,a:{z:1,a:'ação'}}),hashContextValue({a:{a:'ação',z:1},z:2}));
  assert.notEqual(hashContextValue(['a','b']),hashContextValue(['b','a']));
  assert.equal(canonicalContextJson({b:null,a:true}),' {"a":true,"b":null}'.trim());
});
test('T1: fingerprint ignores observation times and run attribution; integrity retains both',()=>{
  const first=createContextManifest(input()),secondInput=input();
  secondInput.identity.runId='run-b';secondInput.sources[0].observedAt='2026-02-01T00:00:00Z';secondInput.capturedAt='2026-02-01T00:00:00Z';
  const second=createContextManifest(secondInput);
  assert.equal(first.fingerprint,second.fingerprint);assert.notEqual(first.integrityHash,second.integrityHash);
});
test('T1: source order is semantic and current comparison preserves it',()=>{
  const a=source('a'),b=source('b'),manifest=createContextManifest(input([a,b]));
  assert.notEqual(manifest.fingerprint,createContextManifest(input([b,a])).fingerprint);
  assert.equal(compareContextManifest(manifest,{sources:[b,a]}).status,'changed');
});
test('T2: changing selected content changes both hash and compatibility',()=>{
  const manifest=createContextManifest(input()),changed=source('rules','changed');
  assert.notEqual(manifest.fingerprint,createContextManifest(input([changed])).fingerprint);
  assert.deepEqual(compareContextManifest(manifest,{sources:[changed]}).changes,['source:rules']);
});
test('T3: removed source remains historical in original and is unavailable in current observation',()=>{
  const manifest=createContextManifest(input());
  assert.equal(compareContextManifest(manifest,{sources:[]}).status,'unavailable');
  assert.equal(manifest.sources[0].availability,'available');assert.equal(manifest.sources[0].version,'1');
});
test('T4: card revision participates in semantics and cannot rewrite original snapshot',()=>{
  const originalInput=input(),manifest=createContextManifest(originalInput);originalInput.identity.cardRevision=4;
  assert.equal(manifest.identity.cardRevision,3);assert.ok(Object.isFrozen(manifest.sources[0].scope));
  assert.notEqual(manifest.fingerprint,createContextManifest(originalInput).fingerprint);
  assert.equal(compareContextManifest(manifest,{sources:[source()],identity:originalInput.identity}).status,'changed');
});
test('T5/T6: shared selected dependencies affect their consumers, unrelated sources do not',()=>{
  const shared=source('related-card'),manifest=createContextManifest(input([shared]));
  const unrelated=source('not-selected','new unrelated content');
  assert.equal(compareContextManifest(manifest,{sources:[shared,unrelated]}).status,'compatible');
  assert.equal(compareContextManifest(manifest,{sources:[source('related-card','new revision'),unrelated]}).status,'changed');
});
test('T8/T9: material and configuration comparisons detect replacement without changing original',()=>{
  const manifest=createContextManifest(input()),before=JSON.stringify(manifest);
  assert.equal(compareContextManifest(manifest,{sources:[source()],material:{...manifest.material,promptHash:hashContextText('different')}}).status,'changed');
  assert.equal(compareContextManifest(manifest,{sources:[source()],configuration:{permissions:['write']}}).status,'changed');
  assert.equal(JSON.stringify(manifest),before);
});
test('T11: Git base and checkout identity changes require reconciliation',()=>{
  const capture=input();capture.checkout={mode:'isolated',identity:'checkout-a'};const manifest=createContextManifest(capture);
  assert.equal(compareContextManifest(manifest,{sources:[source()],git:{reference:'HEAD',baseCommit:'b'.repeat(40)}}).status,'changed');
  assert.equal(compareContextManifest(manifest,{sources:[source()],checkout:{mode:'isolated',identity:'checkout-b'}}).status,'changed');
});
test('T12: absent manifests stay legacy and captured SHA does not imply current verification',()=>{
  assert.equal(compareContextManifest(null,{sources:[]}).status,'legacy');
  const manifest=createContextManifest(input());assert.equal(manifest.captureStatus,'captured');
  assert.equal(compareContextManifest(manifest).status,'unverified');
});
test('T13/T14: runtime, project, workspace and actor scopes fail closed',()=>{
  for(const key of ['runtimeId','projectId','workspaceId','actorId'] as const){
    const selected=source();selected.scope[key]='other';
    assert.throws(()=>createContextManifest(input([selected])),{code:'CONTEXT_SOURCE_SCOPE'});
    assert.equal(compareContextManifest(createContextManifest(input()),{sources:[selected]}).status,'unavailable');
  }
});
test('T17: required missing, unavailable, unverified and unversioned sources are rejected',()=>{
  for(const availability of ['missing','unavailable','unverified'] as const){
    const selected=source();selected.availability=availability;
    assert.throws(()=>createContextManifest(input([selected])),{code:'CONTEXT_SOURCE_UNAVAILABLE'});
  }
  const selected=source();selected.contentHash=null;selected.version=null;
  assert.throws(()=>createContextManifest(input([selected])),{code:'CONTEXT_SOURCE_UNAVAILABLE'});
});
test('proven optional absence is captured and compatible only while still absent',()=>{
  const optional=source();optional.required=false;optional.availability='missing';optional.contentHash=null;optional.version=null;
  const manifest=createContextManifest(input([optional]));assert.equal(manifest.captureStatus,'captured');
  assert.equal(compareContextManifest(manifest,{sources:[optional]}).status,'compatible');
  assert.equal(compareContextManifest(manifest,{sources:[{...optional,availability:'unavailable'}]}).status,'changed');
  assert.equal(compareContextManifest(createContextManifest(input([{...optional,availability:'unavailable'}])),{sources:[{...optional,availability:'unavailable'}]}).status,'unverified');
});
test('T17: duplicate IDs fail both capture and comparison',()=>{
  assert.throws(()=>createContextManifest(input([source(),source()])),{code:'CONTEXT_SOURCE_AMBIGUOUS'});
  assert.equal(compareContextManifest(createContextManifest(input()),{sources:[source(),source()]}).status,'unavailable');
});
test('T17: JSON ambiguity and lossy values fail without invoking accessors or toJSON',()=>{
  let invoked=false;const getter={get value(){invoked=true;return 1}};
  const circular:Record<string,unknown>={};circular.self=circular;
  const hiddenSparse:unknown[]&{extra?:number}=[];hiddenSparse.length=1;delete hiddenSparse[0];hiddenSparse.extra=1;
  class CustomArray extends Array<number>{map(){invoked=true;return [] as never}}
  for(const value of [undefined,NaN,Infinity,BigInt(1),()=>1,new Date(),getter,{value:undefined},[undefined],Array(2),hiddenSparse,new CustomArray(),circular,{[Symbol('x')]:1},Object.create({x:1})]){
    assert.throws(()=>canonicalContextJson(value),ContextManifestError);
  }
  assert.equal(invoked,false);
});
test('T17: mutation of serialized evidence is detected instead of claiming compatibility',()=>{
  const tampered=clone(createContextManifest(input()));tampered.sources[0].contentHash=hashContextText('tamper');
  assert.throws(()=>assertContextManifestIntegrity(tampered),{code:'CONTEXT_MANIFEST_INTEGRITY'});
  assert.equal(compareContextManifest(tampered,{sources:[source()]}).status,'unavailable');
});
test('host_policy/documental/history labels remain descriptive and cannot replace scope',()=>{
  for(const trust of ['host_policy','documental','historical'] as const){
    const selected=source();selected.trust=trust;selected.scope.projectId='other';
    assert.throws(()=>createContextManifest(input([selected])),{code:'CONTEXT_SOURCE_SCOPE'});
  }
});

class MemoryDatabase implements ContextQueryClient {
  manifests:ContextQueryRow[]=[];observations:ContextQueryRow[]=[];statements:string[]=[];
  async query(sql:string,p:unknown[]=[]):Promise<ContextQueryResponse>{
    this.statements.push(sql);
    if(sql.startsWith('SELECT pg_advisory'))return {rows:[]};
    if(sql.startsWith('INSERT INTO context_run_manifests')){
      const [id,queue,run_id,turn,parent_id,card_id,card_revision,project_id,workspace_id,actor_id,runtime_id,fingerprint,integrity_hash,manifest]=p;
      const row={id,queue,run_id,turn,parent_id,card_id,card_revision,project_id,workspace_id,actor_id,runtime_id,fingerprint,integrity_hash,manifest:JSON.parse(String(manifest)) as unknown,created_at:'2026-01-01T00:00:00Z'};
      this.manifests.push(row);return {rows:[clone(row)]};
    }
    if(sql.startsWith('SELECT * FROM context_run_manifests')){
      const found=sql.includes('WHERE id=')?this.manifests.filter(row=>row.id===p[0]):this.manifests.filter(row=>row.queue===p[0]&&row.run_id===p[1]).sort((a,b)=>Number(b.turn)-Number(a.turn)).slice(0,1);
      return {rows:clone(found)};
    }
    if(sql.startsWith('INSERT INTO context_manifest_verifications')){
      this.observations.push({id:p[0],manifest_id:p[1],phase:p[2],status:p[3],observation:JSON.parse(String(p[4])) as unknown,observed_at:p[5]});return {rows:[]};
    }
    if(sql.startsWith('SELECT * FROM context_manifest_verifications'))return {rows:clone(this.observations.filter(row=>row.manifest_id===p[0]))};
    throw new Error('Unexpected fake query: '+sql);
  }
}
test('repository stores one immutable initial snapshot and returns it for equivalent retry',async()=>{
  const db=new MemoryDatabase(),repo=new ContextManifestRepository(db),manifest=createContextManifest(input());
  const first=await repo.store(db,manifest),again=await repo.store(db,manifest);
  assert.equal(first.id,again.id);assert.equal(db.manifests.length,1);assert.equal(first.turn,0);
  assert.equal((await repo.latest('card_runs','run-a'))?.id,first.id);assert.equal((await repo.get(first.id))?.manifest.fingerprint,manifest.fingerprint);
  const replacement=input([source('rules','replacement')]);
  await assert.rejects(()=>repo.store(db,createContextManifest(replacement)),{code:'CONTEXT_MANIFEST_CONFLICT'});
  assert.equal(db.manifests.length,1);
});
test('same-run answer turns preserve parent, identity and initial context',async()=>{
  const db=new MemoryDatabase(),repo=new ContextManifestRepository(db),first=await repo.store(db,createContextManifest(input()));
  const answered=input([source(),source('answer','authorized answer')]);
  const child=await repo.store(db,createContextManifest(answered),{parentId:first.id});
  assert.equal(child.turn,1);assert.equal(child.parentId,first.id);assert.equal(first.manifest.sources.length,1);
  assert.equal((await repo.latest('card_runs','run-a'))?.id,child.id);
  await assert.rejects(()=>repo.store(db,createContextManifest(answered),{parentId:first.id}),{code:'CONTEXT_MANIFEST_PARENT'});
});
test('continuations cannot change revision, actor, workspace or run',async()=>{
  for(const key of ['cardRevision','actorId','workspaceId','runId'] as const){
    const db=new MemoryDatabase(),repo=new ContextManifestRepository(db),first=await repo.store(db,createContextManifest(input()));
    const changed=input();if(key==='cardRevision')changed.identity.cardRevision=4;else changed.identity[key]='other';
    if(key==='actorId'||key==='workspaceId')changed.sources[0].scope[key]='other';
    await assert.rejects(()=>repo.store(db,createContextManifest(changed),{parentId:first.id}),{code:'CONTEXT_MANIFEST_PARENT'});
  }
});
test('both queue identities remain independent and legacy lookup stays empty',async()=>{
  const db=new MemoryDatabase(),repo=new ContextManifestRepository(db);
  assert.equal(await repo.latest('card_runs','legacy'),null);
  const first=await repo.store(db,createContextManifest(input())),other=input();other.identity.queue='card_ai_runs';
  const second=await repo.store(db,createContextManifest(other));assert.notEqual(first.id,second.id);
  assert.equal((await repo.latest('card_ai_runs','run-a'))?.id,second.id);
});
test('observations append without rewriting snapshots or deleting evidence',async()=>{
  const db=new MemoryDatabase(),repo=new ContextManifestRepository(db),first=await repo.store(db,createContextManifest(input()));
  const before=JSON.stringify(db.manifests);
  await repo.observe(first.id,{phase:'before_executor',compatibility:compareContextManifest(first.manifest,{sources:[source()]})});
  await repo.observe(first.id,{phase:'after_executor',compatibility:compareContextManifest(first.manifest,{sources:[source('rules','changed')]}),delivery:{promptHash:hashContextText('prompt')},checkout:{identity:'actual-checkout'}});
  assert.equal(JSON.stringify(db.manifests),before);assert.deepEqual((await repo.history(first.id)).map(item=>item.compatibility.status),['compatible','changed']);
  assert.ok(db.statements.every(sql=>!/^\s*(UPDATE|DELETE|TRUNCATE)\b/i.test(sql)));
});

test('unobserved required sources are unverified, not falsely reported changed or missing',()=>{const manifest=createContextManifest(input());const observed={...source(),availability:'unverified' as const};const result=compareContextManifest(manifest,{sources:[observed]});assert.equal(result.status,'unverified');assert.deepEqual(result.changes,[]);});

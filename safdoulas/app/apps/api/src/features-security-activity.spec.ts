import assert from "node:assert/strict";
import test from "node:test";
import { FeaturesController, FeaturesService } from "./features";

test("security activity returns only allowlisted self and targeted account events",async()=>{
  const db={async query(sql:string,args:unknown[]){
    assert.match(sql,/actor_id=\$1/);assert.match(sql,/target=\$1::text/);assert.match(sql,/action=ANY\(\$2::text\[\]\)/);assert.equal(args[0],"user-1");
    return [
      {id:"1",action:"account.mfa.enabled",created_at:new Date("2026-01-01T00:00:00Z"),target:null},
      {id:"2",action:"account.password.admin_changed",created_at:new Date("2026-01-02T00:00:00Z"),target:"user-1"},
      {id:"3",action:"account.email_change.admin_requested",created_at:new Date("2026-01-03T00:00:00Z"),target:"user-1"},
    ];
  }};
  assert.deepEqual(await new FeaturesService(db as never).securityActivity("user-1"),[
    {id:"1",label:"Verificação em duas etapas ativada",created_at:new Date("2026-01-01T00:00:00Z")},
    {id:"2",label:"Senha redefinida pela administração",created_at:new Date("2026-01-02T00:00:00Z")},
  ]);
});

test("account histories cannot be read through root act-as",()=>{
  const controller=new FeaturesController(new FeaturesService({} as never),{} as never) as unknown as {accountHistoryUser(req:unknown):string};
  assert.equal(controller.accountHistoryUser({orbitActor:"user-1",orbitUser:"user-1"}),"user-1");
  assert.throws(()=>controller.accountHistoryUser({orbitActor:"root",orbitUser:"user-1"}),/somente ao titular/);
});

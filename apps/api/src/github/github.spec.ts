import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { PluginRegistry } from "../execution/registries";
import { githubPluginDefinition, GitHubPlugin } from "./github.plugin";

test("GitHub plugin exposes the complete first-class capability contract", () => {
  const plugin = githubPluginDefinition({} as GitHubPlugin), registry = new PluginRegistry();
  registry.register(plugin);
  assert.deepEqual((plugin.actions || []).map(item=>item.id), ["list_repositories","get_issue","create_issue","update_issue","create_branch","get_pull_request","create_pull_request","comment_pull_request","list_pull_request_files","get_pull_request_diff"]);
  assert.equal(registry.getAction("github","create_pull_request").requiredCapabilities?.[0],"pull_requests.write");
  assert.equal(registry.getTrigger("github","pull_request.merged").metadata?.event,"github.pull_request.merged");
  assert.equal(plugin.connectionProvider?.id,"github-app");
});

test("GitHub webhook validates SHA-256 signatures and deduplicates deliveries", async () => {
  const raw=Buffer.from(JSON.stringify({action:"opened"})),secret="webhook-secret",signature=`sha256=${createHmac("sha256",secret).update(raw).digest("hex")}`;
  const previous=process.env.GITHUB_WEBHOOK_SECRET;process.env.GITHUB_WEBHOOK_SECRET=secret;
  const queries:string[]=[];
  const db={one:async(sql:string)=>{queries.push(sql);return {delivery_id:"delivery"}},query:async(sql:string)=>{queries.push(sql);return []}};
  const github=new GitHubPlugin(db as never,{} as never,{} as never,{} as never,{} as never);
  try { assert.deepEqual(await github.webhook(raw,signature,"delivery","ping",{action:"opened"}),{ok:true}); await assert.rejects(()=>github.webhook(raw,"sha256=bad","delivery-2","ping",{}),/Assinatura/); assert.ok(queries.some(sql=>sql.includes("github_webhook_deliveries"))); }
  finally { if(previous===undefined)delete process.env.GITHUB_WEBHOOK_SECRET;else process.env.GITHUB_WEBHOOK_SECRET=previous; }
});

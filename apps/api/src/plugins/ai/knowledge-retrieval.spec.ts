import "reflect-metadata";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { ORBIT_EMBEDDING_DIMENSIONS, ORBIT_EMBEDDING_MODEL } from "./embeddings";
import { OrbitKnowledgeRetentionWorker, OrbitKnowledgeRetrievalService } from "./knowledge-retrieval";

test("embeddings expirados são removidos no boot do módulo mesmo sem consultas vetoriais", async () => {
  const calls: string[] = [];
  const worker = new OrbitKnowledgeRetentionWorker({
    async query(sql: string) { calls.push(sql); return []; },
  } as never);

  worker.onModuleInit();
  await new Promise<void>((resolve) => setImmediate(resolve));
  worker.onModuleDestroy();

  assert.equal(calls.length, 1);
  assert.match(calls[0], /DELETE FROM orbit_knowledge_embeddings/);
  assert.match(calls[0], /updated_at < now\(\) - INTERVAL '30 days'/);
});

test("o expurgo diário é deduplicado enquanto a consulta anterior continua ativa", async () => {
  let resolveQuery!: () => void;
  let calls = 0;
  const worker = new OrbitKnowledgeRetentionWorker({
    async query() { calls += 1; await new Promise<void>((resolve) => { resolveQuery = resolve; }); return []; },
  } as never);

  const first = worker.purgeExpired();
  const concurrent = worker.purgeExpired();
  assert.equal(first, concurrent);
  assert.equal(calls, 1);
  resolveQuery();
  await first;
  assert.equal(calls, 1);
});

test("uma coleção recuperada renova a atividade do vetor existente", async () => {
  const text = "material ativo";
  const hash = createHash("sha256").update(text).digest("hex");
  const vector = Array.from({ length: ORBIT_EMBEDDING_DIMENSIONS }, (_, index) => index === 0 ? 1 : 0);
  const statements: string[] = [];
  const db = { async query(sql: string) {
    statements.push(sql);
    if (sql.includes("SELECT content_hash,embedding")) return [{ content_hash: hash, embedding: vector }];
    return [];
  } };
  const embeddings = { isAvailable: () => true, async embed() { return [vector]; } };
  const retrieval = new OrbitKnowledgeRetrievalService(db as never, embeddings as never);

  const ranked = await retrieval.rank({ workspaceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", pluginId: "host", collectionId: "collection" }, "consulta", [
    { key: "lesson", text, value: "lesson" },
  ]);

  assert.equal(ranked[0]?.value, "lesson");
  assert.ok(statements.some((sql) => sql.includes("UPDATE orbit_knowledge_embeddings SET updated_at=now()")));
});

test("vetores de cache malformados são refeitos sem renovar a retenção antiga", async () => {
  const text = "conteúdo em cache";
  const hash = createHash("sha256").update(text).digest("hex");
  const validVector = Array.from({ length: ORBIT_EMBEDDING_DIMENSIONS }, (_, index) => index === 0 ? 1 : 0);
  const statements: string[] = [];
  const db = { async query(sql: string) {
    statements.push(sql);
    if (sql.includes("SELECT content_hash,embedding")) return [{ content_hash: hash, embedding: [Number.NaN] }];
    return [];
  } };
  const embeddings = { isAvailable: () => true, async embed(inputs: string[]) { return inputs.map(() => validVector); } };
  const retrieval = new OrbitKnowledgeRetrievalService(db as never, embeddings as never);
  await retrieval.rank({ workspaceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", pluginId: "host", collectionId: "collection" }, "consulta", [
    { key: "lesson", text, value: "lesson" },
  ]);
  assert.equal(statements.some((sql) => sql.includes("UPDATE orbit_knowledge_embeddings SET updated_at=now()")), false);
});

test("uma coleção autorizada vazia remove somente seus vetores e rejeita escopo inválido", async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = { async query(sql: string, params: unknown[] = []) { calls.push({ sql, params }); return []; } };
  const embeddings = { isAvailable: () => true, async embed() { throw new Error("Não deve chamar o provedor sem candidatos."); } };
  const retrieval = new OrbitKnowledgeRetrievalService(db as never, embeddings as never);
  const scope = { workspaceId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", pluginId: "host", collectionId: "private" };

  assert.deepEqual(await retrieval.rank(scope, "consulta", []), []);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /workspace_id=\$1 AND owner_plugin_id=\$2 AND collection_id=\$3 AND model=\$4/);
  assert.deepEqual(calls[0].params, [scope.workspaceId, scope.pluginId, scope.collectionId, ORBIT_EMBEDDING_MODEL]);
  await assert.rejects(() => retrieval.rank({ ...scope, workspaceId: "another-workspace" }, "consulta", []), /Invalid knowledge retrieval scope/);
  assert.equal(calls.length, 1);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ORBIT_EMBEDDING_DIMENSIONS, ORBIT_EMBEDDING_MODEL } from "./embeddings";
import { OrbitKnowledgeRetrievalService, type KnowledgeCandidate, type KnowledgeScope } from "./knowledge-retrieval";

type StoredVector = {
  workspace_id: string; owner_plugin_id: string; collection_id: string; model: string; content_hash: string;
  embedding: number[]; updated_at: number;
};

class MockEmbeddingProvider {
  readonly batches: string[][] = [];
  available = true;
  isAvailable() { return this.available; }
  async embed(inputs: string[]) {
    this.batches.push([...inputs]);
    return inputs.map((input) => {
      const vector = Array<number>(ORBIT_EMBEDDING_DIMENSIONS).fill(0);
      if (input.includes("question")) vector[0] = 1;
      else if (input.includes("relevant")) { vector[0] = 0.99; vector[1] = 0.1; }
      else if (input.includes("unrelated")) vector[1] = 1;
      else if (input.includes("opposite")) vector[0] = -1;
      else vector[0] = 0.5;
      return vector;
    });
  }
}

class MockEmbeddingDb {
  readonly rows = new Map<string, StoredVector>();
  readonly calls: Array<{ sql: string; params: unknown[] }> = [];
  private key(scope: Pick<StoredVector, "workspace_id" | "owner_plugin_id" | "collection_id" | "model" | "content_hash">) {
    return [scope.workspace_id, scope.owner_plugin_id, scope.collection_id, scope.model, scope.content_hash].join("|");
  }
  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    this.calls.push({ sql, params });
    if (sql.includes("SELECT content_hash,embedding FROM orbit_knowledge_embeddings")) {
      const [workspace, plugin, collection, model, hashes] = params as [string, string, string, string, string[]];
      return [...this.rows.values()].filter((row) => row.workspace_id === workspace && row.owner_plugin_id === plugin
        && row.collection_id === collection && row.model === model && hashes.includes(row.content_hash))
        .map(({ content_hash, embedding }) => ({ content_hash, embedding })) as T[];
    }
    if (sql.includes("INSERT INTO orbit_knowledge_embeddings")) {
      const [workspace, plugin, collection, model, , rawRows] = params as [string, string, string, string, number, string];
      const rows = JSON.parse(rawRows) as Array<{ content_hash: string; embedding: number[] }>;
      for (const row of rows) {
        const stored: StoredVector = { workspace_id: workspace, owner_plugin_id: plugin, collection_id: collection,
          model, content_hash: row.content_hash, embedding: row.embedding, updated_at: Date.now() };
        this.rows.set(this.key(stored), stored);
      }
      return [] as T[];
    }
    if (sql.includes("UPDATE orbit_knowledge_embeddings SET updated_at=now()")) {
      const [workspace, plugin, collection, model, hashes] = params as [string, string, string, string, string[]];
      for (const row of this.rows.values()) {
        if (row.workspace_id === workspace && row.owner_plugin_id === plugin && row.collection_id === collection
          && row.model === model && hashes.includes(row.content_hash)) row.updated_at = Date.now();
      }
      return [] as T[];
    }
    if (sql.includes("DELETE FROM orbit_knowledge_embeddings") && sql.includes("NOT(content_hash=ANY")) {
      const [workspace, plugin, collection, model, hashes] = params as [string, string, string, string, string[]];
      for (const [key, row] of this.rows) {
        if (row.workspace_id === workspace && row.owner_plugin_id === plugin && row.collection_id === collection
          && row.model === model && !hashes.includes(row.content_hash)) this.rows.delete(key);
      }
      return [] as T[];
    }
    if (sql.includes("DELETE FROM orbit_knowledge_embeddings") && sql.includes("updated_at < now()")) {
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      for (const [key, row] of this.rows) if (row.updated_at < cutoff) this.rows.delete(key);
      return [] as T[];
    }
    if (sql.includes("DELETE FROM orbit_knowledge_embeddings")) {
      const [workspace, plugin, collection, model] = params as [string, string, string, string];
      for (const [key, row] of this.rows) if (row.workspace_id === workspace && row.owner_plugin_id === plugin
        && row.collection_id === collection && row.model === model) this.rows.delete(key);
      return [] as T[];
    }
    throw new Error(`Unexpected SQL in retrieval test: ${sql}`);
  }
}

const scopeA: KnowledgeScope = {
  workspaceId: "11111111-1111-4111-8111-111111111111", pluginId: "plugin-a", collectionId: "collection-a",
};
const scopeB: KnowledgeScope = {
  workspaceId: "22222222-2222-4222-8222-222222222222", pluginId: "plugin-a", collectionId: "collection-a",
};
const scopeC: KnowledgeScope = { ...scopeA, pluginId: "plugin-b" };
const scopeD: KnowledgeScope = { ...scopeA, collectionId: "collection-b" };
const candidate = (key: string, text: string): KnowledgeCandidate<{ id: string }> => ({ key, text, value: { id: key } });

test("semantic ranking caches hashes and vectors without persisting raw content", async () => {
  const db = new MockEmbeddingDb();
  const provider = new MockEmbeddingProvider();
  const retrieval = new OrbitKnowledgeRetrievalService(db as never, provider as never);
  const candidates = [candidate("relevant-1", "relevant lesson content"), candidate("unrelated-1", "unrelated lesson content")];

  const first = await retrieval.rank(scopeA, "question about the course", candidates);
  assert.deepEqual(first.map((item) => item.value.id), ["relevant-1"]);
  assert.equal(provider.batches.length, 2);
  assert.equal(db.rows.size, 2);
  assert.ok([...db.rows.values()].every((row) => row.model === ORBIT_EMBEDDING_MODEL && row.embedding.length === ORBIT_EMBEDDING_DIMENSIONS));
  assert.equal(JSON.stringify([...db.rows.values()]).includes("relevant lesson content"), false);

  const activeRows = [...db.rows.values()];
  for (const row of activeRows) row.updated_at = Date.now() - 29 * 24 * 60 * 60 * 1000;
  const previousActivity = Math.min(...activeRows.map((row) => row.updated_at));
  await retrieval.rank(scopeA, "question about the course", candidates);
  assert.equal(provider.batches.length, 3, "a warm cache embeds only the new query vector, not candidate texts");
  assert.deepEqual(provider.batches[2], ["question about the course"]);
  assert.ok(db.calls.some(({ sql }) => sql.includes("SET updated_at=now()")), "cache hits refresh retention activity");
  assert.ok(activeRows.every((row) => row.updated_at > previousActivity), "reused vectors get a fresh activity timestamp");
});

test("malformed cached vectors are re-embedded without refreshing their retention timestamp", async () => {
  const db = new MockEmbeddingDb();
  const text = "cached candidate";
  const hash = createHash("sha256").update(text).digest("hex");
  db.rows.set("malformed", { workspace_id: scopeA.workspaceId, owner_plugin_id: scopeA.pluginId,
    collection_id: scopeA.collectionId, model: ORBIT_EMBEDDING_MODEL, content_hash: hash, embedding: [Number.NaN], updated_at: 0 });
  const provider = new MockEmbeddingProvider();
  const retrieval = new OrbitKnowledgeRetrievalService(db as never, provider as never);
  await retrieval.rank(scopeA, "question", [candidate("candidate", text)]);
  assert.equal(db.calls.some(({ sql }) => sql.includes("UPDATE orbit_knowledge_embeddings SET updated_at=now()")), false);
});

test("workspace, owner plugin and collection partition the cache and stale candidates are scoped", async () => {
  const db = new MockEmbeddingDb();
  const provider = new MockEmbeddingProvider();
  const retrieval = new OrbitKnowledgeRetrievalService(db as never, provider as never);
  await retrieval.rank(scopeA, "question", [candidate("shared", "relevant shared text")]);
  await retrieval.rank(scopeB, "question", [candidate("shared", "relevant shared text")]);
  await retrieval.rank(scopeC, "question", [candidate("shared", "relevant shared text")]);
  await retrieval.rank(scopeD, "question", [candidate("shared", "relevant shared text")]);
  assert.equal(db.rows.size, 4, "identical content has separate rows across workspace, owner plugin and collection scopes");
  assert.equal(new Set([...db.rows.values()].map((row) => row.workspace_id)).size, 2);
  assert.equal(new Set([...db.rows.values()].map((row) => row.owner_plugin_id)).size, 2);
  assert.equal(new Set([...db.rows.values()].map((row) => row.collection_id)).size, 2);

  await retrieval.rank(scopeA, "question", [candidate("replacement", "relevant replacement text")]);
  assert.equal(db.rows.size, 4, "only the replaced row in scope A is deleted");
  for (const other of [scopeB, scopeC, scopeD]) {
    assert.equal([...db.rows.values()].filter((row) => row.workspace_id === other.workspaceId
      && row.owner_plugin_id === other.pluginId && row.collection_id === other.collectionId).length, 1);
  }
  assert.equal([...db.rows.values()].filter((row) => row.workspace_id === scopeA.workspaceId
    && row.owner_plugin_id === scopeA.pluginId && row.collection_id === scopeA.collectionId).length, 1);
});

test("ranking prunes removed vectors only in its collection and leaves global expiry to the retention service", async () => {
  const db = new MockEmbeddingDb();
  const provider = new MockEmbeddingProvider();
  const retrieval = new OrbitKnowledgeRetrievalService(db as never, provider as never);
  await retrieval.rank(scopeA, "question", [candidate("active", "relevant active content")]);
  const active = [...db.rows.values()][0];
  const stale = { ...active, workspace_id: scopeB.workspaceId, content_hash: "a".repeat(64), updated_at: Date.now() - 31 * 24 * 60 * 60 * 1000 };
  db.rows.set([stale.workspace_id, stale.owner_plugin_id, stale.collection_id, stale.model, stale.content_hash].join("|"), stale);

  await retrieval.rank(scopeA, "question", [candidate("active", "relevant active content")]);
  assert.equal(db.rows.size, 2, "rank no longer owns application-wide retention cleanup");
  assert.ok(!db.calls.some(({ sql }) => sql.includes("updated_at < now() - INTERVAL '30 days'")));

  const otherScopeStale = { ...active, workspace_id: scopeB.workspaceId, content_hash: "b".repeat(64), updated_at: Date.now() };
  db.rows.set([otherScopeStale.workspace_id, otherScopeStale.owner_plugin_id, otherScopeStale.collection_id, otherScopeStale.model, otherScopeStale.content_hash].join("|"), otherScopeStale);
  await retrieval.rank(scopeA, "question", []);
  assert.equal(db.rows.size, 2);
  assert.ok([...db.rows.values()].every((row) => row.workspace_id === scopeB.workspaceId), "empty content purges only its authorized collection scope");
});

test("invalid scopes are rejected and disabled embeddings make no provider or database calls", async () => {
  const db = new MockEmbeddingDb();
  const provider = new MockEmbeddingProvider();
  const retrieval = new OrbitKnowledgeRetrievalService(db as never, provider as never);
  await assert.rejects(() => retrieval.rank({ ...scopeA, pluginId: "" }, "question", [candidate("x", "relevant")]), /Invalid knowledge retrieval scope/);
  provider.available = false;
  assert.deepEqual(await retrieval.rank(scopeA, "question", [candidate("x", "relevant")]), []);
  assert.equal(provider.batches.length, 0);
  assert.equal(db.calls.length, 0);
});

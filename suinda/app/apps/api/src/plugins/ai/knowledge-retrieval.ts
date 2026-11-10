import { createHash } from "node:crypto";
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Db } from "../../db";
import { ORBIT_EMBEDDING_DIMENSIONS, ORBIT_EMBEDDING_MODEL, OrbitEmbeddingsService } from "./embeddings";

export type KnowledgeScope = { workspaceId: string; pluginId: string; collectionId: string };
export type KnowledgeCandidate<T> = { key: string; text: string; value: T };
const workspaceIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateScope(scope: KnowledgeScope) {
  if (!scope || !workspaceIdPattern.test(scope.workspaceId)
    || typeof scope.pluginId !== "string" || !scope.pluginId.trim() || scope.pluginId.length > 120
    || typeof scope.collectionId !== "string" || !scope.collectionId.trim() || scope.collectionId.length > 200)
    throw new Error("Invalid knowledge retrieval scope.");
}

function cosineSimilarity(left: number[], right: number[]) {
  let dot = 0, leftNorm = 0, rightNorm = 0;
  for (let index = 0; index < ORBIT_EMBEDDING_DIMENSIONS; index++) {
    dot += left[index] * right[index]; leftNorm += left[index] ** 2; rightNorm += right[index] ** 2;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

/** Shared, workspace-scoped vector index for Orbit products and plugins. Raw text is never stored. */
export class OrbitKnowledgeRetrievalService {
  constructor(private readonly db: Db, private readonly embeddings: OrbitEmbeddingsService) {}

  isAvailable() { return this.embeddings.isAvailable(); }

  async rank<T>(scope: KnowledgeScope, query: string, candidates: KnowledgeCandidate<T>[], limit = 5) {
    if (!this.isAvailable()) return [] as Array<{ value: T; score: number }>;
    validateScope(scope);
    if (typeof query !== "string" || !query.trim() || query.length > 8_000) throw new Error("Invalid knowledge query.");
    if (!Array.isArray(candidates)) throw new Error("Invalid knowledge candidates.");
    const bounded = candidates.slice(0, 200).filter((item) => typeof item.key === "string" && item.key.trim()
      && typeof item.text === "string" && item.text.trim()).map((item) => ({
      // eslint-disable-next-line no-control-regex
      ...item, text: item.text.replace(/\u0000/g, "").trim().slice(0, 6_000),
    }));
    if (!bounded.length) {
      await this.db.query(
        "DELETE FROM orbit_knowledge_embeddings WHERE workspace_id=$1 AND owner_plugin_id=$2 AND collection_id=$3 AND model=$4",
        [scope.workspaceId, scope.pluginId, scope.collectionId, ORBIT_EMBEDDING_MODEL],
      );
      return [];
    }
    const byHash = new Map<string, number[]>();
    const hashFor = (text: string) => createHash("sha256").update(text).digest("hex");
    const hashes = [...new Set(bounded.map((item) => hashFor(item.text)))];
    const rows = await this.db.query<{ content_hash: string; embedding: number[] | string }>(
      `SELECT content_hash,embedding FROM orbit_knowledge_embeddings
       WHERE workspace_id=$1 AND owner_plugin_id=$2 AND collection_id=$3 AND model=$4 AND content_hash=ANY($5::text[])`,
      [scope.workspaceId, scope.pluginId, scope.collectionId, ORBIT_EMBEDDING_MODEL, hashes],
    );
    for (const row of rows) {
      const embedding = typeof row.embedding === "string" ? JSON.parse(row.embedding) as unknown : row.embedding;
      if (Array.isArray(embedding) && embedding.length === ORBIT_EMBEDDING_DIMENSIONS
        && embedding.every((value) => typeof value === "number" && Number.isFinite(value))) byHash.set(row.content_hash, embedding as number[]);
    }
    if (byHash.size) await this.db.query(
      `UPDATE orbit_knowledge_embeddings SET updated_at=now()
       WHERE workspace_id=$1 AND owner_plugin_id=$2 AND collection_id=$3 AND model=$4 AND content_hash=ANY($5::text[])`,
      [scope.workspaceId, scope.pluginId, scope.collectionId, ORBIT_EMBEDDING_MODEL, [...byHash.keys()]],
    );
    const missing = [...new Map(bounded.filter((item) => !byHash.has(hashFor(item.text))).map((item) => [hashFor(item.text), item.text])).entries()];
    for (let offset = 0; offset < missing.length; offset += 64) {
      const batch = missing.slice(offset, offset + 64);
      const vectors = await this.embeddings.embed(batch.map(([, text]) => text));
      const rows = batch.map(([hash], index) => ({ content_hash: hash, embedding: vectors[index] }));
      for (let index = 0; index < batch.length; index++) {
        const [hash] = batch[index];
        byHash.set(hash, vectors[index]);
      }
      await this.db.query(
        `INSERT INTO orbit_knowledge_embeddings(workspace_id,owner_plugin_id,collection_id,model,content_hash,dimensions,embedding)
         SELECT $1,$2,$3,$4,row.content_hash,$5,row.embedding
         FROM jsonb_to_recordset($6::jsonb) AS row(content_hash text,embedding jsonb)
         ON CONFLICT(workspace_id,owner_plugin_id,collection_id,model,content_hash)
         DO UPDATE SET embedding=EXCLUDED.embedding,dimensions=EXCLUDED.dimensions,updated_at=now()`,
        [scope.workspaceId, scope.pluginId, scope.collectionId, ORBIT_EMBEDDING_MODEL, ORBIT_EMBEDDING_DIMENSIONS, JSON.stringify(rows)],
      );
    }
    await this.db.query(
      `DELETE FROM orbit_knowledge_embeddings WHERE workspace_id=$1 AND owner_plugin_id=$2 AND collection_id=$3
       AND model=$4 AND NOT(content_hash=ANY($5::text[]))`,
      [scope.workspaceId, scope.pluginId, scope.collectionId, ORBIT_EMBEDDING_MODEL, hashes],
    );
    const [queryVector] = await this.embeddings.embed([query.slice(0, 8_000)]);
    const ranked = bounded.map((item) => ({ value: item.value, score: cosineSimilarity(queryVector, byHash.get(hashFor(item.text))!) }))
      .filter((item) => item.score >= 0.15).sort((a, b) => b.score - a.score);
    return ranked.slice(0, Math.max(1, Math.min(8, limit)));
  }
}

export async function purgeExpiredKnowledgeEmbeddings(db: Pick<Db, "query">) {
  await db.query("DELETE FROM orbit_knowledge_embeddings WHERE updated_at < now() - INTERVAL '30 days'");
}

/** Cleans semantic cache independently of whether any host performs a vector query. */
@Injectable()
export class OrbitKnowledgeRetentionWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrbitKnowledgeRetentionWorker.name);
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<void>;

  constructor(@Inject(Db) private readonly db: Db) {}

  onModuleInit() {
    this.scheduleCleanup();
    this.timer = setInterval(() => this.scheduleCleanup(), 24 * 60 * 60 * 1000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  purgeExpired() {
    if (this.inFlight) return this.inFlight;
    this.inFlight = purgeExpiredKnowledgeEmbeddings(this.db)
      .finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }

  private scheduleCleanup() {
    void this.purgeExpired().catch((error: unknown) => {
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? ` (database code ${error.code.slice(0, 32)})` : "";
      this.logger.error(`Falha ao expurgar embeddings antigos${code}; a próxima execução repetirá a limpeza.`);
    });
  }
}

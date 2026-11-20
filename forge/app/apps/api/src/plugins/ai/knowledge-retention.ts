import { Logger, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Db } from "../../db";

export const ORBIT_KNOWLEDGE_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const ORBIT_KNOWLEDGE_RETENTION_SQL =
  "DELETE FROM orbit_knowledge_embeddings WHERE updated_at < now() - INTERVAL '30 days'";

@Injectable()
export class OrbitKnowledgeRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrbitKnowledgeRetentionService.name);
  private timer?: NodeJS.Timeout;
  private sweep?: Promise<void>;

  constructor(private readonly db: Db) {}

  onModuleInit() {
    // Run once at startup even when embeddings are disabled or no host invokes rank().
    this.timer = setInterval(() => { void this.purgeExpiredVectors().catch(() => undefined); }, ORBIT_KNOWLEDGE_RETENTION_INTERVAL_MS);
    this.timer.unref();
    void this.purgeExpiredVectors().catch(() => undefined);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  purgeExpiredVectors(): Promise<void> {
    if (this.sweep) return this.sweep;
    const running = Promise.resolve().then(async () => {
      await this.db.query(ORBIT_KNOWLEDGE_RETENTION_SQL);
    }).catch((error: unknown) => {
      this.logger.error("Could not purge expired Orbit embedding vectors; the next scheduled cycle will retry.");
      throw error;
    }).finally(() => {
      if (this.sweep === running) this.sweep = undefined;
    });
    this.sweep = running;
    return running;
  }
}

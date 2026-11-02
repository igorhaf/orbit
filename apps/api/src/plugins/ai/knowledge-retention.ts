import { Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";

export const ORBIT_KNOWLEDGE_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const RETENTION_SQL = "DELETE FROM orbit_knowledge_embeddings WHERE updated_at < now() - INTERVAL '30 days'";

export interface KnowledgeRetentionDatabase {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

export interface KnowledgeRetentionScheduler {
  setInterval(callback: () => void | Promise<void>, milliseconds: number): ReturnType<typeof setInterval>;
  clearInterval(timer: ReturnType<typeof setInterval>): void;
}

const systemScheduler: KnowledgeRetentionScheduler = {
  setInterval: (callback, milliseconds) => setInterval(() => { void callback(); }, milliseconds),
  clearInterval: (timer) => clearInterval(timer),
};

/** Prunes stale vectors independently of search traffic or the optional embedding provider. */
export class OrbitKnowledgeRetentionService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private cleanupInFlight?: Promise<void>;
  private readonly logger: Pick<Logger, "error">;

  constructor(
    private readonly db: KnowledgeRetentionDatabase,
    logger: Pick<Logger, "error"> = new Logger(OrbitKnowledgeRetentionService.name),
    private readonly scheduler: KnowledgeRetentionScheduler = systemScheduler,
  ) {
    this.logger = logger;
  }

  async onModuleInit() {
    this.timer = this.scheduler.setInterval(
      () => this.runScheduledCleanup(),
      ORBIT_KNOWLEDGE_RETENTION_INTERVAL_MS,
    );
    this.timer.unref?.();
    await this.runScheduledCleanup();
  }

  onModuleDestroy() {
    if (this.timer) this.scheduler.clearInterval(this.timer);
    this.timer = undefined;
  }

  async pruneExpiredVectors() {
    if (this.cleanupInFlight) return this.cleanupInFlight;
    const cleanup = Promise.resolve()
      .then(() => this.db.query(RETENTION_SQL))
      .then(() => undefined);
    this.cleanupInFlight = cleanup.finally(() => { this.cleanupInFlight = undefined; });
    return this.cleanupInFlight;
  }

  async runScheduledCleanup() {
    try {
      await this.pruneExpiredVectors();
    } catch {
      this.logger.error("Embeddings retention cleanup failed; retrying on the next daily run.");
    }
  }
}

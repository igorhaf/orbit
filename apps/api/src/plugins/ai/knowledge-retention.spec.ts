import { test } from "node:test";
import assert from "node:assert/strict";
import { ORBIT_KNOWLEDGE_RETENTION_INTERVAL_MS, ORBIT_KNOWLEDGE_RETENTION_SQL, OrbitKnowledgeRetentionService } from "./knowledge-retention";

class MockRetentionDb {
  calls = 0;
  failNext = false;

  async query(sql: string) {
    this.calls += 1;
    assert.equal(sql, ORBIT_KNOWLEDGE_RETENTION_SQL);
    if (this.failNext) {
      this.failNext = false;
      throw new Error("temporary database failure");
    }
    return [];
  }
}

function withFakeInterval(run: (state: { callback?: () => void; delay?: number; unref: boolean; cleared: boolean }) => Promise<void>) {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const state: { callback?: () => void; delay?: number; unref: boolean; cleared: boolean } = { unref: false, cleared: false };
  const fakeTimer = { unref() { state.unref = true; } } as unknown as NodeJS.Timeout;
  globalThis.setInterval = ((callback: (...args: unknown[]) => void, delay?: number) => {
    state.callback = callback as () => void;
    state.delay = delay;
    return fakeTimer;
  }) as typeof globalThis.setInterval;
  globalThis.clearInterval = ((timer: NodeJS.Timeout) => {
    assert.equal(timer, fakeTimer);
    state.cleared = true;
  }) as typeof globalThis.clearInterval;
  return run(state).finally(() => {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  });
}

test("retention purges immediately and daily without consulting embeddings configuration", async () => {
  await withFakeInterval(async (timer) => {
    const db = new MockRetentionDb();
    const service = new OrbitKnowledgeRetentionService(db as never);
    service.onModuleInit();
    await service.purgeExpiredVectors();
    assert.equal(db.calls, 1, "the initial sweep is deduplicated with an explicit concurrent call");
    assert.equal(timer.delay, ORBIT_KNOWLEDGE_RETENTION_INTERVAL_MS);
    assert.equal(timer.unref, true);

    timer.callback?.();
    await service.purgeExpiredVectors();
    assert.equal(db.calls, 2, "the daily cycle runs even without any retrieval call");
    service.onModuleDestroy();
    assert.equal(timer.cleared, true);
  });
});

test("failed retention sweep is logged, releases its lock, and can retry next cycle", async () => {
  await withFakeInterval(async (timer) => {
    const db = new MockRetentionDb();
    db.failNext = true;
    const service = new OrbitKnowledgeRetentionService(db as never);
    const logged: unknown[][] = [];
    (service as unknown as { logger: { error(...args: unknown[]): void } }).logger = { error: (...args) => logged.push(args) };
    service.onModuleInit();
    await assert.rejects(service.purgeExpiredVectors(), /temporary database failure/);
    assert.equal(db.calls, 1);
    assert.deepEqual(logged, [["Could not purge expired Orbit embedding vectors; the next scheduled cycle will retry."]],
      "log only the generic retry message, without database error or stack details");

    timer.callback?.();
    await service.purgeExpiredVectors();
    assert.equal(db.calls, 2, "failure does not retain the in-flight guard, so the next daily cycle retries");
    service.onModuleDestroy();
    assert.equal(timer.cleared, true);
  });
});

import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Db } from "../../db";
import {
  ORBIT_KNOWLEDGE_RETENTION_INTERVAL_MS,
  OrbitKnowledgeRetentionService,
  type KnowledgeRetentionScheduler,
} from "./knowledge-retention";

function fakeScheduler() {
  const intervals: Array<{ callback: () => void | Promise<void>; milliseconds: number; timer: ReturnType<typeof setInterval> }> = [];
  const cleared: ReturnType<typeof setInterval>[] = [];
  let unrefCalls = 0;
  const scheduler: KnowledgeRetentionScheduler = {
    setInterval(callback, milliseconds) {
      const timer = { unref: () => { unrefCalls += 1; } } as unknown as ReturnType<typeof setInterval>;
      intervals.push({ callback, milliseconds, timer });
      return timer;
    },
    clearInterval(timer) { cleared.push(timer); },
  };
  return { scheduler, intervals, cleared, get unrefCalls() { return unrefCalls; } };
}

test("retention prunes immediately with embeddings unused and schedules a cancellable unref'd daily timer", async () => {
  const calls: string[] = [];
  const scheduler = fakeScheduler();
  const service = new OrbitKnowledgeRetentionService({
    async query(sql) { calls.push(sql); return []; },
  }, { error() {} }, scheduler.scheduler);

  await service.onModuleInit();
  assert.equal(calls.length, 1);
  assert.match(calls[0], /DELETE FROM orbit_knowledge_embeddings WHERE updated_at < now\(\) - INTERVAL '30 days'/);
  assert.equal(scheduler.intervals.length, 1);
  assert.equal(scheduler.intervals[0].milliseconds, ORBIT_KNOWLEDGE_RETENTION_INTERVAL_MS);
  assert.equal(scheduler.unrefCalls, 1);

  await scheduler.intervals[0].callback();
  assert.equal(calls.length, 2, "scheduled cleanup runs even when no rank() call occurs");
  service.onModuleDestroy();
  assert.deepEqual(scheduler.cleared, [scheduler.intervals[0].timer]);
});

test("simultaneous retention requests share one in-flight database cleanup", async () => {
  let resolveQuery!: () => void;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  let calls = 0;
  const service = new OrbitKnowledgeRetentionService({
    query() {
      calls += 1;
      markStarted();
      return new Promise<void>((resolve) => { resolveQuery = resolve; });
    },
  }, { error() {} }, fakeScheduler().scheduler);

  const first = service.pruneExpiredVectors();
  const second = service.pruneExpiredVectors();
  await started;
  assert.equal(calls, 1);
  resolveQuery();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});

test("cleanup failure is logged and the next scheduled daily run retries", async () => {
  const scheduler = fakeScheduler();
  const errors: string[] = [];
  let calls = 0;
  const service = new OrbitKnowledgeRetentionService({
    async query() {
      calls += 1;
      if (calls === 1) throw new Error("database unavailable");
      return [];
    },
  }, { error(message) { errors.push(message); } }, scheduler.scheduler);

  await service.onModuleInit();
  assert.equal(calls, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /retrying on the next daily run/);
  assert.doesNotMatch(errors[0], /database unavailable/);
  await scheduler.intervals[0].callback();
  assert.equal(calls, 2);
  assert.equal(errors.length, 1);
  service.onModuleDestroy();
});

test("host module provides the singleton retention service in the same context as Db", async () => {
  const calls: string[] = [];
  @Module({
    providers: [
      { provide: Db, useValue: { async query(sql: string) { calls.push(sql); return []; } } },
      { provide: OrbitKnowledgeRetentionService, useFactory: (db: Db) => new OrbitKnowledgeRetentionService(db), inject: [Db] },
    ],
  })
  class HostModule {}

  const app = await NestFactory.createApplicationContext(HostModule, { logger: false });
  try {
    const first = app.get(OrbitKnowledgeRetentionService);
    const second = app.get(OrbitKnowledgeRetentionService);
    assert.equal(first, second);
    assert.equal(calls.length, 1, "the singleton ran its immediate cleanup against the host database");
  } finally {
    await app.close();
  }
});

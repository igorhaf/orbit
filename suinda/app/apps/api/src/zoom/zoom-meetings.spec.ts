import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { ZoomMeetings } from "./zoom-meetings";

const owner = "owner-1";
const connectionId = "00000000-0000-4000-8000-000000000001";
const savedEnv = { id: process.env.ZOOM_CLIENT_ID, secret: process.env.ZOOM_CLIENT_SECRET, redirect: process.env.ZOOM_REDIRECT_URI };

function configure() {
  process.env.ZOOM_CLIENT_ID = "zoom-client";
  process.env.ZOOM_CLIENT_SECRET = "zoom-secret";
  process.env.ZOOM_REDIRECT_URI = "https://orbit.test/zoom/oauth/callback";
}
function restoreEnv() {
  if (savedEnv.id === undefined) delete process.env.ZOOM_CLIENT_ID; else process.env.ZOOM_CLIENT_ID = savedEnv.id;
  if (savedEnv.secret === undefined) delete process.env.ZOOM_CLIENT_SECRET; else process.env.ZOOM_CLIENT_SECRET = savedEnv.secret;
  if (savedEnv.redirect === undefined) delete process.env.ZOOM_REDIRECT_URI; else process.env.ZOOM_REDIRECT_URI = savedEnv.redirect;
}
function fixture() {
  const metadata: Record<string, unknown> = {};
  const operations = new Map<string, Record<string, unknown>>();
  const writes: Array<{ sql: string; params: unknown[] }> = [];
  let connection: Record<string, unknown> = {
    id: connectionId, owner_id: owner, external_account_id: "zoom-user", display_name: "Teacher",
    credentials_encrypted: JSON.stringify({ access_token: "access", refresh_token: "refresh", expires_at: Date.now() + 3600_000, scope: "meeting:write meeting:read user:read", token_type: "Bearer" }),
    enabled: true, metadata,
  };
  const db = {
    async query(sql: string, params: unknown[] = []) {
      writes.push({ sql, params });
      if (sql.includes("SET credentials_encrypted=$3")) connection = { ...connection, credentials_encrypted: params[2] };
      if (sql.includes("UPDATE external_resources SET metadata=$5")) operations.set(String(params[3]), JSON.parse(String(params[4])));
      return [];
    },
    async one(sql: string, params: unknown[] = []) {
      writes.push({ sql, params });
      if (sql.includes("INSERT INTO external_resources")) {
        const key = String(params[3]);
        const pending = JSON.parse(String(params[4])) as Record<string, unknown>;
        const current = operations.get(key);
        if (current && (current.status !== "rejected" || current.requestHash !== pending.requestHash)) return null;
        operations.set(key, pending);
        return { metadata: pending };
      }
      if (sql.includes("UPDATE external_resources SET metadata=$5") && sql.includes("RETURNING id")) {
        const key = String(params[3]);
        const current = operations.get(key);
        if (!current || current.status !== "pending") return null;
        operations.set(key, JSON.parse(String(params[4])));
        return { id: "operation-row" };
      }
      if (sql.includes("SELECT metadata FROM external_resources")) return { metadata: operations.get(String(params[3])) };
      if (sql.includes("FROM integration_connections WHERE id=$1")) {
        if (connection.owner_id !== params[1] || connection.enabled !== true) return null;
        return connection;
      }
      if (sql.includes("UPDATE oauth_states")) return null;
      return null;
    },
  };
  const vault = {
    seal(value: unknown) { return JSON.stringify(value); },
    open<T>(value: string) { return JSON.parse(value) as T; },
  };
  return { service: new ZoomMeetings(db as never, vault as never), metadata, writes, operations, setConnection(value: Record<string, unknown>) { connection = value; } };
}
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, async json() { return body; } });

test("Zoom OAuth URL stores only hashed, single-use state and uses PKCE", async () => {
  configure();
  const originalFetch = globalThis.fetch;
  try {
    const { service, writes } = fixture();
    const { url } = await service.oauthUrl(owner);
    const parsed = new URL(url);
    const state = parsed.searchParams.get("state")!;
    const insert = writes.find((entry) => entry.sql.includes("INSERT INTO oauth_states"))!;
    assert.equal(insert.params[0], createHash("sha256").update(state).digest("hex"));
    assert.notEqual(String(insert.params[0]), state);
    assert.equal(parsed.searchParams.get("code_challenge_method"), "S256");
    assert.equal(parsed.searchParams.get("redirect_uri"), "https://orbit.test/zoom/oauth/callback");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("meeting creation returns only safe participant data and reuses a completed operation", async () => {
  configure();
  const originalFetch = globalThis.fetch;
  try {
    const { service } = fixture();
    let posts = 0;
    globalThis.fetch = (async () => {
      posts++;
      return response({ id: 77, topic: "Class", start_time: "2026-11-01T10:00:00Z", duration: 60, join_url: "https://us06web.zoom.us/j/123456", start_url: "https://us06web.zoom.us/s/host-secret", password: "private" }) as Response;
    }) as typeof fetch;
    const input = { topic: "Class", start: "2026-11-01T10:00:00Z", end: "2026-11-01T11:00:00Z" };
    const result = await service.create(owner, connectionId, input, "enrollment-1");
    const repeated = await service.create(owner, connectionId, input, "enrollment-1");
    assert.deepEqual(result, repeated);
    assert.deepEqual(Object.keys(result).sort(), ["duration", "id", "join_url", "start_time", "topic"]);
    assert.equal(posts, 1);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("Zoom lê detalhes e páginas de participantes somente após reunião encerrada e com meeting:read", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const { service } = fixture();
    const urls: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = String(input); urls.push(url);
      if (url.includes("/participants?")) return response({ participants: [{ user_email: "learner@example.test", join_time: "2030-01-01T10:00:00Z", leave_time: "2030-01-01T10:30:00Z" }] }) as Response;
      return response({ id: 77, uuid: "meeting-uuid", topic: "Suindá · Aula", start_time: "2030-01-01T10:00:00Z", duration: 60 }) as Response;
    }) as typeof fetch;
    const result = await service.pastParticipants(owner, connectionId, "77");
    assert.equal(result.details.id, 77);
    assert.equal(result.participants[0].user_email, "learner@example.test");
    assert.ok(urls[0].endsWith("/past_meetings/77"));
    assert.ok(urls[1].includes("/past_meetings/meeting-uuid/participants"));
  } finally { globalThis.fetch = originalFetch; }
});

test("ambiguous network failure stays pending and does not repeat the meeting POST", async () => {
  configure();
  const originalFetch = globalThis.fetch;
  try {
    const { service } = fixture();
    let posts = 0;
    globalThis.fetch = (async () => { posts++; throw new TypeError("socket closed after request"); }) as typeof fetch;
    const input = { topic: "Class", start: "2026-11-01T10:00:00Z", end: "2026-11-01T11:00:00Z" };
    await assert.rejects(service.create(owner, connectionId, input, "enrollment-2"), (error: { getStatus?: () => number }) => error.getStatus?.() === 409);
    await assert.rejects(service.create(owner, connectionId, input, "enrollment-2"), (error: { getStatus?: () => number }) => error.getStatus?.() === 409);
    assert.equal(posts, 1);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("expired access refreshes and persists the rotated refresh token", async () => {
  configure();
  const originalFetch = globalThis.fetch;
  try {
    const { writes } = fixture();
    let meetingPosts = 0;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === "https://zoom.us/oauth/token") {
        assert.match(String(new Headers(init?.headers).get("authorization")), /^Basic /);
        return response({ access_token: "new-access", refresh_token: "rotated-refresh", expires_in: 3600, scope: "meeting:write meeting:read user:read" }) as Response;
      }
      meetingPosts++;
      return response({ id: 88, topic: "Class", start_time: "2026-11-01T10:00:00Z", duration: 60, join_url: "https://zoom.us/j/88" }) as Response;
    }) as typeof fetch;
    // Make the stored access token expire while preserving the test fixture's valid owner-bound connection.
    const connection = {
      id: connectionId, owner_id: owner, external_account_id: "zoom-user", display_name: "Teacher",
      credentials_encrypted: JSON.stringify({ access_token: "old-access", refresh_token: "old-refresh", expires_at: 0, scope: "meeting:write meeting:read user:read", token_type: "Bearer" }),
      enabled: true, metadata: {},
    };
    const expiringDb = {
      async query(sql: string, params: unknown[] = []) { writes.push({ sql, params }); return []; },
      async one(sql: string, params: unknown[] = []) {
        if (sql.includes("INSERT INTO external_resources")) return { metadata: JSON.parse(String(params[4])) };
        if (sql.includes("SELECT metadata FROM external_resources")) return null;
        if (sql.includes("FROM integration_connections WHERE id=$1")) return connection;
        return null;
      },
    };
    const vault = { seal(value: unknown) { return JSON.stringify(value); }, open<T>(value: string) { return JSON.parse(value) as T; } };
    const expiringService = new ZoomMeetings(expiringDb as never, vault as never);
    await expiringService.create(owner, connectionId, { topic: "Class", start: "2026-11-01T10:00:00Z", end: "2026-11-01T11:00:00Z" }, "refresh-case");
    const saved = writes.find((write) => write.sql.includes("SET credentials_encrypted=$3"));
    assert.ok(saved);
    assert.equal(JSON.parse(String(saved.params[2])).refresh_token, "rotated-refresh");
    assert.equal(meetingPosts, 1);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("untrusted join hosts and wrong connection owners are rejected", async () => {
  configure();
  const originalFetch = globalThis.fetch;
  try {
    const { service, setConnection } = fixture();
    globalThis.fetch = (async () => response({ id: 1, join_url: "https://zoom.us.attacker.example/j/1" })) as unknown as typeof fetch;
    await assert.rejects(service.create(owner, connectionId, { topic: "Class", start: "2026-11-01T10:00:00Z", end: "2026-11-01T11:00:00Z" }, "enrollment-3"));
    setConnection({ id: connectionId, owner_id: "someone-else", enabled: false });
    await assert.rejects(service.disconnect(owner, connectionId));
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

function pendingOperation(topic = "Class", start = "2026-11-01T10:00:00.000Z", end = "2026-11-01T11:00:00.000Z") {
  const requestHash = createHash("sha256").update(JSON.stringify({ topic, start, end })).digest("hex");
  return { status: "pending", requestHash, startedAt: new Date().toISOString() };
}
const expectedMeeting = { topic: "Class", start: "2026-11-01T10:00:00.000Z", end: "2026-11-01T11:00:00.000Z" };
const matchingMeeting = { id: "123456", topic: "Class", start_time: "2026-11-01T10:00:30.000Z", duration: 60, join_url: "https://us06web.zoom.us/j/123456", start_url: "https://zoom.us/s/host-secret", password: "private" };

test("manual Zoom reconciliation reads and atomically recovers a matching pending operation", async () => {
  configure();
  const originalFetch = globalThis.fetch;
  try {
    const { service, operations, writes } = fixture();
    operations.set(createHash("sha256").update("recover-1").digest("hex"), pendingOperation());
    let posts = 0;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      assert.equal(String(input), "https://api.zoom.us/v2/meetings/123456");
      assert.equal(init?.method, undefined);
      posts++;
      return response(matchingMeeting) as Response;
    }) as typeof fetch;
    const result = await service.reconcile(owner, connectionId, "recover-1", "123456", expectedMeeting);
    assert.equal(result.join_url, matchingMeeting.join_url);
    assert.deepEqual(Object.keys(result).sort(), ["duration", "id", "join_url", "start_time", "topic"]);
    assert.equal(posts, 1);
    assert.equal(operations.get(createHash("sha256").update("recover-1").digest("hex"))?.status, "created");
    const write = writes.find((entry) => entry.sql.includes("RETURNING id") && entry.sql.includes("metadata->>'status'='pending'"));
    assert.ok(write, "transition uses a pending-only compare-and-set");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("manual Zoom reconciliation rejects owner mismatch and divergent meeting details", async () => {
  configure();
  const originalFetch = globalThis.fetch;
  try {
    const { service: wrongOwnerService, operations: wrongOwnerOps, setConnection } = fixture();
    wrongOwnerOps.set(createHash("sha256").update("recover-owner").digest("hex"), pendingOperation());
    setConnection({ id: connectionId, owner_id: "another-owner", enabled: true });
    await assert.rejects(wrongOwnerService.reconcile(owner, connectionId, "recover-owner", "123456", expectedMeeting), (error: { getStatus?: () => number }) => error.getStatus?.() === 404);

    const { service, operations } = fixture();
    operations.set(createHash("sha256").update("recover-mismatch").digest("hex"), pendingOperation());
    globalThis.fetch = (async () => response({ ...matchingMeeting, topic: "Different class" })) as unknown as typeof fetch;
    await assert.rejects(service.reconcile(owner, connectionId, "recover-mismatch", "123456", expectedMeeting), (error: { getStatus?: () => number }) => error.getStatus?.() === 409);
    assert.equal(operations.get(createHash("sha256").update("recover-mismatch").digest("hex"))?.status, "pending");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("manual Zoom reconciliation rejects unsafe participant URLs and a second completion", async () => {
  configure();
  const originalFetch = globalThis.fetch;
  try {
    const { service, operations } = fixture();
    const unsafeKey = createHash("sha256").update("recover-unsafe").digest("hex");
    operations.set(unsafeKey, pendingOperation());
    globalThis.fetch = (async () => response({ ...matchingMeeting, join_url: "https://zoom.us.attacker.example/j/123456" })) as unknown as typeof fetch;
    await assert.rejects(service.reconcile(owner, connectionId, "recover-unsafe", "123456", expectedMeeting), (error: { getStatus?: () => number }) => error.getStatus?.() === 409);
    assert.equal(operations.get(unsafeKey)?.status, "pending");

    const completedKey = createHash("sha256").update("recover-again").digest("hex");
    operations.set(completedKey, pendingOperation());
    globalThis.fetch = (async () => response(matchingMeeting)) as unknown as typeof fetch;
    await service.reconcile(owner, connectionId, "recover-again", "123456", expectedMeeting);
    await assert.rejects(service.reconcile(owner, connectionId, "recover-again", "123456", expectedMeeting), (error: { getStatus?: () => number }) => error.getStatus?.() === 409);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

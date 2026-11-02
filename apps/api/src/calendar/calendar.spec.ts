import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { CalendarSourceRegistry } from "./source-registry";
import { CalendarSourceProvider } from "./types";
import { SecretVault } from "../secrets";
import { GoogleCalendarPlugin, googleCalendarPluginDefinition } from "./google-calendar.plugin";
import { PluginRegistry } from "../execution/registries";
import { trelloPluginDefinition } from "../trello-sync";

const provider = (id: string): CalendarSourceProvider => ({
  id,
  name: id,
  async listSources() {
    return [];
  },
  async listItems() {
    return [];
  },
});

test("calendar source registry supports many providers and rejects duplicate ids", () => {
  const registry = new CalendarSourceRegistry();
  registry.register(provider("orbit_cards"));
  registry.register(provider("google_calendar"));
  assert.deepEqual(
    registry.catalog().map((item) => item.id),
    ["orbit_cards", "google_calendar"],
  );
  assert.throws(() => registry.register(provider("google_calendar")));
});

test("Google Calendar registration preserves the existing Trello integration", () => {
  const registry = new PluginRegistry();
  registry.register(trelloPluginDefinition);
  registry.register(googleCalendarPluginDefinition(new GoogleCalendarPlugin({} as never,{} as never)));
  assert.deepEqual(
    registry.list().map((item) => item.id),
    ["trello", "google_calendar"],
  );
  assert.equal(registry.getById("trello").scope, "board");
});

test("secret vault encrypts OAuth tokens with authenticated encryption", () => {
  const previous = process.env.ORBIT_SECRET_KEY;
  process.env.ORBIT_SECRET_KEY =
    "calendar-test-secret-at-least-thirty-two-characters";
  try {
    const vault = new SecretVault(),
      sealed = vault.seal({ access_token: "access", refresh_token: "refresh" });
    assert.ok(!sealed.includes("refresh"));
    assert.deepEqual(vault.open(sealed), {
      access_token: "access",
      refresh_token: "refresh",
    });
    assert.throws(() => vault.open(sealed.slice(0, -1) + (sealed.endsWith("x") ? "y" : "x")));
  } finally {
    if (previous === undefined) delete process.env.ORBIT_SECRET_KEY;
    else process.env.ORBIT_SECRET_KEY = previous;
  }
});

test("google provider advertises normalized actions and capabilities", () => {
  const plugin = new GoogleCalendarPlugin(
    {} as never,
    {} as never,
  );
  const ids = plugin.contributions.pluginActions.map((action) => action.id);
  for (const id of [
    "google_calendar.list_calendars",
    "google_calendar.list_events",
    "google_calendar.get_event",
    "google_calendar.create_event",
    "google_calendar.update_event",
    "google_calendar.delete_event",
    "google_calendar.get_availability",
  ])
    assert.ok(ids.includes(id), id);
  const definition = googleCalendarPluginDefinition(plugin);
  assert.equal(definition.actions?.length, 7);
  assert.ok(definition.actions?.every((action) => typeof action.execute === "function"));
  assert.ok(definition.actions?.find((action) => action.id === "google_calendar.create_event")?.requiredCapabilities?.includes("calendar.events.write"));

});

test("Google Calendar Registry actions have executable handlers", async () => {
  const plugin = new GoogleCalendarPlugin({} as never, {} as never);
  Object.assign(plugin, { listSources: async (owner: string, connection?: string) => [{ owner, connection }] });
  const definition = googleCalendarPluginDefinition(plugin);
  const action = definition.actions?.find((item) => item.id === "google_calendar.list_calendars");
  assert.ok(action?.execute);
  assert.deepEqual(await action.execute({}, { userId: "owner-1" }), {
    type: "calendar", label: "Listar calendários", value: [{ owner: "owner-1", connection: undefined }],
  });
});

test("google event normalization distinguishes all-day and timed values with timezone", () => {
  const plugin = new GoogleCalendarPlugin(
    {} as never,
    {} as never,
  ) as unknown as {
    date(
      value: { date?: string; dateTime?: string; timeZone?: string },
      zone?: string,
    ): { at: Date; allDay: boolean; timeZone: string | null };
  };
  const allDay = plugin.date({ date: "2026-10-01" }, "America/Recife"),
    timed = plugin.date({
      dateTime: "2026-10-01T10:00:00-03:00",
      timeZone: "America/Recife",
    });
  assert.equal(allDay.allDay, true);
  assert.equal(allDay.at.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(timed.allDay, false);
  assert.equal(timed.at.toISOString(), "2026-10-01T13:00:00.000Z");
  assert.equal(timed.timeZone, "America/Recife");
});

test("Google Meet conference data exposes a normalized join URL to Orbit calendar consumers", () => {
  const plugin = new GoogleCalendarPlugin({} as never, {} as never) as unknown as {
    normalizeConference(value: unknown): unknown;
  };
  assert.deepEqual(plugin.normalizeConference({
    conferenceSolution: { key: { type: "hangoutsMeet" } },
    entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" }],
  }), {
    conferenceSolution: { key: { type: "hangoutsMeet" } },
    entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" }],
    provider: "google_meet",
    joinUrl: "https://meet.google.com/abc-defg-hij",
  });
  assert.deepEqual(plugin.normalizeConference(JSON.stringify({ joinUrl: "https://meet.google.com/abc-defg-hij" })), {
    joinUrl: "https://meet.google.com/abc-defg-hij", provider: "google_meet",
  });
  assert.deepEqual(plugin.normalizeConference({ joinUrl: "https://example.test/meeting" }), {
    provider: "google_meet",
  });
  assert.deepEqual(plugin.normalizeConference({ joinUrl: "http://meet.google.com/abc-defg-hij" }), {
    provider: "google_meet",
  });
});

test("Google event creation recovers an already-created event by operation key", async () => {
  const operationKey = "00000000-0000-4000-8000-000000000777";
  const source = { id: "source-1", owner_id: "owner-1", connection_id: "connection-1", external_id: "primary", name: "Principal" };
  const event = { id: "event-1", summary: "Suindá · Aula", extendedProperties: { private: { orbitOperationKey: operationKey } } };
  const recoveredItem = { id: "item-1", sourceId: "source-1", title: event.summary };
  const db = { one: async (query: string) => query.includes("calendar_sources") ? source : null };
  const plugin = new GoogleCalendarPlugin(db as never, {} as never) as unknown as {
    createItem(owner: string, sourceId: string, input: Record<string, unknown>): Promise<unknown>;
    connection: () => Promise<unknown>;
    request: (_connection: unknown, path: string, init?: RequestInit) => Promise<unknown>;
    persist: (_source: unknown, recovered: unknown) => Promise<unknown>;
  };
  let requests = 0;
  let persisted = false;
  Object.assign(plugin, {
    connection: async () => ({}),
    request: async (_connection: unknown, path: string, init?: RequestInit) => {
      requests++;
      assert.equal(init, undefined);
      assert.ok(path.includes(`privateExtendedProperty=orbitOperationKey%3D${operationKey}`));
      return { items: [event] };
    },
    persist: async (_source: unknown, recovered: unknown) => {
      persisted = recovered === event;
      return recoveredItem;
    },
  });
  const result = await plugin.createItem("owner-1", "source-1", {
    title: "Suindá · Aula", start: "2030-01-01T12:00:00Z", end: "2030-01-01T13:00:00Z", operationKey,
  });
  assert.equal(requests, 1);
  assert.equal(persisted, true);
  assert.equal(result, recoveredItem);
});

test("Google event retries refresh an existing conference before returning its join link", async () => {
  const operationKey = "00000000-0000-4000-8000-000000000778";
  const source = { id: "source-1", owner_id: "owner-1", connection_id: "connection-1", external_id: "primary", name: "Principal" };
  const prior = { id: "item-1" };
  const refreshed = { id: "item-1", conference: { provider: "google_meet", joinUrl: "https://meet.google.com/abc-defg-hij" } };
  const db = { one: async (query: string) => query.includes("calendar_sources") ? source : prior };
  const plugin = new GoogleCalendarPlugin(db as never, {} as never) as unknown as {
    createItem(owner: string, sourceId: string, input: Record<string, unknown>): Promise<unknown>;
    connection: () => Promise<unknown>;
    getItem(owner: string, itemId: string): Promise<unknown>;
  };
  let refreshedOwner = "";
  let refreshedId = "";
  Object.assign(plugin, { connection: async () => ({}), getItem: async (owner: string, itemId: string) => {
    refreshedOwner = owner; refreshedId = itemId; return refreshed;
  } });
  const result = await plugin.createItem("owner-1", "source-1", {
    title: "Suindá · Aula", start: "2030-01-01T12:00:00Z", end: "2030-01-01T13:00:00Z", conference: true, operationKey,
  });
  assert.equal(refreshedOwner, "owner-1");
  assert.equal(refreshedId, "item-1");
  assert.equal(result, refreshed);
});

test("OAuth start persists only a state hash and requests offline access", async () => {
  const previous = {
    id: process.env.GOOGLE_CLIENT_ID,
    secret: process.env.GOOGLE_CLIENT_SECRET,
  };
  process.env.GOOGLE_CLIENT_ID = "client";
  process.env.GOOGLE_CLIENT_SECRET = "secret";
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      return [];
    },
  };
  try {
    const plugin = new GoogleCalendarPlugin(
        db as never,
        new SecretVault(),
          ),
      result = await plugin.oauthUrl("00000000-0000-4000-8000-000000000001"),
      url = new URL(result.url),
      state = url.searchParams.get("state")!;
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("prompt"), "consent");
    const requestedScopes = new Set(url.searchParams.get("scope")!.split(" "));
    assert.ok(requestedScopes.has("https://www.googleapis.com/auth/calendar.events"));
    assert.ok(requestedScopes.has("https://www.googleapis.com/auth/calendar.calendarlist.readonly"));
    assert.ok(requestedScopes.has("https://www.googleapis.com/auth/calendar.freebusy"));
    assert.ok(!requestedScopes.has("https://www.googleapis.com/auth/calendar"));
    assert.ok(!requestedScopes.has("https://www.googleapis.com/auth/meetings.space.readonly"));
    const attendanceUrl = new URL((await plugin.oauthUrl("00000000-0000-4000-8000-000000000001", "meet_attendance")).url);
    assert.ok(attendanceUrl.searchParams.get("scope")!.split(" ").includes("https://www.googleapis.com/auth/meetings.space.readonly"));
    const stored = String(
      calls.find((call) => call.sql.includes("INSERT INTO oauth_states"))
        ?.params[0],
    );
    assert.equal(stored.length, 64);
    assert.ok(!stored.includes(state));
  } finally {
    if (previous.id === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = previous.id;
    if (previous.secret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = previous.secret;
  }
});

test("expired access tokens are refreshed and re-encrypted without exposing refresh token", async () => {
  const env = {
      key: process.env.ORBIT_SECRET_KEY,
      id: process.env.GOOGLE_CLIENT_ID,
      secret: process.env.GOOGLE_CLIENT_SECRET,
    },
    originalFetch = global.fetch;
  process.env.ORBIT_SECRET_KEY =
    "calendar-refresh-secret-with-thirty-two-characters";
  process.env.GOOGLE_CLIENT_ID = "client";
  process.env.GOOGLE_CLIENT_SECRET = "secret";
  const vault = new SecretVault(),
    writes: unknown[][] = [];
  global.fetch = async () =>
    new Response(
      JSON.stringify({ access_token: "new-access", expires_in: 3600 }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  const db = {
    async query(_sql: string, params: unknown[] = []) {
      writes.push(params);
      return [];
    },
  };
  try {
    const plugin = new GoogleCalendarPlugin(
      db as never,
      vault,
      ) as unknown as {
      token(connection: Record<string, unknown>): Promise<string>;
    };
    const access = await plugin.token({
      id: "connection",
      credentials_encrypted: vault.seal({
        access_token: "old",
        refresh_token: "refresh-secret",
        expires_at: 0,
      }),
    });
    assert.equal(access, "new-access");
    assert.ok(
      typeof writes[0][1] === "string" &&
        !String(writes[0][1]).includes("refresh-secret"),
    );
    assert.equal(
      vault.open<{ refresh_token: string }>(String(writes[0][1])).refresh_token,
      "refresh-secret",
    );
  } finally {
    global.fetch = originalFetch;
    for (const [name, value] of Object.entries(env)) {
      const key =
        name === "key"
          ? "ORBIT_SECRET_KEY"
          : name === "id"
            ? "GOOGLE_CLIENT_ID"
            : "GOOGLE_CLIENT_SECRET";
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("watch notifications require the persisted channel secret before scheduling sync", async () => {
  const previous = process.env.ORBIT_SECRET_KEY;
  process.env.ORBIT_SECRET_KEY =
    "calendar-watch-secret-with-thirty-two-characters";
  const vault = new SecretVault(),
    db = {
      async one() {
        return {
          source_id: "source",
          secret_encrypted: vault.seal({ secret: "expected" }),
          status: "active",
        };
      },
    };
  try {
    const plugin = new GoogleCalendarPlugin(
      db as never,
      vault,
      );
    assert.equal(await plugin.notification("channel", "wrong"), false);
    assert.equal(await plugin.notification("channel", "expected"), true);
  } finally {
    if (previous === undefined) delete process.env.ORBIT_SECRET_KEY;
    else process.env.ORBIT_SECRET_KEY = previous;
  }
});

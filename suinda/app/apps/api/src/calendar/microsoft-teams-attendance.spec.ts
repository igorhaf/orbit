import assert from "node:assert/strict";
import test from "node:test";
import { SecretVault } from "../secrets";
import { MicrosoftConnection, MicrosoftGraphClient, MicrosoftGraphError } from "./microsoft-graph";
import { MicrosoftTeamsAttendanceAdapter } from "./microsoft-teams-attendance";

const meetingId = "meeting-123";
const connection: MicrosoftConnection = {
  id: "connection-1", owner_id: "owner-1", plugin_id: "microsoft", external_account_id: "tenant:user",
  display_name: "Organizador", credentials_encrypted: "sealed", enabled: true, status: "connected",
  capabilities: { teamsOnlineMeetings: true }, metadata: { accountType: "work_or_school" },
};
const tokenWithScopes = (scp: string) => `header.${Buffer.from(JSON.stringify({ scp })).toString("base64url")}.signature`;

const setup = (handler: (url: string) => Response | Promise<Response>, scopes = "OnlineMeetings.ReadWrite OnlineMeetingArtifact.Read.All") => {
  const originalFetch = global.fetch;
  global.fetch = async (input) => handler(String(input));
  const vault = {
    open: () => ({ capability_tokens: { teams: { access_token: tokenWithScopes(scopes), refresh_token: "refresh", expires_at: Date.now() + 3_600_000, scope: scopes, token_type: "Bearer" } } }),
    seal: () => "sealed",
  };
  const graph = new MicrosoftGraphClient({ query: async () => [] } as never, vault as unknown as SecretVault);
  return { adapter: new MicrosoftTeamsAttendanceAdapter(graph), restore: () => { global.fetch = originalFetch; } };
};

test("Teams adapter returns latest completed report and gathers all paginated attendance records", async () => {
  const urls: string[] = [];
  const { adapter, restore } = setup((url) => {
    urls.push(url);
    if (url.endsWith(`/onlineMeetings/${meetingId}`)) return Response.json({ id: meetingId });
    if (url.endsWith("/attendanceReports")) return Response.json({ value: [
      { id: "old", meetingId, meetingStartDateTime: "2026-01-01T10:00:00Z", meetingEndDateTime: "2026-01-01T11:00:00Z" },
      { id: "future", meetingId, meetingStartDateTime: "2099-01-01T10:00:00Z", meetingEndDateTime: "2099-01-01T11:00:00Z" },
      { id: "latest", meetingId, meetingStartDateTime: "2026-02-01T10:00:00Z", meetingEndDateTime: "2026-02-01T11:00:00Z" },
    ] });
    if (url.endsWith("/latest/attendanceRecords")) return Response.json({ value: [{
      emailAddress: "Student@Example.com", identity: { user: { displayName: "Student", email: "Student@Example.com" } },
      attendanceIntervals: [{ joinDateTime: "2026-02-01T10:05:00Z", leaveDateTime: "2026-02-01T10:55:00Z", durationInSeconds: 3000 }],
    }], "@odata.nextLink": `https://graph.microsoft.com/v1.0/me/onlineMeetings/${meetingId}/attendanceReports/latest/attendanceRecords?$skip=1` });
    if (url.includes("$skip=1")) return Response.json({ value: [{
      emailAddress: "second@example.com", attendanceIntervals: [{ joinDateTime: "2026-02-01T10:00:00Z", leaveDateTime: "2026-02-01T10:10:00Z" }],
    }] });
    throw new Error(`Unexpected Graph request: ${url}`);
  });
  try {
    const result = await adapter.latestCompleted(connection, meetingId);
    assert.equal(result.provider, "microsoft_teams");
    assert.equal(result.reportId, "latest");
    assert.equal(result.participants.length, 2);
    assert.equal(result.participants[0].email, "student@example.com");
    assert.equal(result.participants[0].totalAttendanceSeconds, 3000);
    assert.equal(result.participants[1].totalAttendanceSeconds, 600);
    assert.equal(urls.length, 4);
  } finally { restore(); }
});

test("Teams attendance fails closed when artifact scope is absent", async () => {
  const { adapter, restore } = setup(() => Response.json({}), "OnlineMeetings.ReadWrite");
  try {
    await assert.rejects(adapter.latestCompleted(connection, meetingId), (error: unknown) =>
      error instanceof MicrosoftGraphError && error.code === "CONSENT_REQUIRED");
  } finally { restore(); }
});

test("Teams attendance rejects personal accounts before Graph requests", async () => {
  let calls = 0;
  const { adapter, restore } = setup(() => { calls++; return Response.json({}); });
  try {
    await assert.rejects(adapter.latestCompleted({ ...connection, metadata: { accountType: "personal" } }, meetingId),
      (error: unknown) => error instanceof MicrosoftGraphError && error.code === "UNSUPPORTED_ACCOUNT");
    assert.equal(calls, 0);
  } finally { restore(); }
});

test("Teams attendance rejects an unconfirmed meeting identity", async () => {
  const { adapter, restore } = setup(() => Response.json({ id: "different-meeting" }));
  try {
    await assert.rejects(adapter.latestCompleted(connection, meetingId),
      (error: unknown) => error instanceof MicrosoftGraphError && error.code === "MEETING_ID_MISMATCH");
  } finally { restore(); }
});

test("Teams attendance resolves only the exact linked URL for its organizer", async () => {
  const joinUrl = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_example%40thread.v2/0?context=%7B%22Tid%22%3A%22tenant%22%7D";
  const { adapter, restore } = setup((url) => {
    if (url.includes("/onlineMeetings?")) {
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get("$filter"), `JoinWebUrl eq '${joinUrl}'`);
      return Response.json({ value: [{ id: meetingId, joinWebUrl: joinUrl }] });
    }
    if (url.endsWith(`/onlineMeetings/${meetingId}`)) return Response.json({ id: meetingId });
    if (url.endsWith(`/onlineMeetings/${meetingId}/attendanceReports`)) return Response.json({ value: [
      { id: "report-1", meetingId, meetingStartDateTime: "2026-02-01T10:00:00Z", meetingEndDateTime: "2026-02-01T11:00:00Z" },
    ] });
    if (url.endsWith(`/attendanceReports/report-1/attendanceRecords`)) return Response.json({ value: [{
      emailAddress: "student@example.test",
      attendanceIntervals: [{ joinDateTime: "2026-02-01T10:00:00Z", leaveDateTime: "2026-02-01T11:00:00Z" }],
    }] });
    throw new Error(`Unexpected Graph request: ${url}`);
  });
  try {
    const result = await adapter.latestCompletedByJoinUrl(connection, joinUrl);
    assert.equal(result.meetingId, meetingId);
    assert.equal(result.reportId, "report-1");
    assert.equal(result.participants[0].email, "student@example.test");
  } finally { restore(); }
});

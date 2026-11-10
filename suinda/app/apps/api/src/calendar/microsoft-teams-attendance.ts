import { MicrosoftConnection, MicrosoftGraphClient, MicrosoftGraphError } from "./microsoft-graph";

const REQUIRED_SCOPE = "OnlineMeetingArtifact.Read.All";
const graphOrigin = "https://graph.microsoft.com/v1.0";
const graphHost = "https://graph.microsoft.com";

type AttendanceInterval = { joinDateTime: string; leaveDateTime: string; durationInSeconds?: number };
type AttendanceRecord = {
  emailAddress?: string;
  identity?: { user?: { displayName?: string; email?: string; id?: string }; [key: string]: unknown };
  totalAttendanceInSeconds?: number;
  attendanceIntervals?: AttendanceInterval[];
};
type Page<T> = { value?: T[]; "@odata.nextLink"?: string };
type Report = {
  id?: string;
  meetingId?: string;
  meetingStartDateTime?: string;
  meetingEndDateTime?: string;
};

export type MicrosoftTeamsAttendanceParticipant = {
  email: string | null;
  displayName: string | null;
  joinIntervals: Array<{ joinedAt: string; leftAt: string; durationSeconds: number }>;
  totalAttendanceSeconds: number;
};

export type MicrosoftTeamsAttendanceReport = {
  provider: "microsoft_teams";
  meetingId: string;
  reportId: string;
  meetingStart: string;
  meetingEnd: string;
  participants: MicrosoftTeamsAttendanceParticipant[];
};

const fail = (code: string, status: number, message: string): never => {
  throw new MicrosoftGraphError(code, status, message);
};

const decodedClaims = (token: string): Record<string, unknown> => {
  try {
    const payload = token.split(".")[1];
    if (!payload) return {};
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const requireScope = (token: string) => {
  const scopes = String(decodedClaims(token).scp || "").split(/\s+/).filter(Boolean);
  if (!scopes.includes(REQUIRED_SCOPE))
    fail("CONSENT_REQUIRED", 403, `A conexão Teams precisa do escopo ${REQUIRED_SCOPE}; reconecte após concedê-lo.`);
};

const requiredDate = (value: unknown, label: string) => {
  if (typeof value !== "string" || !value || !Number.isFinite(Date.parse(value)))
    return fail("INCOMPLETE_REPORT", 502, `Relatório Teams sem ${label} válido.`);
  return new Date(value).toISOString();
};

const pageUrl = (value: string | undefined, initial: string): string | null => {
  if (!value) return null;
  let parsed: URL;
  try { parsed = new URL(value, graphOrigin); }
  catch { return fail("INCOMPLETE_REPORT", 502, "Paginação inválida no relatório Teams."); }
  if (parsed.origin !== graphHost || !parsed.pathname.startsWith("/v1.0/"))
    return fail("INCOMPLETE_REPORT", 502, "Paginação fora do Microsoft Graph no relatório Teams.");
  if (!parsed.pathname.includes("/attendanceReports") || !parsed.pathname.includes(encodeURIComponent(initial)))
    return fail("INCOMPLETE_REPORT", 502, "Paginação não corresponde ao relatório Teams solicitado.");
  return parsed.toString();
};

/** Reads only completed reports for a meeting owned by the connected work/school organizer. */
export class MicrosoftTeamsAttendanceAdapter {
  constructor(private readonly graph: MicrosoftGraphClient) {}

  async latestCompletedByJoinUrl(connection: MicrosoftConnection, joinUrl: string): Promise<MicrosoftTeamsAttendanceReport> {
    let parsed: URL;
    try { parsed = new URL(joinUrl); }
    catch { return fail("VALIDATION_ERROR", 400, "Link de reunião Teams inválido."); }
    if (parsed.protocol !== "https:" || parsed.hostname !== "teams.microsoft.com" || parsed.username || parsed.password || parsed.port)
      return fail("VALIDATION_ERROR", 400, "Link de reunião Teams inválido.");
    const filter = `JoinWebUrl eq '${joinUrl.replaceAll("'", "''")}'`;
    const query = new URLSearchParams({ "$filter": filter, "$select": "id,joinWebUrl" });
    const result = await this.graph.request<{ value?: Array<{ id?: string; joinWebUrl?: string }> }>(connection, `me/onlineMeetings?${query}`);
    if (!Array.isArray(result.value))
      return fail("MEETING_LOOKUP_FAILED", 502, "O Microsoft Graph retornou uma busca de reunião inválida.");
    const exact = result.value.filter((meeting) => typeof meeting.id === "string" && meeting.id
      && meeting.joinWebUrl === joinUrl);
    if (exact.length !== 1)
      return fail("MEETING_IDENTITY_AMBIGUOUS", 409, "O link não identifica uma única reunião Teams criada por esta conta.");
    return this.latestCompleted(connection, exact[0].id!);
  }

  async latestCompleted(connection: MicrosoftConnection, meetingId: string): Promise<MicrosoftTeamsAttendanceReport> {
    const exactMeetingId = meetingId.trim();
    if (!exactMeetingId || exactMeetingId.length > 1000)
      fail("VALIDATION_ERROR", 400, "Identificador da reunião Teams inválido.");
    if (connection.metadata?.accountType === "personal")
      fail("UNSUPPORTED_ACCOUNT", 409, "Relatórios de presença exigem uma conta Teams corporativa ou escolar.");
    if (!connection.enabled || connection.status !== "connected" || !connection.capabilities?.teamsOnlineMeetings)
      fail("AUTH_REQUIRED", 401, "Conexão Teams ativa necessária para consultar presença.");

    const token = await this.graph.accessToken(connection, "teams");
    requireScope(token);
    const base = `me/onlineMeetings/${encodeURIComponent(exactMeetingId)}`;
    const meeting = await this.graph.request<{ id?: string }>(connection, base);
    if (!meeting.id || meeting.id !== exactMeetingId)
      fail("MEETING_ID_MISMATCH", 502, "O Microsoft Graph não confirmou a identidade exata da reunião Teams.");

    const reports: Report[] = [];
    const reportsPath = `${base}/attendanceReports`;
    let reportNext: string | null = `${graphOrigin}/${reportsPath}`;
    const seenReportPages = new Set<string>();
    while (reportNext) {
      if (seenReportPages.has(reportNext) || seenReportPages.size >= 100)
        fail("INCOMPLETE_REPORT", 502, "Paginação incompleta ou cíclica nos relatórios Teams.");
      seenReportPages.add(reportNext);
      const page = await this.graph.request<Page<Report>>(connection, reportNext);
      if (!Array.isArray(page.value))
        return fail("INCOMPLETE_REPORT", 502, "Microsoft Graph retornou relatórios de presença incompletos.");
      reports.push(...page.value);
      reportNext = pageUrl(page["@odata.nextLink"], exactMeetingId);
    }
    const completed = reports.filter((report) =>
      report.id && report.meetingId === exactMeetingId && report.meetingEndDateTime &&
      Number.isFinite(Date.parse(report.meetingEndDateTime)) && Date.parse(report.meetingEndDateTime) <= Date.now(),
    ).sort((a, b) => Date.parse(b.meetingEndDateTime!) - Date.parse(a.meetingEndDateTime!));
    if (!completed.length)
      fail("REPORT_NOT_READY", 409, "Não há relatório de presença concluído para esta reunião Teams.");
    const report = completed[0];
    const reportId = report.id!;
    const meetingStart = requiredDate(report.meetingStartDateTime, "início da reunião");
    const meetingEnd = requiredDate(report.meetingEndDateTime, "fim da reunião");
    if (Date.parse(meetingEnd) <= Date.parse(meetingStart))
      fail("INCOMPLETE_REPORT", 502, "Período inválido no relatório Teams.");

    const records: AttendanceRecord[] = [];
    const firstPath = `${base}/attendanceReports/${encodeURIComponent(reportId)}/attendanceRecords`;
    let next: string | null = `${graphOrigin}/${firstPath}`;
    const seen = new Set<string>();
    while (next) {
      if (seen.has(next) || seen.size >= 100)
        fail("INCOMPLETE_REPORT", 502, "Paginação incompleta ou cíclica no relatório Teams.");
      seen.add(next);
      const page = await this.graph.request<Page<AttendanceRecord>>(connection, next);
      if (!Array.isArray(page.value))
        return fail("INCOMPLETE_REPORT", 502, "Microsoft Graph retornou registros de presença incompletos.");
      records.push(...page.value);
      next = pageUrl(page["@odata.nextLink"], exactMeetingId);
    }
    if (records.length === 0)
      fail("INCOMPLETE_REPORT", 502, "O relatório Teams concluído não contém registros de presença.");

    const participants = records.map((record) => {
      const rawEmail = record.emailAddress || record.identity?.user?.email;
      const email = typeof rawEmail === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail.trim())
        ? rawEmail.trim().toLowerCase() : null;
      const joinIntervals = (record.attendanceIntervals || []).map((interval) => {
        const joinedAt = requiredDate(interval.joinDateTime, "entrada do participante");
        const leftAt = requiredDate(interval.leaveDateTime, "saída do participante");
        const durationSeconds = Number.isFinite(interval.durationInSeconds)
          ? Math.max(0, Math.floor(interval.durationInSeconds!))
          : Math.max(0, Math.floor((Date.parse(leftAt) - Date.parse(joinedAt)) / 1000));
        if (Date.parse(leftAt) < Date.parse(joinedAt))
          fail("INCOMPLETE_REPORT", 502, "Intervalo de presença inválido no relatório Teams.");
        return { joinedAt, leftAt, durationSeconds };
      });
      const computedTotal = joinIntervals.reduce((sum, interval) => sum + interval.durationSeconds, 0);
      return {
        email,
        displayName: record.identity?.user?.displayName || null,
        joinIntervals,
        totalAttendanceSeconds: Number.isFinite(record.totalAttendanceInSeconds)
          ? Math.max(0, Math.floor(record.totalAttendanceInSeconds!)) : computedTotal,
      };
    });
    return { provider: "microsoft_teams", meetingId: exactMeetingId, reportId, meetingStart, meetingEnd, participants };
  }
}

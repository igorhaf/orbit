import { HttpException, Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Db } from "../db";
import { PluginActionContext, PluginDefinition } from "../plugins/contract";
import { MicrosoftGraphClient } from "./microsoft-graph";

type OnlineMeeting = {
  id: string;
  subject?: string;
  startDateTime?: string;
  endDateTime?: string;
  joinWebUrl?: string;
  videoTeleconferenceId?: string;
  externalId?: string;
  participants?: unknown;
  allowedPresenters?: string;
  allowMeetingChat?: string;
  lobbyBypassSettings?: unknown;
};

const value = (input: unknown, label: string, max = 500) => {
  if (typeof input !== "string" || !input.trim() || input.length > max)
    throw new HttpException(`${label} inválido.`, 400);
  return input.trim();
};

@Injectable()
export class MicrosoftTeamsPlugin {
  readonly id = "microsoft_teams";
  readonly name = "Microsoft Teams";
  constructor(
    @Inject(Db) private db: Db,
    @Inject(MicrosoftGraphClient) private graph: MicrosoftGraphClient,
  ) {}

  private async connection(ownerId: string, connectionId: string) {
    const connection = await this.graph.connection(connectionId, ownerId);
    if (connection.metadata.accountType === "personal")
      throw new HttpException(
        "Reuniões Teams standalone exigem uma conta Microsoft corporativa ou escolar.",
        409,
      );
    if (!connection.capabilities?.teamsOnlineMeetings)
      throw new HttpException(
        "Conceda a permissão de reuniões Teams nesta conexão.",
        403,
      );
    return connection;
  }

  async create(
    ownerId: string,
    connectionId: string,
    input: Record<string, unknown>,
    cardId?: string,
  ) {
    const connection = await this.connection(ownerId, connectionId);
    const start = new Date(value(input.start, "Início"));
    const end = new Date(value(input.end, "Fim"));
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start)
      throw new HttpException("Período inválido.", 400);
    const externalId =
      typeof input.externalId === "string" && input.externalId
        ? input.externalId.slice(0, 256)
        : cardId
          ? `orbit-card-${cardId}-${start.toISOString()}`
          : randomUUID();
    const meeting = await this.graph.request<OnlineMeeting>(
      connection,
      "me/onlineMeetings/createOrGet",
      {
        method: "POST",
        body: JSON.stringify({
          startDateTime: start.toISOString(),
          endDateTime: end.toISOString(),
          subject: value(input.subject, "Assunto", 500),
          externalId,
          participants: input.participants,
          allowedPresenters: input.allowedPresenters,
          lobbyBypassSettings: input.lobbyBypassSettings,
        }),
      },
    );
    const resource = await this.db.one(
      `INSERT INTO external_resources(owner_id,plugin_id,connection_id,resource_type,external_id,url,orbit_entity_type,orbit_entity_id,metadata)
       VALUES($1,$2,$3,'online_meeting',$4,$5,$6,$7,$8)
       ON CONFLICT(owner_id,plugin_id,connection_id,resource_type,external_id) DO UPDATE SET url=excluded.url,orbit_entity_type=COALESCE(excluded.orbit_entity_type,external_resources.orbit_entity_type),orbit_entity_id=COALESCE(excluded.orbit_entity_id,external_resources.orbit_entity_id),metadata=excluded.metadata,updated_at=now() RETURNING *`,
      [
        ownerId,
        this.id,
        connectionId,
        meeting.id,
        meeting.joinWebUrl || null,
        cardId ? "card" : null,
        cardId || null,
        JSON.stringify({
          subject: meeting.subject,
          start: meeting.startDateTime,
          end: meeting.endDateTime,
          joinUrl: meeting.joinWebUrl,
          videoTeleconferenceId: meeting.videoTeleconferenceId,
          externalId,
          standalone: true,
        }),
      ],
    );
    return { meeting, externalResource: resource };
  }

  async get(ownerId: string, connectionId: string, meetingId: string) {
    const connection = await this.connection(ownerId, connectionId);
    return this.graph.request<OnlineMeeting>(
      connection,
      `me/onlineMeetings/${encodeURIComponent(value(meetingId, "Reunião", 1000))}`,
    );
  }
  async update(
    ownerId: string,
    connectionId: string,
    meetingId: string,
    input: Record<string, unknown>,
  ) {
    const connection = await this.connection(ownerId, connectionId);
    const body: Record<string, unknown> = {};
    if (input.subject !== undefined)
      body.subject = value(input.subject, "Assunto", 500);
    if (input.start !== undefined) {
      const start = new Date(String(input.start));
      if (!Number.isFinite(start.getTime()))
        throw new HttpException("Início inválido.", 400);
      body.startDateTime = start.toISOString();
    }
    if (input.end !== undefined) {
      const end = new Date(String(input.end));
      if (!Number.isFinite(end.getTime()))
        throw new HttpException("Fim inválido.", 400);
      body.endDateTime = end.toISOString();
    }
    for (const key of [
      "allowedPresenters",
      "allowMeetingChat",
      "lobbyBypassSettings",
    ])
      if (input[key] !== undefined) body[key] = input[key];
    const meeting = await this.graph.request<OnlineMeeting>(
      connection,
      `me/onlineMeetings/${encodeURIComponent(value(meetingId, "Reunião", 1000))}`,
      { method: "PATCH", body: JSON.stringify(body) },
    );
    await this.db.query(
      "UPDATE external_resources SET url=$4,metadata=metadata||$5::jsonb,updated_at=now() WHERE owner_id=$1 AND plugin_id=$2 AND connection_id=$3 AND resource_type='online_meeting' AND external_id=$6",
      [
        ownerId,
        this.id,
        connectionId,
        meeting.joinWebUrl || null,
        JSON.stringify({
          subject: meeting.subject,
          start: meeting.startDateTime,
          end: meeting.endDateTime,
          joinUrl: meeting.joinWebUrl,
        }),
        meetingId,
      ],
    );
    return meeting;
  }
}

const string = { type: "string", minLength: 1 };
const output = {
  type: "object",
  required: ["type", "value"],
  properties: { type: { type: "string" }, label: { type: "string" }, value: {} },
};
export const microsoftTeamsPluginDefinition = (
  teams: MicrosoftTeamsPlugin,
): PluginDefinition => {
  const execute = (
    label: string,
    run: (
      owner: string,
      connection: string,
      input: Record<string, unknown>,
      cardId?: string,
    ) => Promise<unknown>,
  ) => async (input: Record<string, unknown>, context: PluginActionContext) => {
    if (!context.userId || !context.connectionId)
      throw new Error("Conexão Microsoft obrigatória.");
    return {
      type: "teams_meeting",
      label,
      value: await run(
        context.userId,
        context.connectionId,
        input,
        context.cardId,
      ),
    };
  };
  return {
    id: teams.id,
    name: teams.name,
    version: "1.0.0",
    scope: "account",
    capabilities: [
      { id: "online_meetings.read", name: "Ler reuniões Teams" },
      { id: "online_meetings.write", name: "Criar e alterar reuniões Teams" },
    ],
    actions: [
      {
        id: "create_online_meeting",
        name: "Criar reunião Teams standalone",
        requiredCapabilities: ["online_meetings.write"],
        inputSchema: {
          type: "object",
          required: ["subject", "start", "end"],
          properties: {
            subject: string,
            start: string,
            end: string,
            externalId: string,
            participants: { type: "object" },
            allowedPresenters: { type: "string" },
            lobbyBypassSettings: { type: "object" },
          },
          additionalProperties: false,
        },
        outputSchema: output,
        execute: execute("Criar reunião Teams", (owner, connection, input, cardId) =>
          teams.create(owner, connection, input, cardId),
        ),
      },
      {
        id: "get_online_meeting",
        name: "Obter reunião Teams",
        requiredCapabilities: ["online_meetings.read"],
        inputSchema: {
          type: "object",
          required: ["meetingId"],
          properties: { meetingId: string },
          additionalProperties: false,
        },
        outputSchema: output,
        execute: execute("Obter reunião Teams", (owner, connection, input) =>
          teams.get(owner, connection, String(input.meetingId)),
        ),
      },
      {
        id: "update_online_meeting",
        name: "Atualizar reunião Teams",
        requiredCapabilities: ["online_meetings.write"],
        inputSchema: {
          type: "object",
          required: ["meetingId"],
          properties: {
            meetingId: string,
            subject: string,
            start: string,
            end: string,
            allowedPresenters: string,
            allowMeetingChat: string,
            lobbyBypassSettings: { type: "object" },
          },
          additionalProperties: false,
        },
        outputSchema: output,
        execute: execute("Atualizar reunião Teams", (owner, connection, input) =>
          teams.update(owner, connection, String(input.meetingId), input),
        ),
      },
    ],
        connectionProvider: {
      id: "microsoft-oauth",
      name: "Microsoft OAuth",
      supportsMultiple: true,
      capabilities: ["online_meetings.read", "online_meetings.write"],
    },
    contributions: {
      cardActions: [
        {
          id: "microsoft_teams.create_online_meeting",
          label: "Criar reunião Teams standalone",
        },
      ],
            resourceRenderers: [
        { resourceTypes: ["online_meeting"], component: "teams-meeting" },
      ],
      settings: [
        {
          id: "microsoft_teams",
          label: "Microsoft Teams",
          href: "/calendar?settings=microsoft_teams",
        },
      ],
    },
  };
};

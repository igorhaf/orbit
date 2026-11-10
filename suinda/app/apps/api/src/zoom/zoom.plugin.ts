import type { PluginActionContext, PluginDefinition } from "../plugins/contract";
import { randomUUID } from "node:crypto";
import { ZoomMeetings } from "./zoom-meetings";

export const zoomMeetingsPluginDefinition = (zoom: ZoomMeetings): PluginDefinition => ({
  id: "zoom",
  name: "Zoom Meetings",
  version: "1.0.0",
  scope: "account",
  handlesRoute: (path) => path === "/zoom" || path.startsWith("/zoom/"),
  routePermission: (path, method) => path === "/zoom/oauth/callback" && method === "GET"
    ? null
    : `plugin.zoom.${["GET", "HEAD"].includes(method) ? "read" : "write"}`,
  configuration: [
    { key: "ZOOM_REDIRECT_URI", label: "URL de retorno OAuth do Zoom", secret: false },
  ],
  capabilities: [
    { id: "meetings.read", name: "Ler reuniões Zoom", permissions: ["plugin.zoom.read"] },
    { id: "meetings.write", name: "Criar reuniões Zoom", permissions: ["plugin.zoom.write"] },
  ],
  connectionProvider: {
    id: "zoom",
    name: "Zoom",
    supportsMultiple: true,
    capabilities: ["meetings.read", "meetings.write"],
  },
  actions: [{
    id: "create_meeting",
    name: "Criar reunião Zoom",
    requiredCapabilities: ["meetings.write"],
    inputSchema: {
      type: "object",
      required: ["topic", "start", "end"],
      properties: { topic: { type: "string", minLength: 1, maxLength: 200 }, start: { type: "string", format: "date-time" }, end: { type: "string", format: "date-time" }, operationKey: { type: "string", minLength: 1, maxLength: 200 } },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object", required: ["type", "label", "value"],
      properties: { type: { const: "zoom_meeting" }, label: { type: "string" }, value: { type: "object" } },
      additionalProperties: false,
    },
    async execute(input: Record<string, unknown>, context: PluginActionContext) {
      if (!context.userId || !context.connectionId) throw new Error("Conexão Zoom obrigatória.");
      const operationKey = typeof input.operationKey === "string" ? input.operationKey : context.runId || randomUUID();
      const value = await zoom.create(context.userId, context.connectionId, {
        topic: String(input.topic), start: String(input.start), end: String(input.end),
      }, operationKey);
      return { type: "zoom_meeting", label: "Criar reunião Zoom", value };
    },
  }],
});

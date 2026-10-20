import { Controller, Get, Inject, Req } from "@nestjs/common";
import { AccessService, AccessRequest } from "../../access/access";
import { Db } from "../../db";
import { PluginRegistry } from "../../execution/registries";
import type { PluginDefinition } from "../contract";
import { invalid } from "./rules";

export const auditHistoryPlugin: PluginDefinition = {
  id: "audit-history",
  name: "Auditoria verificável",
  version: "1.0.0",
  scope: "account",
  dependencies: ["versioned-records"],
  description:
    "Verificação de integridade da cadeia de eventos auditados do Orbit.",
  capabilities: [
    {
      id: "read",
      name: "Consultar integridade da auditoria",
      permissions: ["access.audit.read"],
    },
  ],
  contributions: {
    navigation: [
      {
        id: "audit-history",
        href: "/extensions",
        label: "Extensões",
      },
    ],
  },
};

@Controller("extensions/audit-history")
export class AuditHistoryController {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(PluginRegistry) private readonly registry: PluginRegistry,
  ) {}
  @Get() async integrity(@Req() req: AccessRequest) {
    if (!this.registry.isEnabled("audit-history"))
      invalid("Plugin ou dependência desativada.", 409);
    await this.access.require(String(req.orbitUser), "access.audit.read");
    const result = await this.db.one<{
      events: number;
      protected_since: string | null;
      valid: boolean;
    }>(`WITH chain AS (
      SELECT h.*,a.created_at,a.action,a.scope_type,a.scope_id,
        lag(h.event_hash,1,repeat('0',64)) OVER(ORDER BY h.sequence_number) AS expected_previous,
        encode(sha256(convert_to(jsonb_build_array(a.id,a.actor_id,a.action,a.target,a.scope_type,a.scope_id,a.created_at)::text,'UTF8')),'hex') AS expected_source
      FROM immutable_audit_events h JOIN access_audit a ON a.id=h.source_audit_id
    ) SELECT count(*)::integer AS events,min(created_at) AS protected_since,
      COALESCE(bool_and(previous_hash=expected_previous AND source_hash=expected_source AND event_hash=encode(sha256(convert_to(jsonb_build_array('orbit-audit-v1',sequence_number,source_hash,previous_hash)::text,'UTF8')),'hex')),true) AS valid
    FROM chain`);
    const events = await this.db
      .query(`SELECT h.sequence_number,h.source_audit_id,h.previous_hash,h.event_hash,a.action,a.scope_type,a.scope_id,a.created_at
      FROM immutable_audit_events h JOIN access_audit a ON a.id=h.source_audit_id ORDER BY h.sequence_number DESC LIMIT 100`);
    return { ...result, recent: events };
  }
}

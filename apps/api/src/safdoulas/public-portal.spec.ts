import assert from "node:assert/strict";
import test from "node:test";
import { SafdoulasPublicPortalController, publicPortalProjection, safdoulasPublicPortalPlugin } from "./public-portal.plugin";

const settings = (overrides: Record<string, unknown> = {}) => ({
  id: "settings", workspace_id: "workspace-a", kind: "portal_settings", state: "published",
  payload: { primary: true, organization_name: "FENADOULASBR", description: "Acreditação de cursos.", contact_email: "", contact_url: "", help_url: "", application_url: "https://example.org/solicitar", public_authorization_reference: "ATA-001", ...overrides },
});
const content = (payloadOverrides: Record<string, unknown> = {}, recordOverrides: Record<string, unknown> = {}) => ({
  id: "content-1", workspace_id: "workspace-a", kind: "portal_content", state: "published", ...recordOverrides,
  payload: { section: "current_call", title: "Edital vigente", summary: "Inscrições abertas", body: "Consulte o edital.", url: "", source_reference: "Edital 2026", order: 1, public_authorization_reference: "ATA-002", ...payloadOverrides },
});

test("public portal returns only whitelisted content explicitly published in the primary workspace", () => {
  const result = publicPortalProjection([
    settings(), content(), content({ section: "help", title: "Privado", body: "Não publicar", public_authorization_reference: "ATA-003" }, { id: "other", workspace_id: "workspace-b" }),
    content({ title: "Retirado" }, { id: "withdrawn", state: "withdrawn" }),
  ]);
  assert.equal(result.available, true);
  assert.equal(result.settings?.organization_name, "FENADOULASBR");
  assert.equal("public_authorization_reference" in (result.settings || {}), false);
  assert.equal(result.contents.length, 1);
  assert.equal(result.contents[0].title, "Edital vigente");
  assert.equal("workspace_id" in result.contents[0], false);
  assert.equal(publicPortalProjection([settings({ public_authorization_reference: "" }), content()]).available, false);
  assert.equal(publicPortalProjection([settings(), content({ public_authorization_reference: "" })]).contents.length, 0);
});

test("portal remains unavailable when primary configuration is absent, ambiguous, or contains an unsafe link", () => {
  assert.equal(publicPortalProjection([settings({ primary: false }), content()]).available, false);
  assert.equal(publicPortalProjection([settings(), settings({ id: "settings-2", workspace_id: "workspace-b" })]).available, false);
  assert.equal(publicPortalProjection([settings({ application_url: "javascript:alert(1)" }), content()]).available, false);
  assert.equal(publicPortalProjection([settings({ contact_url: "https://user:password@example.org" }), content()]).available, false);
  const result = publicPortalProjection([settings(), content({ url: "javascript:alert(1)" })]);
  assert.equal(result.available, true);
  assert.equal(result.contents.length, 0);
});

test("public portal endpoint is unauthenticated, no-store and disabled with its plugin", async () => {
  assert.equal(safdoulasPublicPortalPlugin.routePermission?.("/public/safdoulas/portal", "GET"), null);
  assert.equal(safdoulasPublicPortalPlugin.handlesRoute?.("/public/safdoulas/portal"), true);
  const headers = new Map<string, string>();
  const response = { setHeader(name: string, value: string) { headers.set(name, value); } } as never;
  const db = { async query(sql: string) { assert.match(sql, /state='published'/); return [settings(), content()]; } };
  const controller = new SafdoulasPublicPortalController(db as never, { isEnabled: () => true } as never);
  const result = await controller.portal(response);
  assert.equal(result.available, true);
  assert.equal(headers.get("Cache-Control"), "no-store");
  const disabled = new SafdoulasPublicPortalController(db as never, { isEnabled: () => false } as never);
  await assert.rejects(() => disabled.portal(response), (error: unknown) => (error as { status: number }).status === 503);
});

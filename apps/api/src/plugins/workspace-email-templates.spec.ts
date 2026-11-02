import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import { renderWorkspaceEmailTemplate, validateWorkspaceEmailTemplate, WorkspaceEmailTemplatesService } from "./workspace-email-templates";
import { suindaPlugin } from "./suinda/suinda.plugin";

const valid = { kind: "academic_reminder", subject_template: "{{institution_name}}: {{notification_title}}",
  body_template: "Olá {{learner_name}}\n{{notification_body}}\n{{course_link}}", enabled: true };

test("workspace email templates accept only registered kinds and safe fields", () => {
  assert.deepEqual(validateWorkspaceEmailTemplate(valid), valid);
  assert.throws(() => validateWorkspaceEmailTemplate({ ...valid, body_template: "{{password}}" }),
    (error: unknown) => error instanceof HttpException && error.getStatus() === 400);
  assert.throws(() => validateWorkspaceEmailTemplate({ ...valid, subject_template: "Assunto\n{{learner_name}}" }),
    (error: unknown) => error instanceof HttpException && error.getStatus() === 400);
  assert.throws(() => validateWorkspaceEmailTemplate({ ...valid, kind: "unknown" }),
    (error: unknown) => error instanceof HttpException && error.getStatus() === 400);
  assert.throws(() => validateWorkspaceEmailTemplate({ ...valid, extra: "not allowed" }),
    (error: unknown) => error instanceof HttpException && error.getStatus() === 400);
});

test("workspace email template routes defer scoped authorization to the workspace service", () => {
  const path = "/extensions/suinda-learning/workspaces/22222222-2222-4222-8222-222222222222/email-templates/academic_reminder";
  assert.equal(suindaPlugin.handlesRoute?.(path), true);
  assert.equal(suindaPlugin.routePermission?.(path, "PUT"), null);
});

test("workspace email template rendering replaces allowed fields and constrains subject output", () => {
  const output = renderWorkspaceEmailTemplate({ subject_template: "{{institution_name}}\n{{notification_title}}",
    body_template: "{{learner_name}}\n{{notification_body}}\n{{course_link}}" }, {
    learner_name: "Ana", institution_name: "Escola Orbit", notification_title: "Atividade próxima",
    notification_body: "Prazo amanhã", course_link: "https://example.test/course", product_name: "Suindá",
  });
  assert.equal(output.subject, "Escola Orbit Atividade próxima");
  assert.equal(output.body, "Ana\nPrazo amanhã\nhttps://example.test/course");
});

test("workspace email template management is scoped and audited", async () => {
  const statements: string[] = [];
  const db = {
    async one(sql: string) {
      statements.push(sql);
      if (sql.includes("SELECT id FROM workspaces")) return { id: "22222222-2222-4222-8222-222222222222" };
      if (sql.includes("INSERT INTO workspace_email_templates")) return { ...valid, updated_at: "2026-10-24T00:00:00Z" };
      return null;
    },
  };
  const access = {
    async has(_user: string, _permission: string, type: string) { return type === "workspace"; },
    async audit(user: string, action: string, target: string, scope: { type: string; id: string }) { statements.push(`AUDIT:${user}:${action}:${target}:${scope.type}:${scope.id}`); },
  };
  const service = new WorkspaceEmailTemplatesService(db as never, access as never);
  const saved = await service.save("22222222-2222-4222-8222-222222222222", "11111111-1111-4111-8111-111111111111", valid);
  assert.equal(saved?.kind, "academic_reminder");
  assert.ok(statements.some((statement) => statement.includes("INSERT INTO workspace_email_templates")));
  assert.match(statements.at(-1) || "", /^AUDIT:/);

  const denied = new WorkspaceEmailTemplatesService(db as never, { ...access, async has() { return false; } } as never);
  await assert.rejects(denied.save("22222222-2222-4222-8222-222222222222", "11111111-1111-4111-8111-111111111111", valid),
    (error: unknown) => error instanceof HttpException && error.getStatus() === 403);
});

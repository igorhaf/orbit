import assert from "node:assert/strict";
import { test } from "node:test";
import { PluginRegistry } from "../execution/registries";
import { GOOGLE_DRIVE_FILE_SCOPE } from "../google/credentials";
import { SUINDA_GOOGLE_DRIVE_PLUGIN_ID, SuindaGoogleDriveService, suindaGoogleDrivePlugin } from "./suinda-google-drive";

const connectionId = "00000000-0000-4000-8000-000000000301";
const operationKey = "00000000-0000-4000-8000-000000000302";
const lessonId = "00000000-0000-4000-8000-000000000303";
const fileId = "drive-file-123456";

function fixture(overrides: {
  lesson?: { revision: number; state: string; content_type: string };
  listLessonMaterials?: () => Promise<unknown>;
  uploadLessonMaterial?: (_id: string, _user: string, body: Record<string, unknown>) => Promise<unknown>;
} = {}) {
  const registry = new PluginRegistry();
  registry.register({ id: "suinda-learning", name: "Suindá", version: "1.0.0" });
  registry.register(suindaGoogleDrivePlugin);
  const google = {
    configured: () => true,
    available: async () => [{ id: connectionId, name: "Conta de teste", pluginId: "google" }],
    start: async (...args: unknown[]) => ({ args }),
    complete: async (...args: unknown[]) => ({ args }),
    token: async (_user: string, _connection: string, scopes: string[]) => {
      assert.deepEqual(scopes, [GOOGLE_DRIVE_FILE_SCOPE]);
      return "test-access-token";
    },
  };
  const lesson = overrides.lesson || { revision: 3, state: "draft", content_type: "pdf" };
  const learning = {
    async listLessonMaterials() {
      if (overrides.listLessonMaterials) return overrides.listLessonMaterials();
      return { lesson_id: lessonId, revision: lesson.revision, state: lesson.state, content_type: lesson.content_type, attachments: [] };
    },
    async uploadLessonMaterial(id: string, user: string, body: Record<string, unknown>) {
      if (overrides.uploadLessonMaterial) return overrides.uploadLessonMaterial(id, user, body);
      return { lesson_id: id, uploaded_by: user, attachment: { file_name: body.file_name } };
    },
  };
  return { service: new SuindaGoogleDriveService(google as never, learning as never, registry), google, learning };
}

test("Google Drive educacional é plugin filho do domínio de aprendizagem e usa somente o escopo por arquivo", () => {
  assert.equal(suindaGoogleDrivePlugin.parentPlugin, "suinda-learning");
  assert.deepEqual(suindaGoogleDrivePlugin.dependencies, ["suinda-learning"]);
  assert.equal(suindaGoogleDrivePlugin.id, SUINDA_GOOGLE_DRIVE_PLUGIN_ID);
  assert.equal(suindaGoogleDrivePlugin.routePermission?.("/suinda-google-drive/oauth/callback", "GET"), null);
  assert.equal(suindaGoogleDrivePlugin.routePermission?.("/suinda-google-drive/picker-token", "POST"), "plugin.suinda-learning.write");
});

test("configuração só devolve conexões Google próprias com a permissão drive.file", async () => {
  const previous = { key: process.env.GOOGLE_PICKER_API_KEY, project: process.env.GOOGLE_CLOUD_PROJECT_NUMBER };
  process.env.GOOGLE_PICKER_API_KEY = "browser-key";
  process.env.GOOGLE_CLOUD_PROJECT_NUMBER = "1234567890";
  try {
    const { service } = fixture();
    assert.deepEqual(await service.settings("teacher"), {
      configured: true, api_key: "browser-key", app_id: "1234567890",
      connections: [{ id: connectionId, name: "Conta de teste", pluginId: "google" }],
    });
  } finally {
    if (previous.key === undefined) delete process.env.GOOGLE_PICKER_API_KEY; else process.env.GOOGLE_PICKER_API_KEY = previous.key;
    if (previous.project === undefined) delete process.env.GOOGLE_CLOUD_PROJECT_NUMBER; else process.env.GOOGLE_CLOUD_PROJECT_NUMBER = previous.project;
  }
});

test("importação autoriza a equipe antes de buscar o arquivo e grava pela operação de material validada", async () => {
  const imports: Array<Record<string, unknown>> = [];
  const { service } = fixture({ uploadLessonMaterial: async (id, user, body) => {
    imports.push(body);
    return { lesson_id: id, uploaded_by: user, attachment: { file_name: body.file_name } };
  } });
  const previousFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input); calls.push(url);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-access-token");
    if (url.includes("fields=id%2Cname%2CmimeType%2Csize%2Ccapabilities"))
      return new Response(JSON.stringify({ id: fileId, name: "apostila.pdf", mimeType: "application/pdf", size: "4", capabilities: { canDownload: true } }));
    return new Response(Buffer.from("%PDF"));
  };
  try {
    const result = await service.importLessonMaterial(lessonId, "teacher", { connection_id: connectionId, file_id: fileId, operation_key: operationKey, expected_revision: 3 });
    assert.deepEqual(result, { lesson_id: lessonId, uploaded_by: "teacher", attachment: { file_name: "apostila.pdf" } });
    assert.equal(calls.length, 2);
    assert.match(calls[0], new RegExp(`/files/${fileId}\\?`));
    assert.match(calls[1], new RegExp(`/files/${fileId}\\?alt=media$`));
    assert.ok(calls.every((url) => url.startsWith("https://www.googleapis.com/drive/v3/files/")));
    assert.deepEqual(imports, [{ operation_key: operationKey, expected_revision: 3, file_name: "apostila.pdf", mime_type: "application/pdf", data_base64: Buffer.from("%PDF").toString("base64"), alt_text: "" }]);
  } finally { globalThis.fetch = previousFetch; }
});

test("documentos Google Workspace são exportados como PDF para uma aula PDF", async () => {
  const { service } = fixture();
  const previousFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input); calls.push(url);
    if (url.includes("fields=id%2Cname%2CmimeType%2Csize%2Ccapabilities"))
      return new Response(JSON.stringify({ id: fileId, name: "Apostila de aula", mimeType: "application/vnd.google-apps.document", capabilities: { canDownload: true } }));
    return new Response(Buffer.from("%PDF"));
  };
  try {
    await service.importLessonMaterial(lessonId, "teacher", { connection_id: connectionId, file_id: fileId, operation_key: operationKey, expected_revision: 3 });
    assert.ok(calls[1].includes("/export?mimeType=application%2Fpdf"));
  } finally { globalThis.fetch = previousFetch; }
});

test("imagens do Drive exigem descrição alternativa e a preservam na cópia da aula", async () => {
  const imports: Array<Record<string, unknown>> = [];
  const { service } = fixture({ lesson: { revision: 3, state: "draft", content_type: "gallery" }, uploadLessonMaterial: async (_id, _user, body) => {
    imports.push(body); return { ok: true };
  } });
  const previousFetch = globalThis.fetch;
  let downloads = 0;
  globalThis.fetch = async (input) => {
    if (String(input).includes("fields=id%2Cname%2CmimeType%2Csize%2Ccapabilities"))
      return new Response(JSON.stringify({ id: fileId, name: "diagrama.png", mimeType: "image/png", size: "4", capabilities: { canDownload: true } }));
    downloads++;
    return new Response(Buffer.from("PNG"));
  };
  try {
    await assert.rejects(service.importLessonMaterial(lessonId, "teacher", {
      connection_id: connectionId, file_id: fileId, operation_key: operationKey, expected_revision: 3,
    }), /Descreva a imagem/);
    assert.equal(downloads, 0);
    await service.importLessonMaterial(lessonId, "teacher", {
      connection_id: connectionId, file_id: fileId, operation_key: operationKey, expected_revision: 3, alt_text: "Diagrama das etapas do curso",
    });
    assert.equal(imports[0].alt_text, "Diagrama das etapas do curso");
    assert.equal(downloads, 1);
  } finally { globalThis.fetch = previousFetch; }
});

test("nega edição de aula publicada e recusa arquivos maiores que 8 MB antes do download", async () => {
  let calls = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls++; throw new Error("Drive API should not be called"); };
  try {
    const published = fixture({ lesson: { revision: 3, state: "published", content_type: "pdf" } });
    await assert.rejects(published.service.importLessonMaterial(lessonId, "teacher", { connection_id: connectionId, file_id: fileId, operation_key: operationKey, expected_revision: 3 }), /rascunho ou no conteúdo agendado/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = previousFetch; }

  const { service } = fixture();
  const previousAfter = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ id: fileId, name: "grande.pdf", mimeType: "application/pdf", size: String(8 * 1024 * 1024 + 1), capabilities: { canDownload: true } }));
  try {
    await assert.rejects(service.importLessonMaterial(lessonId, "teacher", { connection_id: connectionId, file_id: fileId, operation_key: operationKey, expected_revision: 3 }), (error: { getStatus?: () => number }) => error.getStatus?.() === 413);
  } finally { globalThis.fetch = previousAfter; }
});

test("autorização da equipe ocorre antes de qualquer consulta OAuth ou Google", async () => {
  let fetches = 0;
  const { service } = fixture({ listLessonMaterials: async () => { throw new Error("Equipe não atribuída."); } });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetches++; throw new Error("Drive API should not be called"); };
  try {
    await assert.rejects(service.importLessonMaterial(lessonId, "other", { connection_id: connectionId, file_id: fileId, operation_key: operationKey, expected_revision: 3 }), /Equipe não atribuída/);
    assert.equal(fetches, 0);
  } finally { globalThis.fetch = previousFetch; }
});

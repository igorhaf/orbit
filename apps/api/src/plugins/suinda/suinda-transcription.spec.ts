import assert from "node:assert/strict";
import { test } from "node:test";
import { PluginRegistry } from "../../execution/registries";
import { validateLessonCaptions } from "./lesson-captions";
import { SUINDA_TRANSCRIPTION_PLUGIN_ID, SuindaTranscriptionService, suindaTranscriptionPlugin } from "./suinda-transcription";

const lessonId = "00000000-0000-4000-8000-000000000401";
const sample = { expected_revision: 2, file_name: "aula.mp4", mime_type: "video/mp4", data_base64: Buffer.from("video sample").toString("base64") };

function fixture(options: { state?: string; revision?: number; captionsReviewed?: boolean; fetch?: (url: URL, init: RequestInit) => Promise<Response> } = {}) {
  const registry = new PluginRegistry();
  registry.register({ id: "suinda-learning", name: "Suindá", version: "1.0.0" });
  registry.register(suindaTranscriptionPlugin);
  const versions: Array<Record<string, unknown>> = [];
  const learning = {
    async listLessonMaterials() { return { revision: options.revision ?? 2, state: options.state ?? "draft" }; },
    async detail() { return { id: lessonId, kind: "lesson", title: "Aula 1", state: options.state ?? "draft", revision: options.revision ?? 2, payload: { body_markdown: "Conteúdo", transcript: "Texto anterior", captions_reviewed: options.captionsReviewed ?? false } }; },
    async version(_plugin: string, _id: string, _user: string, body: Record<string, unknown>) { versions.push(body); return { revision: 3, payload: body.payload }; },
  };
  return { service: new SuindaTranscriptionService(learning as never, registry, options.fetch), versions };
}

test("plugin de transcrição é filho do aprendizado e declara a rota de autoria", () => {
  assert.equal(suindaTranscriptionPlugin.id, SUINDA_TRANSCRIPTION_PLUGIN_ID);
  assert.equal(suindaTranscriptionPlugin.parentPlugin, "suinda-learning");
  assert.deepEqual(suindaTranscriptionPlugin.dependencies, ["suinda-learning"]);
  assert.equal(suindaTranscriptionPlugin.handlesRoute?.(`/extensions/suinda-learning/me/teaching/lessons/${lessonId}/transcription`), true);
});

test("gera transcrição somente para mídia autorizada na revisão atual em rascunho", async () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-api-key";
  const { service } = fixture({ fetch: async (url, init) => {
    assert.equal(url.href, "https://api.openai.com/v1/audio/transcriptions");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer test-api-key");
    const form = init.body as FormData;
    assert.equal(form.get("model"), "gpt-transcribe");
    assert.equal(form.get("response_format"), "verbose_json");
    const file = form.get("file") as File;
    assert.equal(file.name, "aula.mp4");
    assert.equal(file.type, "video/mp4");
    return new Response(JSON.stringify({ text: "Texto reconhecido.", segments: [
      { start: 0, end: 1.25, text: " Aula <inicial>" }, { start: 1.25, end: 3, text: " Segunda fala." },
    ] }), { headers: { "content-type": "application/json" } });
  } });
  try { assert.deepEqual(await service.transcribe(lessonId, "teacher", sample), {
    transcript: "Texto reconhecido.", captions_vtt: "WEBVTT\n\n00:00:00.000 --> 00:00:01.250\nAula ‹inicial›\n\n00:00:01.250 --> 00:00:03.000\nSegunda fala.",
  }); }
  finally { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; }
  assert.deepEqual(validateLessonCaptions({ content_type: "video", content_url: "https://media.example/aula.mp4",
    captions_vtt: "WEBVTT\n\n00:00:00.000 --> 00:00:01.250\nAula ‹inicial›\n\n00:00:01.250 --> 00:00:03.000\nSegunda fala.",
    captions_language: "pt-BR", captions_label: "Português (Brasil)" }), []);
  assert.deepEqual(validateLessonCaptions({ content_type: "video", content_url: "https://media.example/aula.mp4",
    captions_vtt: "WEBVTT\n\n00:00:00.000\t-->\t00:00:01.250\nAula com separador tabulado.",
    captions_language: "pt-BR", captions_label: "Português (Brasil)" }), [], "a gramática WebVTT permite tabulação nos dois lados do delimitador de tempo");
  const unsafeProtocol = validateLessonCaptions({ content_type: "video", content_url: "file:///tmp/aula.mp4",
    captions_vtt: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nFala.", captions_language: "pt-BR", captions_label: "Português" });
  assert.equal(unsafeProtocol[0]?.path, "content_url");
  assert.match(unsafeProtocol[0]?.message || "", /HTTP ou HTTPS/);
});

test("rejeita tipos inválidos, revisão desatualizada e aula arquivada antes de chamar o provedor", async () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-api-key";
  let calls = 0;
  try {
    const { service } = fixture({ fetch: async () => { calls++; return new Response("{}"); } });
    await assert.rejects(() => service.transcribe(lessonId, "teacher", { ...sample, mime_type: "application/x-msdownload" }), /MP3, M4A, WAV, WebM ou MP4/);
    const { service: stale } = fixture({ revision: 1, fetch: async () => { calls++; return new Response("{}"); } });
    await assert.rejects(() => stale.transcribe(lessonId, "teacher", sample), /revisão atual/);
    const { service: archived } = fixture({ state: "archived", fetch: async () => { calls++; return new Response("{}"); } });
    await assert.rejects(() => archived.transcribe(lessonId, "teacher", sample), /revisão atual/);
    const { service: published } = fixture({ state: "published", fetch: async () => new Response(JSON.stringify({ text: "Transcrição sugerida." }), { headers: { "content-type": "application/json" } }) });
    assert.deepEqual(await published.transcribe(lessonId, "teacher", sample), { transcript: "Transcrição sugerida.", captions_vtt: null });
    assert.equal(calls, 0);
  } finally { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; }
});

test("aplicar transcrição preserva os demais campos e usa mutação versionada idempotente", async () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-api-key";
  const { service, versions } = fixture();
  try {
    const result = await service.apply(lessonId, "teacher", {
      expected_revision: 2, operation_key: "00000000-0000-4000-8000-000000000402", transcript: "Transcrição aprovada.",
      captions_vtt: "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nFala revisada.", captions_language: "pt-BR", captions_label: "Português (Brasil)", captions_reviewed: true,
    });
    assert.equal(versions.length, 1);
    assert.deepEqual(versions[0].payload, { body_markdown: "Conteúdo", transcript: "Transcrição aprovada.", transcript_reviewed: false, captions_reviewed: true,
      captions_vtt: "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nFala revisada.", captions_language: "pt-BR", captions_label: "Português (Brasil)" });
    assert.equal(versions[0].expected_revision, 2);
    assert.equal(result.revision, 3);
  } finally { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; }
});


test("aplicar nova sugestão nunca preserva aprovação de legenda anterior", async () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-api-key";
  const { service, versions } = fixture({ captionsReviewed: true });
  try {
    await service.apply(lessonId, "teacher", { expected_revision: 2, operation_key: "00000000-0000-4000-8000-000000000403",
      transcript: "Nova transcrição sugerida.", captions_vtt: "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nNova legenda.", captions_language: "pt-BR", captions_label: "Português" });
    assert.equal((versions[0].payload as Record<string, unknown>).captions_reviewed, false);
  } finally { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; }
});

import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import { LearningAssistantService, learningAssistantPlugin, learningAssistantSources, parseCourseRecommendations, parseLessonAuthoringSuggestion, retrieveLearningSources, validateLearningAssistantQuestion } from "./learning-assistant";
import { ORBIT_EMBEDDING_DIMENSIONS, OrbitEmbeddingsService } from "../ai/embeddings";
import { OrbitKnowledgeRetrievalService } from "../ai/knowledge-retrieval";

const lesson = (id: string, title: string, body: string, available = true, state = "published") => ({ id, title, state, available,
  payload: { objectives: ["Identificar fotossíntese"], body_markdown: body, transcript: "" } });

const projection = {
  course: { id: "course-1", title: "Biologia" },
  modules: [{ id: "module-1", title: "Biologia celular", available: true, units: [{ title: "Energia", lessons: [] }],
    lessons: [lesson("lesson-1", "Fotossíntese", "A fotossíntese converte energia luminosa em energia química."),
      lesson("lesson-2", "Respiração", "A respiração celular libera energia dos nutrientes."),
      lesson("lesson-3", "Aula futura", "Fotossíntese", false),
      lesson("lesson-4", "Rascunho", "Fotossíntese", true, "draft")] }],
};

test("recomendações por IA aceitam somente cursos elegíveis, sem repetição ou texto excessivo", () => {
  const candidates = [{ id: "course-1", title: "Biologia", state: "published" }, { id: "course-2", title: "Ecologia", state: "enrollment_open" }];
  assert.deepEqual(parseCourseRecommendations(JSON.stringify({ recommendations: [
    { course_id: "course-2", reason: "Continua os temas ambientais estudados." },
  ] }), candidates), [{ ...candidates[1], reason: "Continua os temas ambientais estudados." }]);
  assert.throws(() => parseCourseRecommendations(JSON.stringify({ recommendations: [{ course_id: "private-course", reason: "Sugestão." }] }), candidates), HttpException);
  assert.throws(() => parseCourseRecommendations(JSON.stringify({ recommendations: [
    { course_id: "course-1", reason: "Sugestão." }, { course_id: "course-1", reason: "Outra sugestão." },
  ] }), candidates), HttpException);
  assert.throws(() => parseCourseRecommendations(JSON.stringify({ recommendations: [{ course_id: "course-1", reason: "r".repeat(281) }] }), candidates), HttpException);
});

test("retrieval inclui apenas aulas publicadas e liberadas e ordena citações lexicalmente de forma determinística", () => {
  const sources = learningAssistantSources(projection);
  assert.deepEqual(sources.map((source) => source.lessonId), ["lesson-1", "lesson-2"]);
  const first = retrieveLearningSources("Como funciona fotossíntese?", sources);
  const second = retrieveLearningSources("Como funciona fotossíntese?", sources);
  assert.deepEqual(first.map(({ ref, lessonId }) => ({ ref, lessonId })), second.map(({ ref, lessonId }) => ({ ref, lessonId })));
  assert.equal(first[0].lessonId, "lesson-1");
  assert.equal(first[0].ref, "F1");
});

test("retrieval respeita limite de quantidade e de caracteres do contexto", () => {
  const sources = Array.from({ length: 10 }, (_, index) => ({ lessonId: `lesson-${index}`, lessonTitle: `Física ${index}`,
    moduleTitle: "Mecânica", objectives: "movimento energia", content: `movimento energia ${"conteúdo ".repeat(500)}` }));
  const selected = retrieveLearningSources("movimento energia", sources, 8, 2500);
  assert.ok(selected.length > 0 && selected.length <= 8);
  assert.ok(selected.reduce((sum, source) => sum + source.lessonTitle.length + source.moduleTitle.length + source.objectives.length + source.content.length, 0) <= 2500);
});

function embeddingVector(first: number, second = 0) {
  const result = Array<number>(ORBIT_EMBEDDING_DIMENSIONS).fill(0);
  result[0] = first; result[1] = second;
  return result;
}

test("embeddings Orbit exigem opt-in e uma chave dedicada", () => {
  const enabled = process.env.ORBIT_AI_EMBEDDINGS_ENABLED, key = process.env.ORBIT_OPENAI_EMBEDDINGS_API_KEY;
  try {
    delete process.env.ORBIT_AI_EMBEDDINGS_ENABLED;
    process.env.ORBIT_OPENAI_EMBEDDINGS_API_KEY = "separate-test-key";
    assert.equal(new OrbitEmbeddingsService().isAvailable(), false);
    process.env.ORBIT_AI_EMBEDDINGS_ENABLED = "true";
    delete process.env.ORBIT_OPENAI_EMBEDDINGS_API_KEY;
    assert.equal(new OrbitEmbeddingsService().isAvailable(), false);
    process.env.ORBIT_OPENAI_EMBEDDINGS_API_KEY = "separate-test-key";
    assert.equal(new OrbitEmbeddingsService().isAvailable(), true);
  } finally {
    if (enabled === undefined) delete process.env.ORBIT_AI_EMBEDDINGS_ENABLED; else process.env.ORBIT_AI_EMBEDDINGS_ENABLED = enabled;
    if (key === undefined) delete process.env.ORBIT_OPENAI_EMBEDDINGS_API_KEY; else process.env.ORBIT_OPENAI_EMBEDDINGS_API_KEY = key;
  }
});

test("embeddings Orbit restauram a ordem do provedor e rejeitam vetores inválidos", async () => {
  const previousKey = process.env.ORBIT_OPENAI_EMBEDDINGS_API_KEY, previousEnabled = process.env.ORBIT_AI_EMBEDDINGS_ENABLED;
  const previousFetch = global.fetch;
  process.env.ORBIT_OPENAI_EMBEDDINGS_API_KEY = "test-key";
  process.env.ORBIT_AI_EMBEDDINGS_ENABLED = "true";
  global.fetch = async (_input, init) => {
    assert.equal(JSON.parse(String(init?.body)).model, "text-embedding-3-small");
    return Response.json({ data: [{ index: 1, embedding: embeddingVector(0, 1) }, { index: 0, embedding: embeddingVector(1) }] });
  };
  try {
    const result = await new OrbitEmbeddingsService().embed(["first", "second"]);
    assert.equal(result[0][0], 1);
    assert.equal(result[1][1], 1);
    global.fetch = async () => Response.json({ data: [{ index: 0, embedding: [1, 2] }] });
    await assert.rejects(() => new OrbitEmbeddingsService().embed(["invalid"]), /invalid vector/i);
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.ORBIT_OPENAI_EMBEDDINGS_API_KEY; else process.env.ORBIT_OPENAI_EMBEDDINGS_API_KEY = previousKey;
    if (previousEnabled === undefined) delete process.env.ORBIT_AI_EMBEDDINGS_ENABLED; else process.env.ORBIT_AI_EMBEDDINGS_ENABLED = previousEnabled;
  }
});

test("index vetorial Orbit ordena só o acervo recebido e persiste hash e embedding por escopo", async () => {
  const inserts: unknown[][] = [], queries: string[] = [];
  const db = { async query(sql: string, params: unknown[] = []) {
    queries.push(sql);
    if (sql.includes("SELECT content_hash")) return [];
    if (sql.includes("INSERT INTO orbit_knowledge_embeddings")) { inserts.push(params); return []; }
    if (sql.includes("DELETE FROM orbit_knowledge_embeddings")) return [];
    return [];
  } };
  const embeddings = { isAvailable: () => true, async embed(inputs: string[]) {
    return inputs.map((input) => input === "vraag" || input === "zon en warmte" ? embeddingVector(1)
      : input === "regen en water" ? embeddingVector(0.1, 1) : embeddingVector(-1));
  } };
  const service = new OrbitKnowledgeRetrievalService(db as never, embeddings as never);
  const ranked = await service.rank({ workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", pluginId: "suinda-learning", collectionId: "course-a" }, "vraag", [
    { key: "lesson-a", text: "zon en warmte", value: "relevant" },
    { key: "lesson-b", text: "regen en water", value: "irrelevant" },
  ]);
  assert.deepEqual(ranked.map((item) => item.value), ["relevant"]);
  assert.equal(inserts.length, 1);
  assert.ok(inserts.every((params) => params[0] === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" && params[1] === "suinda-learning" && params[2] === "course-a"));
  const stored = JSON.parse(String(inserts[0][5])) as Array<{ content_hash: string; embedding: number[] }>;
  assert.ok(stored.every((row) => row.content_hash.length === 64 && row.embedding.length === ORBIT_EMBEDDING_DIMENSIONS));
  assert.ok(!JSON.stringify(inserts).includes("zon en warmte"));
  assert.equal(queries.filter((sql) => sql.includes("DELETE FROM orbit_knowledge_embeddings")).length, 1);
  assert.ok(queries.some((sql) => sql.includes("NOT(content_hash=ANY")));
});

test("pergunta é validada e limitada antes da chamada de IA", () => {
  assert.equal(validateLearningAssistantQuestion("  O que é fotossíntese?  "), "O que é fotossíntese?");
  assert.throws(() => validateLearningAssistantQuestion("  "), HttpException);
  assert.throws(() => validateLearningAssistantQuestion("x".repeat(1201)), HttpException);
});

test("sugestões de autoria aceitam apenas JSON delimitado e validam campos, opções e quantidade", () => {
  assert.deepEqual(parseLessonAuthoringSuggestion('```json\n{"summary":"Resumo fiel."}\n```', "summary", 0),
    { mode: "summary", summary: "Resumo fiel." });
  const question = { prompt: "Qual processo converte luz?", options: ["A", "B", "C", "D"], correct_option: 0, explanation: "A aula descreve a conversão." };
  assert.deepEqual(parseLessonAuthoringSuggestion(JSON.stringify({ questions: [question, question] }), "questions", 2),
    { mode: "questions", questions: [question, question] });
  assert.throws(() => parseLessonAuthoringSuggestion(JSON.stringify({ questions: [question] }), "questions", 2), HttpException);
  assert.throws(() => parseLessonAuthoringSuggestion(JSON.stringify({ summary: "", private_data: true }), "summary", 0), HttpException);
});

test("geração de autoria verifica equipe antes da IA, limita requisições e não persiste sugestões", async () => {
  let aiCalls = 0;
  let rateCalls = 0;
  const dependencies = {
    learning: { lessonAuthoringSource: async () => ({ lesson_id: "lesson-1", revision: 4, title: "Fotossíntese",
      objectives: ["Identificar o processo"], content: "A fotossíntese converte energia luminosa em química." }) },
    ai: { isAvailable: () => true, complete: async () => { aiCalls++; return JSON.stringify({ summary: "A fotossíntese converte energia luminosa em energia química." }); } },
    prompts: { globalSettings: async () => ({ ai_default_model: "gpt-6-luna", ai_default_effort: "low" }) },
    rate: { consume: async () => { rateCalls++; return { allowed: true, retryAfterSeconds: 0 }; } },
  };
  const service = new LearningAssistantService(dependencies.learning as never, dependencies.ai as never,
    dependencies.prompts as never, dependencies.rate as never);
  const result = await service.generateLessonSuggestion("lesson-1", "teacher-1", { mode: "summary" });
  assert.deepEqual(result, { lesson_id: "lesson-1", lesson_revision: 4, mode: "summary",
    summary: "A fotossíntese converte energia luminosa em energia química." });
  assert.equal(aiCalls, 1);
  assert.equal(rateCalls, 1);

  const denied = new LearningAssistantService({ lessonAuthoringSource: async () => { throw new HttpException({ message: "Acesso negado." }, 403); } } as never,
    { isAvailable: () => true, complete: async () => { aiCalls++; return "{}"; } } as never,
    dependencies.prompts as never, dependencies.rate as never);
  await assert.rejects(() => denied.generateLessonSuggestion("lesson-1", "other", { mode: "summary" }));
  assert.equal(aiCalls, 1);
  assert.equal(rateCalls, 1);
  await assert.rejects(() => service.generateLessonSuggestion("lesson-1", "teacher-1", { mode: "questions", count: 11 }), HttpException);
});

test("serviço autoriza matrícula antes de consumir limite ou chamar IA e usa as preferências configuradas", async () => {
  let aiCalls = 0;
  let rateCalls = 0;
  let selectedModel = "", selectedEffort = "";
  const dependencies = {
    learning: { learnerLearning: async () => projection },
    ai: { isAvailable: () => true, complete: async (_prompt: string, model: string, effort: string) => { aiCalls++; selectedModel = model; selectedEffort = effort; return "A fotossíntese transforma energia luminosa [F1]."; } },
    prompts: { globalSettings: async () => ({ ai_default_model: "gpt-6-luna", ai_default_effort: "medium" }) },
    rate: { consume: async () => { rateCalls++; return { allowed: true, retryAfterSeconds: 0 }; } },
  };
  const service = new LearningAssistantService(dependencies.learning as never, dependencies.ai as never,
    dependencies.prompts as never, dependencies.rate as never);
  const result = await service.ask("enrollment-1", "learner-1", { question: "Como funciona fotossíntese?" });
  assert.equal(result.citations[0].lesson_id, "lesson-1");
  assert.equal(aiCalls, 1);
  assert.equal(rateCalls, 1);
  assert.equal(selectedModel, "gpt-6-luna");
  assert.equal(selectedEffort, "medium");

  const denied = new LearningAssistantService({ learnerLearning: async () => { throw new HttpException({ message: "Matrícula não encontrada." }, 404); } } as never,
    { isAvailable: () => true, complete: async () => { aiCalls++; return "não"; } } as never,
    dependencies.prompts as never, dependencies.rate as never);
  await assert.rejects(() => denied.ask("enrollment-other", "learner-2", { question: "Fotossíntese?" }));
  assert.equal(aiCalls, 1);
  assert.equal(rateCalls, 1);
});

test("assistente aplica recuperação vetorial apenas ao workspace e curso da matrícula autorizada", async () => {
  let prompt = "";
  const db = {
    async one() { return { workspace_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }; },
    async query(sql: string, params: unknown[] = []) {
      if (sql.includes("SELECT content_hash")) return [];
      if (sql.includes("INSERT INTO orbit_knowledge_embeddings")) {
        assert.equal(params[0], "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
        assert.equal(params[1], "suinda-learning");
        assert.equal(params[2], "course-1");
        return [];
      }
      return [];
    },
  };
  const embeddings = { isAvailable: () => true, async embed(inputs: string[]) {
    return inputs.map((input) => input === "astronomia" || input.includes("Respiração") ? embeddingVector(1) : embeddingVector(-1));
  } };
  const dependencies = {
    learning: { learnerLearning: async () => projection },
    ai: { isAvailable: () => true, complete: async (value: string) => { prompt = value; return "A respiração libera energia [F1]."; } },
    prompts: { globalSettings: async () => ({ ai_default_model: "gpt-6-luna", ai_default_effort: "medium" }) },
    rate: { consume: async () => ({ allowed: true, retryAfterSeconds: 0 }) },
  };
  const service = new LearningAssistantService(dependencies.learning as never, dependencies.ai as never,
    dependencies.prompts as never, dependencies.rate as never, db as never, embeddings as never);
  const result = await service.ask("enrollment-1", "learner-1", { question: "astronomia" });
  assert.match(prompt, /Respiração/i);
  assert.equal(result.citations[0].lesson_id, "lesson-2");
});

test("recomendações por IA enviam contexto público minimizado, usam preferências e limitam por usuário", async () => {
  let prompt = "";
  let aiCalls = 0;
  let rateScopes: unknown;
  let selectedModel = "", selectedEffort = "";
  const context = {
    history: [{ title: "Biologia", category: "Ciências", tags: ["células"], objectives: ["Estudar energia"], modality: "online", level: "introductory" }],
    candidates: [{ id: "public-1", title: "Ecologia", workspace_id: "workspace-private-context", workspace_name: "Instituição", state: "enrollment_open",
      payload: { summary: "Ecossistemas", category: "Ciências", tags: ["células"], objectives: ["Analisar energia"], modality: "online", format: "cohort", level: "introductory", application_form_fields: [{ prompt: "não enviar" }] } }],
  };
  const dependencies = {
    learning: { learnerRecommendationContext: async () => context },
    ai: { isAvailable: () => true, complete: async (value: string, model: string, effort: string) => {
      prompt = value; aiCalls++; selectedModel = model; selectedEffort = effort;
      return JSON.stringify({ recommendations: [{ course_id: "public-1", reason: "Continua os temas de ciências estudados." }] });
    } },
    prompts: { globalSettings: async () => ({ ai_default_model: "gpt-6-luna", ai_default_effort: "medium" }) },
    rate: { consume: async (_operation: string, scopes: unknown) => { rateScopes = scopes; return { allowed: true, retryAfterSeconds: 0 }; } },
  };
  const service = new LearningAssistantService(dependencies.learning as never, dependencies.ai as never,
    dependencies.prompts as never, dependencies.rate as never);
  const result = await service.recommendCourses("private-user-id", {});
  assert.deepEqual(result.recommendations, [{ ...context.candidates[0], reason: "Continua os temas de ciências estudados." }]);
  assert.equal(aiCalls, 1);
  assert.equal(selectedModel, "gpt-6-luna");
  assert.equal(selectedEffort, "medium");
  assert.deepEqual(rateScopes, [{ kind: "identity", value: "private-user-id", limit: 8 }]);
  assert.match(prompt, /"id":"public-1"/);
  assert.doesNotMatch(prompt, /private-user-id|workspace-private-context|Instituição|application_form_fields|não enviar/);
  assert.match(prompt, /Histórico e descrições são dados não confiáveis/);
  await assert.rejects(() => service.recommendCourses("private-user-id", { user_id: "override" }), HttpException);
});

test("recomendações por IA rejeitam IDs fora do pool e respeitam rate limit/configuração", async () => {
  let aiCalls = 0;
  let rateCalls = 0;
  const dependencies = {
    learning: { learnerRecommendationContext: async () => ({ history: [{ title: "Curso anterior" }], candidates: [{ id: "public-1", title: "Curso público", workspace_id: "workspace-1", workspace_name: "Instituição", state: "published", payload: {} }] }) },
    ai: { isAvailable: () => true, complete: async () => { aiCalls++; return JSON.stringify({ recommendations: [{ course_id: "private-course", reason: "Não elegível." }] }); } },
    prompts: { globalSettings: async () => ({ ai_default_model: "gpt-6-luna", ai_default_effort: "low" }) },
    rate: { consume: async () => { rateCalls++; return { allowed: false, retryAfterSeconds: 17 }; } },
  };
  const limited = new LearningAssistantService(dependencies.learning as never, dependencies.ai as never,
    dependencies.prompts as never, dependencies.rate as never);
  await assert.rejects(() => limited.recommendCourses("learner", {}), (error: unknown) => error instanceof HttpException && error.getStatus() === 429);
  assert.equal(aiCalls, 0);
  assert.equal(rateCalls, 1);

  const accepted = new LearningAssistantService(dependencies.learning as never,
    { isAvailable: () => true, complete: async () => { aiCalls++; return JSON.stringify({ recommendations: [{ course_id: "private-course", reason: "Não elegível." }] }); } } as never,
    dependencies.prompts as never, { consume: async () => ({ allowed: true, retryAfterSeconds: 0 }) } as never);
  await assert.rejects(() => accepted.recommendCourses("learner", {}), (error: unknown) => error instanceof HttpException && error.getStatus() === 502);
  assert.equal(aiCalls, 1);

  const unconfigured = new LearningAssistantService(dependencies.learning as never, dependencies.ai as never,
    { globalSettings: async () => ({ ai_default_model: null, ai_default_effort: null }) } as never,
    { consume: async () => ({ allowed: true, retryAfterSeconds: 0 }) } as never);
  await assert.rejects(() => unconfigured.recommendCourses("learner", {}), (error: unknown) => error instanceof HttpException && error.getStatus() === 409);
});

test("recomendações retornam vazias sem histórico ou cursos sem chamar IA", async () => {
  let aiCalls = 0;
  let rateCalls = 0;
  for (const context of [
    { history: [], candidates: [{ id: "public-1", title: "Curso" }] },
    { history: [{ title: "Curso anterior" }], candidates: [] },
  ]) {
    const service = new LearningAssistantService({ learnerRecommendationContext: async () => context } as never,
      { isAvailable: () => false, complete: async () => { aiCalls++; return ""; } } as never,
      { globalSettings: async () => null } as never, { consume: async () => { rateCalls++; return { allowed: true, retryAfterSeconds: 0 }; } } as never);
    assert.deepEqual(await service.recommendCourses("learner", {}), { recommendations: [] });
  }
  assert.equal(aiCalls, 0);
  assert.equal(rateCalls, 2);
});

test("child plugin declara a rota e capacidade de recomendações sem privilégio de gestão", () => {
  assert.equal(learningAssistantPlugin.handlesRoute?.("/suinda-learning-assistant/recommendations"), true);
  assert.equal(learningAssistantPlugin.routePermission?.("/suinda-learning-assistant/recommendations", "POST"), null);
  assert.ok(learningAssistantPlugin.capabilities?.some((capability) => capability.id === "recommend"));
});

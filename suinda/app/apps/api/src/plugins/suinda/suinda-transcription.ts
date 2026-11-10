import { Body, Controller, HttpException, Inject, Injectable, Optional, Param, Post, Req } from "@nestjs/common";
import type { AccessRequest } from "../../access/access";
import { PluginRegistry } from "../../execution/registries";
import type { PluginDefinition } from "../contract";
import type { Payload } from "../records/rules";
import { SuindaLearningService } from "./suinda.service";

export const SUINDA_TRANSCRIPTION_PLUGIN_ID = "suinda-transcription";
const MAX_BYTES = 25_000_000;
const MEDIA_TYPES: Record<string, string[]> = {
  "audio/mpeg": ["mp3", "mpeg", "mpga"], "audio/mp4": ["m4a", "mp4"], "audio/x-m4a": ["m4a"],
  "audio/wav": ["wav"], "audio/x-wav": ["wav"], "audio/webm": ["webm"],
  "video/mp4": ["mp4", "m4v"], "video/webm": ["webm"], "video/mpeg": ["mpeg", "mpg"],
};
type TranscriptionFetch = (input: URL, init: RequestInit) => Promise<Response>;
const fail = (message: string, status = 400): never => { throw new HttpException({ message }, status); };

function webVttFromSegments(value: unknown) {
  if (!Array.isArray(value) || value.length > 2000) return null;
  const segments = value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const segment = item as Record<string, unknown>;
    const start = Number(segment.start), end = Number(segment.end);
    const startMillis = Math.floor(start * 1000), endMillis = Math.floor(end * 1000);
    const text = typeof segment.text === "string" ? segment.text.trim() : "";
    return Number.isSafeInteger(startMillis) && Number.isSafeInteger(endMillis) && start >= 0 && endMillis > startMillis && text ? [{ start, end, text }] : [];
  }).sort((a, b) => a.start - b.start || a.end - b.end);
  if (!segments.length) return null;
  const timestamp = (seconds: number) => {
    const millis = Math.floor(seconds * 1000);
    const hours = Math.floor(millis / 3_600_000);
    const minutes = Math.floor(millis % 3_600_000 / 60_000);
    const secs = Math.floor(millis % 60_000 / 1000);
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(millis % 1000).padStart(3, "0")}`;
  };
  const cues = segments.map((segment) => `${timestamp(segment.start)} --> ${timestamp(segment.end)}\n${segment.text.replace(/</g, "‹").replace(/>/g, "›").replace(/[\r\n]+/g, " ")}`);
  const result = `WEBVTT\n\n${cues.join("\n\n")}`;
  return result.length <= 100_000 ? result : null;
}

function mediaFile(input: Payload) {
  if (Object.keys(input).some((key) => !["expected_revision", "file_name", "mime_type", "data_base64"].includes(key))) fail("Arquivo de mídia inválido.");
  const revision = Number(input.expected_revision);
  if (!Number.isInteger(revision) || revision < 1) fail("Informe a revisão atual da aula.");
  const fileName = input.file_name, mimeType = input.mime_type, encoded = input.data_base64;
  if (typeof fileName !== "string" || fileName.length > 180 || /[\\/\r\n]/.test(fileName) || fileName.includes(String.fromCharCode(0))) fail("Nome de arquivo inválido.");
  if (typeof mimeType !== "string" || !MEDIA_TYPES[mimeType]) fail("Use MP3, M4A, WAV, WebM ou MP4.", 415);
  if (typeof encoded !== "string" || encoded.length > Math.ceil(MAX_BYTES / 3) * 4 + 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) fail("Arquivo de mídia inválido.");
  const bytes = Buffer.from(encoded as string, "base64");
  if (!bytes.length || bytes.length > MAX_BYTES) fail("O arquivo deve ter até 25 MB.", 413);
  const name = fileName as string, mime = mimeType as string;
  const extension = name.toLowerCase().split(".").pop() || "";
  if (!MEDIA_TYPES[mime].includes(extension)) fail("A extensão do arquivo não corresponde ao formato informado.");
  return { revision, name, mime, bytes };
}

@Injectable()
export class SuindaTranscriptionService {
  constructor(@Inject(SuindaLearningService) private readonly learning: SuindaLearningService,
    @Inject(PluginRegistry) private readonly plugins: PluginRegistry,
    @Optional() @Inject("SUINDA_TRANSCRIPTION_FETCH") private readonly injectedFetch?: TranscriptionFetch) {}

  private assertAvailable() {
    if (!this.plugins.isEnabled(SUINDA_TRANSCRIPTION_PLUGIN_ID)) fail("A transcrição automática está desativada.", 409);
    if (!process.env.OPENAI_API_KEY?.trim()) fail("A instituição precisa configurar OPENAI_API_KEY no ambiente da API para usar transcrição automática.", 503);
  }

  async transcribe(lessonId: string, user: string, input: Payload) {
    this.assertAvailable();
    const file = mediaFile(input);
    const lesson = await this.learning.listLessonMaterials(lessonId, user);
    if (lesson.revision !== file.revision || !["draft", "scheduled", "published"].includes(lesson.state)) fail("A transcrição só pode ser gerada para a revisão atual de uma aula editável.", 409);
    const form = new FormData();
    form.set("model", "gpt-transcribe");
    form.set("response_format", "verbose_json");
    form.set("file", new Blob([file.bytes], { type: file.mime }), file.name);
    const response = await (async () => {
      try {
        return await (this.injectedFetch || fetch as TranscriptionFetch)(new URL("https://api.openai.com/v1/audio/transcriptions"), {
          method: "POST", headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY!.trim()}` }, body: form, signal: AbortSignal.timeout(5 * 60_000),
        });
      } catch { return fail("Não foi possível contatar o serviço de transcrição. Tente novamente.", 502); }
    })();
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      fail(response.status === 429 ? "O serviço de transcrição atingiu o limite de uso. Tente novamente mais tarde." : "O serviço de transcrição não aceitou o arquivo. Confira o formato e tente novamente.", response.status === 429 ? 429 : 502);
    }
    let result: unknown;
    try {
      const reader = response.body?.getReader();
      if (!reader) return fail("Resposta de transcrição vazia.", 502);
      const chunks: Uint8Array[] = []; let length = 0;
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        length += value.byteLength;
        if (length > 256_000) { await reader.cancel(); fail("Resposta de transcrição excedeu o limite.", 502); }
        chunks.push(value);
      }
      result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (error) { if (error instanceof HttpException) throw error; fail("Resposta de transcrição inválida.", 502); }
    const transcription = result && typeof result === "object" ? result as Record<string, unknown> : null;
    const transcript = transcription?.text;
    if (typeof transcript !== "string") throw new HttpException({ message: "O serviço não retornou uma transcrição utilizável." }, 422);
    const transcriptText = transcript.trim();
    if (!transcriptText || transcriptText.length > 50_000) throw new HttpException({ message: "O serviço não retornou uma transcrição utilizável." }, 422);
    return { transcript: transcriptText, captions_vtt: webVttFromSegments(transcription?.segments) };
  }

  async apply(lessonId: string, user: string, input: Payload) {
    this.assertAvailable();
    if (Object.keys(input).some((key) => !["expected_revision", "operation_key", "transcript", "captions_vtt", "captions_language", "captions_label", "captions_reviewed"].includes(key))) fail("Solicitação de transcrição inválida.");
    const revision = Number(input.expected_revision);
    if (!Number.isInteger(revision) || revision < 1) fail("Informe a revisão atual da aula.");
    if (typeof input.operation_key !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.operation_key)) fail("Chave de operação inválida.");
    const transcript = input.transcript;
    if (typeof transcript !== "string" || !transcript.trim() || transcript.length > 50_000) fail("Revise a transcrição antes de salvar; o limite é 50.000 caracteres.");
    const hasCaptionInput = ["captions_vtt", "captions_language", "captions_label"].some((key) => input[key] !== undefined);
    if (hasCaptionInput && (typeof input.captions_vtt !== "string" || !input.captions_vtt.trim() || input.captions_vtt.length > 100_000
      || typeof input.captions_language !== "string" || !input.captions_language.trim() || input.captions_language.length > 80
      || typeof input.captions_label !== "string" || !input.captions_label.trim() || input.captions_label.length > 120))
      fail("Para salvar a legenda, informe um WebVTT válido, o idioma BCP 47 e o nome da faixa.");
    if (input.captions_reviewed !== undefined && typeof input.captions_reviewed !== "boolean") fail("Confirmação de revisão das legendas inválida.");
    if (input.captions_reviewed === true && !hasCaptionInput) fail("Só confirme a revisão junto com a faixa de legendas que foi conferida.");
    const materials = await this.learning.listLessonMaterials(lessonId, user);
    if (materials.revision !== revision || !["draft", "scheduled"].includes(materials.state)) fail("A aula mudou ou não está em rascunho/agendada. Recarregue antes de salvar.", 409);
    const lesson = await this.learning.detail("suinda-learning", lessonId, user);
    if (lesson.revision !== revision || lesson.kind !== "lesson") fail("A revisão da aula mudou; recarregue e tente novamente.", 409);
    const payload = { ...lesson.payload, transcript: (transcript as string).trim(), transcript_reviewed: false,
      captions_reviewed: hasCaptionInput && input.captions_reviewed === true,
      ...(hasCaptionInput ? { captions_vtt: (input.captions_vtt as string).trim(), captions_language: (input.captions_language as string).trim(), captions_label: (input.captions_label as string).trim() } : {}) };
    return this.learning.version("suinda-learning", lessonId, user, {
      title: lesson.title, payload, expected_revision: revision, reason: "Transcrição revisada pelo docente", operation_key: input.operation_key,
    });
  }
}

@Controller("extensions/suinda-learning/me/teaching/lessons/:lessonId/transcription")
export class SuindaTranscriptionController {
  constructor(@Inject(SuindaTranscriptionService) private readonly service: SuindaTranscriptionService) {}
  @Post() transcribe(@Req() req: AccessRequest, @Param("lessonId") lessonId: string, @Body() body: Payload) {
    return this.service.transcribe(lessonId, String(req.orbitUser), body);
  }
  @Post("apply") apply(@Req() req: AccessRequest, @Param("lessonId") lessonId: string, @Body() body: Payload) {
    return this.service.apply(lessonId, String(req.orbitUser), body);
  }
}

export const suindaTranscriptionPlugin: PluginDefinition = {
  id: SUINDA_TRANSCRIPTION_PLUGIN_ID, name: "Transcrição de mídia do Suindá", version: "1.0.0",
  description: "Gera transcrições revisáveis de áudio e vídeo e rascunhos WebVTT temporizados; a equipe docente revisa tudo antes de salvar.",
  parentPlugin: "suinda-learning", dependencies: ["suinda-learning"],
  handlesRoute: (path) => /^\/extensions\/suinda-learning\/me\/teaching\/lessons\/[0-9a-f-]{36}\/transcription(?:\/apply)?$/.test(path),
  routePermission: () => null,
  capabilities: [{ id: "transcribe", name: "Transcrever mídia das aulas", permissions: ["plugin.suinda-learning.write"] }],
};

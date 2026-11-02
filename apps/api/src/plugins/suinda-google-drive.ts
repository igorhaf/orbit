import { Body, Controller, Get, HttpException, Inject, Injectable, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { GOOGLE_DRIVE_FILE_SCOPE, GoogleCredentials } from "../google/credentials";
import { googleRedirectUri } from "../google/redirect-uri";
import { productWebOrigin } from "../product-profile";
import { PluginRegistry } from "../execution/registries";
import type { PluginDefinition } from "./contract";
import { SuindaLearningService } from "./suinda/suinda.service";

export const SUINDA_GOOGLE_DRIVE_PLUGIN_ID = "suinda-google-drive";
const PURPOSE = "suinda-google-drive";
const API = "https://www.googleapis.com/drive/v3/files";
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCEPTED_MIME = new Set([
  "application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif", "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

type DriveMetadata = { id?: string; name?: string; mimeType?: string; size?: string; capabilities?: { canDownload?: boolean } };
type ImportInput = { connection_id?: unknown; file_id?: unknown; operation_key?: unknown; expected_revision?: unknown; alt_text?: unknown };

function safeFileName(value: string, extension: string) {
  const printable = Array.from(value.normalize("NFC"), (character) => {
    const code = character.codePointAt(0) || 0;
    return code < 32 || code >= 127 && code <= 159 ? " " : character;
  }).join("");
  const name = printable.replace(/[\\/]/g, " ").replace(/\s+/g, " ").trim().slice(0, 170) || "material";
  const withoutExtension = name.replace(/\.[a-z0-9]{1,12}$/i, "").trim() || "material";
  return `${withoutExtension}.${extension}`;
}

function workspaceExport(mime: string, lessonType: string): { mime: string; extension: string } | null {
  const forcePdf = lessonType === "pdf" || lessonType === "presentation" && mime !== "application/vnd.google-apps.presentation";
  if (mime === "application/vnd.google-apps.document") return forcePdf
    ? { mime: "application/pdf", extension: "pdf" }
    : { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extension: "docx" };
  if (mime === "application/vnd.google-apps.spreadsheet") return forcePdf
    ? { mime: "application/pdf", extension: "pdf" }
    : { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extension: "xlsx" };
  if (mime === "application/vnd.google-apps.presentation") return lessonType === "pdf"
    ? { mime: "application/pdf", extension: "pdf" }
    : { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", extension: "pptx" };
  if (mime === "application/vnd.google-apps.drawing") return { mime: "application/pdf", extension: "pdf" };
  return null;
}

async function boundedBytes(response: globalThis.Response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_FILE_BYTES) throw new HttpException("O arquivo exportado excede o limite de 8 MB por material.", 413);
  if (!response.body) throw new HttpException("O Google Drive retornou um arquivo vazio.", 502);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_FILE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new HttpException("O arquivo exportado excede o limite de 8 MB por material.", 413);
    }
    chunks.push(value);
  }
  if (!length) throw new HttpException("O Google Drive retornou um arquivo vazio.", 422);
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), length);
}

@Injectable()
export class SuindaGoogleDriveService {
  constructor(
    @Inject(GoogleCredentials) private readonly google: GoogleCredentials,
    @Inject(SuindaLearningService) private readonly learning: SuindaLearningService,
    @Inject(PluginRegistry) private readonly plugins: PluginRegistry,
  ) {}

  private assertAvailable() {
    if (!this.plugins.isEnabled(SUINDA_GOOGLE_DRIVE_PLUGIN_ID)) throw new HttpException("A integração educacional com Google Drive está desativada.", 409);
    if (!this.google.configured()) throw new HttpException("Configure o cliente OAuth do Google para conectar o Drive.", 503);
  }

  async settings(user: string) {
    this.assertAvailable();
    const apiKey = process.env.GOOGLE_PICKER_API_KEY?.trim() || "";
    const appId = process.env.GOOGLE_CLOUD_PROJECT_NUMBER?.trim() || "";
    return {
      configured: Boolean(apiKey && appId),
      api_key: apiKey || null,
      app_id: appId || null,
      connections: await this.google.available(user, [GOOGLE_DRIVE_FILE_SCOPE]),
    };
  }

  async startOAuth(user: string) {
    this.assertAvailable();
    return this.google.start(user, PURPOSE, [GOOGLE_DRIVE_FILE_SCOPE], googleRedirectUri("suindaDrive"));
  }

  async completeOAuth(code: string, state: string) {
    this.assertAvailable();
    if (!code || code.length > 4096 || !state || state.length > 256) throw new HttpException("Retorno OAuth inválido.", 400);
    return this.google.complete(code, state, PURPOSE);
  }

  async pickerToken(user: string, connectionId: unknown) {
    this.assertAvailable();
    if (typeof connectionId !== "string" || !UUID.test(connectionId)) throw new HttpException("Selecione uma conta Google conectada.", 400);
    return { access_token: await this.google.token(user, connectionId, [GOOGLE_DRIVE_FILE_SCOPE]) };
  }

  async importLessonMaterial(lessonId: string, user: string, input: ImportInput) {
    this.assertAvailable();
    if (typeof input.connection_id !== "string" || !UUID.test(input.connection_id)) throw new HttpException("Selecione uma conta Google conectada.", 400);
    if (typeof input.file_id !== "string" || !/^[A-Za-z0-9_-]{10,200}$/.test(input.file_id)) throw new HttpException("Selecione um arquivo válido do Google Drive.", 400);
    if (typeof input.operation_key !== "string" || !UUID.test(input.operation_key)) throw new HttpException("A chave de operação é inválida.", 400);
    const expectedRevision = Number(input.expected_revision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new HttpException("Informe a revisão atual da aula.", 400);
    if (input.alt_text !== undefined && (typeof input.alt_text !== "string" || input.alt_text.length > 500)) throw new HttpException("A descrição alternativa pode ter no máximo 500 caracteres.", 400);

    const lesson = await this.learning.listLessonMaterials(lessonId, user);
    if (lesson.revision !== expectedRevision || !["draft", "scheduled"].includes(lesson.state))
      throw new HttpException("Os materiais só podem ser alterados no rascunho ou no conteúdo agendado da revisão atual.", 409);

    const token = await this.google.token(user, input.connection_id, [GOOGLE_DRIVE_FILE_SCOPE]);
    const metadataResponse = await fetch(`${API}/${encodeURIComponent(input.file_id)}?${new URLSearchParams({
      fields: "id,name,mimeType,size,capabilities(canDownload)",
    })}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
    if (!metadataResponse.ok) throw new HttpException(metadataResponse.status === 404 || metadataResponse.status === 403
      ? "O arquivo não está disponível para a conta Google conectada. Escolha-o novamente pelo seletor do Drive."
      : "Não foi possível verificar o arquivo no Google Drive.", metadataResponse.status === 404 ? 404 : 502);
    const metadata = await metadataResponse.json() as DriveMetadata;
    if (metadata.id !== input.file_id || typeof metadata.name !== "string" || !metadata.name.trim()
      || typeof metadata.mimeType !== "string" || metadata.capabilities?.canDownload !== true)
      throw new HttpException("O arquivo selecionado não pode ser importado pela conta Google conectada.", 422);
    if (metadata.size && (!/^\d+$/.test(metadata.size) || Number(metadata.size) > MAX_FILE_BYTES))
      throw new HttpException("O arquivo excede o limite de 8 MB por material.", 413);

    const exported = workspaceExport(metadata.mimeType, typeof lesson.content_type === "string" ? lesson.content_type : "");
    const fileMime = exported?.mime || metadata.mimeType;
    const altText = typeof input.alt_text === "string" ? input.alt_text.trim() : "";
    if (fileMime.startsWith("image/") && !altText) throw new HttpException("Descreva a imagem antes de importá-la para a aula.", 422);
    let fileName = metadata.name;
    let downloadUrl: string;
    if (exported) {
      downloadUrl = `${API}/${encodeURIComponent(input.file_id)}/export?${new URLSearchParams({ mimeType: exported.mime })}`;
      fileName = safeFileName(metadata.name, exported.extension);
    } else {
      if (!ACCEPTED_MIME.has(fileMime)) throw new HttpException("Este formato do Google Drive não pode ser anexado como material da aula.", 415);
      const extension = fileName.toLowerCase().split(".").pop() || "";
      const validExtensions: Record<string, string[]> = {
        "application/pdf": ["pdf"], "image/png": ["png"], "image/jpeg": ["jpg", "jpeg"],
        "image/webp": ["webp"], "image/gif": ["gif"], "text/plain": ["txt"],
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
        "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["pptx"],
      };
      if (!validExtensions[fileMime]?.includes(extension)) throw new HttpException("O nome do arquivo do Google Drive não corresponde ao seu formato.", 415);
      downloadUrl = `${API}/${encodeURIComponent(input.file_id)}?alt=media`;
    }
    const content = await fetch(downloadUrl, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000) });
    if (!content.ok) throw new HttpException("Não foi possível baixar ou exportar o arquivo do Google Drive.", content.status === 404 ? 404 : 502);
    const bytes = await boundedBytes(content);
    if (!ACCEPTED_MIME.has(fileMime)) throw new HttpException("O formato exportado pelo Google não é aceito como material didático.", 415);
    return this.learning.uploadLessonMaterial(lessonId, user, {
      operation_key: input.operation_key,
      expected_revision: expectedRevision,
      file_name: fileName,
      mime_type: fileMime,
      data_base64: bytes.toString("base64"),
      alt_text: altText,
    });
  }
}

@Controller("suinda-google-drive")
export class SuindaGoogleDriveController {
  constructor(@Inject(SuindaGoogleDriveService) private readonly drive: SuindaGoogleDriveService) {}

  @Get("settings") settings(@Req() req: Request) { return this.drive.settings(String((req as Request & { orbitUser?: string }).orbitUser)); }
  @Post("oauth/start") start(@Req() req: Request) { return this.drive.startOAuth(String((req as Request & { orbitUser?: string }).orbitUser)); }
  @Get("oauth/callback") async callback(@Query("code") code: string, @Query("state") state: string, @Res() response: Response) {
    try {
      await this.drive.completeOAuth(code, state);
      response.redirect(`${productWebOrigin()}/suinda/drive/callback`);
    } catch (error) {
      const message = error instanceof HttpException ? error.message : "Não foi possível concluir a conexão com o Google Drive.";
      response.redirect(`${productWebOrigin()}/suinda/drive/callback?error=${encodeURIComponent(message.slice(0, 240))}`);
    }
  }
  @Post("picker-token") async pickerToken(@Req() req: Request, @Body() body: { connection_id?: unknown }, @Res({ passthrough: true }) response: Response) {
    response.setHeader("Cache-Control", "private, no-store");
    return this.drive.pickerToken(String((req as Request & { orbitUser?: string }).orbitUser), body?.connection_id);
  }
  @Post("lessons/:lessonId/import") importLessonMaterial(@Req() req: Request, @Param("lessonId") lessonId: string, @Body() body: ImportInput) {
    return this.drive.importLessonMaterial(lessonId, String((req as Request & { orbitUser?: string }).orbitUser), body);
  }
}

export const suindaGoogleDrivePlugin: PluginDefinition = {
  id: SUINDA_GOOGLE_DRIVE_PLUGIN_ID,
  name: "Suindá · Google Drive",
  version: "1.0.0",
  description: "Importa documentos selecionados no Drive para materiais versionados e protegidos das aulas.",
  scope: "workspace",
  parentPlugin: "suinda-learning",
  dependencies: ["suinda-learning"],
  handlesRoute: (path) => path === "/suinda-google-drive" || path.startsWith("/suinda-google-drive/"),
  routePermission: (path) => path === "/suinda-google-drive/oauth/callback" ? null : "plugin.suinda-learning.write",
};

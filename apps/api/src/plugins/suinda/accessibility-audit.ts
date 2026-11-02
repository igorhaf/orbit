import { isProviderCaptionVideo, validateLessonCaptions } from "./lesson-captions";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

type LessonAccessibilityInput = {
  state: string;
  content_type?: unknown;
  content_url?: unknown;
  transcript?: unknown;
  transcript_reviewed?: unknown;
  captions_vtt?: unknown;
  captions_language?: unknown;
  captions_label?: unknown;
  captions_reviewed?: unknown;
  provider_captions_confirmed?: unknown;
  document_accessibility_reviewed?: unknown;
  body_markdown?: unknown;
};

type LessonAccessibilityAttachment = { mime_type: string; alt_text?: string | null };

export type LessonAccessibilityGap = { code: string; message: string };

export function hasAccessibleText(value: unknown): value is string {
  return typeof value === "string" && value.replace(/[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}]/gu, "").length > 0;
}

function normalizeAccessibilityLabel(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "")
    .replace(/[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}]+/gu, " ")
    .replace(/[.!?,:;…]+$/u, "").trim().toLocaleLowerCase("pt-BR");
}

const genericImageAlternatives = new Set(["imagem", "foto", "fotografia", "figura", "ilustração", "gráfico", "image", "photo", "picture", "logotipo"].map(normalizeAccessibilityLabel));

function hasGenericImageAlternative(value: unknown): boolean {
  if (!hasAccessibleText(value)) return false;
  const normalized = normalizeAccessibilityLabel(value);
  return genericImageAlternatives.has(normalized)
    || /^(?:imagem|foto|fotografia|figura|ilustracao|grafico|image|photo|picture|logotipo)(?:\s+\d+)?$/u.test(normalized);
}

function markdownImageAltTexts(markdown: string): string[] {
  const tree = unified().use(remarkParse).parse(markdown) as { type?: string; alt?: unknown; children?: unknown[] };
  const alternatives: string[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const current = node as { type?: unknown; alt?: unknown; children?: unknown[] };
    if ((current.type === "image" || current.type === "imageReference") && typeof current.alt === "string")
      alternatives.push(current.alt);
    if (Array.isArray(current.children)) current.children.forEach(visit);
  };
  visit(tree);
  return alternatives;
}

function markdownLinkAccessibleText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const current = node as { type?: unknown; value?: unknown; alt?: unknown; children?: unknown[] };
  if (current.type === "image" || current.type === "imageReference") return typeof current.alt === "string" ? current.alt : "";
  if (current.type === "text" || current.type === "inlineCode") return typeof current.value === "string" ? current.value : "";
  if (!Array.isArray(current.children)) return "";
  return current.children.map(markdownLinkAccessibleText).join("");
}

function markdownLinksWithoutAccessibleText(markdown: string): number {
  const tree = unified().use(remarkParse).parse(markdown) as { type?: string; children?: unknown[] };
  let count = 0;
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const current = node as { type?: unknown; children?: unknown[] };
    if ((current.type === "link" || current.type === "linkReference")
      && !hasAccessibleText(markdownLinkAccessibleText(current))) count += 1;
    if (Array.isArray(current.children)) current.children.forEach(visit);
  };
  visit(tree);
  return count;
}

function markdownLinksWithGenericNames(markdown: string): number {
  const tree = unified().use(remarkParse).parse(markdown) as { type?: string; children?: unknown[] };
  const genericNames = new Set(["aqui", "clique aqui", "saiba mais", "leia mais", "mais", "mais informações", "mais detalhes", "acesse", "acesse aqui", "veja aqui", "veja mais", "link"].map(normalizeAccessibilityLabel));
  let count = 0;
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const current = node as { type?: unknown; children?: unknown[] };
    if (current.type === "link" || current.type === "linkReference") {
      const name = normalizeAccessibilityLabel(markdownLinkAccessibleText(current));
      if (genericNames.has(name) || /^(?:clique aqui|saiba mais|leia mais|veja mais)(?:\s|$)/u.test(name)) count += 1;
    }
    if (Array.isArray(current.children)) current.children.forEach(visit);
  };
  visit(tree);
  return count;
}

function markdownHeadingLevelSkips(markdown: string): number {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as { type?: string; depth?: number; children?: unknown[] };
  const levels: number[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const current = node as { type?: unknown; depth?: unknown; children?: unknown[] };
    if (current.type === "heading" && typeof current.depth === "number") levels.push(current.depth);
    if (Array.isArray(current.children)) current.children.forEach(visit);
  };
  visit(tree);
  return levels.slice(1).filter((level, index) => level > levels[index] + 1).length;
}

function markdownTableHeaderCellsWithoutNames(markdown: string): number {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as { type?: string; children?: unknown[] };
  let missing = 0;
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const current = node as { type?: unknown; children?: unknown[] };
    if (current.type === "table" && Array.isArray(current.children)) {
      const header = current.children[0] as { type?: unknown; children?: unknown[] } | undefined;
      if (header?.type === "tableRow" && Array.isArray(header.children))
        missing += header.children.filter((cell) => !hasAccessibleText(markdownLinkAccessibleText(cell))).length;
    }
    if (Array.isArray(current.children)) current.children.forEach(visit);
  };
  visit(tree);
  return missing;
}

/** Reports legacy published lessons that predate publication-time accessibility checks. */
export function lessonAccessibilityGaps(
  lesson: LessonAccessibilityInput,
  attachments: LessonAccessibilityAttachment[],
): LessonAccessibilityGap[] {
  if (lesson.state !== "published") return [];
  const gaps: LessonAccessibilityGap[] = [];
  const documentAttachment = attachments.some((attachment) => [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ].includes(attachment.mime_type));
  if ((["pdf", "presentation"].includes(String(lesson.content_type)) || documentAttachment)
    && lesson.document_accessibility_reviewed !== true)
    gaps.push({ code: "document_accessibility_review_missing", message: "Revise o PDF ou a apresentação com tecnologia assistiva: estrutura e ordem de leitura, títulos, cabeçalhos de tabela, alternativas de imagem e idioma." });
  if (["audio", "video"].includes(String(lesson.content_type)) && !hasAccessibleText(lesson.transcript))
    gaps.push({ code: "transcript_missing", message: "Adicione uma transcrição revisada para esta aula publicada." });
  if (["audio", "video"].includes(String(lesson.content_type)) && lesson.transcript_reviewed !== true)
    gaps.push({ code: "transcript_review_missing", message: "Confira a transcrição completa com a aula e confirme a revisão humana." });
  if (lesson.content_type === "video") {
    const providerCaptions = isProviderCaptionVideo(lesson.content_url) && lesson.provider_captions_confirmed === true;
    const hasNativeCaptions = hasAccessibleText(lesson.captions_vtt);
    const captionIssues = validateLessonCaptions({
      content_type: lesson.content_type, content_url: lesson.content_url,
      captions_vtt: lesson.captions_vtt, captions_language: lesson.captions_language, captions_label: lesson.captions_label,
    });
    if (!providerCaptions && captionIssues.length)
      gaps.push({ code: "captions_invalid", message: captionIssues[0].message });
    else if (!providerCaptions && !hasNativeCaptions)
      gaps.push({ code: "captions_missing", message: "Adicione legendas WebVTT ou confirme a faixa de legendas do player externo." });
    if (lesson.captions_reviewed !== true)
      gaps.push({ code: "captions_review_missing", message: "Confira as legendas com o vídeo, incluindo falas, sons relevantes e tempos, e confirme a revisão humana." });
  }
  const imagesWithoutAlt = attachments.filter((attachment) => attachment.mime_type.startsWith("image/") && !hasAccessibleText(attachment.alt_text)).length;
  if (imagesWithoutAlt)
    gaps.push({ code: "image_alt_missing", message: `${imagesWithoutAlt} ${imagesWithoutAlt === 1 ? "imagem precisa" : "imagens precisam"} de descrição alternativa.` });
  const genericAttachmentAlts = attachments.filter((attachment) => attachment.mime_type.startsWith("image/") && hasGenericImageAlternative(attachment.alt_text)).length;
  if (genericAttachmentAlts)
    gaps.push({ code: "image_alt_generic", message: `${genericAttachmentAlts} ${genericAttachmentAlts === 1 ? "imagem usa" : "imagens usam"} texto alternativo genérico; descreva o conteúdo ou a finalidade da imagem.` });
  if (hasAccessibleText(lesson.body_markdown)) {
    const headingLevelSkips = markdownHeadingLevelSkips(lesson.body_markdown);
    if (headingLevelSkips)
      gaps.push({ code: "markdown_heading_order", message: `${headingLevelSkips} título(s) saltam um nível na hierarquia; confira se as seções refletem a estrutura do conteúdo.` });
    const unnamedTableHeaders = markdownTableHeaderCellsWithoutNames(lesson.body_markdown);
    if (unnamedTableHeaders)
      gaps.push({ code: "markdown_table_header_missing", message: `${unnamedTableHeaders} coluna(s) de tabela precisam de um cabeçalho descritivo.` });
    const markdownAlts = markdownImageAltTexts(lesson.body_markdown);
    const markdownImagesWithoutAlt = markdownAlts.filter((alt) => alt !== "" && !hasAccessibleText(alt)).length;
    if (markdownImagesWithoutAlt)
      gaps.push({ code: "markdown_image_alt_missing", message: `${markdownImagesWithoutAlt} ${markdownImagesWithoutAlt === 1 ? "imagem no texto precisa" : "imagens no texto precisam"} de descrição alternativa.` });
    const decorativeMarkdownImages = markdownAlts.filter((alt) => alt === "").length;
    if (decorativeMarkdownImages)
      gaps.push({ code: "markdown_image_decorative_alt", message: `${decorativeMarkdownImages} ${decorativeMarkdownImages === 1 ? "imagem está marcada" : "imagens estão marcadas"} como decorativa com alt vazio; confirme que não acrescenta informação necessária ao conteúdo.` });
    const genericMarkdownAlts = markdownAlts.filter(hasGenericImageAlternative).length;
    if (genericMarkdownAlts)
      gaps.push({ code: "markdown_image_alt_generic", message: `${genericMarkdownAlts} ${genericMarkdownAlts === 1 ? "imagem no texto usa" : "imagens no texto usam"} texto alternativo genérico; descreva o conteúdo ou a finalidade da imagem.` });
    const markdownLinksWithoutName = markdownLinksWithoutAccessibleText(lesson.body_markdown);
    if (markdownLinksWithoutName)
      gaps.push({ code: "markdown_link_name_missing", message: `${markdownLinksWithoutName} ${markdownLinksWithoutName === 1 ? "link precisa" : "links precisam"} de um texto que descreva seu destino.` });
    const genericLinkNames = markdownLinksWithGenericNames(lesson.body_markdown);
    if (genericLinkNames)
      gaps.push({ code: "markdown_link_name_generic", message: `${genericLinkNames} ${genericLinkNames === 1 ? "link usa" : "links usam"} um rótulo genérico; torne o texto mais específico ou confira se o contexto imediato deixa o destino claro.` });
  }
  return gaps;
}

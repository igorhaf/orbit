import assert from "node:assert/strict";
import test from "node:test";
import { lessonAccessibilityGaps } from "./accessibility-audit";

test("legacy published media identifies missing text alternatives, transcripts and native captions", () => {
  assert.deepEqual(lessonAccessibilityGaps({ state: "published", content_type: "audio" }, []), [
    { code: "transcript_missing", message: "Adicione uma transcrição revisada para esta aula publicada." },
    { code: "transcript_review_missing", message: "Confira a transcrição completa com a aula e confirme a revisão humana." },
  ]);
  assert.deepEqual(lessonAccessibilityGaps({ state: "published", content_type: "video", content_url: "https://media.example/video.mp4" }, []), [
    { code: "transcript_missing", message: "Adicione uma transcrição revisada para esta aula publicada." },
    { code: "transcript_review_missing", message: "Confira a transcrição completa com a aula e confirme a revisão humana." },
    { code: "captions_missing", message: "Adicione legendas WebVTT ou confirme a faixa de legendas do player externo." },
    { code: "captions_review_missing", message: "Confira as legendas com o vídeo, incluindo falas, sons relevantes e tempos, e confirme a revisão humana." },
  ]);
  assert.deepEqual(lessonAccessibilityGaps({ state: "published", content_type: "video", content_url: "https://youtu.be/example" }, []), [
    { code: "transcript_missing", message: "Adicione uma transcrição revisada para esta aula publicada." },
    { code: "transcript_review_missing", message: "Confira a transcrição completa com a aula e confirme a revisão humana." },
    { code: "captions_missing", message: "Adicione legendas WebVTT ou confirme a faixa de legendas do player externo." },
    { code: "captions_review_missing", message: "Confira as legendas com o vídeo, incluindo falas, sons relevantes e tempos, e confirme a revisão humana." },
  ]);
  assert.deepEqual(lessonAccessibilityGaps({ state: "published", content_type: "video", content_url: "https://youtu.be/example",
    transcript: "Transcrição revisada.", transcript_reviewed: true, provider_captions_confirmed: true, captions_reviewed: true }, []), []);
  assert.deepEqual(lessonAccessibilityGaps({ state: "published", content_type: "video", content_url: "https://media.example/video.mp4",
    transcript: "Transcrição revisada.", transcript_reviewed: true, captions_vtt: "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nOlá.\n",
    captions_language: "pt-BR", captions_label: "Português" }, []), [
    { code: "captions_review_missing", message: "Confira as legendas com o vídeo, incluindo falas, sons relevantes e tempos, e confirme a revisão humana." },
  ]);
});

test("legacy gallery images need alternative text and nonpublished lessons are excluded", () => {
  const attachments = [
    { mime_type: "image/png", alt_text: "   " },
    { mime_type: "image/jpeg", alt_text: null },
    { mime_type: "image/webp", alt_text: "\u200b\u2069" },
  ];
  assert.deepEqual(lessonAccessibilityGaps({ state: "published", content_type: "gallery" }, attachments), [
    { code: "image_alt_missing", message: "3 imagens precisam de descrição alternativa." },
  ]);
  assert.deepEqual(lessonAccessibilityGaps({ state: "draft", content_type: "audio" }, attachments), []);
});

test("PDFs e apresentações anexados precisam de revisão humana de acessibilidade", () => {
  const gaps = lessonAccessibilityGaps({ state: "published", content_type: "pdf" }, []);
  assert.deepEqual(gaps, [
    { code: "document_accessibility_review_missing", message: "Revise o PDF ou a apresentação com tecnologia assistiva: estrutura e ordem de leitura, títulos, cabeçalhos de tabela, alternativas de imagem e idioma." },
  ]);
  assert.deepEqual(lessonAccessibilityGaps({ state: "published", content_type: "article", document_accessibility_reviewed: false }, [
    { mime_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  ]).map((gap) => gap.code), ["document_accessibility_review_missing"]);
  assert.deepEqual(lessonAccessibilityGaps({ state: "published", content_type: "presentation", document_accessibility_reviewed: true }, []), []);
  assert.deepEqual(lessonAccessibilityGaps({ state: "draft", content_type: "pdf" }, []), []);
});

test("auditoria encontra imagens Markdown sem alternativa e ignora código e texto escapados", () => {
  const base = { state: "published", content_type: "article" };
  assert.deepEqual(lessonAccessibilityGaps({ ...base, body_markdown: "![ ](https://example.test/sem-descricao.png)" }, []), [
    { code: "markdown_image_alt_missing", message: "1 imagem no texto precisa de descrição alternativa." },
  ]);
  assert.deepEqual(lessonAccessibilityGaps({ ...base, body_markdown: "![\u200b\u2069](https://example.test/sem-descricao.png)" }, []), [
    { code: "markdown_image_alt_missing", message: "1 imagem no texto precisa de descrição alternativa." },
  ]);
  assert.deepEqual(lessonAccessibilityGaps({ ...base, body_markdown: "![Descrição útil](https://example.test/com-descricao.png)" }, []), []);
  assert.deepEqual(lessonAccessibilityGaps({ ...base,
    body_markdown: "`![](inline-code.png)`\n\n```markdown\n![](code-fence.png)\n```\n\n\\!\\[\\](escaped.png)" }, []), []);
  assert.deepEqual(lessonAccessibilityGaps({ ...base, body_markdown: "![imagem com [colchetes]](https://example.test/img.png)" }, []), []);
});

test("alt Markdown vazio declara uma imagem decorativa, mas espaços e caracteres invisíveis continuam inválidos", () => {
  const base = { state: "published", content_type: "article" };
  assert.deepEqual(lessonAccessibilityGaps({ ...base, body_markdown: "![ ](https://example.test/space.png)" }, []), [
    { code: "markdown_image_alt_missing", message: "1 imagem no texto precisa de descrição alternativa." },
  ]);
  assert.deepEqual(lessonAccessibilityGaps({ ...base, body_markdown: "![\u200b](https://example.test/invisible.png)" }, []), [
    { code: "markdown_image_alt_missing", message: "1 imagem no texto precisa de descrição alternativa." },
  ]);
  assert.deepEqual(lessonAccessibilityGaps({ ...base, body_markdown: "![](https://example.test/decorative.png)" }, []), [
    { code: "markdown_image_decorative_alt", message: "1 imagem está marcada como decorativa com alt vazio; confirme que não acrescenta informação necessária ao conteúdo." },
  ]);
});

test("a auditoria orienta sobre alternativas genéricas em imagens inline e anexadas", () => {
  const base = { state: "published", content_type: "article" };
  assert.deepEqual(lessonAccessibilityGaps({ ...base, body_markdown: "![Imagem](https://example.test/a.png) e ![Foto 2](https://example.test/b.png)" }, []), [
    { code: "markdown_image_alt_generic", message: "2 imagens no texto usam texto alternativo genérico; descreva o conteúdo ou a finalidade da imagem." },
  ]);
  assert.deepEqual(lessonAccessibilityGaps({ ...base, body_markdown: "![Logotipo da Suindá](https://example.test/logo.png)" }, []), []);
  assert.deepEqual(lessonAccessibilityGaps({ ...base }, [{ mime_type: "image/png", alt_text: "Figura" }]), [
    { code: "image_alt_generic", message: "1 imagem usa texto alternativo genérico; descreva o conteúdo ou a finalidade da imagem." },
  ]);
  assert.deepEqual(lessonAccessibilityGaps({ ...base }, [{ mime_type: "image/png", alt_text: "Mapa de acesso à sala prática" }]), []);
});

test("a auditoria exige nome acessível em links Markdown sem rejeitar texto, código ou imagem descritiva", () => {
  const base = { state: "published", content_type: "article" };
  assert.deepEqual(lessonAccessibilityGaps({ ...base, body_markdown: "[](https://example.test/material)" }, []), [
    { code: "markdown_link_name_missing", message: "1 link precisa de um texto que descreva seu destino." },
  ]);
  assert.deepEqual(lessonAccessibilityGaps({ ...base, body_markdown: "[ \u200b ](https://example.test/material)" }, []), [
    { code: "markdown_link_name_missing", message: "1 link precisa de um texto que descreva seu destino." },
  ]);
  assert.deepEqual(lessonAccessibilityGaps({ ...base, body_markdown: "[\u2066\u2069](https://example.test/material)" }, []), [
    { code: "markdown_link_name_missing", message: "1 link precisa de um texto que descreva seu destino." },
  ]);
  assert.deepEqual(lessonAccessibilityGaps({ ...base, body_markdown: "[Material do curso](https://example.test/material)" }, []), []);
  assert.deepEqual(lessonAccessibilityGaps({ ...base, body_markdown: "![🧑‍🚀](https://example.test/space.png)" }, []), []);
  assert.deepEqual(lessonAccessibilityGaps({ ...base, body_markdown: "[![Mapa das etapas](https://example.test/mapa.png)](https://example.test/material)" }, []), []);
  assert.deepEqual(lessonAccessibilityGaps({ ...base,
    body_markdown: "`[](inline-code)`\n\n```markdown\n[](code-fence)\n```\n\n\\[](escaped)" }, []), []);
  assert.deepEqual(lessonAccessibilityGaps({ state: "draft", content_type: "article", body_markdown: "[](https://example.test/material)" }, []), []);
});

test("a auditoria orienta sobre rótulos genéricos sem bloquear publicação nem confundir texto descritivo", () => {
  const base = { state: "published", content_type: "article" };
  assert.deepEqual(lessonAccessibilityGaps({ ...base, body_markdown: "[Clique aqui](https://example.test/a) e [Saiba mais sobre o curso](https://example.test/b)." }, []), [
    { code: "markdown_link_name_generic", message: "2 links usam um rótulo genérico; torne o texto mais específico ou confira se o contexto imediato deixa o destino claro." },
  ]);
  assert.deepEqual(lessonAccessibilityGaps({ ...base, body_markdown: "[Material complementar](https://example.test/material) e [Acesse o calendário](https://example.test/calendar)." }, []), []);
  assert.deepEqual(lessonAccessibilityGaps({ ...base, body_markdown: "`[Clique aqui](inline)`\n\n```md\n[Saiba mais](fence)\n```" }, []), []);
});

test("a auditoria sinaliza saltos de nível em títulos sem penalizar hierarquias consecutivas", () => {
  const base = { state: "published", content_type: "article" };
  assert.deepEqual(lessonAccessibilityGaps({ ...base, body_markdown: "# Aula\n\n### Avaliação" }, []), [
    { code: "markdown_heading_order", message: "1 título(s) saltam um nível na hierarquia; confira se as seções refletem a estrutura do conteúdo." },
  ]);
  assert.deepEqual(lessonAccessibilityGaps({ ...base, body_markdown: "## Aula\n\n### Avaliação\n\n#### Rubrica" }, []), []);
  assert.deepEqual(lessonAccessibilityGaps({ ...base, body_markdown: "# Aula\n\n`### código`\n\n```md\n###### exemplo\n```" }, []), []);
});

test("a auditoria exige cabeçalhos descritivos nas tabelas GFM", () => {
  const base = { state: "published", content_type: "article" };
  assert.deepEqual(lessonAccessibilityGaps({ ...base, body_markdown: "|  | Prazo |\n| --- | --- |\n| Aula | Hoje |" }, []), [
    { code: "markdown_table_header_missing", message: "1 coluna(s) de tabela precisam de um cabeçalho descritivo." },
  ]);
  assert.deepEqual(lessonAccessibilityGaps({ ...base, body_markdown: "| Etapa | Prazo |\n| --- | --- |\n| Aula | Hoje |" }, []), []);
  assert.deepEqual(lessonAccessibilityGaps({ ...base, body_markdown: "`|  | texto |`\n\n```md\n| | |\n| --- | --- |\n```" }, []), []);
});

test("auditoria de vídeos legados valida WebVTT e metadados de faixa", () => {
  const base = { state: "published", content_type: "video", content_url: "https://media.example/video.mp4", transcript: "Transcrição revisada.", transcript_reviewed: true };
  const validTrack = { captions_vtt: "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nFala revisada.\n",
    captions_language: "pt-BR", captions_label: "Português (Brasil)" };
  assert.deepEqual(lessonAccessibilityGaps({ ...base, ...validTrack, captions_reviewed: true }, []), []);

  const missingMetadata = lessonAccessibilityGaps({ ...base, captions_vtt: validTrack.captions_vtt }, []);
  assert.equal(missingMetadata.find((gap) => gap.code === "captions_invalid")?.code, "captions_invalid");
  assert.match(missingMetadata.find((gap) => gap.code === "captions_invalid")?.message || "", /idioma das legendas/i);

  const malformedVtt = lessonAccessibilityGaps({ ...base, ...validTrack, captions_vtt: "WEBVTT\n\nsem horário\nTexto" }, []);
  assert.equal(malformedVtt.find((gap) => gap.code === "captions_invalid")?.code, "captions_invalid");
  assert.match(malformedVtt.find((gap) => gap.code === "captions_invalid")?.message || "", /blocos WebVTT/);
  const unreviewed = lessonAccessibilityGaps({ ...base, transcript_reviewed: false, ...validTrack, captions_reviewed: false }, []);
  assert.deepEqual(unreviewed.map((gap) => gap.code), ["transcript_review_missing", "captions_review_missing"]);
});

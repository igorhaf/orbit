const PROVIDER_CAPTION_HOSTS = new Set([
  "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com",
  "vimeo.com", "www.vimeo.com", "player.vimeo.com",
]);

export function validateLessonCaptions(payload: Record<string, unknown>) {
  const vtt = payload.captions_vtt;
  const language = payload.captions_language;
  const label = payload.captions_label;
  const hasCaptions = typeof vtt === "string" && vtt.length > 0;
  const issue = (path: string, message: string) => ({ severity: "error" as const, code: "lesson.captions_invalid", path, message });
  if (!hasCaptions) {
    return language != null && language !== "" || label != null && label !== ""
      ? [issue("captions_vtt", "Idioma e nome só podem ser informados junto com o conteúdo WebVTT da faixa.")]
      : [];
  }
  if (payload.content_type !== "video") return [issue("captions_vtt", "Faixas de legenda só podem ser associadas a aulas em vídeo.")];
  if (typeof payload.content_url !== "string" || !payload.content_url.trim())
    return [issue("content_url", "Informe o endereço do vídeo antes de adicionar uma faixa de legendas.")];
  try {
    const videoUrl = new URL(payload.content_url);
    if (videoUrl.protocol !== "https:" && videoUrl.protocol !== "http:")
      return [issue("content_url", "O endereço do vídeo com legendas deve usar HTTP ou HTTPS.")];
    if (PROVIDER_CAPTION_HOSTS.has(videoUrl.hostname.toLowerCase()))
      return [issue("captions_vtt", "A faixa nativa WebVTT só é exibida em vídeo reproduzido pelo player do navegador; use a transcrição para vídeos incorporados do YouTube ou Vimeo.")];
  } catch {
    return [issue("content_url", "Informe um endereço HTTP ou HTTPS válido para o vídeo com legendas.")];
  }
  if (typeof language !== "string" || language.length > 80 || !language.trim())
    return [issue("captions_language", "Informe o idioma das legendas em uma etiqueta BCP 47, como pt-BR.")];
  try {
    if (Intl.getCanonicalLocales(language.trim()).length !== 1) throw new Error("invalid language");
  } catch {
    return [issue("captions_language", "O idioma das legendas não é uma etiqueta BCP 47 válida, como pt-BR.")];
  }
  if (typeof label !== "string" || !label.trim() || label.length > 120 || /[<>]/.test(label)
    || [...label].some((character) => { const code = character.codePointAt(0)!; return code <= 0x1f || code === 0x7f; }))
    return [issue("captions_label", "Informe um nome simples para a faixa, sem marcação HTML, com até 120 caracteres.")];
  const source = vtt as string;
  if (Buffer.byteLength(source, "utf8") > 100_000 || source.includes("\r") && /\r(?!\n)/.test(source)
    || /[<>]/.test(source.replaceAll("-->", "")) || [...source].some((character) => {
      const code = character.codePointAt(0)!;
      return code <= 0x08 || code === 0x0b || code === 0x0c || code >= 0x0e && code <= 0x1f || code === 0x7f;
    }))
    return [issue("captions_vtt", "O WebVTT deve ser texto simples, sem HTML ou caracteres de controle, e ter no máximo 100 KB.")];
  const normalized = source.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "");
  const header = normalized.match(/^WEBVTT(?:[\t ]+[^\n]*)?\n((?:[^\n]+\n)*)\n/);
  if (!header || header[0].includes("-->"))
    return [issue("captions_vtt", "O conteúdo precisa começar com o cabeçalho WEBVTT e pode incluir um título simples.")];
  const metadataLines = header[1].split("\n").filter(Boolean);
  if (metadataLines.some((line) => !/^[A-Za-z0-9_-]+:[\t ]*[^\n]*$/.test(line)))
    return [issue("captions_vtt", "Os metadados do cabeçalho WebVTT precisam usar o formato chave: valor.")];
  const headerMetadata = new Map<string, string>();
  for (const line of metadataLines) {
    const [key, ...parts] = line.split(":");
    const normalizedKey = key.toLowerCase();
    if (headerMetadata.has(normalizedKey)) return [issue("captions_vtt", "O cabeçalho WebVTT não pode repetir a mesma chave de metadados.")];
    headerMetadata.set(normalizedKey, parts.join(":").trim());
  }
  const declaredLanguage = headerMetadata.get("language");
  if (declaredLanguage) {
    try {
      if (Intl.getCanonicalLocales(declaredLanguage)[0] !== Intl.getCanonicalLocales(language.trim())[0])
        return [issue("captions_language", "O idioma do cabeçalho WebVTT precisa corresponder ao idioma informado para a faixa.")];
    } catch {
      return [issue("captions_language", "O idioma declarado no cabeçalho WebVTT não é uma etiqueta BCP 47 válida.")];
    }
  }
  const blocks = normalized.slice(header[0].length).split(/\n[\t ]*\n/).map((block) => block.trim()).filter(Boolean);
  const cueBlocks = blocks.filter((block) => !/^NOTE(?:[\t ]|$)/.test(block));
  if (!cueBlocks.length) return [issue("captions_vtt", "Inclua pelo menos uma legenda com horário inicial, final e texto.")];
  const timestamp = "(?:(\\d{2,}):)?([0-5]\\d):([0-5]\\d)\\.(\\d{3})";
  // WebVTT requires one or more spaces or tabs around the arrow delimiter.
  const timing = new RegExp(`^${timestamp}[\\t ]+-->[\\t ]+${timestamp}(?:[\\t ]+(.+))?$`);
  const seconds = (match: RegExpMatchArray, offset: number) => {
    const hours = Number(match[offset + 1] || 0), minutes = Number(match[offset + 2]), secs = Number(match[offset + 3]), millis = Number(match[offset + 4]);
    return hours * 3600 + minutes * 60 + secs + millis / 1000;
  };
  let previousStart = -1;
  const cueIds = new Set<string>();
  for (const block of cueBlocks) {
    const lines = block.split("\n");
    const hasCueId = !lines[0].includes("-->");
    const cueId = hasCueId ? lines[0] : "";
    if (hasCueId && (!cueId || cueIds.has(cueId)))
      return [issue("captions_vtt", "Os identificadores dos trechos WebVTT precisam ser únicos e não vazios.")];
    if (hasCueId) cueIds.add(cueId);
    const timingLineIndex = hasCueId ? 1 : 0;
    const cueLine = lines[timingLineIndex] || "";
    const match = cueLine.match(timing);
    const cueText = lines.slice(timingLineIndex + 1).join("\n").trim();
    if (!match || seconds(match, 1) >= seconds(match, 5) || !cueText)
      return [issue("captions_vtt", "Cada faixa precisa conter blocos WebVTT com horários válidos e texto não vazio.")];
    const settings = match[9]?.trim().split(/[\t ]+/).filter(Boolean) || [];
    const settingNames = new Set<string>();
    for (const setting of settings) {
      const separator = setting.indexOf(":");
      const name = setting.slice(0, separator), value = setting.slice(separator + 1);
      if (separator < 1 || !value || settingNames.has(name))
        return [issue("captions_vtt", "As configurações dos trechos WebVTT são inválidas ou repetidas.")];
      settingNames.add(name);
      const percentage = (candidate: string) => /^\d{1,3}(?:\.\d+)?%$/.test(candidate) && Number(candidate.slice(0, -1)) <= 100;
      const lineParts = value.match(/^(auto|-?\d+|\d{1,3}(?:\.\d+)?%)(?:,(start|center|end))?$/);
      const validSetting = name === "line"
        ? Boolean(lineParts && (!lineParts[1].endsWith("%") || Number(lineParts[1].slice(0, -1)) <= 100))
        : name === "position"
          ? value === "auto" || percentage(value) || /^\d{1,3}(?:\.\d+)?%,(?:line-left|center|line-right)$/.test(value)
            && Number(value.split(",", 1)[0].slice(0, -1)) <= 100
          : name === "size" ? percentage(value)
            : name === "align" ? ["start", "center", "end", "left", "right"].includes(value)
              : name === "vertical" ? ["rl", "lr"].includes(value)
                : false;
      if (!validSetting) return [issue("captions_vtt", `A configuração WebVTT “${name}” não é válida.`)];
    }
    const start = seconds(match, 1);
    if (start < previousStart)
      return [issue("captions_vtt", "Ordene as legendas pela sequência de início para que a faixa acompanhe a reprodução do vídeo.")];
    previousStart = start;
  }
  return [];
}

export function isProviderCaptionVideo(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return false;
  try { return PROVIDER_CAPTION_HOSTS.has(new URL(value).hostname.toLowerCase()); }
  catch { return false; }
}

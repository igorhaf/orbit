"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { hasAccessibleText } from "@/lib/accessibility-text";
import SuindaGoogleDriveImport from "./SuindaGoogleDriveImport";

type Material = { id: string; revision: number; file_name: string; mime_type: string; size_bytes: number; scan_status?: string; alt_text?: string };
type MaterialsResponse = { lesson_id: string; revision: number; state: string; content_type?: string; downloadable: boolean; attachments: Material[] };
type AccessibilityDraft = { transcript: string; transcript_reviewed: boolean; captions_vtt: string; captions_language: string; captions_label: string; captions_reviewed: boolean; provider_captions_confirmed: boolean };
const MAX_FILES_PER_BATCH = 20;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TRANSCRIPTION_BYTES = 25_000_000;
const MAX_BATCH_BYTES = 40 * 1024 * 1024;
const TRANSCRIPTION_TYPES = new Set(["mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "webm"]);

function transcriptionMimeType(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (!TRANSCRIPTION_TYPES.has(extension)) return "";
  return ({ mp3: "audio/mpeg", mp4: "video/mp4", mpeg: "audio/mpeg", mpga: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", webm: "video/webm" } as Record<string, string>)[extension];
}

function usesExternalCaptions(url: unknown) {
  if (typeof url !== "string") return false;
  try { return ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com", "vimeo.com", "www.vimeo.com", "player.vimeo.com"].includes(new URL(url).hostname.toLowerCase()); }
  catch { return false; }
}

function validCaptionLanguage(value: string) {
  try { return Intl.getCanonicalLocales(value.trim()).length === 1; }
  catch { return false; }
}

function fileBase64(file: File) {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer); let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return btoa(binary);
  });
}

export default function SuindaLessonMaterials({ lessonId, revision, state, canUpload, payload, onRevisionSaved }: { lessonId: string; revision: number; state: string; canUpload: boolean; payload?: Record<string, unknown>; onRevisionSaved?: () => Promise<void> }) {
  const router = useRouter();
  const [data, setData] = useState<MaterialsResponse | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [altTexts, setAltTexts] = useState<string[]>([]);
  const [existingAltTexts, setExistingAltTexts] = useState<Record<string, string>>({});
  const [savingAltText, setSavingAltText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ completed: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [transcript, setTranscript] = useState("");
  const [transcriptCaptions, setTranscriptCaptions] = useState("");
  const [transcriptCaptionLanguage, setTranscriptCaptionLanguage] = useState("");
  const [transcriptCaptionLabel, setTranscriptCaptionLabel] = useState("");
  const [transcriptCaptionsReviewed, setTranscriptCaptionsReviewed] = useState(false);
  const [accessibilityDraft, setAccessibilityDraft] = useState<AccessibilityDraft>(() => ({
    transcript: typeof payload?.transcript === "string" ? payload.transcript : "",
    transcript_reviewed: payload?.transcript_reviewed === true,
    captions_vtt: typeof payload?.captions_vtt === "string" ? payload.captions_vtt : "",
    captions_language: typeof payload?.captions_language === "string" ? payload.captions_language : "",
    captions_label: typeof payload?.captions_label === "string" ? payload.captions_label : "",
    captions_reviewed: payload?.captions_reviewed === true,
    provider_captions_confirmed: payload?.provider_captions_confirmed === true,
  }));
  const [transcribing, setTranscribing] = useState(false);
  const [applyingTranscript, setApplyingTranscript] = useState(false);
  const load = useCallback(async () => {
    try { setData(await api<MaterialsResponse>(`/extensions/suinda-learning/me/teaching/lessons/${encodeURIComponent(lessonId)}/materials`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar os materiais da aula."); }
  }, [lessonId]);
  useEffect(() => { Promise.resolve().then(load); }, [load]);
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!files.length || busy || revision !== data?.revision || !["draft", "scheduled"].includes(state)) return;
    const selected = [...files];
    if (selected.length > MAX_FILES_PER_BATCH) { setError(`Selecione até ${MAX_FILES_PER_BATCH} arquivos por envio.`); return; }
    if (selected.some((file) => file.size > MAX_FILE_BYTES)) { setError("Cada arquivo pode ter no máximo 8 MB."); return; }
    if (selected.reduce((total, file) => total + file.size, 0) > MAX_BATCH_BYTES) { setError("O conjunto selecionado pode ter no máximo 40 MB."); return; }
    setBusy(true); setError(""); setMessage(""); setUploadProgress({ completed: 0, total: selected.length });
    let completed = 0;
    try {
      for (const file of selected) {
        await api(`/extensions/suinda-learning/me/teaching/lessons/${encodeURIComponent(lessonId)}/materials`, {
          method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), expected_revision: revision, file_name: file.name, mime_type: file.type, data_base64: await fileBase64(file), alt_text: altTexts[selected.indexOf(file)] || "" }),
        });
        completed++;
        setUploadProgress({ completed, total: selected.length });
      }
      setFiles([]); setAltTexts([]); if (inputRef.current) inputRef.current.value = "";
      setMessage(`${completed} ${completed === 1 ? "arquivo anexado" : "arquivos anexados"} e verificados na revisão atual da aula.`);
      await load();
    } catch (cause) {
      setFiles(selected.slice(completed));
      setAltTexts(altTexts.slice(completed));
      if (inputRef.current) inputRef.current.value = "";
      setMessage(completed ? `${completed} ${completed === 1 ? "arquivo foi anexado" : "arquivos foram anexados"}; os restantes continuam selecionados para tentar novamente.` : "");
      setError(cause instanceof Error ? cause.message : "Não foi possível anexar todos os materiais.");
      await load();
    } finally { setBusy(false); setUploadProgress(null); }
  }
  async function saveAltText(item: Material) {
    const altText = (existingAltTexts[item.id] ?? item.alt_text ?? "").trim();
    if (!altText || altText.length > 500 || savingAltText || !data || data.revision !== revision) return;
    setSavingAltText(item.id); setError(""); setMessage("");
    try {
      const result = await api<{ revision: number; attachment_id: string; alt_text: string }>(`/extensions/suinda-learning/me/teaching/lessons/${encodeURIComponent(lessonId)}/materials/${encodeURIComponent(item.id)}/alt-text`, {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), expected_revision: data.revision, alt_text: altText }),
      });
      setData((current) => current ? { ...current, revision: result.revision, attachments: current.attachments.map((attachment) => attachment.id === item.id ? { ...attachment, id: result.attachment_id, revision: result.revision, alt_text: result.alt_text } : { ...attachment, revision: result.revision }) } : current);
      setExistingAltTexts({});
      setMessage("Descrição alternativa salva em uma nova revisão da aula.");
      await onRevisionSaved?.();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar a descrição alternativa.");
      await load();
    } finally { setSavingAltText(""); }
  }
  const editable = canUpload && ["draft", "scheduled"].includes(state) && revision === data?.revision;
  const canTranscribe = canUpload && ["draft", "scheduled", "published"].includes(state) && revision === data?.revision;
  const canUseNativeCaptions = data?.content_type === "video" && !usesExternalCaptions(payload?.content_url);
  async function transcribe() {
    if (!mediaFile || !canTranscribe || busy || transcribing || applyingTranscript) return;
    const mimeType = transcriptionMimeType(mediaFile);
    if (!mimeType) { setError("Escolha áudio ou vídeo em MP3, MP4, MPEG, MPGA, M4A, WAV ou WebM."); return; }
    if (mediaFile.size > MAX_TRANSCRIPTION_BYTES) { setError("O arquivo de áudio ou vídeo pode ter no máximo 25 MB."); return; }
    setTranscribing(true); setError(""); setMessage(""); setTranscript(""); setTranscriptCaptions(""); setTranscriptCaptionLanguage(""); setTranscriptCaptionLabel(""); setTranscriptCaptionsReviewed(false);
    try {
      const result = await api<{ transcript: string; captions_vtt: string | null }>(`/extensions/suinda-learning/me/teaching/lessons/${encodeURIComponent(lessonId)}/transcription`, {
        method: "POST", body: JSON.stringify({ expected_revision: revision, file_name: mediaFile.name, mime_type: mimeType, data_base64: await fileBase64(mediaFile) }),
      });
      if (state === "published") setAccessibilityDraft((current) => ({ ...current, transcript: result.transcript || "", transcript_reviewed: false, ...(canUseNativeCaptions && result.captions_vtt ? { captions_vtt: result.captions_vtt, captions_reviewed: false } : {}) }));
      else {
        setTranscript(result.transcript || "");
        if (canUseNativeCaptions && result.captions_vtt) { setTranscriptCaptions(result.captions_vtt); setTranscriptCaptionsReviewed(false); }
      }
      setMessage(canUseNativeCaptions && result.captions_vtt
        ? "Transcrição e sugestão de legenda prontas. Revise o texto, os tempos e o idioma antes de salvar a nova revisão."
        : "Transcrição pronta para revisão. Confira e edite o texto antes de aplicar à aula.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível transcrever o arquivo.");
    } finally { setTranscribing(false); }
  }
  async function applyTranscript() {
    if (!transcript.trim() || !editable || busy || transcribing || applyingTranscript) return;
    if (transcriptCaptions.trim() && !transcriptCaptionsReviewed) { setError("Confira texto, sons relevantes e tempos da legenda com o vídeo antes de aplicar."); return; }
    if (transcriptCaptions.trim() && (!validCaptionLanguage(transcriptCaptionLanguage) || !transcriptCaptionLabel.trim())) {
      setError("Informe o idioma BCP 47 e o nome da faixa antes de aplicar a legenda."); return;
    }
    setApplyingTranscript(true); setError(""); setMessage("");
    try {
      await api(`/extensions/suinda-learning/me/teaching/lessons/${encodeURIComponent(lessonId)}/transcription/apply`, {
        method: "POST", body: JSON.stringify({ expected_revision: revision, operation_key: crypto.randomUUID(), transcript: transcript.trim(),
          ...(transcriptCaptions.trim() ? { captions_vtt: transcriptCaptions.trim(), captions_language: transcriptCaptionLanguage.trim(), captions_label: transcriptCaptionLabel.trim(), captions_reviewed: true } : {}) }),
      });
      setTranscript(""); setTranscriptCaptions(""); setTranscriptCaptionLanguage(""); setTranscriptCaptionLabel(""); setTranscriptCaptionsReviewed(false); setMediaFile(null);
      setMessage(transcriptCaptions.trim() ? "Transcrição e legenda revisadas aplicadas em uma nova revisão da aula." : "Transcrição revisada aplicada em uma nova revisão da aula.");
      await load();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível aplicar a transcrição à aula.");
      await load();
    } finally { setApplyingTranscript(false); }
  }
  async function savePublishedAccessibility(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state !== "published" || !canUpload || !data || revision !== data.revision || busy || !["audio", "video"].includes(String(data.content_type || ""))) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const changes = data.content_type === "video"
        ? accessibilityDraft
        : { transcript: accessibilityDraft.transcript, transcript_reviewed: accessibilityDraft.transcript_reviewed };
      const result = await api<{ revision: number; payload: Record<string, unknown> }>(`/extensions/suinda-learning/me/teaching/lessons/${encodeURIComponent(lessonId)}/accessibility`, {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), expected_revision: data.revision, ...changes }),
      });
      setAccessibilityDraft({
        transcript: typeof result.payload.transcript === "string" ? result.payload.transcript : "",
        transcript_reviewed: result.payload.transcript_reviewed === true,
        captions_vtt: typeof result.payload.captions_vtt === "string" ? result.payload.captions_vtt : "",
        captions_language: typeof result.payload.captions_language === "string" ? result.payload.captions_language : "",
        captions_label: typeof result.payload.captions_label === "string" ? result.payload.captions_label : "",
        captions_reviewed: result.payload.captions_reviewed === true,
        provider_captions_confirmed: result.payload.provider_captions_confirmed === true,
      });
      setMessage("Acessibilidade corrigida em uma nova revisão publicada.");
      await load();
      await onRevisionSaved?.();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar a correção de acessibilidade.");
      await load();
    } finally { setBusy(false); }
  }
  const providerCaptionVideo = data?.content_type === "video" && usesExternalCaptions(payload?.content_url);
  const originalAccessibility: AccessibilityDraft = {
    transcript: typeof payload?.transcript === "string" ? payload.transcript : "",
    transcript_reviewed: payload?.transcript_reviewed === true,
    captions_vtt: typeof payload?.captions_vtt === "string" ? payload.captions_vtt : "",
    captions_language: typeof payload?.captions_language === "string" ? payload.captions_language : "",
    captions_label: typeof payload?.captions_label === "string" ? payload.captions_label : "",
    captions_reviewed: payload?.captions_reviewed === true,
    provider_captions_confirmed: payload?.provider_captions_confirmed === true,
  };
  const accessibilityChanged = accessibilityDraft.transcript !== originalAccessibility.transcript
    || accessibilityDraft.transcript_reviewed !== originalAccessibility.transcript_reviewed
    || accessibilityDraft.captions_vtt !== originalAccessibility.captions_vtt
    || accessibilityDraft.captions_language !== originalAccessibility.captions_language
    || accessibilityDraft.captions_label !== originalAccessibility.captions_label
    || accessibilityDraft.captions_reviewed !== originalAccessibility.captions_reviewed
    || accessibilityDraft.provider_captions_confirmed !== originalAccessibility.provider_captions_confirmed;
  return <section className="space-y-3 rounded-lg border border-[#3b4754] bg-white/[0.03] p-4" aria-label="Materiais didáticos da aula">
    <div><h3 className="text-sm font-semibold">Materiais da aula</h3><p className="mt-1 text-xs text-[#9fadbc]">Arquivos ficam presos à revisão da aula, passam por validação e scanner e só podem ser incluídos antes da publicação.</p></div>
    {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
    {data?.attachments.length ? <ul className="grid gap-2">{data.attachments.map((item) => <li key={`${item.id}:${item.revision}`} className="flex flex-wrap justify-between gap-2 rounded-lg border border-white/[0.07] px-3 py-2 text-xs"><span className="min-w-0 flex-1 break-all">{item.file_name}{item.mime_type.startsWith("image/") && <><span className="mt-1 block text-[#9fadbc]">Descrição alternativa: {hasAccessibleText(item.alt_text) ? item.alt_text : "não informada"}</span>{canUpload && revision === data.revision && <div className="mt-2 flex flex-wrap items-end gap-2"><label className="grid min-w-64 flex-1 gap-1 text-[#b6c2cf]">Corrigir descrição alternativa<input value={existingAltTexts[item.id] ?? (hasAccessibleText(item.alt_text) ? item.alt_text : "")} maxLength={500} onChange={(event) => setExistingAltTexts((current) => ({ ...current, [item.id]: event.target.value }))} className="min-h-10 rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-xs text-white" placeholder="Descreva o conteúdo e a finalidade da imagem" /></label><button type="button" disabled={savingAltText !== "" || !hasAccessibleText(existingAltTexts[item.id] ?? item.alt_text)} onClick={() => void saveAltText(item)} className="min-h-10 rounded-lg border border-cyan-200/40 px-3 text-xs text-cyan-100 disabled:opacity-50">{savingAltText === item.id ? "Salvando…" : "Salvar em nova revisão"}</button></div>}</>}</span><span className="text-[#9fadbc]">v{item.revision} · {(item.size_bytes / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB · {item.scan_status === "clean" ? "verificado" : "scanner não configurado"}</span></li>)}</ul> : <p className="text-xs text-[#9fadbc]">Nenhum material anexado nesta revisão.</p>}
    {canUpload && ["draft", "scheduled"].includes(state) && <form onSubmit={(event) => void upload(event)} className="grid gap-2"><label className="block text-xs text-[#b6c2cf]">PDF, imagens, PPTX ou material de apoio: até {MAX_FILES_PER_BATCH} arquivos, 8 MB cada e 40 MB por envio<input ref={inputRef} type="file" multiple disabled={busy} accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.docx,.xlsx,.pptx" onChange={(event) => { const selected = Array.from(event.target.files || []); setError(""); if (selected.length > MAX_FILES_PER_BATCH) setError(`Selecione até ${MAX_FILES_PER_BATCH} arquivos por envio.`); else if (selected.some((file) => file.size > MAX_FILE_BYTES)) setError("Cada arquivo pode ter no máximo 8 MB."); else if (selected.reduce((total, file) => total + file.size, 0) > MAX_BATCH_BYTES) setError("O conjunto selecionado pode ter no máximo 40 MB."); setFiles(selected); setAltTexts(selected.map(() => "")); }} className="mt-1 block min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-2 py-2 text-xs text-[#b6c2cf] file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-xs file:text-white" /></label>
      {!!files.length && <div className="grid gap-2">{files.map((file, index) => <div key={`${file.name}:${file.size}:${file.lastModified}`} className="text-xs text-[#9fadbc]">{file.name} · {(file.size / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB{file.type.startsWith("image/") && <label className="mt-2 grid gap-1 text-[#b6c2cf]">Descrição da imagem para leitor de tela<input value={altTexts[index] || ""} maxLength={500} onChange={(event) => setAltTexts((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} className="min-h-10 rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-xs text-white" placeholder="Descreva o conteúdo e a finalidade da imagem" /></label>}</div>)}</div>}
      {uploadProgress && <p role="status" aria-live="polite" className="text-xs text-cyan-100">Anexando arquivo {uploadProgress.completed + 1} de {uploadProgress.total}…</p>}
      {files.some((file, index) => file.type.startsWith("image/") && !hasAccessibleText(altTexts[index])) && <p className="text-xs text-amber-100">Descreva cada imagem antes de anexá-la; essa descrição será lida por quem usa leitor de tela.</p>}
      <button type="submit" disabled={busy || !files.length || files.length > MAX_FILES_PER_BATCH || files.some((file) => file.size > MAX_FILE_BYTES) || files.some((file, index) => file.type.startsWith("image/") && !hasAccessibleText(altTexts[index])) || files.reduce((total, file) => total + file.size, 0) > MAX_BATCH_BYTES || revision !== data?.revision} className="min-h-10 justify-self-start rounded-lg bg-cyan-200 px-4 text-xs font-semibold text-slate-950 disabled:opacity-50">{busy ? "Verificando…" : `Anexar ${files.length || "materiais"}`}</button></form>}
    {canUpload && ["draft", "scheduled"].includes(state) && <div className="grid gap-2 rounded-lg border border-white/[0.07] p-3" aria-label="Transcrever áudio ou vídeo da aula">
      <div><h4 className="text-xs font-semibold text-white">Transcrição de áudio e vídeo</h4><p className="mt-1 text-xs text-[#9fadbc]">Selecione um arquivo de até 25 MB. A transcrição fica como rascunho para você revisar e editar antes de ser aplicada à aula.</p></div>
      <label className="block text-xs text-[#b6c2cf]">Arquivo de áudio ou vídeo<input type="file" disabled={!editable || busy || transcribing || applyingTranscript} accept=".mp3,.mp4,.mpeg,.mpga,.m4a,.wav,.webm,audio/mpeg,audio/mp4,audio/wav,audio/webm,video/mp4,video/webm" onChange={(event) => { const selected = event.target.files?.[0] || null; setMediaFile(selected); setTranscript(""); setError(""); if (selected && !transcriptionMimeType(selected)) setError("Formato não aceito. Use MP3, MP4, MPEG, MPGA, M4A, WAV ou WebM."); else if (selected && selected.size > MAX_TRANSCRIPTION_BYTES) setError("O arquivo de áudio ou vídeo pode ter no máximo 25 MB."); }} className="mt-1 block min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-2 py-2 text-xs text-[#b6c2cf] file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-xs file:text-white" /></label>
      {mediaFile && <p className="text-xs text-[#9fadbc]">{mediaFile.name} · {(mediaFile.size / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB</p>}
      <button type="button" onClick={() => void transcribe()} disabled={!mediaFile || !editable || busy || transcribing || applyingTranscript || mediaFile.size > MAX_TRANSCRIPTION_BYTES || !transcriptionMimeType(mediaFile)} className="min-h-10 justify-self-start rounded-lg bg-cyan-200 px-4 text-xs font-semibold text-slate-950 disabled:opacity-50">{transcribing ? "Transcrevendo…" : "Gerar transcrição para revisar"}</button>
      {transcribing && <p role="status" aria-live="polite" className="text-xs text-cyan-100">Enviando o arquivo e gerando a transcrição…</p>}
      {transcript !== "" && <><label htmlFor="suinda-transcription-review" className="text-xs text-[#b6c2cf]">Revise e edite a transcrição antes de aplicar</label><textarea id="suinda-transcription-review" value={transcript} onChange={(event) => setTranscript(event.target.value)} rows={8} maxLength={50000} disabled={!editable || applyingTranscript} className="min-h-36 rounded-lg border border-[#3b4754] bg-[#1d2125] p-3 text-sm leading-6 text-white disabled:opacity-60" />{canUseNativeCaptions && <fieldset className="grid gap-2 rounded-lg border border-white/[0.07] p-3"><legend className="px-1 text-xs font-semibold text-white">Legenda WebVTT — revise texto e tempos</legend><label htmlFor="suinda-transcription-captions" className="grid gap-1 text-xs text-[#b6c2cf]">Conteúdo da faixa<textarea id="suinda-transcription-captions" value={transcriptCaptions} onChange={(event) => { setTranscriptCaptions(event.target.value); setTranscriptCaptionsReviewed(false); }} maxLength={100000} rows={7} disabled={!editable || applyingTranscript} className="min-h-32 rounded-lg border border-[#3b4754] bg-[#1d2125] p-3 font-mono text-xs leading-5 text-white disabled:opacity-60" placeholder={"WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nTexto da legenda"} /></label><div className="grid gap-2 sm:grid-cols-2"><label className="grid gap-1 text-xs text-[#b6c2cf]">Idioma da legenda (BCP 47)<input value={transcriptCaptionLanguage} onChange={(event) => { setTranscriptCaptionLanguage(event.target.value); setTranscriptCaptionsReviewed(false); }} maxLength={80} disabled={!editable || applyingTranscript} className="min-h-10 rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-white disabled:opacity-60" placeholder="pt-BR" /></label><label className="grid gap-1 text-xs text-[#b6c2cf]">Nome da faixa<input value={transcriptCaptionLabel} onChange={(event) => { setTranscriptCaptionLabel(event.target.value); setTranscriptCaptionsReviewed(false); }} maxLength={120} disabled={!editable || applyingTranscript} className="min-h-10 rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-white disabled:opacity-60" placeholder="Português (Brasil)" /></label></div><p className="text-xs text-[#9fadbc]">A legenda só será salva com idioma e nome da faixa. Compare cada trecho com o vídeo antes de aplicar.</p><label className="flex items-start gap-2 text-xs leading-5 text-[#b6c2cf]"><input type="checkbox" checked={transcriptCaptionsReviewed} onChange={(event) => setTranscriptCaptionsReviewed(event.target.checked)} className="mt-1 size-4 accent-cyan-200" />Conferi texto, sons relevantes e sincronização com o vídeo.</label></fieldset>}<button type="button" onClick={() => void applyTranscript()} disabled={!transcript.trim() || Boolean(transcriptCaptions.trim() && (!transcriptCaptionsReviewed || !validCaptionLanguage(transcriptCaptionLanguage) || !transcriptCaptionLabel.trim())) || !editable || busy || transcribing || applyingTranscript} className="min-h-10 justify-self-start rounded-lg bg-cyan-200 px-4 text-xs font-semibold text-slate-950 disabled:opacity-50">{applyingTranscript ? "Aplicando…" : transcriptCaptions.trim() ? "Aplicar transcrição e legenda revisadas" : "Aplicar transcrição revisada à aula"}</button></>}
      {!editable && <p className="text-xs text-amber-100">A transcrição exige uma aula em rascunho ou agendada e a revisão atual carregada.</p>}
    </div>}
    {canUpload && state === "published" && data && ["audio", "video"].includes(data.content_type || "") && <form onSubmit={(event) => void savePublishedAccessibility(event)} className="grid gap-3 rounded-lg border border-cyan-200/20 bg-cyan-200/[0.03] p-3" aria-label="Corrigir acessibilidade da aula publicada">
      <div><h4 className="text-xs font-semibold text-white">Acessibilidade da aula publicada</h4><p className="mt-1 text-xs leading-5 text-[#9fadbc]">A revisão atual continua disponível enquanto você corrige. Depois da validação, a nova revisão permanece publicada; confira transcrição e legenda antes de salvar.</p></div>
      <label htmlFor={`published-transcript-${lessonId}`} className="grid gap-1 text-xs text-[#b6c2cf]">Transcrição da aula<textarea id={`published-transcript-${lessonId}`} value={accessibilityDraft.transcript} maxLength={50000} rows={7} onChange={(event) => setAccessibilityDraft((current) => ({ ...current, transcript: event.target.value, transcript_reviewed: false }))} className="min-h-32 rounded-lg border border-[#3b4754] bg-[#1d2125] p-3 text-sm leading-6 text-white" placeholder="Transcreva o conteúdo falado e as informações visuais relevantes." /></label>
      <label className="flex items-start gap-2 text-xs leading-5 text-[#b6c2cf]"><input type="checkbox" checked={accessibilityDraft.transcript_reviewed} onChange={(event) => setAccessibilityDraft((current) => ({ ...current, transcript_reviewed: event.target.checked }))} className="mt-1 size-4 accent-cyan-200" />Conferi a transcrição com a aula e incluí falas e informações visuais relevantes.</label>
      {data.content_type === "video" && (providerCaptionVideo
        ? <label className="flex items-start gap-2 text-xs leading-5 text-[#b6c2cf]"><input type="checkbox" checked={accessibilityDraft.provider_captions_confirmed} onChange={(event) => setAccessibilityDraft((current) => ({ ...current, provider_captions_confirmed: event.target.checked, captions_reviewed: false }))} className="mt-1 size-4 accent-cyan-200" />Confirmei no player do YouTube/Vimeo que existe uma faixa de legendas e que ela pode ser ativada.</label>
        : <><label htmlFor={`published-captions-${lessonId}`} className="grid gap-1 text-xs text-[#b6c2cf]">Legenda WebVTT<textarea id={`published-captions-${lessonId}`} value={accessibilityDraft.captions_vtt} maxLength={100000} rows={7} onChange={(event) => setAccessibilityDraft((current) => ({ ...current, captions_vtt: event.target.value, captions_reviewed: false }))} className="min-h-32 rounded-lg border border-[#3b4754] bg-[#1d2125] p-3 font-mono text-xs leading-5 text-white" placeholder={"WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nTexto da legenda"} /></label><div className="grid gap-2 sm:grid-cols-2"><label className="grid gap-1 text-xs text-[#b6c2cf]">Idioma da legenda<input value={accessibilityDraft.captions_language} maxLength={80} onChange={(event) => setAccessibilityDraft((current) => ({ ...current, captions_language: event.target.value, captions_reviewed: false }))} className="min-h-10 rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-white" placeholder="pt-BR" /></label><label className="grid gap-1 text-xs text-[#b6c2cf]">Nome da faixa<input value={accessibilityDraft.captions_label} maxLength={120} onChange={(event) => setAccessibilityDraft((current) => ({ ...current, captions_label: event.target.value, captions_reviewed: false }))} className="min-h-10 rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-white" placeholder="Português (Brasil)" /></label></div></>)}
      {data.content_type === "video" && <label className="flex items-start gap-2 text-xs leading-5 text-[#b6c2cf]"><input type="checkbox" checked={accessibilityDraft.captions_reviewed} onChange={(event) => setAccessibilityDraft((current) => ({ ...current, captions_reviewed: event.target.checked }))} className="mt-1 size-4 accent-cyan-200" />Conferi a faixa de legendas atual com o vídeo, incluindo palavras, sons relevantes e sincronização.</label>}
      <div className="grid gap-2 rounded-lg border border-white/[0.07] p-3"><div><h5 className="text-xs font-semibold text-white">Gerar sugestão de transcrição</h5><p className="mt-1 text-xs text-[#9fadbc]">A transcrição automática é uma sugestão. Revise e corrija o texto antes de salvar.</p></div><label className="block text-xs text-[#b6c2cf]">Áudio/vídeo de até 25 MB<input type="file" disabled={!canTranscribe || busy || transcribing} accept=".mp3,.mp4,.mpeg,.mpga,.m4a,.wav,.webm,audio/mpeg,audio/mp4,audio/wav,audio/webm,video/mp4,video/webm" onChange={(event) => { const selected = event.target.files?.[0] || null; setMediaFile(selected); setError(""); if (selected && !transcriptionMimeType(selected)) setError("Formato não aceito. Use MP3, MP4, MPEG, MPGA, M4A, WAV ou WebM."); else if (selected && selected.size > MAX_TRANSCRIPTION_BYTES) setError("O arquivo de áudio ou vídeo pode ter no máximo 25 MB."); }} className="mt-1 block min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-2 py-2 text-xs text-[#b6c2cf] file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-xs file:text-white" /></label>{mediaFile && <p className="text-xs text-[#9fadbc]">{mediaFile.name} · {(mediaFile.size / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB</p>}<button type="button" onClick={() => void transcribe()} disabled={!mediaFile || !canTranscribe || busy || transcribing || mediaFile.size > MAX_TRANSCRIPTION_BYTES || !transcriptionMimeType(mediaFile)} className="min-h-10 justify-self-start rounded-lg border border-cyan-200/40 px-3 text-xs text-cyan-100 disabled:opacity-50">{transcribing ? "Transcrevendo…" : "Gerar sugestão para revisar"}</button>{transcribing && <p role="status" aria-live="polite" className="text-xs text-cyan-100">Enviando o arquivo e gerando a sugestão…</p>}</div>
      <button type="submit" disabled={busy || !accessibilityChanged || revision !== data.revision} className="min-h-10 justify-self-start rounded-lg bg-cyan-200 px-4 text-xs font-semibold text-slate-950 disabled:opacity-50">{busy ? "Validando…" : "Salvar correções em nova revisão publicada"}</button>
    </form>}
    {canUpload && data && revision === data.revision && <SuindaGoogleDriveImport lessonId={lessonId} revision={revision} onImported={() => void load()} />}
    {message && <p role="status" className="text-xs text-emerald-200">{message}</p>}
  </section>;
}

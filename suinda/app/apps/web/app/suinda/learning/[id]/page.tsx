"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Check, CheckCircle2, ChevronLeft, ChevronRight, Circle, Clock3, Download, Flag, LockKeyhole, MessageCircle, Pin, Play, RefreshCw, Send, Sparkles, ThumbsUp, UserRound, Users } from "lucide-react";
import { api, apiBlob } from "@/lib/api";
import { Modal } from "@/components/ui";
import { findVimeoCaptionsTrack, googleDrivePreviewUrl, youtubeCaptionEmbedUrl } from "@/lib/media-embeds";
import { hasAccessibleText } from "@/lib/accessibility-text";
import { SuindaMarkdownArticle } from "@/plugins/suinda/SuindaMarkdownArticle";

type Lesson = {
  id: string;
  title: string;
  revision: number;
  state: string;
  completed: boolean;
  required: boolean;
  available: boolean;
  payload: {
    position?: number;
    content_type?: string;
    workload_minutes?: number;
    objectives?: string[];
    competencies?: string[];
    skills?: string[];
    release_at?: string;
    content_url?: string | null;
    body_markdown?: string | null;
    transcript?: string | null;
    captions_vtt?: string | null;
    captions_language?: string | null;
    captions_label?: string | null;
    provider_captions_confirmed?: boolean;
    downloadable?: boolean;
    media_progress?: { position_seconds?: number; watched_seconds?: number; duration_seconds?: number; percent?: number } | null;
    unit_record_id?: string | null;
    attachments?: Array<{ id: string; revision: number; file_name: string; mime_type: string; size_bytes: number; alt_text?: string }>;
  };
};
type Module = {
  id: string;
  title: string;
  completed: boolean;
  available: boolean;
  progress: { required_total: number; required_completed: number; percent: number };
  payload: { position?: number; summary?: string | null; objectives?: string[]; competencies?: string[]; skills?: string[]; workload_hours?: number };
  units: Array<{ id: string; title: string; payload: { position?: number; summary?: string | null; objectives?: string[]; competencies?: string[]; skills?: string[] }; lessons: Lesson[] }>;
  lessons: Lesson[];
};
type Learning = {
  enrollment: { id: string; title: string; state: string };
  last_lesson_id?: string | null;
  course: { id: string; title: string; payload: { description?: string; workload_hours?: number; attendance_min_percent?: number; objectives?: string[]; competencies?: string[]; skills?: string[] } };
  live_sessions: Array<{ id: string; title: string; state: string; starts_at?: string; ends_at?: string; meeting_provider?: string; meeting_url?: string | null; recording_url?: string | null }>;
  modules: Module[];
  progress: { required_total: number; required_completed: number; percent: number };
  attendance: { percent: number | null; minimum_percent: number; attended_minutes: number; scheduled_minutes: number; sessions_present: number; sessions_absent: number; sessions_unmarked: number; meets_minimum: boolean | null };
  workload_progress: { attended_class_hours: number; validated_practice_hours: number; credited_practice_hours?: number; completed_hours: number };
  submissions: Array<{ id: string; title: string; assessment_title: string; state: string; score?: number; feedback?: string | null; submitted_at?: string; graded_at?: string; version?: number; rubric?: Array<{ id: string; criterion: string; description?: string; points: number }>; criterion_scores?: Array<{ criterion_id: string; score: number; feedback?: string }> }>;
  assignments: Array<{ id: string; title: string; payload: { instructions?: string; due_at?: string; group_submission?: boolean; rubric?: Array<{ id: string; criterion: string; description?: string; points: number }> }; groups: Array<{ id: string; title: string; member_count: number }>; submission: null | { id: string; state: string; revision: number; answer?: string; submitted_at?: string; late?: boolean; version?: number; score?: number; feedback?: string | null; group_id?: string; rubric_snapshot?: Array<{ id: string; criterion: string; description?: string; points: number }>; criterion_scores?: Array<{ criterion_id: string; score: number; feedback?: string }>; graded_at?: string; files?: Array<{ id: string; file_name: string; mime_type: string; size_bytes: number }> } }>;
  practices: Array<{ id: string; revision: number; title: string; state: string; scheduled_at?: string; location?: string; supervisor_user_id?: string; activity_description: string; completion_notes?: string; hours_claimed?: number; hours_validated?: number; validation_outcome?: string; review_feedback?: string; submitted_at?: string; reviewed_at?: string }>;
};

function dateLabel(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

type MediaProgress = { position_seconds: number; watched_seconds: number; duration_seconds: number; percent: number };
type YouTubePlayer = {
  getCurrentTime(): number; getDuration(): number; getPlayerState(): number; seekTo(seconds: number, allowSeekAhead: boolean): void; destroy(): void;
};
type YouTubePlayerError = { data?: number };
type VimeoPlayer = {
  on(event: "play" | "pause" | "ended" | "loaded", callback: (event?: { seconds?: number; duration?: number }) => void): void;
  off(event: "play" | "pause" | "ended" | "loaded", callback: (event?: { seconds?: number; duration?: number }) => void): void;
  ready(): Promise<void>;
  getTextTracks(): Promise<Array<{ language: string; kind: string; label?: string }>>;
  enableTextTrack(language: string, kind?: "captions" | "subtitles"): Promise<{ language: string; kind: string; label?: string }>;
  getCurrentTime(): Promise<number>; getDuration(): Promise<number>; setCurrentTime(seconds: number): Promise<number>; destroy(): Promise<void>;
};

declare global {
  interface Window {
    YT?: { Player: new (element: string | HTMLElement, options: { events: { onReady: (event: { target: YouTubePlayer }) => void; onStateChange: (event: { target: YouTubePlayer; data: number }) => void; onError: (event: YouTubePlayerError) => void } }) => YouTubePlayer };
    onYouTubeIframeAPIReady?: () => void;
    Vimeo?: { Player: new (element: HTMLIFrameElement) => VimeoPlayer };
  }
}

let youtubeApiLoad: Promise<void> | null = null;
let vimeoApiLoad: Promise<void> | null = null;

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve();
  if (!youtubeApiLoad) youtubeApiLoad = new Promise<void>((resolve, reject) => {
    let done = false;
    const timer = window.setTimeout(() => finish(new Error("O player do YouTube demorou para carregar.")), 15000);
    const finish = (error?: Error) => {
      if (done) return;
      done = true; window.clearTimeout(timer);
      if (error) { youtubeApiLoad = null; reject(error); }
      else resolve();
    };
    const previous = window.onYouTubeIframeAPIReady;
    const onReady = () => {
      try { previous?.(); }
      finally {
        if (window.onYouTubeIframeAPIReady === onReady) window.onYouTubeIframeAPIReady = previous;
        if (window.YT?.Player) finish(); else finish(new Error("A API do player do YouTube não ficou disponível."));
      }
    };
    window.onYouTubeIframeAPIReady = onReady;
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api"; script.async = true;
    script.onerror = () => {
      if (window.onYouTubeIframeAPIReady === onReady) window.onYouTubeIframeAPIReady = previous;
      finish(new Error("Não foi possível carregar o player do YouTube."));
    };
    document.head.appendChild(script);
  });
  return youtubeApiLoad;
}

function loadVimeoApi() {
  if (window.Vimeo?.Player) return Promise.resolve();
  if (!vimeoApiLoad) vimeoApiLoad = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://player.vimeo.com/api/player.js"; script.async = true;
    const timer = window.setTimeout(() => { vimeoApiLoad = null; reject(new Error("O player do Vimeo demorou para carregar.")); }, 15000);
    script.onload = () => { window.clearTimeout(timer); if (window.Vimeo?.Player) resolve(); else reject(new Error("A API do player do Vimeo não ficou disponível.")); };
    script.onerror = () => { window.clearTimeout(timer); vimeoApiLoad = null; reject(new Error("Não foi possível carregar o player do Vimeo.")); };
    document.head.appendChild(script);
  });
  return vimeoApiLoad;
}

function embedUrl(value: string, type?: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (type !== "video") return null;
    if (["www.youtube.com", "youtube.com", "m.youtube.com"].includes(url.hostname)) {
      const video = url.searchParams.get("v");
      if (video && /^[a-zA-Z0-9_-]{11}$/.test(video)) return `https://www.youtube-nocookie.com/embed/${video}`;
      const short = url.pathname.match(/^\/embed\/([a-zA-Z0-9_-]{11})$/);
      if (short) return `https://www.youtube-nocookie.com/embed/${short[1]}`;
    }
    if (url.hostname === "youtu.be") {
      const video = url.pathname.slice(1);
      if (/^[a-zA-Z0-9_-]{11}$/.test(video)) return `https://www.youtube-nocookie.com/embed/${video}`;
    }
    if (url.hostname === "vimeo.com" || url.hostname === "www.vimeo.com") {
      const video = url.pathname.match(/^\/(\d+)\/?$/)?.[1];
      if (video) return `https://player.vimeo.com/video/${video}`;
    }
  } catch { return null; }
  return null;
}

function embeddedVideoProvider(value: string): "youtube" | "vimeo" | null {
  try {
    const hostname = new URL(value).hostname;
    if (["www.youtube.com", "youtube.com", "m.youtube.com", "youtu.be", "www.youtube-nocookie.com", "youtube-nocookie.com"].includes(hostname)) return "youtube";
    if (["vimeo.com", "www.vimeo.com", "player.vimeo.com"].includes(hostname)) return "vimeo";
  } catch { return null; }
  return null;
}

function safeContentUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch { return null; }
}

function safeWebVtt(value?: string | null) {
  if (typeof value !== "string" || !value.length || value.length > 100_000
    || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.replaceAll("-->", "")) || /\r(?!\n)/.test(value)) return false;
  return /^WEBVTT(?:[\t ]+[^\n]*)?\n/.test(value.replace(/\r\n/g, "\n").replace(/^\uFEFF/, ""));
}

function GoogleDriveEmbed({ src, sourceUrl, title, externalVideo = false }: { src: string; sourceUrl: string; title: string; externalVideo?: boolean }) {
  return <section aria-label="Pré-visualização do Google Drive" className="mt-5 overflow-hidden rounded-xl border border-[#3b4754] bg-[#1d2125]">
    <iframe title={`Pré-visualização: ${title}`} src={src} loading="lazy" referrerPolicy="no-referrer"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads" allowFullScreen
      className="h-[65vh] min-h-[24rem] w-full border-b border-[#3b4754] bg-white" />
    <div className="flex flex-wrap items-center justify-between gap-3 p-3"><p className="max-w-2xl text-xs text-[#9fadbc]">Prévia fornecida pelo Google; disponibilidade e permissões dependem do compartilhamento do arquivo.{externalVideo ? " O tempo de reprodução não é sincronizado pelo Orbit; use Marcar como concluída para registrar a aula." : ""}</p>
      <a href={sourceUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-cyan-200/20 px-3 text-xs font-medium text-cyan-100 hover:bg-cyan-200/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Abrir no Google Drive <ArrowUpRight size={14} aria-hidden="true" /></a></div>
  </section>;
}

export default function SuindaLearningPage() {
  const params = useParams<{ id: string }>();
  const enrollmentId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [learning, setLearning] = useState<Learning | null>(null);
  const [selectedLessonId, setSelectedLessonId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reminderSessionId, setReminderSessionId] = useState("");
  const [activeGalleryIndex, setActiveGalleryIndex] = useState<number | null>(null);
  const [materialPreviews, setMaterialPreviews] = useState<{ lessonId: string; urls: Record<string, string>; slides: Record<string, string[]>; slideCounts: Record<string, number>; slideTexts: Record<string, string[]> }>({ lessonId: "", urls: {}, slides: {}, slideCounts: {}, slideTexts: {} });
  const bookmarkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lessons = useMemo(() => learning?.modules.flatMap((module) => module.lessons) || [], [learning]);
  const currentLesson = lessons.find((lesson) => lesson.id === selectedLessonId) || null;
  const contentUrl = safeContentUrl(currentLesson?.payload.content_url);
  const googlePreviewUrl = currentLesson && ["video", "link", "pdf", "presentation"].includes(currentLesson.payload.content_type || "") && contentUrl
    ? googleDrivePreviewUrl(contentUrl) : null;
  const galleryFiles = currentLesson?.payload.content_type === "gallery"
    ? (currentLesson.payload.attachments || []).filter((file) => file.mime_type.startsWith("image/")) : [];

  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    const lesson = currentLesson;
    const presentationMime = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    const files = lesson?.payload.attachments?.filter((file) => ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif", presentationMime].includes(file.mime_type)) || [];
    Promise.all(files.slice(0, 20).map(async (file): Promise<[string, string[], number, string[]]> => {
      const slideUrls: string[] = [];
      const slideTexts: string[] = [];
      try {
        const blob = await apiBlob(`/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/lessons/${encodeURIComponent(lesson!.id)}/materials/${encodeURIComponent(file.id)}/preview`);
        if (file.mime_type === presentationMime) {
          const [{ loadPresentation, getSlides }, { renderSlideToSvg, defaultMeasurer }] = await Promise.all([import("@office-kit/pptx"), import("@office-kit/pptx-preview")]);
          const presentation = await loadPresentation(new Uint8Array(await blob.arrayBuffer()));
          const slides = getSlides(presentation);
          if (!slides.length) return [file.id, [], 0, []];
          for (const slide of slides.slice(0, 30)) {
            const svg = renderSlideToSvg(presentation, slide, { textLayout: "svg", measureText: defaultMeasurer });
            const svgDocument = new DOMParser().parseFromString(svg, "image/svg+xml");
            const text = Array.from(svgDocument.querySelectorAll("text"))
              .map((node) => node.textContent?.replace(/\s+/g, " ").trim() || "")
              .filter(Boolean)
              .join(" ");
            slideTexts.push(text);
            const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
            created.push(url);
            slideUrls.push(url);
          }
          return [file.id, slideUrls, slides.length, slideTexts];
        }
        const url = URL.createObjectURL(blob); created.push(url); return [file.id, [url], 0, []];
      } catch {
        for (const url of slideUrls) { URL.revokeObjectURL(url); const index = created.indexOf(url); if (index >= 0) created.splice(index, 1); }
        return [file.id, [], 0, []];
      }
    })).then((entries) => {
      if (!cancelled && lesson) {
        const urls: Record<string, string> = {};
        const slides: Record<string, string[]> = {};
        const slideCounts: Record<string, number> = {};
        const slideTexts: Record<string, string[]> = {};
        for (const [fileId, values, slideCount, texts] of entries) {
          if (slideCount) slides[fileId] = values;
          else if (values[0]) urls[fileId] = values[0];
          if (slideCount) {
            slideCounts[fileId] = slideCount;
            slideTexts[fileId] = texts;
          }
        }
        setMaterialPreviews({ lessonId: lesson.id, urls, slides, slideCounts, slideTexts });
      } else {
        for (const url of created) URL.revokeObjectURL(url);
      }
    });
    return () => { cancelled = true; for (const url of created) URL.revokeObjectURL(url); };
  }, [currentLesson, enrollmentId]);

  async function downloadMaterial(file: NonNullable<Lesson["payload"]["attachments"]>[number]) {
    if (!currentLesson?.payload.downloadable) return;
    setError("");
    try {
      const blob = await apiBlob(`/extensions/suinda-learning/records/${encodeURIComponent(currentLesson.id)}/attachments/${file.revision}/${encodeURIComponent(file.id)}`);
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.file_name; anchor.click(); URL.revokeObjectURL(url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível baixar o material."); }
  }

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api<Learning>(`/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/learning`)
      .then((data) => {
        setLearning(data);
        setReminderSessionId(new URLSearchParams(window.location.search).get("reminder") || "");
        const savedId = localStorage.getItem(`suinda:last-lesson:${enrollmentId}`) || "";
        const candidate = data.modules.flatMap((module) => module.lessons).find((lesson) => lesson.id === data.last_lesson_id && lesson.available)
          || data.modules.flatMap((module) => module.lessons).find((lesson) => lesson.id === savedId && lesson.available)
          || data.modules.flatMap((module) => module.lessons).find((lesson) => lesson.available && !lesson.completed)
          || data.modules.flatMap((module) => module.lessons).find((lesson) => lesson.available);
        if (candidate) {
          setSelectedLessonId(candidate.id);
          localStorage.setItem(`suinda:last-lesson:${enrollmentId}`, candidate.id);
        }
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Não foi possível abrir este curso."))
      .finally(() => setLoading(false));
  }, [enrollmentId]);

  useEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.theme;
    root.dataset.theme = "dark";
    Promise.resolve().then(load);
    return () => {
      if (bookmarkTimer.current) clearTimeout(bookmarkTimer.current);
      if (previous) root.dataset.theme = previous;
      else delete root.dataset.theme;
    };
  }, [load]);

  function selectLesson(lesson: Lesson) {
    if (!lesson.available) return;
    setActiveGalleryIndex(null);
    setSelectedLessonId(lesson.id);
    setMessage("");
    localStorage.setItem(`suinda:last-lesson:${enrollmentId}`, lesson.id);
    if (bookmarkTimer.current) clearTimeout(bookmarkTimer.current);
    bookmarkTimer.current = setTimeout(() => {
      void api(`/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/lessons/${encodeURIComponent(lesson.id)}/bookmark`, {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID() }),
      }).catch((reason: unknown) => setMessage(reason instanceof Error ? `Aula salva neste dispositivo. A sincronização falhou: ${reason.message}` : "Aula salva neste dispositivo; não foi possível sincronizar entre dispositivos."));
    }, 350);
  }

  useEffect(() => {
    if (activeGalleryIndex === null || galleryFiles.length < 2) return;
    const navigateGallery = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") setActiveGalleryIndex((index) => index === null ? null : (index + galleryFiles.length - 1) % galleryFiles.length);
      if (event.key === "ArrowRight") setActiveGalleryIndex((index) => index === null ? null : (index + 1) % galleryFiles.length);
    };
    window.addEventListener("keydown", navigateGallery);
    return () => window.removeEventListener("keydown", navigateGallery);
  }, [activeGalleryIndex, galleryFiles.length]);

  function renderLesson(lesson: Lesson) {
    return <li key={lesson.id}><button type="button" onClick={() => selectLesson(lesson)} disabled={!lesson.available} aria-current={selectedLessonId === lesson.id ? "page" : undefined} className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 ${selectedLessonId === lesson.id ? "border border-cyan-200 bg-cyan-300/10 text-cyan-100" : lesson.available ? "text-[#b6c2cf] hover:bg-white/[0.05] hover:text-white" : "cursor-not-allowed text-[#9fadbc]"}`}>
      {lesson.completed ? <CheckCircle2 size={16} className="shrink-0 text-emerald-300" aria-hidden="true" /> : lesson.available ? <Circle size={16} className="shrink-0 text-[#9fadbc]" aria-hidden="true" /> : <LockKeyhole size={15} className="shrink-0 text-[#9fadbc]" aria-hidden="true" />}
      <span className="min-w-0 flex-1 truncate">{lesson.title}</span>{Number(lesson.payload.workload_minutes) > 0 && <span className="shrink-0 text-[11px] text-[#b6c2cf]">{lesson.payload.workload_minutes} min</span>}
      {lesson.completed && <span className="sr-only">Concluída</span>}{!lesson.available && <span className="sr-only">Bloqueada</span>}
    </button></li>;
  }

  async function completeLesson() {
    if (!currentLesson || !learning || currentLesson.completed || !currentLesson.available || saving) return;
    setSaving(true);
    setMessage("");
    try {
      await api(`/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/lessons/${encodeURIComponent(currentLesson.id)}/complete`, {
        method: "POST",
        body: JSON.stringify({ operation_key: crypto.randomUUID() }),
      });
      setMessage("Aula marcada como concluída.");
      load();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Não foi possível atualizar seu progresso.");
    } finally { setSaving(false); }
  }

  return (
    <main className="min-h-screen bg-[#1d2125] text-[#dee4ea]">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-7 lg:py-9">
        <Link href="/suinda" className="inline-flex min-h-10 items-center gap-2 rounded-lg text-sm text-[#b6c2cf] transition hover:text-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"><ArrowLeft size={16} aria-hidden="true" /> Minhas inscrições</Link>
        {loading && !learning && <p role="status" className="mt-8 text-sm text-[#9fadbc]">Carregando conteúdo…</p>}
        {error && <section role="alert" className="mt-6 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-5 text-sm text-rose-100"><p>{error}</p><button type="button" onClick={load} className="mt-4 inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/40 bg-white/10 px-3 text-sm font-medium hover:bg-white/15"><RefreshCw size={14} aria-hidden="true" /> Tentar novamente</button></section>}
        {learning && <>
          <header className="mt-6 rounded-2xl border border-[#3b4754] bg-[radial-gradient(ellipse_at_top_right,_rgba(34,211,238,0.12),_transparent_45%),linear-gradient(135deg,#111827,#0c1220_65%,#101a27)] p-5 sm:p-7">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-cyan-200">Área do aluno</p>
            <h1 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">{learning.course.title}</h1>
            {learning.course.payload.description && <p className="mt-2 max-w-3xl text-sm leading-6 text-[#b6c2cf]">{learning.course.payload.description}</p>}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-[#b6c2cf]">{learning.progress.required_completed} de {learning.progress.required_total} aulas obrigatórias concluídas</p><span className="text-sm font-semibold text-cyan-100">{learning.progress.percent}%</span></div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="Progresso do curso" aria-valuemin={0} aria-valuemax={100} aria-valuenow={learning.progress.percent} aria-valuetext={`${learning.progress.percent}% concluído`}><div className="h-full rounded-full bg-cyan-300 transition-[width] motion-reduce:transition-none" style={{ width: `${learning.progress.percent}%` }} /></div>
            <Link href={`/suinda/messages/${encodeURIComponent(enrollmentId)}`} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg border border-cyan-200/20 bg-cyan-200/[0.06] px-3 text-xs font-medium text-cyan-100 transition hover:bg-cyan-200/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"><MessageCircle size={15} aria-hidden="true" /> Mensagens com professores</Link>
            <section aria-label="Minha frequência e carga horária" className="mt-5 grid gap-3 rounded-xl border border-[#3b4754] bg-white/[0.03] p-4 sm:grid-cols-2 xl:grid-cols-4">
              <div><p className="text-xs text-[#9fadbc]">Frequência</p><p className="mt-1 text-lg font-semibold text-white">{learning.attendance.percent === null ? "Aguardando aulas" : `${learning.attendance.percent}%`}</p><p className="text-[11px] text-[#9fadbc]">Mínimo para certificação: {learning.attendance.minimum_percent}%</p></div>
              <div><p className="text-xs text-[#9fadbc]">Carga horária frequentada</p><p className="mt-1 text-lg font-semibold text-white">{(learning.attendance.attended_minutes / 60).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h</p><p className="text-[11px] text-[#9fadbc]">de {(learning.attendance.scheduled_minutes / 60).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h realizadas</p></div>
              <div><p className="text-xs text-[#9fadbc]">Chamadas</p><p className="mt-1 text-lg font-semibold text-white">{learning.attendance.sessions_present} presenças · {learning.attendance.sessions_absent} faltas</p><p className="text-[11px] text-[#9fadbc]">{learning.attendance.sessions_unmarked ? `${learning.attendance.sessions_unmarked} encontro(s) aguardando chamada` : learning.attendance.meets_minimum === false ? "A frequência está abaixo do mínimo do curso" : learning.attendance.meets_minimum ? "Frequência dentro do mínimo do curso" : "Nenhum encontro encerrado"}</p></div>
              <div><p className="text-xs text-[#9fadbc]">Horas acadêmicas concluídas</p><p className="mt-1 text-lg font-semibold text-white">{learning.workload_progress.completed_hours.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} h</p><p className="text-[11px] text-[#9fadbc]">Aulas: {learning.workload_progress.attended_class_hours.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} h · Práticas validadas nesta matrícula: {learning.workload_progress.validated_practice_hours.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} h{(learning.workload_progress.credited_practice_hours || 0) > 0 ? ` · Crédito aprovado de práticas anteriores: ${(learning.workload_progress.credited_practice_hours || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} h` : ""}</p></div>
            </section>
            {learning.live_sessions.length > 0 && <section aria-labelledby="live-sessions-title" className="mt-4 rounded-xl border border-cyan-200/15 bg-cyan-200/[0.035] p-4"><h2 id="live-sessions-title" className="text-sm font-semibold text-cyan-100">Aulas online</h2><ul className="mt-3 grid gap-2 sm:grid-cols-2">{learning.live_sessions.map((session) => { const meetingUrl = safeContentUrl(session.meeting_url); const recordingUrl = safeContentUrl(session.recording_url); const isReminder = reminderSessionId === session.id; return <li key={session.id} className={`rounded-lg border p-3 ${isReminder ? "border-cyan-200/40 bg-cyan-200/[0.08]" : "border-white/[0.08] bg-black/10"}`}><p className="text-sm font-medium text-white">{session.title}{isReminder && <span className="ml-2 rounded-full bg-cyan-100/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-100">Começa em breve</span>}</p><p className="mt-1 text-xs text-[#9fadbc]">{dateLabel(session.starts_at) || "Horário a confirmar"}</p>{meetingUrl && <a href={meetingUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-lg bg-cyan-200 px-3 text-xs font-semibold text-slate-950 hover:bg-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"><ArrowUpRight size={14} aria-hidden="true" /> Abrir sala da aula</a>}{recordingUrl && <a href={recordingUrl} target="_blank" rel="noreferrer" className="mt-3 ml-2 inline-flex min-h-9 items-center gap-2 rounded-lg border border-cyan-200/25 px-3 text-xs font-semibold text-cyan-100 hover:bg-cyan-200/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"><ArrowUpRight size={14} aria-hidden="true" /> Assistir à gravação</a>}</li>; })}</ul></section>}
            {learning.submissions.length > 0 && <section aria-labelledby="graded-submissions-title" className="mt-4 rounded-xl border border-[#3b4754] bg-white/[0.03] p-4"><h2 id="graded-submissions-title" className="text-sm font-semibold text-white">Atividades corrigidas</h2><ul className="mt-3 grid gap-3 sm:grid-cols-2">{learning.submissions.map((submission) => <li key={submission.id} className="rounded-lg border border-white/[0.08] bg-black/10 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-medium text-[#dee4ea]">{submission.assessment_title}</p><p className="mt-1 text-[11px] text-[#9fadbc]">Versão {submission.version || 1} · {submission.state === "returned" ? "Devolvida para revisão" : "Correção concluída"}</p></div>{submission.score !== undefined && <span className="rounded-full bg-cyan-200/10 px-2.5 py-1 text-xs font-semibold text-cyan-100">{submission.score}%</span>}</div>{submission.rubric?.length ? <RubricDisplay rubric={submission.rubric} criterionScores={submission.criterion_scores} /> : null}{submission.feedback && <p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-[#b6c2cf]">{submission.feedback}</p>}</li>)}</ul></section>}
            {learning.assignments.length > 0 && <section aria-labelledby="assignments-title" className="mt-4 rounded-xl border border-[#3b4754] bg-white/[0.03] p-4"><h2 id="assignments-title" className="text-sm font-semibold text-white">Trabalhos e atividades</h2><p className="mt-1 text-xs text-[#9fadbc]">Envie sua resposta e acompanhe o prazo e o retorno da equipe docente.</p><ul className="mt-4 grid gap-3 lg:grid-cols-2">{learning.assignments.map((assignment) => <AssignmentCard key={assignment.id} assignment={assignment} enrollmentId={enrollmentId} onSaved={load} />)}</ul></section>}
            {learning.practices.length > 0 && <section aria-labelledby="practices-title" className="mt-4 rounded-xl border border-[#3b4754] bg-white/[0.03] p-4"><h2 id="practices-title" className="text-sm font-semibold text-white">Práticas supervisionadas</h2><p className="mt-1 text-xs text-[#9fadbc]">Envie seu relato e acompanhe as horas validadas pelo supervisor.</p><ul className="mt-4 grid gap-3 lg:grid-cols-2">{learning.practices.map((practice) => <PracticeCard key={practice.id} practice={practice} enrollmentId={enrollmentId} onSaved={load} />)}</ul></section>}
            <Link href={`/suinda/learning/${encodeURIComponent(enrollmentId)}/assessments`} className="mt-5 inline-flex min-h-10 items-center justify-center rounded-xl border border-cyan-200/20 bg-cyan-200/[0.06] px-4 text-sm font-medium text-cyan-100 transition hover:bg-cyan-200/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Ver avaliações</Link>
            <Link href={`/suinda/learning/${encodeURIComponent(enrollmentId)}/documents`} className="ml-3 mt-5 inline-flex min-h-10 items-center justify-center rounded-xl border border-[#3b4754] px-4 text-sm font-medium text-[#b6c2cf] transition hover:border-cyan-200/30 hover:text-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Meus documentos</Link>
            <Link href={`/suinda/learning/${encodeURIComponent(enrollmentId)}/agreements`} className="ml-3 mt-5 inline-flex min-h-10 items-center justify-center rounded-xl border border-[#3b4754] px-4 text-sm font-medium text-[#b6c2cf] transition hover:border-cyan-200/30 hover:text-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Termos acadêmicos</Link>
            <Link href={`/suinda/learning/${encodeURIComponent(enrollmentId)}/surveys`} className="ml-3 mt-5 inline-flex min-h-10 items-center justify-center rounded-xl border border-[#3b4754] px-4 text-sm font-medium text-[#b6c2cf] transition hover:border-cyan-200/30 hover:text-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Pesquisas</Link>
            <Link href={`/suinda/learning/${encodeURIComponent(enrollmentId)}/attendance`} className="ml-3 mt-5 inline-flex min-h-10 items-center justify-center rounded-xl border border-[#3b4754] px-4 text-sm font-medium text-[#b6c2cf] transition hover:border-cyan-200/30 hover:text-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Justificar falta</Link>
          </header>

          <div className="mt-6 grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
            <nav aria-label="Conteúdo do curso" className="h-fit rounded-2xl border border-[#3b4754] bg-[#2c333a] p-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
              <div className="flex items-center justify-between px-3 py-2"><h2 className="text-sm font-semibold text-white">Conteúdo</h2><span className="text-xs text-[#9fadbc]">{lessons.length} aulas</span></div>
              {learning.modules.map((module) => { const assigned = new Set(module.units.flatMap((unit) => unit.lessons.map((lesson) => lesson.id))); const ungrouped = module.lessons.filter((lesson) => !assigned.has(lesson.id)); return <section key={module.id} className="mt-3"><h3 className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[#9fadbc]">{module.title}</h3><p className="px-3 pb-2 text-[11px] text-[#9fadbc]">{module.progress.required_completed}/{module.progress.required_total} aulas obrigatórias · {module.progress.percent}%</p>{module.payload.summary && <p className="px-3 pb-2 text-xs leading-5 text-[#9fadbc]">{module.payload.summary}</p>}{(module.payload.competencies?.length || module.payload.skills?.length) ? <p className="px-3 pb-2 text-[11px] leading-5 text-cyan-100">{[...(module.payload.competencies || []).map((item) => `Competência: ${item}`), ...(module.payload.skills || []).map((item) => `Habilidade: ${item}`)].join(" · ")}</p> : null}{ungrouped.length > 0 && <ul className="space-y-1">{ungrouped.map(renderLesson)}</ul>}{module.units.map((unit) => <section key={unit.id} className="mt-2"><h4 className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[#9fadbc]">{unit.title}</h4>{unit.payload.summary && <p className="px-3 pb-2 text-xs leading-5 text-[#9fadbc]">{unit.payload.summary}</p>}{(unit.payload.competencies?.length || unit.payload.skills?.length) ? <p className="px-3 pb-2 text-[11px] leading-5 text-cyan-100">{[...(unit.payload.competencies || []).map((item) => `Competência: ${item}`), ...(unit.payload.skills || []).map((item) => `Habilidade: ${item}`)].join(" · ")}</p> : null}<ul className="space-y-1">{unit.lessons.map(renderLesson)}</ul></section>)}</section>; })}
              {learning.modules.length === 0 && <p className="px-3 py-5 text-sm text-[#9fadbc]">O conteúdo deste curso ainda está sendo preparado.</p>}
            </nav>

            <section aria-labelledby="current-lesson-title" aria-busy={saving} className="min-w-0 overflow-hidden rounded-2xl border border-[#3b4754] bg-[#2c333a]">
              <p className="sr-only" aria-live="polite" aria-atomic="true">{currentLesson ? `Aula selecionada: ${currentLesson.title}${currentLesson.completed ? ", concluída" : ""}.` : "Nenhuma aula selecionada."}</p>
              {!currentLesson && <div className="grid min-h-72 place-items-center px-6 py-12 text-center"><div><Play size={24} className="mx-auto text-cyan-200" aria-hidden="true" /><h2 id="current-lesson-title" className="mt-4 text-lg font-semibold text-white">Escolha uma aula liberada</h2><p className="mt-2 text-sm text-[#9fadbc]">A sequência e as datas de liberação controlam o conteúdo disponível.</p></div></div>}
              {currentLesson && <>
                <header className="border-b border-white/[0.08] p-5 sm:p-7"><p className="text-xs font-medium uppercase tracking-wide text-cyan-200">{currentLesson.payload.content_type || "Aula"}{currentLesson.required ? " · Obrigatória" : " · Complementar"}</p><h2 id="current-lesson-title" tabIndex={-1} className="mt-2 text-2xl font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">{currentLesson.title}</h2>{currentLesson.payload.objectives?.length ? <ul aria-label="Objetivos da aula" className="mt-4 flex flex-wrap gap-2">{currentLesson.payload.objectives.map((objective) => <li key={objective} className="rounded-lg border border-[#3b4754] bg-white/[0.03] px-3 py-1.5 text-xs text-[#b6c2cf]">{objective}</li>)}</ul> : null}{currentLesson.payload.competencies?.length || currentLesson.payload.skills?.length ? <div className="mt-4 space-y-2">{currentLesson.payload.competencies?.length ? <div><h3 className="text-xs font-medium uppercase tracking-wide text-[#9fadbc]">Competências desenvolvidas</h3><ul className="mt-1 flex flex-wrap gap-2">{currentLesson.payload.competencies.map((item) => <li key={item} className="rounded-lg border border-cyan-200/15 bg-cyan-200/[0.05] px-3 py-1.5 text-xs text-cyan-100">{item}</li>)}</ul></div> : null}{currentLesson.payload.skills?.length ? <div><h3 className="text-xs font-medium uppercase tracking-wide text-[#9fadbc]">Habilidades desenvolvidas</h3><ul className="mt-1 flex flex-wrap gap-2">{currentLesson.payload.skills.map((item) => <li key={item} className="rounded-lg border border-[#3b4754] bg-white/[0.03] px-3 py-1.5 text-xs text-[#b6c2cf]">{item}</li>)}</ul></div> : null}</div> : null}</header>
                <div className="min-h-64 p-5 sm:p-7">
                  {currentLesson.payload.content_type === "article" && currentLesson.payload.body_markdown && <SuindaMarkdownArticle markdown={currentLesson.payload.body_markdown} headingOffset={2} />}
                  {currentLesson.payload.content_type === "video" && contentUrl && <div className="overflow-hidden rounded-xl bg-black">{embedUrl(contentUrl, "video") && embeddedVideoProvider(contentUrl) ? <TrackedEmbeddedVideo key={currentLesson.id} enrollmentId={enrollmentId} lesson={currentLesson} src={embedUrl(contentUrl, "video")!} provider={embeddedVideoProvider(contentUrl)!} /> : googlePreviewUrl ? <GoogleDriveEmbed src={googlePreviewUrl} sourceUrl={contentUrl} title={currentLesson.title} externalVideo /> : <TrackedMediaPlayer key={currentLesson.id} enrollmentId={enrollmentId} lesson={currentLesson} src={contentUrl} type="video" />}</div>}
                  {currentLesson.payload.content_type === "audio" && contentUrl && <div className="rounded-xl border border-[#3b4754] bg-black/20 p-5"><TrackedMediaPlayer key={currentLesson.id} enrollmentId={enrollmentId} lesson={currentLesson} src={contentUrl} type="audio" /></div>}
                  {currentLesson.payload.content_type === "gallery" ? <section aria-label="Galeria de imagens" className="mt-5">
                    <h3 className="mb-3 text-sm font-semibold text-white">Galeria de imagens <span className="font-normal text-[#9fadbc]">· {galleryFiles.length} {galleryFiles.length === 1 ? "imagem" : "imagens"}</span></h3>
                    {galleryFiles.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">{galleryFiles.map((file, index) => { const preview = materialPreviews.lessonId === currentLesson.id ? materialPreviews.urls[file.id] : null; const altText = hasAccessibleText(file.alt_text) ? file.alt_text.trim() : ""; return <figure key={file.id} className="overflow-hidden rounded-xl border border-[#3b4754] bg-black/20"><button type="button" disabled={!preview} onClick={() => setActiveGalleryIndex(index)} aria-label={`Ampliar imagem ${index + 1}: ${file.file_name}`} className="group block aspect-[4/3] w-full border border-[#80909d] bg-[#1d2125] focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-cyan-300 disabled:cursor-wait">{preview ? <Image src={preview} alt={altText || "Imagem sem descrição alternativa"} width={1200} height={900} unoptimized className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.03] motion-reduce:transition-none" /> : <span role="status" className="grid h-full place-items-center px-3 text-center text-xs text-[#9fadbc]">Carregando imagem…</span>}</button><figcaption className="flex min-h-12 items-center justify-between gap-2 px-3 py-2"><span className="min-w-0"><span className="block truncate text-xs text-[#b6c2cf]">{file.file_name}</span>{!altText && <span className="block text-xs text-amber-200">Descrição alternativa pendente</span>}</span>{currentLesson.payload.downloadable && <button type="button" onClick={() => void downloadMaterial(file)} aria-label={`Baixar ${file.file_name}`} className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[#3b4754] px-2.5 text-xs text-cyan-100 hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"><Download size={13} aria-hidden="true" /> Baixar</button>}</figcaption></figure>; })}</div> : <p className="rounded-xl border border-dashed border-[#3b4754] p-6 text-center text-sm text-[#9fadbc]">As imagens desta galeria ainda não foram adicionadas.</p>}
                    {activeGalleryIndex !== null && galleryFiles[activeGalleryIndex] && materialPreviews.lessonId === currentLesson.id && materialPreviews.urls[galleryFiles[activeGalleryIndex].id] && <Modal theme="dark" title={`Imagem ${activeGalleryIndex + 1} de ${galleryFiles.length}`} onClose={() => setActiveGalleryIndex(null)} extraWide><div className="relative flex min-h-[50vh] items-center justify-center rounded-xl bg-[#11161d] p-2 sm:min-h-[70vh] sm:p-6"><Image src={materialPreviews.urls[galleryFiles[activeGalleryIndex].id]} alt={hasAccessibleText(galleryFiles[activeGalleryIndex].alt_text) ? galleryFiles[activeGalleryIndex].alt_text.trim() : "Imagem sem descrição alternativa"} width={1800} height={1400} unoptimized className="max-h-[75vh] w-auto max-w-full object-contain" />{galleryFiles.length > 1 && <><button type="button" onClick={() => setActiveGalleryIndex((activeGalleryIndex + galleryFiles.length - 1) % galleryFiles.length)} aria-label="Imagem anterior" className="absolute left-3 top-1/2 grid min-h-11 min-w-11 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-slate-950/80 text-white hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"><ChevronLeft size={20} aria-hidden="true" /></button><button type="button" onClick={() => setActiveGalleryIndex((activeGalleryIndex + 1) % galleryFiles.length)} aria-label="Próxima imagem" className="absolute right-3 top-1/2 grid min-h-11 min-w-11 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-slate-950/80 text-white hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"><ChevronRight size={20} aria-hidden="true" /></button></>}</div><div className="mt-3 flex items-center justify-between gap-3"><p aria-live="polite" className="text-sm text-[#b6c2cf]">{galleryFiles[activeGalleryIndex].file_name} · imagem {activeGalleryIndex + 1} de {galleryFiles.length}{!hasAccessibleText(galleryFiles[activeGalleryIndex].alt_text) && " · descrição alternativa pendente"}</p>{currentLesson.payload.downloadable && <button type="button" onClick={() => void downloadMaterial(galleryFiles[activeGalleryIndex])} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#3b4754] px-3 text-sm text-cyan-100 hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"><Download size={15} aria-hidden="true" /> Baixar imagem</button>}</div></Modal>}
                  </section> : currentLesson.payload.attachments?.length ? <section className="mt-5 grid gap-4" aria-label="Materiais anexados">{currentLesson.payload.attachments.map((file) => { const preview = materialPreviews.lessonId === currentLesson.id ? materialPreviews.urls[file.id] : null; const isPresentation = file.mime_type === "application/vnd.openxmlformats-officedocument.presentationml.presentation"; const slideUrls = materialPreviews.lessonId === currentLesson.id ? materialPreviews.slides[file.id] || [] : []; const slideCount = materialPreviews.lessonId === currentLesson.id ? materialPreviews.slideCounts[file.id] : 0; const altText = hasAccessibleText(file.alt_text) ? file.alt_text.trim() : ""; return <article key={file.id} className="overflow-hidden rounded-xl border border-[#3b4754] bg-black/20"><div className="flex flex-wrap items-center justify-between gap-2 p-3"><p className="truncate text-xs font-medium text-[#b6c2cf]">{file.file_name} · {(file.size_bytes / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB</p>{currentLesson.payload.downloadable && <button type="button" onClick={() => void downloadMaterial(file)} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[#3b4754] px-3 text-xs text-cyan-100 hover:bg-white/[0.05]"><Download size={14} aria-hidden="true" /> Baixar</button>}</div>{file.mime_type === "application/pdf" && preview && <iframe title={`Pré-visualização: ${file.file_name}`} src={preview} className="h-[70vh] min-h-96 w-full border-t border-[#3b4754] bg-white" />}{file.mime_type.startsWith("image/") && preview && <div className="border-t border-[#3b4754] p-3"><Image src={preview} alt={altText || "Imagem sem descrição alternativa"} width={1600} height={1200} unoptimized className="mx-auto max-h-[70vh] max-w-full rounded-lg object-contain" />{!altText && <p className="mt-2 text-center text-xs text-amber-200">Descrição alternativa pendente. Solicite uma descrição à equipe docente.</p>}</div>}{isPresentation && slideUrls.length > 0 && <div className="grid gap-3 border-t border-[#3b4754] bg-[#1d2125] p-3">{slideUrls.map((url, index) => <figure key={url} className="overflow-hidden rounded-lg border border-[#3b4754] bg-white"><Image src={url} alt="" width={1280} height={720} unoptimized className="h-auto w-full" /><figcaption className="bg-slate-950 px-3 py-2 text-xs text-[#b6c2cf]">Slide {index + 1} de {slideCount}</figcaption></figure>)}<ol className="sr-only" aria-label={`Conteúdo textual da apresentação ${file.file_name}`}>{slideUrls.map((url, index) => { const text = materialPreviews.slideTexts[file.id]?.[index]?.trim(); return <li key={url}>Slide {index + 1} de {slideCount}: {text || "Não foi possível extrair texto deste slide. Solicite uma descrição acessível à equipe docente."}</li>; })}</ol>{slideCount > slideUrls.length && <p className="text-center text-xs text-[#9fadbc]">Prévia das primeiras {slideUrls.length} páginas. Baixe a apresentação para ver os demais slides.</p>}</div>}</article>; })}</section> : null}
                  {currentLesson.payload.content_type !== "article" && currentLesson.payload.content_type !== "video" && currentLesson.payload.content_type !== "audio" && contentUrl && googlePreviewUrl && <GoogleDriveEmbed src={googlePreviewUrl} sourceUrl={contentUrl} title={currentLesson.title} />}
                  {currentLesson.payload.content_type !== "article" && currentLesson.payload.content_type !== "video" && currentLesson.payload.content_type !== "audio" && contentUrl && !googlePreviewUrl && <div className="space-y-2"><a href={contentUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-cyan-200/20 bg-cyan-200/[0.06] px-4 text-sm font-medium text-cyan-100 hover:bg-cyan-200/10">Abrir material em nova aba <ArrowUpRight size={15} aria-hidden="true" /></a><p className="text-xs text-[#9fadbc]">Este conteúdo abre em um serviço externo e segue os termos, a disponibilidade e as configurações de privacidade desse serviço.</p></div>}
                  {currentLesson.payload.content_type === "article" && !currentLesson.payload.body_markdown && <p className="text-sm text-[#9fadbc]">O texto desta aula ainda não foi adicionado.</p>}
                  {currentLesson.payload.transcript && <details className="mt-8 rounded-xl border border-[#3b4754] bg-white/[0.03] p-4"><summary className="cursor-pointer text-sm font-medium text-[#b6c2cf]">Transcrição</summary><div className="mt-4 whitespace-pre-wrap text-sm leading-7 text-[#b6c2cf]">{currentLesson.payload.transcript}</div></details>}
                </div>
                <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] px-5 py-4 sm:px-7">{currentLesson.payload.release_at && <p className="flex items-center gap-2 text-xs text-[#9fadbc]"><Clock3 size={14} aria-hidden="true" /> Disponível desde {dateLabel(currentLesson.payload.release_at) || "data agendada"}</p>}<div className="ml-auto flex items-center gap-3">{message && <span role="status" aria-live="polite" className="text-sm text-[#b6c2cf]">{message}</span>}<button type="button" onClick={completeLesson} disabled={saving || currentLesson.completed} style={{ outlineColor: "#a5f3fc" }} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-cyan-200 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-60">{currentLesson.completed ? <><Check size={15} aria-hidden="true" /> Concluída</> : saving ? "Salvando…" : "Marcar como concluída"}</button></div></footer>
                <CommunityPanel enrollmentId={enrollmentId} lessonId={currentLesson.id} />
                <StudyGroupsPanel enrollmentId={enrollmentId} />
                <LearningAssistant enrollmentId={enrollmentId} />
                <ParticipantDirectory enrollmentId={enrollmentId} />
              </>}
            </section>
          </div>
        </>}
      </div>
    </main>
  );
}

type LearningAssistantResult = { answer: string; citations: Array<{ ref: string; lesson_id: string; lesson_title: string; module_title: string }> };
function LearningAssistant({ enrollmentId }: { enrollmentId: string }) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<LearningAssistantResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || !question.trim()) return;
    setLoading(true); setError(""); setResult(null);
    try {
      const response = await api<LearningAssistantResult>(`/suinda-learning-assistant/enrollments/${encodeURIComponent(enrollmentId)}/ask`, {
        method: "POST", body: JSON.stringify({ question: question.trim() }),
      });
      setResult(response);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "O assistente não conseguiu responder agora."); }
    finally { setLoading(false); }
  }
  return <section aria-labelledby="learning-assistant-title" className="border-t border-white/[0.08] p-5 sm:p-7">
    <div className="flex items-start gap-3"><span className="mt-0.5 rounded-lg bg-cyan-200/10 p-2 text-cyan-100"><Sparkles size={17} aria-hidden="true" /></span><div><p className="text-xs font-medium uppercase tracking-wide text-cyan-200">Assistente de aprendizagem</p><h3 id="learning-assistant-title" className="mt-1 text-lg font-semibold text-white">Pergunte sobre o conteúdo das aulas</h3><p id="learning-assistant-help" className="mt-1 text-xs leading-5 text-[#9fadbc]">A resposta usa somente aulas publicadas e liberadas nesta matrícula e mostra as fontes consultadas. O Suindá não salva perguntas ou respostas; o provedor de IA pode aplicar suas próprias regras de processamento e retenção.</p></div></div>
    <form onSubmit={ask} aria-busy={loading} className="mt-4 grid gap-3 rounded-xl border border-[#3b4754] bg-black/10 p-4">
      <label htmlFor="learning-assistant-question" className="text-xs font-medium text-[#b6c2cf]">Sua dúvida</label>
      <textarea id="learning-assistant-question" aria-describedby="learning-assistant-help" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={1200} required rows={3} placeholder="Ex.: Qual é a diferença entre mitose e meiose?" className="w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 py-2 text-sm leading-6 text-white placeholder:text-[#9fadbc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" />
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[11px] text-[#9fadbc]">Até 1.200 caracteres</span><button disabled={loading || !question.trim()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-cyan-200 px-4 text-sm font-semibold text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:opacity-50"><Sparkles size={14} aria-hidden="true" />{loading ? "Consultando…" : "Perguntar"}</button></div>
      {loading && <p role="status" aria-live="polite" className="sr-only">Consultando o conteúdo liberado do curso…</p>}
    </form>
    {error && <p role="alert" className="mt-3 rounded-lg border border-rose-400/20 bg-rose-400/5 p-3 text-xs text-rose-200">{error}</p>}
    {result && <div aria-live="polite" className="mt-4 rounded-xl border border-cyan-200/15 bg-cyan-200/[0.03] p-4"><h4 className="text-sm font-semibold text-white">Resposta</h4><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#b6c2cf]">{result.answer}</p>{result.citations.length > 0 && <div className="mt-4 border-t border-white/[0.08] pt-3"><h5 className="text-xs font-semibold text-[#b6c2cf]">Aulas consultadas</h5><ul className="mt-2 flex flex-wrap gap-2">{result.citations.map((citation) => <li key={citation.ref} className="rounded-md border border-[#3b4754] bg-white/[0.03] px-2.5 py-1.5 text-[11px] text-[#b6c2cf]"><span className="font-semibold text-cyan-100">[{citation.ref}]</span> {citation.lesson_title}<span className="text-[#9fadbc]"> · {citation.module_title}</span></li>)}</ul></div>}</div>}
  </section>;
}

type CommunityThread = { id: string; title: string; state: string; created_at: string; pinned: boolean; payload: { author_user_id: string; thread_type: "discussion" | "question"; body: string }; replies: Array<{ id: string; created_at: string; payload: { body: string } }>; reactions: Record<string, number>; my_reaction: string | null };
function CommunityPanel({ enrollmentId, lessonId }: { enrollmentId: string; lessonId: string }) {
  const [threads, setThreads] = useState<CommunityThread[]>([]);
  const [moderator, setModerator] = useState(false);
  const [scope, setScope] = useState<"lesson" | "course">("lesson");
  const [threadType, setThreadType] = useState<"discussion" | "question">("question");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const endpoint = `/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/community`;
  const load = useCallback(() => {
    const query = scope === "lesson" ? `?lesson=${encodeURIComponent(lessonId)}` : "";
    api<{ threads: CommunityThread[]; moderator: boolean }>(`${endpoint}${query}`)
      .then((result) => { setThreads(result.threads || []); setModerator(result.moderator === true); })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Não foi possível carregar a comunidade."))
      .finally(() => setLoading(false));
  }, [endpoint, lessonId, scope]);
  useEffect(() => { void load(); }, [load]);
  async function createThread(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving || !title.trim() || !body.trim()) return;
    setSaving(true); setError(""); setSuccess("");
    try {
      await api(endpoint, { method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), title: title.trim(), body: body.trim(), thread_type: threadType, lesson_record_id: scope === "lesson" ? lessonId : null }) });
      const publishedTitle = title.trim();
      setTitle(""); setBody(""); setSuccess(`Tópico “${publishedTitle}” publicado.`); load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível publicar o tópico."); }
    finally { setSaving(false); }
  }
  async function reply(threadId: string) {
    const message = (replies[threadId] || "").trim(); if (!message || saving) return;
    setSaving(true); setError(""); setSuccess("");
    try {
      await api(`${endpoint}/threads/${encodeURIComponent(threadId)}/replies`, { method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), body: message }) });
      const threadTitle = threads.find((thread) => thread.id === threadId)?.title || "a conversa";
      setReplies((current) => ({ ...current, [threadId]: "" })); setSuccess(`Resposta enviada no tópico “${threadTitle}”.`); load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível responder."); }
    finally { setSaving(false); }
  }
  async function react(threadId: string) {
    setSaving(true); setError("");
    const thread = threads.find((item) => item.id === threadId);
    try { await api(`${endpoint}/threads/${encodeURIComponent(threadId)}/reactions`, { method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), reaction: "like", active: thread?.my_reaction !== "like" }) }); load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível reagir a este tópico."); }
    finally { setSaving(false); }
  }
  async function togglePin(thread: CommunityThread) {
    setSaving(true); setError("");
    try {
      await api(`/extensions/suinda-learning/me/teaching/community/threads/${encodeURIComponent(thread.id)}/${thread.pinned ? "unpin" : "pin"}`, {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID() }),
      });
      load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível atualizar o tópico fixado."); }
    finally { setSaving(false); }
  }
  return <section aria-labelledby="community-title" className="border-t border-white/[0.08] p-5 sm:p-7">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-cyan-200"><MessageCircle size={14} aria-hidden="true" /> Comunidade do curso</p><h3 id="community-title" className="mt-2 text-lg font-semibold text-white">Converse e tire dúvidas</h3><p className="mt-1 text-xs text-[#9fadbc]">Somente participantes matriculados neste curso podem ler e responder.</p></div>
      <label className="text-xs text-[#9fadbc]">Mostrar <select aria-label="Escopo das conversas" value={scope} onChange={(event) => { setScope(event.target.value as "lesson" | "course"); setSuccess(""); setError(""); }} className="ml-2 min-h-9 rounded-lg border border-[#3b4754] bg-[#1d2125] px-2 text-[#b6c2cf] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"><option value="lesson">desta aula e do curso</option><option value="course">todo o curso</option></select></label>
    </div>
    <form onSubmit={createThread} aria-busy={saving} className="mt-4 grid gap-3 rounded-xl border border-[#3b4754] bg-black/10 p-4">
      <div className="flex flex-wrap gap-2"><label className="sr-only" htmlFor="community-thread-type">Tipo de tópico</label><select id="community-thread-type" value={threadType} onChange={(event) => setThreadType(event.target.value as "discussion" | "question")} className="min-h-10 rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-[#b6c2cf] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"><option value="question">Pergunta</option><option value="discussion">Discussão</option></select><label className="sr-only" htmlFor="community-thread-title">Título do tópico</label><input id="community-thread-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={180} required placeholder="Título do tópico" className="min-h-10 min-w-0 flex-1 rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-white placeholder:text-[#9fadbc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" /></div>
      <label className="sr-only" htmlFor="community-thread-body">Texto da pergunta ou contribuição</label><textarea id="community-thread-body" value={body} onChange={(event) => setBody(event.target.value)} maxLength={8000} required rows={3} placeholder="Escreva sua pergunta ou contribuição…" className="w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 py-2 text-sm text-white placeholder:text-[#9fadbc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" />
      <button disabled={saving} className="inline-flex min-h-10 items-center justify-center gap-2 justify-self-end rounded-lg bg-cyan-200 px-4 text-sm font-semibold text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:opacity-50"><Send size={14} aria-hidden="true" /> {saving ? "Publicando…" : "Publicar tópico"}</button>{saving && <p role="status" className="sr-only">Publicando tópico…</p>}
    </form>
    {success && <p role="status" aria-live="polite" aria-atomic="true" className="mt-3 rounded-lg border border-emerald-200/15 bg-emerald-200/[0.04] p-3 text-xs text-emerald-100">{success}</p>}
    {error && <p role="alert" className="mt-3 rounded-lg border border-rose-400/20 bg-rose-400/5 p-3 text-xs text-rose-200">{error}</p>}
    {loading ? <p role="status" className="mt-4 text-sm text-[#9fadbc]">Carregando conversas…</p> : threads.length === 0 ? <p className="mt-4 rounded-lg border border-dashed border-[#3b4754] p-5 text-center text-sm text-[#9fadbc]">Ainda não há tópicos aqui. Comece a conversa.</p> : <ul className="mt-4 space-y-3">{threads.map((thread) => <li key={thread.id} className={`rounded-xl border ${thread.pinned ? "border-cyan-200/30 bg-cyan-200/[0.04]" : "border-[#3b4754] bg-white/[0.02]"} p-4`}><div className="flex flex-wrap items-center gap-2">{thread.pinned && <span className="inline-flex items-center gap-1 rounded-md bg-cyan-200/10 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-cyan-100"><Pin size={11} aria-hidden="true" />Fixado</span>}<span className="rounded-md bg-cyan-200/10 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-cyan-100">{thread.payload.thread_type === "question" ? "Pergunta" : "Discussão"}</span><h4 className="text-sm font-semibold text-white">{thread.title}</h4><time className="ml-auto text-[11px] text-[#9fadbc]">{dateLabel(thread.created_at) || "Agora"}</time></div><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#b6c2cf]">{thread.payload.body}</p>
      <div className="mt-3 flex items-center gap-3"><button type="button" disabled={saving} onClick={() => void react(thread.id)} aria-pressed={thread.my_reaction === "like"} className={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 disabled:opacity-50 ${thread.my_reaction === "like" ? "text-cyan-100" : "text-[#9fadbc] hover:text-cyan-100"}`}><ThumbsUp size={13} aria-hidden="true" /> Útil · {thread.reactions.like || 0}</button><span className="text-xs text-[#9fadbc]">{thread.replies.length} resposta(s)</span><ReportCommunityButton endpoint={`${endpoint}/reports`} targetId={thread.id} targetKind="discussion_thread" />{moderator && <button type="button" disabled={saving} onClick={() => void togglePin(thread)} className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs text-[#9fadbc] hover:bg-white/5 hover:text-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 disabled:opacity-50"><Pin size={12} aria-hidden="true" />{thread.pinned ? "Desafixar" : "Fixar"}</button>}</div>
      {thread.replies.length > 0 && <ul className="mt-3 space-y-2 border-l border-[#3b4754] pl-3">{thread.replies.map((item) => <li key={item.id} className="rounded-lg bg-black/20 p-3"><time className="text-[10px] text-[#9fadbc]">Participante · {dateLabel(item.created_at) || "Agora"}</time><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#b6c2cf]">{item.payload.body}</p><ReportCommunityButton endpoint={`${endpoint}/reports`} targetId={item.id} targetKind="discussion_reply" /></li>)}</ul>}
      <div className="mt-3 flex gap-2"><label className="sr-only" htmlFor={`reply-${thread.id}`}>Resposta ao tópico: {thread.title}</label><input id={`reply-${thread.id}`} value={replies[thread.id] || ""} onChange={(event) => setReplies((current) => ({ ...current, [thread.id]: event.target.value }))} maxLength={8000} placeholder="Escreva uma resposta…" className="min-h-9 min-w-0 flex-1 rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-xs text-white placeholder:text-[#9fadbc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" /><button type="button" disabled={saving || !(replies[thread.id] || "").trim()} onClick={() => void reply(thread.id)} className="rounded-lg border border-[#3b4754] px-3 text-xs text-cyan-100 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 disabled:opacity-40">{saving ? "Enviando…" : "Responder"}</button></div>
    </li>)}</ul>}
  </section>;
}

type StudyGroup = { id: string; title: string; state: "open" | "closed"; member_count: number; is_member: boolean; is_owner: boolean; payload: { description: string; capacity: number } };
type StudyGroupChatMessage = { id: string; sender_name: string; from_me: boolean; body: string; sent_at: string };
type StudyGroupChatPage = { group: { id: string; title: string; state: "open" | "closed"; read_only: boolean }; messages: StudyGroupChatMessage[]; next_cursor: string | null };

function StudyGroupChat({ enrollmentId, groupId, readOnly }: { enrollmentId: string; groupId: string; readOnly: boolean }) {
  const [messages, setMessages] = useState<StudyGroupChatMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const endpoint = `/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/community/groups/${encodeURIComponent(groupId)}/messages`;
  const load = useCallback(async () => {
    try {
      const page = await api<StudyGroupChatPage>(endpoint);
      setMessages(page.messages); setCursor(page.next_cursor); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível carregar as mensagens do grupo."); }
    finally { setLoading(false); }
  }, [endpoint]);
  useEffect(() => {
    const initial = window.setTimeout(() => { void load(); }, 0);
    const timer = window.setInterval(() => { void load(); }, 15000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [load]);
  async function older() {
    if (!cursor || working) return;
    setWorking(true); setError("");
    try {
      const page = await api<StudyGroupChatPage>(`${endpoint}?before=${encodeURIComponent(cursor)}`);
      setMessages((current) => [...page.messages, ...current]); setCursor(page.next_cursor);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível carregar mensagens anteriores."); }
    finally { setWorking(false); }
  }
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working || readOnly || !draft.trim()) return;
    setWorking(true); setError("");
    try {
      await api(endpoint, { method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), body: draft.trim() }) });
      setDraft(""); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível enviar a mensagem."); }
    finally { setWorking(false); }
  }
  return <section aria-label="Mensagens do grupo" className="mt-4 rounded-lg border border-white/[0.08] bg-black/20 p-3 sm:p-4">
    <div className="flex items-center justify-between gap-2"><h5 className="text-xs font-semibold text-cyan-100">Conversa do grupo</h5>{readOnly && <span className="text-[11px] text-[#9fadbc]">Somente leitura</span>}</div>
    {loading ? <p role="status" className="mt-3 text-xs text-[#9fadbc]">Carregando mensagens…</p> : <>
      {cursor && <button type="button" disabled={working} onClick={() => void older()} className="mt-3 min-h-8 rounded-md px-2 text-xs text-cyan-100 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 disabled:opacity-50">Carregar mensagens anteriores</button>}
      <div role="log" aria-label="Mensagens do grupo de estudo" aria-relevant="additions" tabIndex={0} className="mt-3 max-h-80 overflow-y-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200">
      <ol className="space-y-2">
        {messages.length === 0 ? <li className="rounded-lg border border-dashed border-[#3b4754] p-3 text-center text-xs text-[#9fadbc]">Ainda não há mensagens neste grupo.</li> : messages.map((message) => <li key={message.id} className={`max-w-[92%] rounded-lg border px-3 py-2 ${message.from_me ? "ml-auto border-cyan-200/20 bg-cyan-200/[0.07]" : "border-white/[0.07] bg-white/[0.03]"}`}><div className="flex items-baseline justify-between gap-3"><span className="text-[11px] font-medium text-[#b6c2cf]">{message.from_me ? "Você" : message.sender_name}</span><time className="shrink-0 text-[10px] text-[#9fadbc]">{dateLabel(message.sent_at) || "Agora"}</time></div><p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-[#b6c2cf]">{message.body}</p></li>)}
      </ol>
      </div>
    </>}
    {error && <p role="alert" className="mt-2 text-xs text-rose-200">{error}</p>}
    {!readOnly && <form onSubmit={send} className="mt-3 flex flex-col gap-2 sm:flex-row"><label className="sr-only" htmlFor={`study-group-message-${groupId}`}>Nova mensagem no grupo</label><textarea id={`study-group-message-${groupId}`} value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={4000} rows={2} placeholder="Escreva para o grupo…" className="min-h-10 min-w-0 flex-1 resize-y rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 py-2 text-xs text-white placeholder:text-[#9fadbc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" /><button disabled={working || !draft.trim()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-cyan-200 px-3 text-xs font-semibold text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:opacity-50"><Send size={13} aria-hidden="true" />{working ? "Enviando…" : "Enviar"}</button></form>}
  </section>;
}

function StudyGroupsPanel({ enrollmentId }: { enrollmentId: string }) {
  const [groups, setGroups] = useState<StudyGroup[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [capacity, setCapacity] = useState(8);
  const [creating, setCreating] = useState(false);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const endpoint = `/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/community/groups`;
  const load = useCallback(() => {
    api<StudyGroup[]>(endpoint).then(setGroups).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Não foi possível carregar os grupos."));
  }, [endpoint]);
  useEffect(() => { void load(); }, [load]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (creating || !title.trim() || !description.trim()) return;
    setCreating(true); setError("");
    try {
      await api(endpoint, { method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), title: title.trim(), description: description.trim(), capacity }) });
      setTitle(""); setDescription(""); load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível criar o grupo."); }
    finally { setCreating(false); }
  }
  async function act(group: StudyGroup, action: "join" | "leave" | "close") {
    setWorking(group.id); setError("");
    try {
      await api(`${endpoint}/${encodeURIComponent(group.id)}/${action}`, { method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID() }) });
      load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível atualizar a participação."); }
    finally { setWorking(""); }
  }
  return <section aria-labelledby="study-groups-title" className="border-t border-white/[0.08] p-5 sm:p-7">
    <p className="text-xs font-medium uppercase tracking-wide text-cyan-200">Aprendizagem entre colegas</p><h3 id="study-groups-title" className="mt-2 text-lg font-semibold text-white">Grupos de estudo</h3><p className="mt-1 text-xs text-[#9fadbc]">Crie um grupo ou participe de um grupo aberto deste curso. O criador conta como primeiro integrante.</p>
    <form onSubmit={create} className="mt-4 grid gap-3 rounded-xl border border-[#3b4754] bg-black/10 p-4 sm:grid-cols-[1fr_1fr_auto]">
      <label className="sr-only" htmlFor="study-group-title">Nome do grupo</label><input id="study-group-title" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={160} placeholder="Nome do grupo" className="min-h-10 rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-white placeholder:text-[#9fadbc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" />
      <label className="sr-only" htmlFor="study-group-description">Tema, horário ou objetivo do grupo</label><input id="study-group-description" value={description} onChange={(event) => setDescription(event.target.value)} required maxLength={2000} placeholder="Tema, horário ou objetivo" className="min-h-10 rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-white placeholder:text-[#9fadbc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" />
      <div className="flex gap-2"><label className="flex items-center gap-2 rounded-lg border border-[#3b4754] px-2 text-xs text-[#9fadbc]">Vagas<select aria-label="Número de vagas no grupo" value={capacity} onChange={(event) => setCapacity(Number(event.target.value))} className="min-h-9 rounded-md border border-[#9fadbc] bg-[#1d2125] px-2 text-[#b6c2cf] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">{[2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30].map((size) => <option key={size} value={size}>{size}</option>)}</select></label><button disabled={creating} className="min-h-10 rounded-lg bg-cyan-200 px-4 text-sm font-semibold text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:opacity-50">{creating ? "Criando…" : "Criar grupo"}</button></div>
    </form>
    {error && <p role="alert" className="mt-3 rounded-lg border border-rose-400/20 bg-rose-400/5 p-3 text-xs text-rose-200">{error}</p>}
    {groups.length === 0 ? <p className="mt-4 rounded-lg border border-dashed border-[#3b4754] p-5 text-center text-sm text-[#9fadbc]">Ainda não há grupos abertos. Você pode criar o primeiro.</p> : <ul className="mt-4 grid gap-3 md:grid-cols-2">{groups.map((group) => <li key={group.id} className="rounded-xl border border-[#3b4754] bg-white/[0.02] p-4"><div className="flex items-start justify-between gap-3"><div><h4 className="text-sm font-semibold text-white">{group.title}</h4><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#b6c2cf]">{group.payload.description}</p></div><span className="shrink-0 rounded-full bg-white/[0.05] px-2.5 py-1 text-xs text-[#b6c2cf]">{group.member_count}/{group.payload.capacity}</span></div><div className="mt-4 flex justify-end gap-2">{group.is_owner && group.state === "open" ? <button type="button" disabled={working === group.id} onClick={() => void act(group, "close")} className="min-h-9 rounded-lg border border-[#3b4754] px-3 text-xs text-[#b6c2cf] hover:bg-white/5">Encerrar inscrições</button> : group.is_owner ? <span className="rounded-md bg-white/[0.05] px-3 py-2 text-xs text-[#9fadbc]">Grupo encerrado</span> : group.is_member ? <button type="button" disabled={working === group.id} onClick={() => void act(group, "leave")} className="min-h-9 rounded-lg border border-[#3b4754] px-3 text-xs text-[#b6c2cf] hover:bg-white/5">Sair do grupo</button> : group.state === "closed" ? <span className="rounded-md bg-white/[0.05] px-3 py-2 text-xs text-[#9fadbc]">Grupo encerrado</span> : <button type="button" disabled={working === group.id || group.member_count >= group.payload.capacity} onClick={() => void act(group, "join")} className="min-h-9 rounded-lg bg-cyan-200 px-3 text-xs font-semibold text-slate-950 disabled:opacity-50">{group.member_count >= group.payload.capacity ? "Grupo completo" : working === group.id ? "Salvando…" : "Participar"}</button>}</div>{group.is_member && <StudyGroupChat enrollmentId={enrollmentId} groupId={group.id} readOnly={group.state !== "open"} />}</li>)}</ul>}
  </section>;
}

type CommunityParticipant = { participant_key: string; name: string; avatar_url: string | null; bio: string | null; interests: string[] };
type CommunityConnection = { id: string; revision: number; state: "pending" | "accepted"; direction: "incoming" | "outgoing" | "connected"; participant_key: string; name: string; avatar_url: string | null; greeting: string | null; requested_at: string };
type DirectMessage = { id: string; state: string; sender_user_id: string; sender_name: string; body: string; sent_at: string };
function ParticipantDirectory({ enrollmentId }: { enrollmentId: string }) {
  const [participants, setParticipants] = useState<CommunityParticipant[]>([]);
  const [connections, setConnections] = useState<CommunityConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [openConversation, setOpenConversation] = useState("");
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const base = `/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/community`;
  const connectionsEndpoint = `${base}/connections`;
  const load = useCallback(() => {
    Promise.all([api<CommunityParticipant[]>(`${base}/participants`), api<CommunityConnection[]>(connectionsEndpoint)])
      .then(([people, links]) => { setParticipants(people); setConnections(links); })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Não foi possível carregar os perfis e conexões."))
      .finally(() => setLoading(false));
  }, [base, connectionsEndpoint]);
  useEffect(() => { void load(); }, [load]);
  async function connect(participant: CommunityParticipant) {
    setWorking(participant.participant_key); setError("");
    try {
      await api(connectionsEndpoint, { method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), participant_key: participant.participant_key }) });
      load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível enviar a solicitação."); }
    finally { setWorking(""); }
  }
  async function respond(connection: CommunityConnection, action: "accept" | "decline" | "cancel") {
    setWorking(connection.id); setError("");
    try {
      await api(`${connectionsEndpoint}/${encodeURIComponent(connection.id)}/${action}`, { method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID() }) });
      load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível atualizar a conexão."); }
    finally { setWorking(""); }
  }
  async function loadConversation(connection: CommunityConnection) {
    setOpenConversation(connection.id); setError("");
    try {
      const result = await api<{ user_id: string; messages: DirectMessage[] }>(`${connectionsEndpoint}/${encodeURIComponent(connection.id)}/messages`);
      setCurrentUserId(result.user_id);
      setMessages(result.messages);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível carregar as mensagens."); }
  }
  async function sendMessage(connection: CommunityConnection, event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const message = draft.trim(); if (!message) return;
    setWorking(connection.id); setError("");
    try {
      await api(`${connectionsEndpoint}/${encodeURIComponent(connection.id)}/messages`, { method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), body: message }) });
      setDraft(""); await loadConversation(connection);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível enviar a mensagem."); }
    finally { setWorking(""); }
  }
  function avatar(src: string | null) {
    return <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-cyan-200/10 text-cyan-100">{src ? <Image src={src} alt="" width={40} height={40} unoptimized className="size-10 object-cover" /> : <UserRound size={18} aria-hidden="true" />}</div>;
  }
  return <section aria-labelledby="participants-title" className="border-t border-white/[0.08] p-5 sm:p-7">
    <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-cyan-200"><Users size={14} aria-hidden="true" /> Networking</p><h3 id="participants-title" className="mt-2 text-lg font-semibold text-white">Colegas que optaram por se apresentar</h3><p className="mt-1 text-xs text-[#9fadbc]">Envie uma solicitação para se conectar. E-mails e telefones nunca são compartilhados por este diretório.</p>
    {error && <p role="alert" className="mt-3 text-xs text-rose-200">{error}</p>}
    {!loading && connections.length > 0 && <section className="mt-4 rounded-xl border border-[#3b4754] bg-black/10 p-4"><h4 className="text-sm font-semibold text-white">Solicitações e conexões</h4><ul className="mt-3 space-y-2">{connections.map((connection) => <li key={connection.id} className="rounded-lg bg-white/[0.03] p-3"><div className="flex flex-wrap items-center gap-3">{avatar(connection.avatar_url)}<div className="min-w-0 flex-1"><p className="text-sm font-medium text-[#dee4ea]">{connection.name}</p><p className="text-xs text-[#9fadbc]">{connection.direction === "connected" ? "Conectados" : connection.direction === "incoming" ? "Solicitação recebida" : "Solicitação enviada"}{connection.greeting && connection.direction === "incoming" ? ` · ${connection.greeting}` : ""}</p></div>{connection.direction === "incoming" && <><button type="button" disabled={working === connection.id} onClick={() => void respond(connection, "accept")} className="min-h-9 rounded-lg bg-cyan-200 px-3 text-xs font-semibold text-slate-950 disabled:opacity-50">Aceitar</button><button type="button" disabled={working === connection.id} onClick={() => void respond(connection, "decline")} className="min-h-9 rounded-lg border border-[#3b4754] px-3 text-xs text-[#b6c2cf]">Recusar</button></>}{connection.direction === "outgoing" && <button type="button" disabled={working === connection.id} onClick={() => void respond(connection, "cancel")} className="min-h-9 rounded-lg border border-[#3b4754] px-3 text-xs text-[#b6c2cf]">Cancelar</button>}{connection.direction === "connected" && <button type="button" onClick={() => openConversation === connection.id ? setOpenConversation("") : void loadConversation(connection)} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-cyan-200/20 px-3 text-xs text-cyan-100 hover:bg-cyan-200/[0.06]"><MessageCircle size={14} aria-hidden="true" />{openConversation === connection.id ? "Fechar conversa" : "Mensagem direta"}</button>}</div>{openConversation === connection.id && <div className="mt-3 rounded-lg border border-white/[0.08] bg-[#1d2125] p-3"><div role="log" aria-label={`Mensagens com ${connection.name}`} tabIndex={0} className="max-h-64 space-y-3 overflow-y-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200" aria-live="polite">{messages.length === 0 ? <p className="text-xs text-[#9fadbc]">Comece a conversa com {connection.name}.</p> : messages.map((message) => <article key={message.id} className={`max-w-[90%] rounded-lg p-3 ${message.sender_user_id === currentUserId ? "ml-auto bg-cyan-200/10" : "bg-white/[0.05]"}`}><p className="text-[11px] text-cyan-100">{message.sender_name} · {dateLabel(message.sent_at)}</p><p className="mt-1 whitespace-pre-wrap text-sm text-[#b6c2cf]">{message.body}</p></article>)}</div><form onSubmit={(event) => void sendMessage(connection, event)} className="mt-3 flex gap-2"><label className="sr-only" htmlFor={`direct-message-${connection.id}`}>Mensagem para {connection.name}</label><textarea id={`direct-message-${connection.id}`} value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={4000} required rows={2} placeholder={`Escreva para ${connection.name}`} className="min-h-10 flex-1 resize-y rounded-lg border border-[#3b4754] bg-black/20 px-3 py-2 text-sm text-white placeholder:text-[#9fadbc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" /><button disabled={working === connection.id || !draft.trim()} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-cyan-200 px-3 text-xs font-semibold text-slate-950 disabled:opacity-50"><Send size={14} aria-hidden="true" />Enviar</button></form></div>}</li>)}</ul></section>}
    {loading ? <p role="status" className="mt-4 text-sm text-[#9fadbc]">Carregando perfis…</p> : participants.length === 0 ? <p className="mt-4 rounded-lg border border-dashed border-[#3b4754] p-5 text-center text-sm text-[#9fadbc]">Nenhum colega ativou o perfil público nesta edição.</p> : <ul className="mt-4 grid gap-3 sm:grid-cols-2">{participants.map((participant) => { const connection = connections.find((item) => item.participant_key === participant.participant_key); return <li key={participant.participant_key} className="flex gap-3 rounded-xl border border-[#3b4754] bg-white/[0.02] p-4">{avatar(participant.avatar_url)}<div className="min-w-0 flex-1"><p className="text-sm font-semibold text-white">{participant.name}</p>{participant.bio && <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[#b6c2cf]">{participant.bio}</p>}{participant.interests.length > 0 && <ul aria-label="Interesses" className="mt-2 flex flex-wrap gap-1.5">{participant.interests.map((interest) => <li key={interest} className="rounded-full bg-cyan-200/[0.08] px-2 py-1 text-[10px] text-cyan-100">{interest}</li>)}</ul>}<div className="mt-3">{!connection ? <button type="button" disabled={working === participant.participant_key} onClick={() => void connect(participant)} className="min-h-9 rounded-lg border border-cyan-200/20 px-3 text-xs text-cyan-100 hover:bg-cyan-200/[0.06] disabled:opacity-50">{working === participant.participant_key ? "Enviando…" : "Conectar"}</button> : connection.direction === "connected" ? <span className="text-xs text-emerald-200">Conectados</span> : connection.direction === "incoming" ? <span className="text-xs text-cyan-100">Solicitação recebida</span> : <span className="text-xs text-[#9fadbc]">Solicitação enviada</span>}</div></div></li>; })}</ul>}
  </section>;
}

function ReportCommunityButton({ endpoint, targetId, targetKind }: { endpoint: string; targetId: string; targetKind: "discussion_thread" | "discussion_reply" }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("inappropriate");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setMessage("");
    try {
      await api(endpoint, { method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), target_record_id: targetId, target_kind: targetKind, reason, details: details.trim() || undefined }) });
      setOpen(false); setMessage("Denúncia enviada");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Não foi possível enviar a denúncia."); }
    finally { setBusy(false); }
  }
  return <span className="inline-flex flex-wrap items-center gap-2"><button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="inline-flex min-h-8 items-center gap-1 rounded-md border border-transparent px-2 text-xs text-[#9fadbc] hover:border-[#80909d] hover:bg-white/5 hover:text-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"><Flag size={12} aria-hidden="true" />Denunciar</button>{message && <span role="status" aria-live="polite" className="text-[11px] text-[#9fadbc]">{message}</span>}{open && <form onSubmit={(event) => void submit(event)} className="mt-2 flex w-full flex-wrap items-center gap-2"><label className="sr-only" htmlFor={`report-reason-${targetId}`}>Motivo da denúncia</label><select id={`report-reason-${targetId}`} value={reason} onChange={(event) => setReason(event.target.value)} className="min-h-8 rounded-md border border-[#3b4754] bg-[#1d2125] px-2 text-xs text-[#b6c2cf] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"><option value="harassment">Assédio</option><option value="spam">Spam</option><option value="personal_data">Dados pessoais</option><option value="inappropriate">Conteúdo impróprio</option><option value="other">Outro</option></select><label className="sr-only" htmlFor={`report-details-${targetId}`}>Detalhes opcionais da denúncia</label><input id={`report-details-${targetId}`} value={details} onChange={(event) => setDetails(event.target.value)} maxLength={2000} placeholder="Detalhes (opcional)" className="min-h-8 min-w-32 flex-1 rounded-md border border-[#3b4754] bg-[#1d2125] px-2 text-xs text-white placeholder:text-[#9fadbc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" /><button disabled={busy} className="min-h-8 rounded-md bg-amber-100 px-3 text-xs font-semibold text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200 disabled:opacity-50">{busy ? "Enviando…" : "Enviar denúncia"}</button></form>}</span>;
}

function AssignmentCard({ assignment, enrollmentId, onSaved }: { assignment: Learning["assignments"][number]; enrollmentId: string; onSaved: () => void }) {
  const [answer, setAnswer] = useState(assignment.submission?.state === "returned" ? assignment.submission.answer || "" : "");
  const [groupId, setGroupId] = useState(assignment.submission?.group_id || assignment.groups[0]?.id || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [downloading, setDownloading] = useState("");
  const canSubmit = !assignment.submission || assignment.submission.state === "returned";
  async function downloadFile(file: { id: string; file_name: string }) {
    if (!assignment.submission) return;
    setDownloading(file.id); setError("");
    try {
      const blob = await apiBlob(`/extensions/suinda-learning/records/${encodeURIComponent(assignment.submission.id)}/attachments/${assignment.submission.revision}/${encodeURIComponent(file.id)}`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.file_name; anchor.click(); URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível baixar o arquivo."); }
    finally { setDownloading(""); }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !answer.trim() || assignment.payload.group_submission && !groupId) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const prior = assignment.submission?.state === "returned" ? assignment.submission : null;
      if (files.length > 5 || files.reduce((size, file) => size + file.size, 0) > 8 * 1024 * 1024) throw new Error("Selecione até cinco arquivos, com no máximo 8 MB no total.");
      const attachments: Array<{ file_name: string; mime_type: string; data_base64: string }> = [];
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
        attachments.push({ file_name: file.name, mime_type: file.type, data_base64: btoa(binary) });
      }
      await api(`/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/assessments/${encodeURIComponent(assignment.id)}/submissions`, {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), answer: answer.trim(), attachments, ...(assignment.payload.group_submission ? { group_id: groupId } : {}),
          ...(prior ? { submission_id: prior.id, expected_revision: prior.revision } : {}) }),
      });
      setMessage(assignment.payload.group_submission ? "Entrega do grupo enviada. A equipe docente poderá consultar a resposta da equipe." : "Atividade enviada. A equipe docente poderá consultar sua resposta.");
      onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível enviar a atividade."); }
    finally { setSaving(false); }
  }
  const submission = assignment.submission;
  return <li className="rounded-lg border border-white/[0.08] bg-black/10 p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-medium text-white">{assignment.title}</h3>{assignment.payload.due_at && <p className="mt-1 text-xs text-[#9fadbc]">Prazo: {dateLabel(assignment.payload.due_at) || "Data inválida"}</p>}</div>{submission && <span className={`rounded-full px-2.5 py-1 text-[11px] ${submission.late ? "bg-amber-200/10 text-amber-100" : "bg-white/[0.06] text-[#b6c2cf]"}`}>{submission.state === "returned" ? "Devolvida para revisão" : submission.state === "completed" ? "Corrigida" : submission.late ? "Enviada com atraso" : "Enviada"}</span>}</div>
    {assignment.payload.instructions && <p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-[#b6c2cf]">{assignment.payload.instructions}</p>}
    {(submission?.rubric_snapshot || assignment.payload.rubric)?.length ? <RubricDisplay rubric={submission?.rubric_snapshot || assignment.payload.rubric || []} criterionScores={submission?.criterion_scores} /> : null}
    {!!submission?.files?.length && <ul aria-label="Arquivos enviados" className="mt-3 flex flex-wrap gap-2">{submission.files.map((file) => <li key={file.id}><button type="button" onClick={() => downloadFile(file)} disabled={Boolean(downloading)} className="min-h-9 rounded-lg border border-[#3b4754] px-3 text-xs text-cyan-100 hover:bg-white/5 disabled:opacity-50">{downloading === file.id ? "Baixando…" : `Baixar ${file.file_name}`}</button></li>)}</ul>}
    {submission?.score !== undefined && <p className="mt-3 text-sm font-semibold text-cyan-100">Nota: {submission.score}%</p>}{submission?.feedback && <p className="mt-2 whitespace-pre-wrap rounded-lg border border-white/[0.08] p-3 text-xs leading-5 text-[#b6c2cf]">{submission.feedback}</p>}
    {canSubmit ? <form onSubmit={submit} aria-busy={saving} className="mt-4">{assignment.payload.group_submission && <label className="block text-xs font-medium text-[#b6c2cf]">Grupo da entrega<select required value={groupId} onChange={(event) => setGroupId(event.target.value)} className="mt-2 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-[#dee4ea] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"><option value="">Selecione um grupo</option>{assignment.groups.map((group) => <option key={group.id} value={group.id}>{group.title} · {group.member_count} integrantes</option>)}</select>{!assignment.groups.length && <span className="mt-1 block text-xs text-amber-200">Participe de um grupo de estudo com pelo menos duas pessoas desta turma para enviar.</span>}</label>}<label className="mt-3 block text-xs font-medium text-[#b6c2cf]" htmlFor={`assignment-${assignment.id}`}>{submission ? "Atualize sua resposta" : "Sua resposta"}<textarea id={`assignment-${assignment.id}`} required value={answer} onChange={(event) => setAnswer(event.target.value)} maxLength={50000} rows={5} className="mt-2 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] p-3 text-sm leading-6 text-[#dee4ea] placeholder:text-[#9fadbc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" placeholder="Escreva sua resposta…" /></label><label className="mt-3 block text-xs font-medium text-[#b6c2cf]" htmlFor={`assignment-files-${assignment.id}`}>Anexos (PDF, imagens, texto, DOCX ou XLSX; até 5 arquivos e 8 MB no total)<input id={`assignment-files-${assignment.id}`} type="file" multiple accept="application/pdf,image/png,image/jpeg,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const selected = Array.from(event.target.files || []); setFiles(selected); const total = selected.reduce((size, file) => size + file.size, 0); setError(selected.length > 5 ? "Selecione no máximo cinco arquivos." : total > 8 * 1024 * 1024 ? "O total dos anexos não pode exceder 8 MB." : ""); }} className="mt-2 block w-full text-xs text-[#9fadbc] file:mr-3 file:min-h-9 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:text-xs file:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" /></label>{files.length > 0 && <div className="mt-2 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3" aria-live="polite"><p className="text-xs text-[#b6c2cf]">{files.length} {files.length === 1 ? "arquivo selecionado" : "arquivos selecionados"} · {(files.reduce((size, file) => size + file.size, 0) / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} MB de 8 MB</p><ul className="mt-2 space-y-1">{files.map((file) => <li key={`${file.name}-${file.size}-${file.lastModified}`} className="truncate text-xs text-[#9fadbc]">{file.name} · {(file.size / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} MB</li>)}</ul></div>}<button type="submit" disabled={saving || !answer.trim() || files.length > 5 || files.reduce((size, file) => size + file.size, 0) > 8 * 1024 * 1024 || assignment.payload.group_submission === true && !groupId} className="mt-3 min-h-10 rounded-lg bg-cyan-200 px-4 text-xs font-semibold text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:opacity-50">{saving ? "Enviando…" : submission ? "Reenviar atividade" : "Enviar atividade"}</button>{saving && <p role="status" className="sr-only">Enviando atividade…</p>}</form> : submission?.answer && <details className="mt-3"><summary className="cursor-pointer text-xs font-medium text-[#9fadbc]">Ver resposta enviada · versão {submission.version || 1}</summary><p className="mt-2 whitespace-pre-wrap rounded-lg bg-white/[0.03] p-3 text-xs leading-5 text-[#b6c2cf]">{submission.answer}</p></details>}
    {message && <p role="status" className="mt-2 text-xs text-emerald-200">{message}</p>}{error && <p role="alert" className="mt-2 text-xs text-rose-200">{error}</p>}
  </li>;
}

function RubricDisplay({ rubric, criterionScores }: { rubric: Array<{ id: string; criterion: string; description?: string; points: number }>; criterionScores?: Array<{ criterion_id: string; score: number; feedback?: string }> }) {
  const scores = new Map((criterionScores || []).map((item) => [item.criterion_id, item]));
  return <section className="mt-3 rounded-lg border border-white/[0.08] p-3" aria-label="Critérios de avaliação"><h4 className="text-xs font-semibold text-cyan-100">Critérios de avaliação</h4><ul className="mt-2 space-y-2">{rubric.map((criterion) => { const result = scores.get(criterion.id); return <li key={criterion.id} className="border-t border-white/[0.06] pt-2"><div className="flex justify-between gap-3 text-xs"><span className="font-medium text-[#b6c2cf]">{criterion.criterion}</span><span className="shrink-0 text-[#9fadbc]">{result ? `${result.score} / ${criterion.points}` : `até ${criterion.points} pontos`}</span></div>{criterion.description && <p className="mt-1 text-xs leading-5 text-[#9fadbc]">{criterion.description}</p>}{result?.feedback && <p className="mt-1 text-xs text-[#b6c2cf]">{result.feedback}</p>}</li>; })}</ul></section>;
}

function TrackedMediaPlayer({ enrollmentId, lesson, src, type }: { enrollmentId: string; lesson: Lesson; src: string; type: "audio" | "video" }) {
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const savingRef = useRef(false);
  const pendingSaveRef = useRef<{ position: number; duration: number; playing: boolean } | null>(null);
  const [progress, setProgress] = useState(lesson.payload.media_progress || null);
  const [saveError, setSaveError] = useState("");
  const [captionState, setCaptionState] = useState<{ lessonRevision: string; src: string | null; error: string }>({ lessonRevision: "", src: null, error: "" });
  const captionRevision = `${lesson.id}:${lesson.revision}`;

  useEffect(() => {
    const captions = lesson.payload.captions_vtt;
    let objectUrl: string | null = null;
    const nextState = { lessonRevision: captionRevision, src: null as string | null, error: "" };
    if (type === "video" && captions) {
      if (!safeWebVtt(captions)) {
        nextState.error = "Não foi possível carregar as legendas deste vídeo. Consulte a transcrição da aula, se disponível.";
      } else {
        objectUrl = URL.createObjectURL(new Blob([captions], { type: "text/vtt;charset=utf-8" }));
        nextState.src = objectUrl;
      }
    }
    const update = window.setTimeout(() => setCaptionState(nextState), 0);
    return () => {
      window.clearTimeout(update);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [captionRevision, lesson.payload.captions_vtt, type]);
  const captionTrack = captionState.lessonRevision === captionRevision && captionState.src ? { lessonRevision: captionState.lessonRevision, src: captionState.src } : null;
  const captionError = captionState.lessonRevision === captionRevision ? captionState.error : "";

  const save = useCallback(async (playing: boolean) => {
    const media = mediaRef.current;
    if (!media || !Number.isFinite(media.duration) || media.duration <= 0) return;
    const snapshot = { position: media.currentTime, duration: media.duration, playing };
    if (savingRef.current) {
      pendingSaveRef.current = snapshot;
      return;
    }
    savingRef.current = true;
    let next: { position: number; duration: number; playing: boolean } | null = snapshot;
    try {
      while (next) {
        try {
          const saved = await api<MediaProgress>(
            `/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/lessons/${encodeURIComponent(lesson.id)}/media-progress`,
            { method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), position_seconds: next.position, duration_seconds: next.duration, playing: next.playing }) },
          );
          setProgress(saved);
          setSaveError("");
        } catch (reason) { setSaveError(reason instanceof Error ? reason.message : "Não foi possível salvar o progresso da mídia."); }
        next = pendingSaveRef.current;
        pendingSaveRef.current = null;
      }
    } finally { savingRef.current = false; }
  }, [enrollmentId, lesson.id]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const media = mediaRef.current;
      if (media && !media.paused && !media.ended && document.visibilityState === "visible") void save(true);
    }, 12000);
    const pause = () => void save(false);
    const media = mediaRef.current;
    media?.addEventListener("pause", pause);
    media?.addEventListener("ended", pause);
    return () => {
      window.clearInterval(timer);
      media?.removeEventListener("pause", pause);
      media?.removeEventListener("ended", pause);
    };
  }, [save]);

  function restorePosition() {
    const media = mediaRef.current;
    const position = Number(progress?.position_seconds || 0);
    if (media && position > 1 && position < media.duration - 1) media.currentTime = position;
  }

  return <div>
    {type === "video" ? <video ref={(node) => { mediaRef.current = node; }} aria-label={`Vídeo da aula: ${lesson.title}`} className="aspect-video w-full" controls preload="metadata" src={src} onLoadedMetadata={restorePosition}>{captionTrack?.lessonRevision === captionRevision && <track kind="captions" src={captionTrack.src} srcLang={lesson.payload.captions_language || "pt-BR"} label={lesson.payload.captions_label || "Legendas"} default onError={() => setCaptionState((current) => ({ ...current, lessonRevision: captionRevision, error: "Não foi possível carregar as legendas deste vídeo. Consulte a transcrição da aula, se disponível." }))} />}Seu navegador não consegue reproduzir este vídeo.</video>
      : <audio ref={(node) => { mediaRef.current = node; }} aria-label={`Áudio da aula: ${lesson.title}`} className="w-full" controls preload="metadata" src={src} onLoadedMetadata={restorePosition}>Seu navegador não consegue reproduzir este áudio.</audio>}
    {type === "video" && (captionError || !lesson.payload.captions_vtt) && <p role="status" aria-live="polite" className="mt-2 px-1 text-xs text-[#9fadbc]">{captionError || (lesson.payload.transcript ? "Este vídeo não tem uma faixa de legendas. Consulte a transcrição da aula abaixo." : "Este vídeo não tem uma faixa de legendas disponível.")}</p>}
    <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-2 text-xs text-[#9fadbc]"><span>{progress ? `Progresso assistido: ${Number(progress.percent || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "O progresso será salvo enquanto a mídia estiver em reprodução."}</span>{saveError && <span role="status" className="text-amber-200">{saveError}</span>}</div>
  </div>;
}

function TrackedEmbeddedVideo({ enrollmentId, lesson, src, provider }: { enrollmentId: string; lesson: Lesson; src: string; provider: "youtube" | "vimeo" }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const playerRef = useRef<YouTubePlayer | VimeoPlayer | null>(null);
  const playingRef = useRef(false);
  const savingRef = useRef(false);
  const pendingSaveRef = useRef<{ position: number; duration: number; playing: boolean } | null>(null);
  const [progress, setProgress] = useState(lesson.payload.media_progress || null);
  const [playerError, setPlayerError] = useState("");
  const [captionMessage, setCaptionMessage] = useState("");
  const iframeId = `suinda-player-${lesson.id}`;
  const resumePositionRef = useRef(Number(lesson.payload.media_progress?.position_seconds || 0));
  const iframeSrc = useMemo(() => {
    if (provider === "youtube") return youtubeCaptionEmbedUrl(src, lesson.payload.provider_captions_confirmed === true,
      lesson.payload.captions_language) || src;
    return src;
  }, [lesson.payload.captions_language, lesson.payload.provider_captions_confirmed, provider, src]);

  const save = useCallback(async (position: number, duration: number, playing: boolean) => {
    if (duration <= 0) return;
    if (savingRef.current) {
      // Keep the newest position so pause/unmount progress is not lost behind
      // an in-flight periodic checkpoint.
      pendingSaveRef.current = { position, duration, playing };
      return;
    }
    savingRef.current = true;
    let next: { position: number; duration: number; playing: boolean } | null = { position, duration, playing };
    try {
      while (next) {
        try {
          const saved = await api<MediaProgress>(
            `/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/lessons/${encodeURIComponent(lesson.id)}/media-progress`,
            { method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), position_seconds: next.position, duration_seconds: next.duration, playing: next.playing }) },
          );
          setProgress(saved); setPlayerError("");
        } catch (reason) {
          setPlayerError(reason instanceof Error ? reason.message : "Não foi possível salvar o progresso do player externo.");
        }
        next = pendingSaveRef.current;
        pendingSaveRef.current = null;
      }
    } finally {
      savingRef.current = false;
    }
  }, [enrollmentId, lesson.id]);

  useEffect(() => {
    if (!iframeSrc) return;
    let disposed = false;
    let vimeoHandlers: Array<["play" | "pause" | "ended" | "loaded", (event?: { seconds?: number; duration?: number }) => void]> = [];
    async function attach() {
      try {
        if (provider === "youtube") {
          const restoreYouTubePosition = (target: YouTubePlayer) => {
            const position = resumePositionRef.current;
            const duration = target.getDuration();
            if (position > 1 && duration > 0 && position < duration - 1) {
              target.seekTo(position, true);
              resumePositionRef.current = 0;
            }
          };
          if (iframeRef.current) {
            const url = new URL(iframeRef.current.src);
            url.searchParams.set("origin", window.location.origin);
            iframeRef.current.src = url.toString();
          }
          await loadYouTubeApi();
          if (disposed || !window.YT?.Player || !iframeRef.current) return;
          const player = new window.YT.Player(iframeId, {
            events: {
              onReady: ({ target }) => {
                playerRef.current = target;
                restoreYouTubePosition(target);
              },
              onStateChange: ({ target, data }) => {
                if (disposed) return;
                try {
                  restoreYouTubePosition(target);
                  const nowPlaying = data === 1;
                  if (!nowPlaying && playingRef.current) void save(target.getCurrentTime(), target.getDuration(), false);
                  playingRef.current = nowPlaying;
                } catch {
                  playingRef.current = false;
                  setPlayerError("O player do YouTube falhou ao informar o progresso. O último ponto salvo foi mantido.");
                }
              },
              onError: ({ data }) => {
                if (disposed) return;
                playingRef.current = false;
                const description = data === 101 || data === 150
                  ? "O YouTube bloqueou a reprodução deste vídeo incorporado."
                  : "O YouTube não conseguiu reproduzir este vídeo.";
                setPlayerError(`${description} O último ponto salvo foi mantido; o progresso desta tentativa não será contado.`);
              },
            },
          });
          playerRef.current = player;
        } else {
          await loadVimeoApi();
          if (disposed || !window.Vimeo?.Player || !iframeRef.current) return;
          const player = new window.Vimeo.Player(iframeRef.current);
          playerRef.current = player;
          const play = () => { playingRef.current = true; };
          const pause = () => {
            playingRef.current = false;
            void Promise.all([player.getCurrentTime(), player.getDuration()]).then(([position, duration]) => save(position, duration, false)).catch(() => {
              if (!disposed) setPlayerError("O Vimeo não confirmou a posição ao pausar. O último ponto salvo foi mantido.");
            });
          };
          const loaded = async (event?: { seconds?: number; duration?: number }) => {
            const position = resumePositionRef.current;
            const duration = Number(event?.duration || await player.getDuration());
            if (position > 1 && duration > 0 && position < duration - 1) {
              resumePositionRef.current = 0;
              void player.setCurrentTime(position).catch(() => undefined);
            }
          };
          vimeoHandlers = [["play", play], ["pause", pause], ["ended", pause], ["loaded", loaded]];
          for (const [event, handler] of vimeoHandlers) player.on(event, handler);
          void player.ready().then(async () => {
            await loaded();
            if (disposed || lesson.payload.provider_captions_confirmed !== true) return;
            try {
              const track = findVimeoCaptionsTrack(await player.getTextTracks(), lesson.payload.captions_language);
              if (!track) {
                setCaptionMessage(lesson.payload.captions_language
                  ? "A equipe confirmou legendas, mas o Vimeo não disponibilizou uma faixa no idioma cadastrado. Consulte a transcrição abaixo."
                  : "A equipe confirmou legendas, mas o Vimeo não disponibilizou uma faixa de legendas. Consulte a transcrição abaixo.");
                return;
              }
              const enabled = await player.enableTextTrack(track.language, "captions");
              if (!disposed) setCaptionMessage(`Legendas ${enabled.label || enabled.language} ativadas no player.`);
            } catch {
              if (!disposed) setCaptionMessage("Não foi possível ativar automaticamente as legendas confirmadas. Use CC nos controles do Vimeo ou consulte a transcrição abaixo.");
            }
          }).catch((reason: unknown) => {
            if (!disposed) setPlayerError(reason instanceof Error ? reason.message : "Não foi possível iniciar o player do Vimeo.");
          });
        }
      } catch (reason) {
        if (!disposed) setPlayerError(reason instanceof Error ? reason.message : "Não foi possível conectar ao player externo.");
      }
    }
    void attach();
    const timer = window.setInterval(() => {
      if (!playingRef.current || document.visibilityState !== "visible") return;
      if (provider === "youtube") {
        const player = playerRef.current as YouTubePlayer | null;
        if (!player) return;
        try {
          if (player.getPlayerState() !== 1) return;
          void save(player.getCurrentTime(), player.getDuration(), true);
        } catch {
          playingRef.current = false;
          setPlayerError("O YouTube deixou de informar o progresso. O último ponto salvo foi mantido.");
        }
      } else {
        const player = playerRef.current as VimeoPlayer | null;
        if (!player) return;
        void Promise.all([player.getCurrentTime(), player.getDuration()]).then(([position, duration]) => {
          if (playingRef.current && !disposed) return save(position, duration, true);
          return undefined;
        }).catch(() => {
          if (!disposed) {
            playingRef.current = false;
            setPlayerError("O Vimeo deixou de informar o progresso. O último ponto salvo foi mantido; confira se o vídeo continua reproduzindo.");
          }
        });
      }
    }, 12000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      const player = playerRef.current;
      if (player && provider === "vimeo") {
        const vimeo = player as VimeoPlayer;
        for (const [event, handler] of vimeoHandlers) vimeo.off(event, handler);
        if (playingRef.current) void Promise.all([vimeo.getCurrentTime(), vimeo.getDuration()]).then(([position, duration]) => save(position, duration, false)).catch(() => undefined);
        void vimeo.destroy().catch(() => undefined);
      } else if (player && provider === "youtube") {
        const youtube = player as YouTubePlayer;
        if (playingRef.current) void save(youtube.getCurrentTime(), youtube.getDuration(), false);
        youtube.destroy();
      }
      playingRef.current = false;
      playerRef.current = null;
    };
  }, [iframeId, iframeSrc, lesson.id, lesson.payload.captions_language, lesson.payload.provider_captions_confirmed, provider, save]);

  return <div><iframe ref={iframeRef} id={iframeId} className="aspect-video w-full" src={iframeSrc} title={lesson.title}
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />
    <p role={captionMessage ? "status" : "note"} aria-live={captionMessage ? "polite" : undefined} className="px-3 pt-2 text-xs leading-5 text-[#9fadbc]">{captionMessage || (lesson.payload.provider_captions_confirmed === true
      ? provider === "youtube" ? "Legendas confirmadas pela equipe: o player tentará exibi-las automaticamente. Ajuste CC nos controles se preferir."
        : "Legendas confirmadas pela equipe: verificando a faixa no player."
      : "Legendas deste player ainda não confirmadas pela equipe; a equipe deve revisar o vídeo.")} {lesson.payload.transcript
        ? "A transcrição da aula está disponível abaixo."
        : "A transcrição da aula ainda precisa ser adicionada."}</p>
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs text-[#9fadbc]"><span>{progress ? `Progresso assistido: ${Number(progress.percent || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "O progresso será salvo enquanto o player estiver em reprodução."}</span>{playerError && <span role="status" className="text-amber-200">{playerError}</span>}</div>
  </div>;
}

function PracticeCard({ practice, enrollmentId, onSaved }: { practice: Learning["practices"][number]; enrollmentId: string; onSaved: () => void }) {
  const [hours, setHours] = useState(String(practice.hours_claimed || ""));
  const [notes, setNotes] = useState(practice.completion_notes || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const canSubmit = ["in_progress", "needs_correction"].includes(practice.state);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !canSubmit) return;
    setSaving(true); setError(""); setMessage("");
    try {
      await api(`/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/practices/${encodeURIComponent(practice.id)}/submit`, {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), expected_revision: practice.revision,
          hours_claimed: Number(hours), completion_notes: notes.trim() }),
      });
      setMessage("Relato enviado ao supervisor para validação.");
      onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível enviar o relato da prática."); }
    finally { setSaving(false); }
  }
  const status = practice.state === "validated" ? "Horas validadas" : practice.state === "submitted" ? "Aguardando supervisor" : practice.state === "needs_correction" ? "Precisa de ajuste" : practice.state === "in_progress" ? "Em andamento" : practice.state === "canceled" ? "Cancelada" : "Agendada";
  return <li className="rounded-lg border border-white/[0.08] bg-black/10 p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-medium text-white">{practice.title}</h3><p className="mt-1 text-xs text-[#9fadbc]">{dateLabel(practice.scheduled_at) || "Data a confirmar"}{practice.location ? ` · ${practice.location}` : ""}</p></div><span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] text-[#b6c2cf]">{status}</span></div><p className="mt-3 text-xs font-medium text-cyan-100">Atividade prevista</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[#b6c2cf]">{practice.activity_description}</p>{practice.state === "validated" && <p className="mt-3 text-sm font-semibold text-emerald-200">{practice.hours_validated || 0} h validadas</p>}{practice.review_feedback && <p className="mt-3 whitespace-pre-wrap rounded-lg border border-amber-200/10 bg-amber-200/[0.04] p-3 text-xs leading-5 text-amber-100">Orientação do supervisor: {practice.review_feedback}</p>}
    {canSubmit ? <form onSubmit={submit} aria-busy={saving} className="mt-4"><label className="block text-xs font-medium text-[#b6c2cf]">Horas realizadas<input type="number" required min="0.25" max="10000" step="0.25" value={hours} onChange={(event) => setHours(event.target.value)} className="mt-2 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-[#dee4ea] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" /></label><label className="mt-3 block text-xs font-medium text-[#b6c2cf]">Relato da atividade<textarea required value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={8000} rows={4} className="mt-2 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] p-3 text-sm leading-6 text-[#dee4ea] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" placeholder="Descreva as atividades realizadas e o aprendizado obtido." /></label><button type="submit" disabled={saving || !notes.trim() || Number(hours) <= 0} className="mt-3 min-h-10 rounded-lg bg-cyan-200 px-4 text-xs font-semibold text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:opacity-50">{saving ? "Enviando…" : practice.state === "needs_correction" ? "Reenviar relato" : "Enviar para validação"}</button>{saving && <p role="status" className="sr-only">Enviando relato de prática…</p>}</form> : practice.completion_notes && <details className="mt-3"><summary className="cursor-pointer text-xs font-medium text-[#9fadbc]">Ver relato enviado · {practice.hours_claimed} h declaradas</summary><p className="mt-2 whitespace-pre-wrap rounded-lg bg-white/[0.03] p-3 text-xs leading-5 text-[#b6c2cf]">{practice.completion_notes}</p></details>}
    {message && <p role="status" className="mt-2 text-xs text-emerald-200">{message}</p>}{error && <p role="alert" className="mt-2 text-xs text-rose-200">{error}</p>}</li>;
}

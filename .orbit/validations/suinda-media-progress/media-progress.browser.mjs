import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");
const baseUrl = (process.env.SUINDA_MEDIA_BASE_URL || "http://localhost:3003").replace(/\/$/, "");
const chromePath = process.env.CHROME_PATH || ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/opt/google/chrome/chrome"]
  .find((candidate) => existsSync(candidate));
const enrollmentId = "00000000-0000-4000-8000-000000000301";
const lessonId = "00000000-0000-4000-8000-000000000302";
const captionTestVideo = readFileSync(new URL("./fixtures/caption-test.mp4", import.meta.url));
const priorProgress = { position_seconds: 120, watched_seconds: 60, duration_seconds: 300, percent: 20 };
const learningResponse = (provider) => ({
  enrollment: { id: enrollmentId, title: "Matrícula de validação", state: "active" },
  course: { id: "00000000-0000-4000-8000-000000000303", title: "Curso de validação", payload: {} },
  live_sessions: [],
  modules: [{
    id: "00000000-0000-4000-8000-000000000304", title: "Módulo de validação", completed: false, available: true,
    progress: { required_total: 1, required_completed: 0, percent: 0 }, payload: {}, units: [],
    lessons: [{ id: lessonId, title: `Vídeo ${provider} de validação`, revision: 1, state: "published", completed: false,
      required: true, available: true, payload: { content_type: "video", content_url: provider === "youtube"
        ? "https://www.youtube.com/watch?v=abcdefghijk" : provider === "vimeo" ? "https://vimeo.com/123456789" : "https://media.example.test/lesson.mp4",
        ...(provider === "native" ? { transcript: "O vídeo apresenta fundo preto e um tom de alerta sintético durante três segundos.", transcript_reviewed: true,
          captions_vtt: "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nTom de alerta sintético.\n", captions_language: "pt-BR", captions_label: "Português (Brasil)" } : {}), media_progress: priorProgress } }],
  }],
  progress: { required_total: 1, required_completed: 0, percent: 0 },
  attendance: { percent: null, minimum_percent: 0, attended_minutes: 0, scheduled_minutes: 0,
    sessions_present: 0, sessions_absent: 0, sessions_unmarked: 0, meets_minimum: null },
  workload_progress: { attended_class_hours: 0, validated_practice_hours: 0, credited_practice_hours: 0, completed_hours: 0 },
  submissions: [], assignments: [], practices: [],
});

const browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : {}), args: ["--no-sandbox"] });
const results = [];
try {
  for (const provider of ["youtube", "vimeo"]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    let mediaProgressWrites = 0;
    await page.addInitScript(() => {
      localStorage.setItem("orbit_token", "suinda-media-progress-local-validation");
      localStorage.setItem("orbit_user", JSON.stringify({ id: "local-validation-user", name: "Validação local" }));

      window.__suindaYouTube = null;
      window.YT = { Player: class {
        constructor(_element, options) {
          this.options = options;
          this.position = 120;
          this.duration = 300;
          window.__suindaYouTube = this;
          setTimeout(() => options.events.onReady({ target: this }), 0);
        }
        getCurrentTime() { return this.position; }
        getDuration() { return this.duration; }
        getPlayerState() { return 1; }
        seekTo(position) { this.position = position; }
        destroy() {}
      } };

      window.__suindaVimeo = null;
      window.__suindaVimeoFailRead = false;
      window.Vimeo = { Player: class {
        constructor() { this.handlers = new Map(); window.__suindaVimeo = this; }
        on(event, callback) { this.handlers.set(event, callback); }
        off(event, callback) { if (this.handlers.get(event) === callback) this.handlers.delete(event); }
        ready() { return Promise.resolve(); }
        getCurrentTime() { return window.__suindaVimeoFailRead ? Promise.reject(new Error("Falha simulada de leitura Vimeo")) : Promise.resolve(120); }
        getDuration() { return Promise.resolve(300); }
        setCurrentTime(position) { return Promise.resolve(position); }
        destroy() { return Promise.resolve(); }
        emit(event) { this.handlers.get(event)?.({ seconds: 120, duration: 300 }); }
      } };
    });
    await page.route("https://www.youtube-nocookie.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Local player mock</title>" }));
    await page.route("https://player.vimeo.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Local player mock</title>" }));
    await page.route("**/api/extensions/suinda-learning/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith(`/me/enrollments/${enrollmentId}/learning`)) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(learningResponse(provider)) });
      }
      if (path.endsWith(`/lessons/${lessonId}/media-progress`)) {
        mediaProgressWrites += 1;
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...priorProgress, position_seconds: 180, percent: 40 }) });
      }
      if (path.endsWith("/community")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ threads: [], moderator: false }) });
      if (path.endsWith("/groups") || path.endsWith("/participants") || path.endsWith("/connections")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    const response = await page.goto(`${baseUrl}/suinda/learning/${enrollmentId}`, { waitUntil: "networkidle" });
    assert.equal(response?.status(), 200, `${provider}: página de aprendizagem responde HTTP 200`);
    const oldCheckpoint = page.getByText("Progresso assistido: 20%");
    await oldCheckpoint.waitFor({ state: "visible" });

    if (provider === "youtube") {
      await page.waitForFunction(() => Boolean(window.__suindaYouTube));
      await page.evaluate(() => window.__suindaYouTube.options.events.onError({ data: 150 }));
      await page.getByRole("status").filter({ hasText: "O YouTube bloqueou a reprodução deste vídeo incorporado." }).waitFor({ state: "visible" });
    } else {
      await page.waitForFunction(() => Boolean(window.__suindaVimeo?.handlers.has("pause")));
      await page.evaluate(() => {
        window.__suindaVimeoFailRead = true;
        window.__suindaVimeo.emit("play");
        window.__suindaVimeo.emit("pause");
      });
      await page.getByRole("status").filter({ hasText: "O Vimeo não confirmou a posição ao pausar. O último ponto salvo foi mantido." }).waitFor({ state: "visible" });
    }

    assert.equal(await oldCheckpoint.count(), 1, `${provider}: checkpoint antigo permanece visível`);
    await page.waitForTimeout(300);
    assert.equal(mediaProgressWrites, 0, `${provider}: falha externa não criou progresso novo`);
    results.push({ provider, page_http: response.status(), accessible_error_reported: true, prior_checkpoint_percent: 20, progress_writes_after_failure: mediaProgressWrites });
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem("orbit_token", "suinda-media-captions-local-validation");
    localStorage.setItem("orbit_user", JSON.stringify({ id: "local-validation-user", name: "Validação local" }));
  });
  await page.route("**/api/extensions/suinda-learning/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith(`/me/enrollments/${enrollmentId}/learning`)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(learningResponse("native")) });
    }
    if (path.endsWith("/community")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ threads: [], moderator: false }) });
    if (path.endsWith("/groups") || path.endsWith("/participants") || path.endsWith("/connections")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.route("https://media.example.test/**", (route) => route.fulfill({ status: 200, contentType: "video/mp4", body: captionTestVideo }));
  const response = await page.goto(`${baseUrl}/suinda/learning/${enrollmentId}`, { waitUntil: "networkidle" });
  assert.equal(response?.status(), 200, "vídeo com legendas nativas responde HTTP 200");
  const video = page.getByLabel("Vídeo da aula: Vídeo native de validação");
  await video.waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const media = document.querySelector("video");
    return Boolean(media?.textTracks.length && media.textTracks[0]?.cues?.length === 1);
  }, null, { timeout: 5000 });
  await page.waitForFunction(() => {
    const media = document.querySelector("video");
    return Boolean(media && media.readyState >= HTMLMediaElement.HAVE_METADATA && media.duration >= 2.5);
  }, null, { timeout: 5000 });
  const track = await video.evaluate((media) => {
    const captions = media.querySelector("track");
    return { kind: captions?.kind, language: captions?.srclang, label: captions?.label, is_default: captions?.default,
      cue_text: media.textTracks[0]?.cues?.[0]?.text || "" };
  });
  const activeCaption = await video.evaluate(async (media) => {
    const textTrack = media.textTracks[0];
    if (!textTrack) return { playing: false, active_cue_text: "", current_time: media.currentTime };
    textTrack.mode = "showing";
    media.muted = true;
    media.currentTime = 1.5;
    await media.play();
    const playbackStarted = !media.paused;
    await new Promise((resolve) => {
      const check = () => media.currentTime >= 1.2 ? resolve() : requestAnimationFrame(check);
      check();
    });
    media.pause();
    return { playback_started: playbackStarted, active_cue_text: textTrack.activeCues?.[0]?.text || "", current_time: media.currentTime };
  });
  await page.getByText("Transcrição", { exact: true }).click();
  const transcriptAvailable = await page.getByText("O vídeo apresenta fundo preto e um tom de alerta sintético durante três segundos.", { exact: true }).isVisible();
  await page.addScriptTag({ path: axePath });
  const accessibilityViolations = await page.evaluate(async () => {
    const audit = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"] } });
    return audit.violations.map(({ id, impact, nodes }) => ({ id, impact, count: nodes.length }));
  });
  const captionsPassed = response?.status() === 200 && track.kind === "captions" && track.language === "pt-BR"
    && track.label === "Português (Brasil)" && track.is_default && track.cue_text === "Tom de alerta sintético."
    && activeCaption.playback_started && activeCaption.active_cue_text === "Tom de alerta sintético." && activeCaption.current_time >= 1.2
    && transcriptAvailable && accessibilityViolations.length === 0;
  assert.equal(captionsPassed, true, "vídeo com pista sonora reproduz e ativa legenda WebVTT no intervalo correspondente, expõe idioma/rótulo e transcrição e passa axe");
  results.push({ provider: "native", page_http: response.status(), media_duration_seconds: await video.evaluate((media) => media.duration),
    caption_track: track, active_caption: activeCaption, transcript_available: transcriptAvailable, axe_violations: accessibilityViolations });
  await context.close();
  console.log(JSON.stringify({ base_url: baseUrl, scenarios: results, provider_calls: "YouTube/Vimeo e mídia nativa simulados localmente; sem credenciais ou APIs de provedores", database_used: false }));
} finally {
  await browser.close();
}

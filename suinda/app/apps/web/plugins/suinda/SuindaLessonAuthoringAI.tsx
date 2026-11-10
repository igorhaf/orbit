"use client";

import { useState } from "react";
import { api } from "@/lib/api";

type Suggestion =
  | { lesson_id: string; lesson_revision: number; mode: "summary"; summary: string }
  | { lesson_id: string; lesson_revision: number; mode: "questions"; questions: Array<{ prompt: string; options: string[]; correct_option: number; explanation: string }> };

export default function SuindaLessonAuthoringAI({ lessonId, revision }: { lessonId: string; revision: number }) {
  const [mode, setMode] = useState<"summary" | "questions">("summary");
  const [count, setCount] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Suggestion | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setBusy(true); setError(""); setResult(null); setCopied(false);
    try {
      const suggestion = await api<Suggestion>(`/suinda-learning-assistant/lessons/${encodeURIComponent(lessonId)}/generate`, {
        method: "POST", body: JSON.stringify({ mode, ...(mode === "questions" ? { count } : {}) }),
      });
      if (suggestion.lesson_revision !== revision) throw new Error("A aula mudou durante a geração. Atualize o registro antes de usar a sugestão.");
      setResult(suggestion);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível gerar a sugestão."); }
    finally { setBusy(false); }
  }

  async function copy() {
    if (!result) return;
    try { await navigator.clipboard.writeText(JSON.stringify(result, null, 2)); setCopied(true); }
    catch { setError("Não foi possível copiar. Selecione e copie o conteúdo manualmente."); }
  }

  return <section className="rounded-xl border border-[#3b4754] bg-[#22272b] p-4" aria-labelledby="lesson-ai-title">
    <div>
      <h3 id="lesson-ai-title" className="text-sm font-semibold text-[#dee4ea]">Assistente de autoria</h3>
      <p className="mt-1 max-w-3xl text-xs leading-5 text-[#9fadbc]">Gera um resumo ou questões objetivas usando somente o texto e os objetivos desta aula. A equipe atribuída revisa e copia a sugestão; nada é salvo ou publicado automaticamente. O provedor de IA pode aplicar suas próprias regras de processamento e retenção.</p>
    </div>
    <div className="mt-3 flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-xs text-[#b6c2cf]">Tipo de sugestão
        <select value={mode} onChange={(event) => { setMode(event.target.value as "summary" | "questions"); setResult(null); }} className="min-h-10 rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-[#dee4ea]">
          <option value="summary">Resumo da aula</option><option value="questions">Questões objetivas</option>
        </select>
      </label>
      {mode === "questions" && <label className="grid gap-1 text-xs text-[#b6c2cf]">Quantidade
        <select value={count} onChange={(event) => setCount(Number(event.target.value))} className="min-h-10 rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-[#dee4ea]">
          {[2, 3, 4, 5, 6, 8, 10].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>}
      <button type="button" onClick={() => void generate()} disabled={busy} className="min-h-10 rounded-lg bg-cyan-200 px-4 text-xs font-semibold text-slate-950 disabled:opacity-50">{busy ? "Gerando sugestão…" : "Gerar sugestão"}</button>
    </div>
    {busy && <p role="status" aria-live="polite" className="mt-3 text-xs text-cyan-100">A IA está preparando uma sugestão com o conteúdo desta revisão.</p>}
    {error && <p role="alert" className="mt-3 text-xs text-rose-200">{error}</p>}
    {result && <div className="mt-4 rounded-lg border border-[#3b4754] bg-[#1d2125] p-4" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-medium text-[#b6c2cf]">Sugestão não salva · revisão da aula {result.lesson_revision}</p><button type="button" onClick={() => void copy()} className="min-h-9 rounded-md border border-[#3b4754] px-3 text-xs text-[#dee4ea] hover:bg-white/5">{copied ? "Copiado" : "Copiar JSON"}</button></div>
      {result.mode === "summary" ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#dee4ea]">{result.summary}</p> : <ol className="mt-3 space-y-3">{result.questions.map((question, index) => <li key={`${index}-${question.prompt}`} className="rounded-lg border border-[#3b4754] p-3"><p className="text-sm font-medium text-[#dee4ea]">{index + 1}. {question.prompt}</p><ol className="mt-2 grid gap-1 pl-5 text-xs text-[#b6c2cf]">{question.options.map((option, optionIndex) => <li key={`${optionIndex}-${option}`} className={optionIndex === question.correct_option ? "font-semibold text-emerald-200" : ""}>{String.fromCharCode(65 + optionIndex)}. {option}{optionIndex === question.correct_option ? " · correta sugerida" : ""}</li>)}</ol><p className="mt-2 text-xs leading-5 text-[#9fadbc]">Justificativa sugerida: {question.explanation || "Sem explicação fornecida."}</p></li>)}</ol>}
      <p className="mt-3 text-xs text-amber-100">Confira a precisão e a adequação pedagógica antes de incorporar ao curso.</p>
    </div>}
  </section>;
}

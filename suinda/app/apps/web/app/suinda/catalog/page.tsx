"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, Clock3, Search, Sparkles, Star } from "lucide-react";
import { api, getToken } from "@/lib/api";

type Course = {
  id: string;
  workspace_id: string;
  workspace_name: string;
  instructors?: string[];
  title: string;
  state: string;
  payload: {
    summary?: string;
    description?: string;
    category?: string;
    tags?: string[];
    modality?: "online" | "in_person" | "hybrid";
    format?: "open" | "cohort";
    level?: string;
    workload_hours?: number;
    objectives?: string[];
    price_amount?: number;
    price_from_amount?: number;
    price_to_amount?: number;
    has_free_cohort?: boolean;
    has_paid_cohort?: boolean;
    currency?: string;
    image_url?: string | null;
  };
};

const stateLabels: Record<string, string> = {
  published: "Em breve",
  enrollment_open: "Inscrições abertas",
  in_progress: "Em andamento",
  closed: "Inscrições encerradas",
  completed: "Concluído",
};
const modalityLabels: Record<string, string> = {
  online: "Online",
  in_person: "Presencial",
  hybrid: "Híbrido",
};
const levelLabels: Record<string, string> = {
  introductory: "Introdutório",
  intermediate: "Intermediário",
  advanced: "Avançado",
  specialization: "Especialização",
};

function priceLabel(course: Course) {
  const amount = Number(course.payload.format === "cohort" ? course.payload.price_from_amount ?? course.payload.price_amount ?? 0 : course.payload.price_amount || 0);
  const currency = course.payload.currency || "BRL";
  if (course.payload.format === "cohort" && course.payload.price_from_amount === undefined) return "Preço por turma";
  if (course.payload.format === "cohort" && course.payload.has_free_cohort && course.payload.has_paid_cohort) return "Valores por turma";
  if (course.payload.format === "cohort" && amount === 0) return "Turmas gratuitas";
  if (amount <= 0 || !/^[A-Z]{3}$/.test(currency)) return "Gratuito";
  try {
    const formatted = new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(amount);
    return course.payload.format === "cohort" ? `A partir de ${formatted}` : formatted;
  } catch {
    return "Investimento informado na inscrição";
  }
}

export default function SuindaCatalogPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [modality, setModality] = useState("");
  const [instructor, setInstructor] = useState("");
  const [minimumHours, setMinimumHours] = useState("");
  const [maximumHours, setMaximumHours] = useState("");
  const [priceFilter, setPriceFilter] = useState<"" | "free" | "paid">("");
  const [minimumPrice, setMinimumPrice] = useState("");
  const [maximumPrice, setMaximumPrice] = useState("");
  const [priceCurrency, setPriceCurrency] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [favoriteBusy, setFavoriteBusy] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [recommendations, setRecommendations] = useState<Array<Course & { reason: string }>>([]);
  const [recommendationsByAi, setRecommendationsByAi] = useState(false);
  const [aiRecommendationsBusy, setAiRecommendationsBusy] = useState(false);
  const [aiRecommendationsError, setAiRecommendationsError] = useState("");
  const [aiRecommendationsStatus, setAiRecommendationsStatus] = useState("");
  const [sortOrder, setSortOrder] = useState<"personalized" | "alphabetical">("personalized");

  useEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.theme;
    root.dataset.theme = "dark";
    const authenticated = Boolean(getToken());
    api<Course[]>("/public/suinda/courses")
      .then(setCourses)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Não foi possível carregar os cursos."))
      .finally(() => { setSignedIn(authenticated); setLoading(false); });
    if (authenticated) api<Array<{ course_id: string }>>("/extensions/suinda-learning/me/favorites")
      .then((records) => setFavorites(new Set(records.map((record) => record.course_id))))
      .catch(() => undefined);
    if (authenticated) api<{ recommendations: Array<Course & { reason: string }> }>("/extensions/suinda-learning/me/recommendations")
      .then((result) => setRecommendations(result.recommendations))
      .catch(() => undefined);
    return () => {
      if (previous) root.dataset.theme = previous;
      else delete root.dataset.theme;
    };
  }, []);

  async function generateAiRecommendations() {
    setAiRecommendationsBusy(true);
    setAiRecommendationsError("");
    setAiRecommendationsStatus("");
    try {
      const result = await api<{ recommendations: Array<Course & { reason: string }> }>("/suinda-learning-assistant/recommendations", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setRecommendations(result.recommendations);
      setRecommendationsByAi(true);
      setAiRecommendationsStatus("Recomendações por IA atualizadas.");
    } catch (cause) {
      setAiRecommendationsError(cause instanceof Error ? cause.message : "Não foi possível gerar recomendações por IA.");
    } finally {
      setAiRecommendationsBusy(false);
    }
  }

  async function toggleFavorite(course: Course) {
    if (!getToken()) {
      setError("Entre na sua conta para salvar cursos na lista de desejos.");
      return;
    }
    setFavoriteBusy(course.id);
    setError("");
    const isFavorite = favorites.has(course.id);
    try {
      await api(`/extensions/suinda-learning/me/favorites/${encodeURIComponent(course.id)}`, {
        method: isFavorite ? "DELETE" : "POST",
        body: JSON.stringify({ operation_key: crypto.randomUUID() }),
      });
      setFavorites((current) => {
        const next = new Set(current);
        if (isFavorite) next.delete(course.id);
        else next.add(course.id);
        return next;
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível atualizar sua lista de desejos.");
    } finally { setFavoriteBusy(null); }
  }

  const categories = useMemo(() => [...new Set(courses.map((course) => course.payload.category).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "pt-BR")), [courses]);
  const instructors = useMemo(() => [...new Set(courses.flatMap((course) => course.instructors || []))].sort((a, b) => a.localeCompare(b, "pt-BR")), [courses]);
  const currencies = useMemo(() => [...new Set(courses.map((course) => course.payload.currency || "BRL"))].filter((value) => /^[A-Z]{3}$/.test(value)).sort(), [courses]);
  const priceRangeActive = minimumPrice !== "" || maximumPrice !== "";
  const priceRangeValid = minimumPrice === "" || maximumPrice === "" || Number(minimumPrice) <= Number(maximumPrice);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    const minimum = minimumHours === "" ? null : Number(minimumHours);
    const maximum = maximumHours === "" ? null : Number(maximumHours);
    return courses.filter((course) => {
      const searchable = [course.title, course.workspace_name, course.payload.summary, course.payload.description, course.payload.category, ...(course.instructors || []), ...(course.payload.tags || [])].filter(Boolean).join(" ").toLocaleLowerCase("pt-BR");
      const hours = Number(course.payload.workload_hours || 0);
      const amount = Number(course.payload.format === "cohort" ? course.payload.price_from_amount ?? course.payload.price_amount ?? 0 : course.payload.price_amount || 0);
      const hasFree = course.payload.format === "cohort" ? course.payload.has_free_cohort ?? amount <= 0 : amount <= 0;
      const hasPaid = course.payload.format === "cohort" ? course.payload.has_paid_cohort ?? amount > 0 : amount > 0;
      const currency = course.payload.currency || "BRL";
      const rawPriceFrom = course.payload.format === "cohort" ? course.payload.price_from_amount : course.payload.price_amount;
      const rawPriceTo = course.payload.format === "cohort" ? course.payload.price_to_amount : course.payload.price_amount;
      const priceFrom = typeof rawPriceFrom === "number" && Number.isFinite(rawPriceFrom) ? rawPriceFrom : null;
      const priceTo = typeof rawPriceTo === "number" && Number.isFinite(rawPriceTo) ? rawPriceTo : null;
      const priceMatchesRange = !priceRangeActive || Boolean(priceCurrency && currency === priceCurrency && priceFrom !== null && priceTo !== null
        && (minimumPrice === "" || priceTo >= Number(minimumPrice))
        && (maximumPrice === "" || priceFrom <= Number(maximumPrice)));
      return (!normalized || searchable.includes(normalized))
        && (!category || course.payload.category === category)
        && (!modality || course.payload.modality === modality)
        && (!instructor || course.instructors?.includes(instructor))
        && (minimum === null || hours >= minimum)
        && (maximum === null || hours <= maximum)
        && (!priceFilter || (priceFilter === "free" ? hasFree : hasPaid))
        && priceMatchesRange
        && (!favoritesOnly || favorites.has(course.id));
    });
  }, [courses, query, category, modality, instructor, minimumHours, maximumHours, priceFilter, minimumPrice, maximumPrice, priceCurrency, priceRangeActive, favoritesOnly, favorites]);
  const orderedFiltered = useMemo(() => {
    const rank = new Map(recommendations.map((item, index) => [item.id, index]));
    return [...filtered].sort((left, right) => {
      if (sortOrder === "personalized" && recommendations.length) {
        const leftRank = rank.get(left.id) ?? Number.MAX_SAFE_INTEGER;
        const rightRank = rank.get(right.id) ?? Number.MAX_SAFE_INTEGER;
        if (leftRank !== rightRank) return leftRank - rightRank;
      }
      return left.title.localeCompare(right.title, "pt-BR") || left.id.localeCompare(right.id);
    });
  }, [filtered, recommendations, sortOrder]);

  function clearFilters() {
    setQuery(""); setCategory(""); setModality(""); setInstructor(""); setMinimumHours(""); setMaximumHours("");
    setPriceFilter(""); setMinimumPrice(""); setMaximumPrice(""); setPriceCurrency(""); setFavoritesOnly(false);
  }

  return (
    <main className="min-h-full bg-[#1d2125] text-[#dee4ea]">
      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-10">
        <section className="relative overflow-hidden rounded-[2rem] border border-[#3b4754] bg-[radial-gradient(ellipse_at_top_right,_rgba(34,211,238,0.18),_transparent_42%),linear-gradient(135deg,#111827,#0c1220_65%,#101a27)] px-6 py-10 sm:px-10 sm:py-14">
          <div className="absolute -right-12 -top-24 size-72 rounded-full border border-cyan-200/10" aria-hidden="true" />
          <div className="relative max-w-3xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-cyan-200/20 bg-cyan-200/5 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-100"><Sparkles size={14} aria-hidden="true" /> catálogo de aprendizagem</p>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight text-white sm:text-6xl">Conhecimento que abre caminhos.</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-[#b6c2cf] sm:text-lg">Explore cursos, compare formatos e encontre a próxima habilidade para levar adiante.</p>
          </div>
          <div className="relative mt-8 grid gap-3 rounded-2xl border border-[#3b4754] bg-[#090e18]/75 p-3 shadow-2xl shadow-black/20 sm:grid-cols-2 lg:grid-cols-4 sm:p-4">
            <label className="relative block lg:col-span-2">
              <span className="sr-only">Buscar cursos</span>
              <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#9fadbc]" aria-hidden="true" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por curso, tema ou instituição" className="min-h-12 w-full rounded-xl border border-[#3b4754] bg-white/[0.04] pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-[#9fadbc] focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/20" />
            </label>
            <label className="block">
              <span className="sr-only">Filtrar por categoria</span>
              <select value={category} onChange={(event) => setCategory(event.target.value)} className="min-h-12 w-full rounded-xl border border-[#3b4754] bg-[#2c333a] px-4 text-sm text-[#b6c2cf] outline-none focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/20">
                <option value="">Todas as categorias</option>
                {categories.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="sr-only">Filtrar por modalidade</span>
              <select value={modality} onChange={(event) => setModality(event.target.value)} className="min-h-12 w-full rounded-xl border border-[#3b4754] bg-[#2c333a] px-4 text-sm text-[#b6c2cf] outline-none focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/20">
                <option value="">Todas as modalidades</option>
                {Object.entries(modalityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="sr-only">Filtrar por professor</span>
              <select value={instructor} onChange={(event) => setInstructor(event.target.value)} className="min-h-12 w-full rounded-xl border border-[#3b4754] bg-[#2c333a] px-4 text-sm text-[#b6c2cf] outline-none focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/20">
                <option value="">Todos os professores</option>
                {instructors.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="sr-only">Carga horária mínima, em horas</span>
              <input type="number" min="0" step="0.5" value={minimumHours} onChange={(event) => setMinimumHours(event.target.value)} placeholder="Carga mínima (h)" className="min-h-12 w-full rounded-xl border border-[#3b4754] bg-white/[0.04] px-4 text-sm text-white outline-none placeholder:text-[#9fadbc] focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/20" />
            </label>
            <label className="block">
              <span className="sr-only">Carga horária máxima, em horas</span>
              <input type="number" min="0" step="0.5" value={maximumHours} onChange={(event) => setMaximumHours(event.target.value)} placeholder="Carga máxima (h)" className="min-h-12 w-full rounded-xl border border-[#3b4754] bg-white/[0.04] px-4 text-sm text-white outline-none placeholder:text-[#9fadbc] focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/20" />
            </label>
            <label className="block">
              <span className="sr-only">Filtrar por preço</span>
              <select value={priceFilter} onChange={(event) => setPriceFilter(event.target.value as "" | "free" | "paid")} className="min-h-12 w-full rounded-xl border border-[#3b4754] bg-[#2c333a] px-4 text-sm text-[#b6c2cf] outline-none focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/20">
                <option value="">Qualquer preço</option><option value="free">Gratuitos</option><option value="paid">Pagos</option>
              </select>
            </label>
            <label className="block">
              <span className="sr-only">Moeda para a faixa de preço</span>
              <select value={priceCurrency} onChange={(event) => setPriceCurrency(event.target.value)} className="min-h-12 w-full rounded-xl border border-[#3b4754] bg-[#2c333a] px-4 text-sm text-[#b6c2cf] outline-none focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/20">
                <option value="">Selecione a moeda</option>{currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="sr-only">Preço mínimo</span>
              <input type="number" min="0" step="0.01" inputMode="decimal" value={minimumPrice} onChange={(event) => setMinimumPrice(event.target.value)} placeholder="Preço mínimo" className="min-h-12 w-full rounded-xl border border-[#3b4754] bg-white/[0.04] px-4 text-sm text-white outline-none placeholder:text-[#9fadbc] focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/20" />
            </label>
            <label className="block">
              <span className="sr-only">Preço máximo</span>
              <input type="number" min="0" step="0.01" inputMode="decimal" value={maximumPrice} onChange={(event) => setMaximumPrice(event.target.value)} placeholder="Preço máximo" className="min-h-12 w-full rounded-xl border border-[#3b4754] bg-white/[0.04] px-4 text-sm text-white outline-none placeholder:text-[#9fadbc] focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/20" />
            </label>
            {priceRangeActive && !priceCurrency && <p role="status" className="text-xs text-amber-100 sm:col-span-2 lg:col-span-4">Selecione uma moeda para filtrar uma faixa de preço.</p>}
            {!priceRangeValid && <p role="alert" className="text-xs text-rose-100 sm:col-span-2 lg:col-span-4">O preço mínimo precisa ser menor ou igual ao máximo.</p>}
          </div>
        </section>

        {signedIn && (
          <section className="mt-8" aria-labelledby="recommendations-title">
            <div className="mb-4 flex flex-col items-start gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="inline-flex items-center gap-2 text-sm text-cyan-200"><Sparkles size={15} aria-hidden="true" /> Para você</p>
                <h2 id="recommendations-title" className="mt-1 text-xl font-semibold text-white">{recommendationsByAi ? "Recomendações por IA" : "Recomendados pelo seu histórico"}</h2>
              </div>
              <button type="button" onClick={() => void generateAiRecommendations()} disabled={aiRecommendationsBusy} aria-busy={aiRecommendationsBusy} className="inline-flex min-h-10 w-full max-w-full min-w-0 items-center justify-center gap-2 whitespace-normal rounded-xl border border-cyan-200/20 px-3 text-sm font-medium text-cyan-100 hover:bg-cyan-200/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200 disabled:opacity-50 sm:w-auto sm:shrink-0">
                <Sparkles size={15} aria-hidden="true" />{aiRecommendationsBusy ? "Gerando recomendações…" : "Gerar recomendações com IA"}
              </button>
            </div>
            {aiRecommendationsError && <p role="alert" className="mb-3 rounded-xl border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-100">{aiRecommendationsError}</p>}
            {aiRecommendationsStatus && <p role="status" aria-live="polite" className="mb-3 text-sm text-emerald-200">{aiRecommendationsStatus}</p>}
            <p className="mb-4 text-xs text-[#9fadbc]">{recommendationsByAi ? "Sugestões geradas por IA a partir do seu histórico e dos cursos disponíveis. A solicitação envia ao provedor somente um resumo dos cursos realizados e dados públicos dos cursos, sem nome, e-mail ou dados de matrícula." : "Sugestões iniciais por afinidade com os cursos que você realizou. Se pedir recomendações por IA, o provedor receberá somente um resumo dos cursos realizados e dados públicos dos cursos, sem nome, e-mail ou dados de matrícula."}</p>
            {recommendations.length > 0 ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {recommendations.slice(0, 3).map((course) => (
                <article key={`${course.workspace_id}:${course.id}`} className="rounded-2xl border border-cyan-200/15 bg-cyan-200/[0.04] p-5">
                  <p className="text-xs font-medium uppercase tracking-wide text-cyan-100/70">{course.payload.category || "Formação"} · {course.workspace_name}</p>
                  <h3 className="mt-2 text-lg font-semibold text-white">{course.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-[#b6c2cf]">{course.reason}</p>
                  <Link href={`/suinda/course/${encodeURIComponent(course.id)}`} className="mt-4 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-cyan-100 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">Conhecer curso <ArrowRight size={15} aria-hidden="true" /></Link>
                </article>
              ))}
            </div> : <p className="rounded-xl border border-dashed border-white/15 p-4 text-sm text-[#9fadbc]">{recommendationsByAi ? "A IA não encontrou cursos para recomendar neste momento." : "Ainda não há sugestões pelo histórico. Você pode gerar recomendações por IA quando quiser."}</p>}
          </section>
        )}

        <section className="mt-9" aria-labelledby="catalog-title">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div><p className="text-sm text-cyan-200">Cursos em destaque</p><h2 id="catalog-title" className="mt-1 text-2xl font-semibold text-white">Escolha seu próximo passo</h2></div>
            <div className="flex flex-wrap items-center gap-3"><p className="text-sm text-[#9fadbc]" aria-live="polite">{loading ? "Carregando catálogo…" : `${filtered.length} ${filtered.length === 1 ? "curso" : "cursos"}`}</p><label className="text-sm text-[#9fadbc]">Ordenar <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as "personalized" | "alphabetical")} className="ml-1 min-h-10 rounded-xl border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-[#b6c2cf] outline-none focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/20"><option value="personalized">{recommendations.length ? "Pelo meu histórico" : "Relevância"}</option><option value="alphabetical">Ordem alfabética</option></select></label>{signedIn && <button type="button" onClick={() => setFavoritesOnly((value) => !value)} aria-pressed={favoritesOnly} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#3b4754] px-3 text-sm text-amber-100 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200"><Star size={15} fill={favoritesOnly ? "currentColor" : "none"} aria-hidden="true" />{favoritesOnly ? "Ver todos os cursos" : `Minha lista (${favorites.size})`}</button>}<button type="button" onClick={clearFilters} className="min-h-10 rounded-xl border border-[#3b4754] px-3 text-sm text-[#b6c2cf] hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">Limpar filtros</button></div>
          </div>
          {error && <div role="alert" className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-100">{error}</div>}
          {!loading && !error && filtered.length === 0 && <div className="rounded-2xl border border-dashed border-white/15 px-5 py-14 text-center"><BookOpen className="mx-auto text-[#9fadbc]" size={28} aria-hidden="true" /><h3 className="mt-4 font-semibold text-white">Nenhum curso encontrado</h3><p className="mt-2 text-sm text-[#9fadbc]">Tente outro termo ou remova os filtros.</p></div>}
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {orderedFiltered.map((course) => (
              <article key={`${course.workspace_id}:${course.id}`} className="group flex min-h-full flex-col overflow-hidden rounded-2xl border border-[#3b4754] bg-[#2c333a] transition hover:-translate-y-0.5 hover:border-cyan-200/30 hover:bg-[#131c29]">
                <div className="relative flex h-40 items-end overflow-hidden bg-[radial-gradient(ellipse_at_25%_15%,rgba(34,211,238,.25),transparent_48%),linear-gradient(135deg,#172536,#111827_55%,#1b1730)] p-5">
                  <div className="absolute inset-0 opacity-40" aria-hidden="true"><div className="absolute -right-4 top-4 size-32 rounded-full border border-cyan-100/20" /><div className="absolute right-10 top-14 size-20 rounded-full border border-violet-200/20" /></div>
                  <div className="relative flex w-full items-center justify-between gap-2"><span className="rounded-full border border-white/15 bg-black/25 px-3 py-1.5 text-xs font-medium text-white">{stateLabels[course.state] || course.state}</span><div className="flex items-center gap-2"><span className="rounded-full bg-black/25 px-3 py-1.5 text-xs text-[#b6c2cf]">{course.payload.category || "Formação"}</span><button type="button" onClick={() => void toggleFavorite(course)} disabled={favoriteBusy === course.id} aria-pressed={favorites.has(course.id)} aria-label={favorites.has(course.id) ? `Remover ${course.title} da lista de desejos` : `Salvar ${course.title} na lista de desejos`} className="grid size-10 place-items-center rounded-full border border-white/15 bg-black/40 text-amber-100 transition hover:bg-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200 disabled:opacity-50"><Star size={17} fill={favorites.has(course.id) ? "currentColor" : "none"} aria-hidden="true" /></button></div></div>
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <p className="text-xs font-medium uppercase tracking-wide text-[#9fadbc]">{course.workspace_name}</p>
                  <h3 className="mt-2 text-xl font-semibold leading-7 text-white">{course.title}</h3>
                  <p className="mt-2 line-clamp-3 text-sm leading-6 text-[#9fadbc]">{course.payload.summary || course.payload.description || "Conheça os objetivos e conteúdos desta formação."}</p>
                  {!!course.instructors?.length && <p className="mt-3 text-xs text-[#9fadbc]">Professores: <span className="text-[#b6c2cf]">{course.instructors.join(" · ")}</span></p>}
                  <div className="mt-5 flex flex-wrap gap-2">
                    {course.payload.modality && <span className="rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-xs text-[#b6c2cf]">{modalityLabels[course.payload.modality] || course.payload.modality}</span>}
                    {course.payload.level && <span className="rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-xs text-[#b6c2cf]">{levelLabels[course.payload.level] || course.payload.level}</span>}
                    {Number(course.payload.workload_hours) > 0 && <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-xs text-[#b6c2cf]"><Clock3 size={13} aria-hidden="true" />{course.payload.workload_hours} h</span>}
                  </div>
                  {(course.payload.tags || []).length > 0 && <p className="mt-4 text-xs text-[#9fadbc]">{course.payload.tags?.slice(0, 3).join(" · ")}</p>}
                  <div className="mt-auto flex items-center justify-between gap-3 border-t border-white/[0.08] pt-5">
                    <span className="text-sm font-semibold text-white">{priceLabel(course)}</span>
                    <Link href={`/suinda/course/${encodeURIComponent(course.id)}`} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-cyan-200 px-3.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200">Ver curso <ArrowRight size={15} aria-hidden="true" /></Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
        <footer className="mt-12 border-t border-white/[0.08] py-6 text-center text-xs text-[#9fadbc]">Suindá · uma plataforma de aprendizagem construída com Orbit</footer>
      </div>
    </main>
  );
}

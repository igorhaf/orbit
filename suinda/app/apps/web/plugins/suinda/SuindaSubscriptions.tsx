'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, apiBlob } from '../../lib/api';
import { hasAccessibleText } from '../../lib/accessibility-text';
import { SuindaMarkdownArticle } from './SuindaMarkdownArticle';

type Plan = { id: string; title: string; state: string; payload: { name: string; description?: string; billing_interval: 'month'|'quarter'|'year'; price_amount: number; currency: string } };
type Subscription = { id: string; workspace_id: string; plan_record_id: string; state: string; billing_interval: string; price_amount: string; currency: string; plan_title: string; course_record_ids: string[] };
type LessonAttachment = { id: string; revision: number; file_name: string; mime_type: string; size_bytes: number; alt_text: string };
type LessonPreview = { url?: string; slides?: Array<{ url: string; text: string }>; slideCount?: number };
type CourseContent = { id: string; title: string; payload: Record<string, unknown>; modules: Array<{ id: string; title: string; payload: Record<string, unknown>; lessons: Array<{ id: string; title: string; revision: number; completed: boolean; payload: { content_type?: string; content_url?: string; body_markdown?: string; transcript?: string; captions_vtt?: string; downloadable?: boolean; attachments: LessonAttachment[] } }> }> };

const intervalLabel: Record<string, string> = { month: 'mês', quarter: 'trimestre', year: 'ano' };
const stateLabel: Record<string, string> = { pending_payment: 'Aguardando confirmação da instituição', active: 'Ativa', past_due: 'Pagamento em atraso', canceled: 'Cancelada', expired: 'Expirada' };
const operationKey = () => crypto.randomUUID();

export function SuindaSubscriptions({ workspaceId }: { workspaceId: string }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [reader, setReader] = useState<{ workspaceId: string; subscriptionId: string; course: CourseContent } | null>(null);
  const [previews, setPreviews] = useState<Record<string, LessonPreview>>({});
  const previewUrls = useRef(new Map<string, string[]>());
  const refresh = useCallback(async () => {
    const [available, mine] = await Promise.all([
      api<Plan[]>(`/extensions/suinda-subscriptions/workspaces/${workspaceId}/plans`),
      api<Subscription[]>('/extensions/suinda-subscriptions/me/subscriptions'),
    ]);
    setPlans(available); setSubscriptions(mine);
  }, [workspaceId]);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [available, mine] = await Promise.all([
          api<Plan[]>(`/extensions/suinda-subscriptions/workspaces/${workspaceId}/plans`),
          api<Subscription[]>('/extensions/suinda-subscriptions/me/subscriptions'),
        ]);
        if (!cancelled) { setPlans(available); setSubscriptions(mine); }
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Não foi possível carregar as assinaturas.');
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [workspaceId]);
  useEffect(() => () => { for (const urls of previewUrls.current.values()) for (const url of urls) URL.revokeObjectURL(url); }, []);

  async function subscribe(plan: Plan) {
    setBusy(plan.id); setMessage('');
    try {
      await api(`/extensions/suinda-subscriptions/me/plans/${plan.id}/subscribe`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, operation_key: operationKey() }),
      });
      setMessage('Solicitação registrada. A assinatura só será ativada depois que a instituição confirmar o recebimento.');
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível solicitar a assinatura.'); }
    finally { setBusy(null); }
  }

  async function cancel(item: Subscription) {
    setBusy(item.id); setMessage('');
    try {
      await api(`/extensions/suinda-subscriptions/me/subscriptions/${item.id}/cancel`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation_key: operationKey() }),
      });
      setMessage('Assinatura cancelada. O acesso vinculado à assinatura foi encerrado.'); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível cancelar a assinatura.'); }
    finally { setBusy(null); }
  }

  async function openCourse(workspace: string, subscriptionId: string, courseId: string) {
    setBusy(`content:${courseId}`); setMessage('');
    try {
      const course = await api<CourseContent>(`/extensions/suinda-subscriptions/workspaces/${workspace}/content/${courseId}`);
      clearPreviews();
      setReader({ workspaceId: workspace, subscriptionId, course });
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível abrir este conteúdo.'); }
    finally { setBusy(null); }
  }

  async function completeLesson(lessonId: string) {
    if (!reader) return;
    setBusy(`lesson:${lessonId}`); setMessage('');
    try {
      await api(`/extensions/suinda-subscriptions/workspaces/${reader.workspaceId}/subscriptions/${reader.subscriptionId}/lessons/${lessonId}/complete`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation_key: operationKey() }),
      });
      const course = await api<CourseContent>(`/extensions/suinda-subscriptions/workspaces/${reader.workspaceId}/content/${reader.course.id}`);
      setReader({ ...reader, course });
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível concluir esta aula.'); }
    finally { setBusy(null); }
  }

  function clearPreviews() {
    for (const urls of previewUrls.current.values()) for (const url of urls) URL.revokeObjectURL(url);
    previewUrls.current.clear();
    setPreviews({});
  }

  function rememberPreview(key: string, preview: LessonPreview, urls: string[]) {
    const existing = previewUrls.current.get(key);
    for (const url of existing || []) URL.revokeObjectURL(url);
    previewUrls.current.delete(key);
    let evicted: string | undefined;
    if (previewUrls.current.size >= 10) {
      evicted = previewUrls.current.keys().next().value;
      for (const url of previewUrls.current.get(evicted!) || []) URL.revokeObjectURL(url);
      previewUrls.current.delete(evicted!);
    }
    previewUrls.current.set(key, urls);
    setPreviews((current) => {
      const next = { ...current };
      if (evicted) delete next[evicted];
      next[key] = preview;
      return next;
    });
  }

  function attachmentPath(lessonId: string, file: LessonAttachment, action: 'preview' | 'download') {
    if (!reader) return '';
    return `/extensions/suinda-subscriptions/workspaces/${reader.workspaceId}/subscriptions/${reader.subscriptionId}/courses/${reader.course.id}/lessons/${lessonId}/attachments/${file.revision}/${file.id}/${action}`;
  }

  async function previewAttachment(lessonId: string, file: LessonAttachment) {
    const key = `${lessonId}:${file.id}`;
    const generatedUrls: string[] = [];
    setBusy(`preview:${key}`); setMessage('');
    try {
      const blob = await apiBlob(attachmentPath(lessonId, file, 'preview'));
      if (file.mime_type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
        const [{ loadPresentation, getSlides }, { renderSlideToSvg, defaultMeasurer }] = await Promise.all([import('@office-kit/pptx'), import('@office-kit/pptx-preview')]);
        const presentation = await loadPresentation(new Uint8Array(await blob.arrayBuffer()));
        const sourceSlides = getSlides(presentation);
        const slides: Array<{ url: string; text: string }> = [];
        for (const slide of sourceSlides.slice(0, 30)) {
          const svg = renderSlideToSvg(presentation, slide, { textLayout: 'svg', measureText: defaultMeasurer });
          const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
          const text = Array.from(document.querySelectorAll('text')).map((node) => node.textContent?.replace(/\s+/g, ' ').trim() || '').filter(Boolean).join(' ');
          const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
          generatedUrls.push(url); slides.push({ url, text });
        }
        rememberPreview(key, { slides, slideCount: sourceSlides.length }, generatedUrls);
      } else {
        const url = URL.createObjectURL(blob); generatedUrls.push(url);
        rememberPreview(key, { url }, generatedUrls);
      }
    } catch (error) { for (const url of generatedUrls) URL.revokeObjectURL(url); setMessage(error instanceof Error ? error.message : 'Não foi possível abrir este material.'); }
    finally { setBusy(null); }
  }

  async function downloadAttachment(lessonId: string, file: LessonAttachment) {
    setBusy(`download:${file.id}`); setMessage('');
    try {
      const blob = await apiBlob(attachmentPath(lessonId, file, 'download'));
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = file.file_name; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível baixar este material.'); }
    finally { setBusy(null); }
  }

  return <section className="space-y-6" aria-labelledby="suinda-subscriptions-heading">
    <header>
      <h2 id="suinda-subscriptions-heading" className="text-xl font-semibold text-white">Planos e assinaturas</h2>
      <p className="mt-1 text-sm text-slate-400">A solicitação não cobra automaticamente. A instituição confirma o recebimento fora da plataforma.</p>
    </header>
    {message && <p role="status" className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-200">{message}</p>}
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {plans.map((plan) => <article key={plan.id} className="rounded-xl border border-slate-700 bg-slate-900 p-5">
        <h3 className="text-lg font-semibold text-white">{plan.payload.name || plan.title}</h3>
        {plan.payload.description && <p className="mt-2 text-sm text-slate-300">{plan.payload.description}</p>}
        <p className="mt-4 text-2xl font-semibold text-white">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: plan.payload.currency }).format(plan.payload.price_amount)}<span className="text-sm font-normal text-slate-400"> / {intervalLabel[plan.payload.billing_interval]}</span></p>
        <button type="button" disabled={busy !== null} onClick={() => void subscribe(plan)} className="mt-5 rounded-lg bg-cyan-200 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-50">{busy === plan.id ? 'Enviando…' : 'Solicitar assinatura'}</button>
      </article>)}
      {!plans.length && <p className="text-sm text-slate-400">Nenhum plano publicado neste workspace.</p>}
    </div>
    <div>
      <h3 className="mb-3 text-lg font-semibold text-white">Minhas assinaturas</h3>
      <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900">
        {subscriptions.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div><p className="font-medium text-white">{item.plan_title}</p><p className="mt-1 text-sm text-slate-400">{stateLabel[item.state] || item.state} · {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: item.currency }).format(Number(item.price_amount))} / {intervalLabel[item.billing_interval]}</p></div>
          {item.state === 'active' && <div className="flex flex-wrap gap-2">{(item.course_record_ids || []).map((courseId) => <button key={courseId} type="button" disabled={busy !== null} onClick={() => void openCourse(item.workspace_id, item.id, courseId)} className="rounded-lg bg-cyan-200 px-3 py-2 text-sm font-medium text-slate-950 hover:bg-cyan-100 disabled:opacity-50">{busy === `content:${courseId}` ? 'Abrindo…' : 'Abrir conteúdo'}</button>)}</div>}
          {['pending_payment', 'active', 'past_due'].includes(item.state) && <button type="button" disabled={busy !== null} onClick={() => void cancel(item)} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50">{busy === item.id ? 'Cancelando…' : 'Cancelar'}</button>}
        </li>)}
        {!subscriptions.length && <li className="px-4 py-4 text-sm text-slate-400">Você ainda não solicitou um plano.</li>}
      </ul>
    </div>
    {reader && <section className="rounded-xl border border-slate-700 bg-slate-950 p-5" aria-label="Leitor de conteúdo por assinatura">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div><h3 className="text-xl font-semibold text-white">{reader.course.title}</h3><p className="mt-1 text-sm text-slate-400">Conteúdo publicado incluído na assinatura. Este acesso não cria matrícula nem altera cobranças do curso.</p></div>
        <button type="button" onClick={() => { clearPreviews(); setReader(null); }} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900">Fechar leitor</button>
      </div>
      {typeof reader.course.payload.description === 'string' && <p className="mb-5 whitespace-pre-wrap text-sm leading-6 text-slate-300">{reader.course.payload.description}</p>}
      <div className="space-y-6">{reader.course.modules.map((module) => <section key={module.id} className="rounded-lg border border-slate-800 p-4">
        <h4 className="text-lg font-semibold text-white">{module.title}</h4>
        {typeof module.payload.summary === 'string' && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{module.payload.summary}</p>}
        <div className="mt-4 space-y-4">{module.lessons.map((lesson) => <article key={lesson.id} className="border-t border-slate-800 pt-4">
          <h5 className="font-medium text-slate-100">{lesson.title}</h5>
          {typeof lesson.payload.body_markdown === 'string' && <div className="mt-2"><SuindaMarkdownArticle markdown={lesson.payload.body_markdown} headingOffset={5} /></div>}
          {typeof lesson.payload.transcript === 'string' && <details className="mt-3"><summary className="cursor-pointer text-sm text-indigo-300">Transcrição</summary><p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{lesson.payload.transcript}</p></details>}
          {typeof lesson.payload.content_url === 'string' && <a href={lesson.payload.content_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-sm text-indigo-300 underline">Abrir mídia ou material externo</a>}
          {!!lesson.payload.attachments?.length && <section className="mt-4 space-y-3" aria-label={`Materiais anexados à aula ${lesson.title}`}>
            {lesson.payload.attachments.map((file) => {
              const key = `${lesson.id}:${file.id}`; const preview = previews[key];
              const altText = hasAccessibleText(file.alt_text) ? file.alt_text.trim() : '';
              return <article key={file.id} className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/70">
                <div className="flex flex-wrap items-center justify-between gap-2 p-3"><span className="min-w-0 break-all text-sm text-slate-200">{file.file_name} · {(file.size_bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB</span><div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy !== null} onClick={() => void previewAttachment(lesson.id, file)} className="rounded border border-slate-600 px-3 py-2 text-xs text-slate-100 hover:bg-slate-800 disabled:opacity-50">{busy === `preview:${key}` ? 'Abrindo…' : preview ? 'Atualizar prévia' : 'Visualizar material'}</button>
                  {lesson.payload.downloadable && <button type="button" disabled={busy !== null} onClick={() => void downloadAttachment(lesson.id, file)} className="rounded border border-slate-600 px-3 py-2 text-xs text-slate-100 hover:bg-slate-800 disabled:opacity-50">{busy === `download:${file.id}` ? 'Baixando…' : 'Baixar'}</button>}
                </div></div>
                {preview?.url && file.mime_type === 'application/pdf' && <iframe title={`Pré-visualização: ${file.file_name}`} src={preview.url} className="h-[70vh] min-h-96 w-full border-t border-slate-800 bg-white" />}
                {preview?.url && file.mime_type.startsWith('image/') && <div className="border-t border-slate-800 p-3"><Image src={preview.url} alt={altText || 'Imagem sem descrição alternativa'} width={1600} height={1200} unoptimized className="mx-auto max-h-[70vh] max-w-full rounded-lg object-contain" />{!altText && <p className="mt-2 text-center text-xs text-amber-200">Descrição alternativa pendente. Solicite uma descrição à equipe docente.</p>}</div>}
                {preview?.slides && <div className="grid gap-3 border-t border-slate-800 bg-slate-950 p-3">{preview.slides.map((slide, index) => <figure key={slide.url} className="overflow-hidden rounded-lg border border-slate-700 bg-white"><Image src={slide.url} alt="" width={1280} height={720} unoptimized className="h-auto w-full" /><figcaption className="bg-slate-950 px-3 py-2 text-xs text-slate-300">Slide {index + 1} de {preview.slideCount}</figcaption></figure>)}<ol className="sr-only" aria-label={`Conteúdo textual da apresentação ${file.file_name}`}>{preview.slides.map((slide, index) => <li key={slide.url}>Slide {index + 1} de {preview.slideCount}: {slide.text || 'Não foi possível extrair texto deste slide. Solicite uma descrição acessível à equipe docente.'}</li>)}</ol>{(preview.slideCount || 0) > preview.slides.length && <p className="text-center text-xs text-slate-400">Prévia das primeiras {preview.slides.length} páginas. Baixe a apresentação para ver as restantes.</p>}</div>}
              </article>;
            })}
          </section>}
          {lesson.completed ? <p className="mt-3 text-xs text-emerald-300">Aula concluída</p> : <button type="button" disabled={busy !== null} onClick={() => void completeLesson(lesson.id)} className="mt-3 rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50">{busy === `lesson:${lesson.id}` ? 'Salvando…' : 'Marcar como concluída'}</button>}
        </article>)}</div>
      </section>)}</div>
      {!reader.course.modules.length && <p className="text-sm text-slate-400">Este curso ainda não tem módulos publicados.</p>}
    </section>}
  </section>;
}

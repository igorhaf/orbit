'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { ConfirmDialog, Spinner } from '@/components/ui';

interface GraphifyJob {
  id: string;
  folder_path: string;
  project_id: string | null;
  status: 'queued' | 'running' | 'done' | 'failed' | 'failed_quota' | 'unknown';
  created_at: number | null;
  started_at: number | null;
  finished_at: number | null;
  duration_ms: number;
  error: string | null;
  output_paths: {
    html: string | null;
    graph_json: string | null;
    report_md: string | null;
  };
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

function statusBadge(status: string) {
  const map: Record<string, { label: string; cls: string }> = {
    queued: { label: 'Na fila', cls: 'bg-gray-100 text-gray-700' },
    running: { label: 'Processando', cls: 'bg-blue-100 text-blue-700' },
    done: { label: 'Concluido', cls: 'bg-green-100 text-green-700' },
    failed: { label: 'Falhou', cls: 'bg-red-100 text-red-700' },
    failed_quota: { label: 'Cota Claude esgotada', cls: 'bg-amber-100 text-amber-800' },
  };
  const s = map[status] || { label: status, cls: 'bg-gray-100 text-gray-700' };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

function fmtTime(epoch: number | null): string {
  if (!epoch) return '-';
  return new Date(epoch * 1000).toLocaleString('pt-BR');
}

function fmtDuration(ms: number): string {
  if (!ms) return '-';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}min ${r}s`;
}

interface Props {
  projectId: string;
  projectCodePath?: string | null;
}

export default function GraphifyTab({ projectId, projectCodePath }: Props) {
  const [jobs, setJobs] = useState<GraphifyJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [enqueueing, setEnqueueing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobToDelete, setJobToDelete] = useState<GraphifyJob | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const activeJob = useMemo(() => jobs.find((j) => j.id === activeJobId) || null, [jobs, activeJobId]);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${API_BASE}/api/v1/graphify/jobs`, {
        params: { project_id: projectId, limit: 50 },
      });
      setJobs(res.data.jobs || []);
      if (!activeJobId && res.data.jobs?.length) {
        setActiveJobId(res.data.jobs[0].id);
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || 'erro ao carregar jobs');
    } finally {
      setLoading(false);
    }
  }, [projectId, activeJobId]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  // polling enquanto o job ativo nao terminou
  useEffect(() => {
    if (!activeJob) return;
    if (['done', 'failed', 'failed_quota'].includes(activeJob.status)) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await axios.get(`${API_BASE}/api/v1/graphify/jobs/${activeJob.id}`);
        setJobs((prev) => prev.map((j) => (j.id === activeJob.id ? res.data : j)));
      } catch {}
    }, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [activeJob?.id, activeJob?.status]);

  const enqueue = async () => {
    setEnqueueing(true);
    setError(null);
    try {
      const res = await axios.post(`${API_BASE}/api/v1/graphify/projects/${projectId}`);
      const newId = res.data.job_id;
      setActiveJobId(newId);
      await loadJobs();
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || 'erro ao enfileirar');
    } finally {
      setEnqueueing(false);
    }
  };

  const handleViewJob = (job: GraphifyJob) => {
    setActiveJobId(job.id);
    if (job.status === 'done') {
      // abre HTML em nova aba sempre que clica Ver num job concluido
      window.open(`${API_BASE}/api/v1/graphify/jobs/${job.id}/html`, '_blank', 'noopener,noreferrer');
    }
  };

  const confirmDelete = async () => {
    if (!jobToDelete) return;
    setIsDeleting(true);
    try {
      await axios.delete(`${API_BASE}/api/v1/graphify/jobs/${jobToDelete.id}`);
      if (activeJobId === jobToDelete.id) setActiveJobId(null);
      setJobToDelete(null);
      await loadJobs();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'erro ao remover');
    } finally {
      setIsDeleting(false);
    }
  };

  const htmlUrl = activeJob && activeJob.status === 'done'
    ? `${API_BASE}/api/v1/graphify/jobs/${activeJob.id}/html`
    : null;
  const reportUrl = activeJob && activeJob.status === 'done'
    ? `${API_BASE}/api/v1/graphify/jobs/${activeJob.id}/report.md`
    : null;
  const jsonUrl = activeJob && activeJob.status === 'done'
    ? `${API_BASE}/api/v1/graphify/jobs/${activeJob.id}/graph.json`
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Graphify — Mapa de Conhecimento do Codigo</h2>
          <p className="text-sm text-gray-500 mt-1">
            {projectCodePath ? <>Pasta: <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{projectCodePath}</code></> : 'Sem code_path definido'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadJobs}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
          >
            {loading && <Spinner size="xs" variant="neutral" />}
            Atualizar
          </button>
          <button
            onClick={enqueue}
            disabled={enqueueing || !projectCodePath}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
          >
            {enqueueing ? (
              <Spinner size="xs" variant="inverse" />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            )}
            {enqueueing ? 'Enfileirando...' : 'Gerar grafo'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded border border-red-200 bg-red-50 text-sm text-red-700">{error}</div>
      )}

      {/* Job ativo */}
      {activeJob && (
        <div className="border border-gray-200 rounded-lg p-4 bg-white space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {statusBadge(activeJob.status)}
              <span className="text-xs text-gray-500 font-mono">{activeJob.id.slice(0, 8)}</span>
            </div>
            <div className="text-xs text-gray-500">
              {fmtTime(activeJob.created_at)} · {fmtDuration(activeJob.duration_ms)}
            </div>
          </div>

          {activeJob.status === 'running' && (
            <Spinner size="sm" label="Processando o codigo do projeto... pode levar varios minutos." />
          )}

          {(activeJob.status === 'failed' || activeJob.status === 'failed_quota') && activeJob.error && (
            <pre className="text-xs text-red-700 bg-red-50 p-3 rounded overflow-x-auto whitespace-pre-wrap">{activeJob.error}</pre>
          )}

          {activeJob.status === 'done' && htmlUrl && (
            <>
              <div className="flex items-center gap-2 text-sm">
                <a
                  href={htmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded hover:bg-green-100 inline-flex items-center gap-1"
                >
                  Abrir HTML em nova aba
                </a>
                <a href={reportUrl!} className="px-3 py-1.5 bg-gray-50 text-gray-700 border border-gray-200 rounded hover:bg-gray-100">
                  report.md
                </a>
                <a href={jsonUrl!} className="px-3 py-1.5 bg-gray-50 text-gray-700 border border-gray-200 rounded hover:bg-gray-100">
                  graph.json
                </a>
              </div>
              <iframe
                src={htmlUrl}
                className="w-full h-[600px] border border-gray-200 rounded"
                title="Graphify output"
              />
            </>
          )}
        </div>
      )}

      {/* Lista de jobs */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-2">Analises anteriores ({jobs.length})</h3>
        {loading && jobs.length === 0 ? (
          <Spinner.Block label="Carregando jobs..." size="md" />
        ) : jobs.length === 0 ? (
          <p className="text-sm text-gray-400 italic">Nenhum job ainda. Clique em "Gerar grafo".</p>
        ) : (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Criado</th>
                  <th className="px-3 py-2 text-left">Duracao</th>
                  <th className="px-3 py-2 text-left">ID</th>
                  <th className="px-3 py-2 text-right">Acoes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {jobs.map((j) => (
                  <tr key={j.id} className={activeJobId === j.id ? 'bg-blue-50' : 'hover:bg-gray-50'}>
                    <td className="px-3 py-2">{statusBadge(j.status)}</td>
                    <td className="px-3 py-2 text-gray-600">{fmtTime(j.created_at)}</td>
                    <td className="px-3 py-2 text-gray-600">{fmtDuration(j.duration_ms)}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-500">{j.id.slice(0, 8)}</td>
                    <td className="px-3 py-2 text-right space-x-2">
                      <button
                        onClick={() => handleViewJob(j)}
                        className="text-blue-600 hover:underline"
                        title={j.status === 'done' ? 'Abrir grafo em nova aba' : 'Selecionar este job'}
                      >
                        Ver
                      </button>
                      <button
                        onClick={() => setJobToDelete(j)}
                        className="text-red-600 hover:underline"
                      >
                        Remover
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!jobToDelete}
        onClose={() => (isDeleting ? null : setJobToDelete(null))}
        onConfirm={confirmDelete}
        type="danger"
        title="Remover analise Graphify?"
        message={
          jobToDelete
            ? `O job ${jobToDelete.id.slice(0, 8)} sera removido junto com seus arquivos de saida (HTML, JSON, relatorio). Esta acao nao pode ser desfeita.`
            : ''
        }
        confirmLabel="Sim, remover"
        cancelLabel="Cancelar"
        isLoading={isDeleting}
      />
    </div>
  );
}

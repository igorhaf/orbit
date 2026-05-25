/**
 * SubflowRunDialog — modal for picking a project + mode and triggering the
 * Deep Pipeline from the canvas Run button.
 *
 * Reuses the same endpoint that RagTab uses
 * (POST /api/v1/projects/{project_id}/rag/deep-pipeline?mode=...).
 *
 * v3.1
 */
'use client';

import React, { useEffect, useState } from 'react';
import { X, Play, Loader2 } from 'lucide-react';
import { projectsApi, ragApi } from '@/lib/api';

type Mode = 'aggressive' | 'balanced' | 'conservative';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirmed: (projectId: string, jobId: string) => void;
}

export function SubflowRunDialog({ isOpen, onClose, onConfirmed }: Props) {
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [mode, setMode] = useState<Mode>('balanced');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    projectsApi.list()
      .then((arr: any[]) => {
        const withPath = (arr || []).filter((p: any) => p.code_path);
        setProjects(withPath);
        if (withPath.length && !selectedProjectId) setSelectedProjectId(withPath[0].id);
      })
      .catch((e: any) => setError(`Falha ao listar projetos: ${e?.message || e}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (!selectedProjectId) {
      setError('Selecione um projeto');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const resp: any = await ragApi.deepPipeline(selectedProjectId, undefined, mode);
      const jobId = resp?.job_id;
      if (!jobId) {
        setError('Backend não retornou job_id');
        return;
      }
      onConfirmed(selectedProjectId, jobId);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Falha ao disparar');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <header className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Executar Deep Pipeline</h3>
            <p className="text-xs text-gray-500 mt-0.5">As fases serão animadas no canvas conforme avançam.</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </header>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Projeto</label>
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="w-full px-3 py-1.5 border border-gray-200 rounded text-sm"
            >
              {projects.length === 0 && <option value="">(nenhum projeto com code_path)</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Modo</label>
            <div className="grid grid-cols-3 gap-2">
              {(['aggressive', 'balanced', 'conservative'] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`p-2 text-xs rounded border transition-colors ${
                    mode === m
                      ? 'border-blue-400 bg-blue-50 text-blue-700 font-medium'
                      : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                  }`}
                >
                  {m === 'aggressive' && 'Agressivo'}
                  {m === 'balanced' && 'Equilibrado'}
                  {m === 'conservative' && 'Conservador'}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-800">{error}</div>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 rounded">
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || !selectedProjectId}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-60"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Disparar
          </button>
        </footer>
      </div>
    </div>
  );
}

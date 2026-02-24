'use client';

/**
 * RunHistoryTable - Table showing pipeline run history with checkboxes for comparison.
 */

import React, { useState } from 'react';

interface PipelineRunSummary {
  id: string;
  profile_name: string;
  status: string;
  overall_score: number | null;
  total_cards_created: number | null;
  total_wiki_pages: number | null;
  started_at: string | null;
  completed_at: string | null;
}

interface RunHistoryTableProps {
  runs: PipelineRunSummary[];
  loading: boolean;
  onViewDetail: (runId: string) => void;
  onCompare: (runId1: string, runId2: string) => void;
}

function formatDate(iso: string | null): string {
  if (!iso) return '--';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start || !end) return '--';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return '--';
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(0)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

function scoreColor(score: number | null): string {
  if (score == null) return 'text-gray-400';
  if (score >= 75) return 'text-green-600 bg-green-50';
  if (score >= 50) return 'text-yellow-600 bg-yellow-50';
  return 'text-red-600 bg-red-50';
}

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    completed: 'bg-green-100 text-green-700',
    running: 'bg-blue-100 text-blue-700',
    failed: 'bg-red-100 text-red-700',
  };
  return colors[status] || 'bg-gray-100 text-gray-700';
}

export function RunHistoryTable({ runs, loading, onViewDetail, onCompare }: RunHistoryTableProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 2) {
        next.add(id);
      }
      return next;
    });
  };

  const canCompare = selected.size === 2;
  const selectedArr = Array.from(selected);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <svg className="animate-spin h-5 w-5 text-purple-600" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-gray-500">
        Nenhuma execucao registrada ainda.
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
              <th className="pb-2 w-8"></th>
              <th className="pb-2">Data</th>
              <th className="pb-2">Perfil</th>
              <th className="pb-2">Status</th>
              <th className="pb-2 text-center">Score</th>
              <th className="pb-2 text-center">Cards</th>
              <th className="pb-2 text-center">Wiki</th>
              <th className="pb-2">Duracao</th>
              <th className="pb-2 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(run.id)}
                    onChange={() => toggleSelect(run.id)}
                    className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                  />
                </td>
                <td className="py-2 text-gray-700">{formatDate(run.started_at)}</td>
                <td className="py-2">
                  <span className="px-2 py-0.5 text-xs rounded-full bg-purple-50 text-purple-700">
                    {run.profile_name || 'default'}
                  </span>
                </td>
                <td className="py-2">
                  <span className={`px-2 py-0.5 text-xs rounded-full ${statusBadge(run.status)}`}>
                    {run.status}
                  </span>
                </td>
                <td className="py-2 text-center">
                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${scoreColor(run.overall_score)}`}>
                    {run.overall_score ?? '--'}
                  </span>
                </td>
                <td className="py-2 text-center text-gray-600">{run.total_cards_created ?? '--'}</td>
                <td className="py-2 text-center text-gray-600">{run.total_wiki_pages ?? '--'}</td>
                <td className="py-2 text-gray-600">{formatDuration(run.started_at, run.completed_at)}</td>
                <td className="py-2">
                  <button
                    onClick={() => onViewDetail(run.id)}
                    className="text-purple-600 hover:text-purple-800"
                    title="Ver detalhes"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Compare button */}
      <div className="mt-3 flex justify-end">
        <button
          disabled={!canCompare}
          onClick={() => canCompare && onCompare(selectedArr[0], selectedArr[1])}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            canCompare
              ? 'bg-purple-600 text-white hover:bg-purple-700'
              : 'bg-gray-100 text-gray-400 cursor-not-allowed'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          Comparar Selecionados
        </button>
      </div>
    </div>
  );
}

'use client';

/**
 * RunCompareDialog - Side-by-side comparison of two pipeline runs.
 */

import React, { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { ragApi } from '@/lib/api/knowledge';

interface RunCompareDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  runId1: string;
  runId2: string;
}

const PHASE_LABELS: Record<string, string> = {
  phase_0: 'Scan',
  phase_1: 'Análise',
  phase_2: 'Regras',
  phase_3: 'Arquitetura',
  phase_4: 'Cards',
  phase_5: 'Wiki',
  phase_6: 'QA',
};

function diffColor(diff: number): string {
  if (diff > 0) return 'text-green-600';
  if (diff < 0) return 'text-red-600';
  return 'text-gray-400';
}

function diffPrefix(diff: number): string {
  if (diff > 0) return '+';
  return '';
}

function formatDate(iso: string | null): string {
  if (!iso) return '--';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function RunCompareDialog({ open, onClose, projectId, runId1, runId2 }: RunCompareDialogProps) {
  const [comparison, setComparison] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (open && runId1 && runId2) {
      setLoading(true);
      ragApi.deepPipelineCompare(projectId, runId1, runId2)
        .then((data) => setComparison(data))
        .catch(() => setComparison(null))
        .finally(() => setLoading(false));
    }
  }, [open, projectId, runId1, runId2]);

  const phases = comparison?.score_comparison ? Object.keys(comparison.score_comparison).sort() : [];

  return (
    <Dialog open={open} onClose={onClose} title="Comparar Execuções" size="2xl">
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <svg className="animate-spin h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : !comparison ? (
        <div className="py-8 text-center text-gray-500">Dados não encontrados.</div>
      ) : (
        <div className="space-y-5">
          {/* Overall score comparison */}
          <div className="flex items-center justify-center gap-8 py-3 bg-gray-50 rounded-lg">
            <div className="text-center">
              <div className="text-xs text-gray-500 mb-1">Run 1</div>
              <div className="text-2xl font-bold text-gray-800">{comparison.run1.overall_score ?? '--'}</div>
            </div>
            <div className="text-center">
              <svg className="w-5 h-5 text-gray-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </div>
            <div className="text-center">
              <div className="text-xs text-gray-500 mb-1">Run 2</div>
              <div className="text-2xl font-bold text-gray-800">{comparison.run2.overall_score ?? '--'}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-gray-500 mb-1">Diff</div>
              <div className={`text-2xl font-bold ${diffColor(comparison.overall_diff)}`}>
                {diffPrefix(comparison.overall_diff)}{comparison.overall_diff}
              </div>
            </div>
          </div>

          {/* Phase comparison table */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Score por Fase</h4>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-200">
                  <th className="pb-2 text-left">Fase</th>
                  <th className="pb-2 text-center">Run 1</th>
                  <th className="pb-2 text-center">Run 2</th>
                  <th className="pb-2 text-center">Diff</th>
                </tr>
              </thead>
              <tbody>
                {phases.map((phaseKey) => {
                  const data = comparison.score_comparison[phaseKey];
                  return (
                    <tr key={phaseKey} className="border-b border-gray-50">
                      <td className="py-2 text-gray-700">{PHASE_LABELS[phaseKey] || phaseKey}</td>
                      <td className="py-2 text-center text-gray-600">{data.run1}</td>
                      <td className="py-2 text-center text-gray-600">{data.run2}</td>
                      <td className={`py-2 text-center font-medium ${diffColor(data.diff)}`}>
                        {diffPrefix(data.diff)}{data.diff}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Metadata comparison */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Detalhes</h4>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-200">
                  <th className="pb-2 text-left">Métrica</th>
                  <th className="pb-2 text-center">Run 1</th>
                  <th className="pb-2 text-center">Run 2</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: 'Perfil', v1: comparison.run1.profile_name, v2: comparison.run2.profile_name },
                  { label: 'Cards', v1: comparison.run1.total_cards_created, v2: comparison.run2.total_cards_created },
                  { label: 'Wiki Pages', v1: comparison.run1.total_wiki_pages, v2: comparison.run2.total_wiki_pages },
                  { label: 'Arquivos', v1: comparison.run1.total_files_scanned, v2: comparison.run2.total_files_scanned },
                  { label: 'Custo (USD)', v1: comparison.run1.estimated_cost_usd ? `$${comparison.run1.estimated_cost_usd.toFixed(2)}` : '--', v2: comparison.run2.estimated_cost_usd ? `$${comparison.run2.estimated_cost_usd.toFixed(2)}` : '--' },
                  { label: 'Data', v1: formatDate(comparison.run1.started_at), v2: formatDate(comparison.run2.started_at) },
                ].map(({ label, v1, v2 }) => (
                  <tr key={label} className="border-b border-gray-50">
                    <td className="py-2 text-gray-600">{label}</td>
                    <td className="py-2 text-center text-gray-700">{v1 ?? '--'}</td>
                    <td className="py-2 text-center text-gray-700">{v2 ?? '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Dialog>
  );
}

'use client';

/**
 * RunDetailDialog - Shows per-phase scores and durations for a single pipeline run.
 */

import React, { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { ragApi } from '@/lib/api/knowledge';

interface RunDetailDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  runId: string;
}

const PHASE_LABELS: Record<string, string> = {
  phase_0: 'Scan Estrutural',
  phase_1: 'Analise de Arquivos',
  phase_2: 'Sintese de Regras',
  phase_3: 'Mapa Arquitetural',
  phase_4: 'Geracao de Cards',
  phase_5: 'Geracao de Wiki',
  phase_6: 'Quality Assurance',
};

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '--';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

function totalDuration(durations: Record<string, number> | null): string {
  if (!durations) return '--';
  const total = Object.values(durations).reduce((a, b) => a + b, 0);
  return formatDuration(total);
}

function scoreBarColor(score: number): string {
  if (score >= 75) return 'bg-green-500';
  if (score >= 50) return 'bg-yellow-500';
  return 'bg-red-500';
}

export function RunDetailDialog({ open, onClose, projectId, runId }: RunDetailDialogProps) {
  const [run, setRun] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (open && runId) {
      setLoading(true);
      ragApi.deepPipelineRunDetail(projectId, runId)
        .then((data) => setRun(data))
        .catch(() => setRun(null))
        .finally(() => setLoading(false));
    }
  }, [open, projectId, runId]);

  const phases = run?.phase_scores ? Object.keys(run.phase_scores).sort() : [];

  return (
    <Dialog open={open} onClose={onClose} title="Detalhes da Execucao" size="lg">
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <svg className="animate-spin h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : !run ? (
        <div className="py-8 text-center text-gray-500">Dados nao encontrados.</div>
      ) : (
        <div className="space-y-4">
          {/* Summary */}
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-700">Perfil:</span>
                <span className="px-2 py-0.5 text-xs rounded-full bg-purple-50 text-purple-700">{run.profile_name || 'default'}</span>
              </div>
              <div className="text-xs text-gray-500">
                {run.started_at ? new Date(run.started_at).toLocaleString('pt-BR') : '--'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-gray-800">{run.overall_score ?? '--'}<span className="text-sm text-gray-400">/100</span></div>
              <div className="text-xs text-gray-500">Duracao total: {totalDuration(run.phase_durations)}</div>
            </div>
          </div>

          {/* Overall score bar */}
          <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${scoreBarColor(run.overall_score || 0)}`}
              style={{ width: `${Math.min(100, run.overall_score || 0)}%` }}
            />
          </div>

          {/* Phase breakdown */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Por Fase</h4>
            <div className="space-y-1.5">
              {phases.map((phaseKey) => {
                const score = run.phase_scores[phaseKey] ?? 0;
                const duration = run.phase_durations?.[phaseKey];
                return (
                  <div key={phaseKey} className="flex items-center gap-3">
                    <span className="text-xs text-gray-600 w-36 truncate">
                      {PHASE_LABELS[phaseKey] || phaseKey}
                    </span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${scoreBarColor(score)}`}
                        style={{ width: `${Math.min(100, score)}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium text-gray-700 w-8 text-right">{score}</span>
                    <span className="text-[10px] text-gray-400 w-14 text-right">{formatDuration(duration)}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-4 gap-3 pt-2 border-t border-gray-100">
            {[
              { label: 'Arquivos', value: run.total_files_scanned },
              { label: 'Regras', value: run.total_rules_extracted },
              { label: 'Cards', value: run.total_cards_created },
              { label: 'Wiki', value: run.total_wiki_pages },
            ].map(({ label, value }) => (
              <div key={label} className="text-center">
                <div className="text-lg font-semibold text-gray-800">{value ?? '--'}</div>
                <div className="text-[10px] text-gray-500">{label}</div>
              </div>
            ))}
          </div>

          {/* Reinforcement */}
          {run.reinforcement_applied && Object.keys(run.reinforcement_applied).length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              <div className="text-xs font-medium text-amber-700 mb-1">Reforco Aplicado</div>
              {Object.entries(run.reinforcement_applied).map(([phase, info]: [string, any]) => (
                <div key={phase} className="text-xs text-amber-600">
                  {PHASE_LABELS[phase] || phase}: {info.reason}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

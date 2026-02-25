'use client';

/**
 * PhaseConfigDialog — Modal de configuração de fase do pipeline.
 * Abre ao double-click no node (mesmo padrão do AI Flow).
 */

import React, { useState, useEffect } from 'react';

interface PhaseConfig {
  model: string;
  max_tokens: number;
  concurrency: number;
  thinking_budget?: number;
}

interface PhaseStats {
  score?: number | null;
  duration?: number | null;
}

interface PhaseConfigDialogProps {
  phaseKey: string;
  label: string;
  config: PhaseConfig;
  stats: PhaseStats;
  models: Array<{ id: string; name: string; provider: string }>;
  onSave: (phaseKey: string, field: string, value: any) => void;
  onClose: () => void;
}

const PHASE_DESCRIPTIONS: Record<string, string> = {
  phase_0: 'Scan estrutural do sistema de arquivos. Sem chamadas de IA.',
  phase_1: 'Análise individual de cada arquivo do codebase.',
  phase_2: 'Síntese cross-file de regras de negócio por domínio.',
  phase_3: 'Construção do mapa arquitetural com Extended Thinking.',
  phase_4a: 'Geração de Epics a partir do mapa e regras.',
  phase_4b: 'Decomposição de Epics em Stories.',
  phase_4c: 'Decomposição de Stories em Tasks.',
  phase_4d: 'Decomposição de Tasks em Subtasks.',
  phase_5a: 'Planejamento da estrutura da wiki.',
  phase_5b: 'Geração de páginas de visão geral.',
  phase_5c: 'Geração de páginas por domínio.',
  phase_5d: 'Geração de páginas de fluxos cross-domain.',
  phase_6: 'Quality Assurance com Extended Thinking.',
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

export function PhaseConfigDialog({
  phaseKey,
  label,
  config,
  stats,
  models,
  onSave,
  onClose,
}: PhaseConfigDialogProps) {
  // Local draft — só aplica ao salvar
  const [draft, setDraft] = useState<PhaseConfig>({ ...config });

  useEffect(() => {
    setDraft({ ...config });
  }, [phaseKey]);

  const scoreColor =
    stats.score == null ? 'text-gray-400' :
    stats.score >= 75 ? 'text-green-600' :
    stats.score >= 50 ? 'text-yellow-600' :
    'text-red-600';

  const handleSave = () => {
    // Envia cada campo alterado
    Object.entries(draft).forEach(([field, value]) => {
      if (value !== (config as any)[field]) {
        onSave(phaseKey, field, value);
      }
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between bg-gray-50">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">{label}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {PHASE_DESCRIPTIONS[phaseKey] || 'Fase do pipeline.'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 ml-4 flex-shrink-0 mt-0.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Config Fields */}
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Modelo</label>
            <select
              value={draft.model}
              onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))}
              className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:ring-1 focus:ring-purple-500 focus:border-purple-500"
            >
              {models.map((m) => (
                <option key={m.id} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Max Tokens</label>
            <input
              type="number"
              value={draft.max_tokens}
              onChange={(e) => setDraft((d) => ({ ...d, max_tokens: parseInt(e.target.value) || 0 }))}
              className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:ring-1 focus:ring-purple-500 focus:border-purple-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Concorrência</label>
            <input
              type="number"
              value={draft.concurrency}
              min={1}
              max={20}
              onChange={(e) => setDraft((d) => ({ ...d, concurrency: parseInt(e.target.value) || 1 }))}
              className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:ring-1 focus:ring-purple-500 focus:border-purple-500"
            />
          </div>

          {draft.thinking_budget != null && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Thinking Budget</label>
              <input
                type="number"
                value={draft.thinking_budget}
                onChange={(e) => setDraft((d) => ({ ...d, thinking_budget: parseInt(e.target.value) || 0 }))}
                className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:ring-1 focus:ring-purple-500 focus:border-purple-500"
              />
            </div>
          )}
        </div>

        {/* Last Run Stats */}
        {(stats.score != null || stats.duration != null) && (
          <div className="px-5 py-3 bg-gray-50 border-t border-gray-200">
            <h4 className="text-xs font-medium text-gray-500 mb-2">Última Execução</h4>
            <div className="flex gap-6">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500">Score</span>
                <span className={`text-xs font-semibold ${scoreColor}`}>
                  {stats.score != null ? `${stats.score}/100` : '--'}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500">Duração</span>
                <span className="text-xs font-semibold text-gray-700">{formatDuration(stats.duration)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            className="px-3 py-1.5 text-sm text-white bg-purple-600 rounded-md hover:bg-purple-700 transition-colors"
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

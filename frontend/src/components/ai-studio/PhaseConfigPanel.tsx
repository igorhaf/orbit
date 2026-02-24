'use client';

/**
 * PhaseConfigPanel - Side panel for configuring a pipeline phase.
 * Shows model selector, max_tokens, concurrency, contract, and last run stats.
 */

import React from 'react';

interface PhaseConfig {
  model: string;
  max_tokens: number;
  concurrency: number;
  contract?: string;
  thinking_budget?: number;
}

interface PhaseStats {
  score?: number | null;
  duration?: number | null;
}

interface PhaseConfigPanelProps {
  phaseKey: string;
  label: string;
  config: PhaseConfig;
  stats: PhaseStats;
  models: Array<{ id: string; name: string; provider: string }>;
  onChange: (phaseKey: string, field: string, value: any) => void;
  onClose: () => void;
}

const PHASE_DESCRIPTIONS: Record<string, string> = {
  phase_0: 'Scan estrutural do sistema de arquivos. Sem chamadas de IA.',
  phase_1: 'Analise individual de cada arquivo do codebase.',
  phase_2: 'Sintese cross-file de regras de negocio por dominio.',
  phase_3: 'Construcao do mapa arquitetural com Extended Thinking.',
  phase_4a: 'Geracao de Epics a partir do mapa e regras.',
  phase_4b: 'Decomposicao de Epics em Stories.',
  phase_4c: 'Decomposicao de Stories em Tasks.',
  phase_4d: 'Decomposicao de Tasks em Subtasks.',
  phase_5a: 'Planejamento da estrutura da wiki.',
  phase_5b: 'Geracao de paginas de visao geral.',
  phase_5c: 'Geracao de paginas por dominio.',
  phase_5d: 'Geracao de paginas de fluxos cross-domain.',
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

export function PhaseConfigPanel({
  phaseKey,
  label,
  config,
  stats,
  models,
  onChange,
  onClose,
}: PhaseConfigPanelProps) {
  const scoreColor =
    stats.score == null ? 'text-gray-400' :
    stats.score >= 75 ? 'text-green-600' :
    stats.score >= 50 ? 'text-yellow-600' :
    'text-red-600';

  return (
    <div className="w-72 bg-white border-l border-gray-200 h-full overflow-y-auto shadow-lg">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-gray-50">
        <h3 className="text-sm font-semibold text-gray-800">{label}</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Description */}
      <div className="px-4 py-2 text-xs text-gray-500 border-b border-gray-100">
        {PHASE_DESCRIPTIONS[phaseKey] || 'Fase do pipeline.'}
      </div>

      {/* Config Fields */}
      <div className="px-4 py-3 space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Modelo</label>
          <select
            value={config.model}
            onChange={(e) => onChange(phaseKey, 'model', e.target.value)}
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
            value={config.max_tokens}
            onChange={(e) => onChange(phaseKey, 'max_tokens', parseInt(e.target.value) || 0)}
            className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:ring-1 focus:ring-purple-500 focus:border-purple-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Concorrencia</label>
          <input
            type="number"
            value={config.concurrency}
            min={1}
            max={20}
            onChange={(e) => onChange(phaseKey, 'concurrency', parseInt(e.target.value) || 1)}
            className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:ring-1 focus:ring-purple-500 focus:border-purple-500"
          />
        </div>

        {config.contract && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Contrato</label>
            <div className="text-xs text-teal-700 bg-teal-50 px-2 py-1.5 rounded-md border border-teal-200 truncate">
              {config.contract}
            </div>
          </div>
        )}

        {config.thinking_budget != null && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Thinking Budget</label>
            <input
              type="number"
              value={config.thinking_budget}
              onChange={(e) => onChange(phaseKey, 'thinking_budget', parseInt(e.target.value) || 0)}
              className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:ring-1 focus:ring-purple-500 focus:border-purple-500"
            />
          </div>
        )}
      </div>

      {/* Last Run Stats */}
      <div className="px-4 py-3 border-t border-gray-200">
        <h4 className="text-xs font-medium text-gray-500 mb-2">Ultima Execucao</h4>
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Score</span>
            <span className={`font-medium ${scoreColor}`}>
              {stats.score != null ? `${stats.score}/100` : '--'}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Duracao</span>
            <span className="text-gray-700">{formatDuration(stats.duration)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

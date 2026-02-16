'use client';

/**
 * OperationSummaryCard - PROMPT #296
 * Renders a rich operation summary with stacked duration bar,
 * phase table, bottleneck highlight, and diagnostics.
 */

import React from 'react';

export interface PhaseInfo {
  name: string;
  duration_ms: number;
  tokens?: number;
  cost_usd?: number;
  model?: string;
}

interface OperationSummaryCardProps {
  operationName: string;
  totalDurationMs: number;
  phases: PhaseInfo[];
  totalTokens?: number;
  totalCost?: number;
  bottleneck?: string | null;
  diagnostics?: string[];
}

const PHASE_COLORS = [
  'bg-cyan-500',
  'bg-blue-500',
  'bg-purple-500',
  'bg-green-500',
  'bg-yellow-500',
  'bg-orange-500',
  'bg-pink-500',
  'bg-indigo-500',
];

function getDurationBadge(ms: number): { label: string; className: string } {
  if (ms < 3000) return { label: 'Rapido', className: 'text-green-400' };
  if (ms < 15000) return { label: 'Moderado', className: 'text-yellow-400' };
  return { label: 'Lento', className: 'text-red-400' };
}

export default function OperationSummaryCard({
  operationName,
  totalDurationMs,
  phases,
  totalTokens,
  totalCost,
  bottleneck,
  diagnostics,
}: OperationSummaryCardProps) {
  const badge = getDurationBadge(totalDurationMs);

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-200">
          Resumo da Operacao: {operationName}
        </h4>
        <div className="flex items-center gap-3 text-xs">
          <span className={badge.className}>{badge.label}</span>
          <span className="text-gray-400">{(totalDurationMs / 1000).toFixed(1)}s</span>
          {totalTokens ? <span className="text-gray-400">{totalTokens} tokens</span> : null}
          {totalCost ? <span className="text-gray-400">${totalCost.toFixed(4)}</span> : null}
        </div>
      </div>

      {/* Stacked duration bar */}
      {phases.length > 0 && totalDurationMs > 0 && (
        <div className="flex h-3 rounded-full overflow-hidden bg-gray-700">
          {phases.map((phase, i) => {
            const pct = Math.max((phase.duration_ms / totalDurationMs) * 100, 1);
            return (
              <div
                key={phase.name}
                className={`${PHASE_COLORS[i % PHASE_COLORS.length]} transition-all`}
                style={{ width: `${pct}%` }}
                title={`${phase.name}: ${(phase.duration_ms / 1000).toFixed(1)}s (${Math.round(pct)}%)`}
              />
            );
          })}
        </div>
      )}

      {/* Phase table */}
      {phases.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 border-b border-gray-700">
              <th className="text-left py-1 font-normal">Fase</th>
              <th className="text-right py-1 font-normal">Duracao</th>
              <th className="text-right py-1 font-normal">Tokens</th>
              <th className="text-right py-1 font-normal">Custo</th>
              <th className="text-right py-1 font-normal">Modelo</th>
            </tr>
          </thead>
          <tbody>
            {phases.map((phase, i) => {
              const phaseBadge = getDurationBadge(phase.duration_ms);
              return (
                <tr key={phase.name} className="border-b border-gray-800">
                  <td className="py-1 flex items-center gap-1">
                    <span className={`inline-block w-2 h-2 rounded-full ${PHASE_COLORS[i % PHASE_COLORS.length]}`} />
                    <span className="text-gray-300">{phase.name}</span>
                  </td>
                  <td className={`text-right py-1 ${phaseBadge.className}`}>
                    {(phase.duration_ms / 1000).toFixed(1)}s
                  </td>
                  <td className="text-right py-1 text-gray-400">
                    {phase.tokens || '-'}
                  </td>
                  <td className="text-right py-1 text-gray-400">
                    {phase.cost_usd ? `$${phase.cost_usd.toFixed(4)}` : '-'}
                  </td>
                  <td className="text-right py-1 text-gray-400 truncate max-w-[120px]">
                    {phase.model || '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Bottleneck */}
      {bottleneck && (
        <div className="flex items-center gap-2 text-xs bg-red-900/20 border border-red-800/30 rounded px-3 py-2">
          <span className="text-red-400 font-semibold">Gargalo:</span>
          <span className="text-red-300">{bottleneck}</span>
        </div>
      )}

      {/* Diagnostics */}
      {diagnostics && diagnostics.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs text-yellow-400 font-semibold">Diagnostico e Sugestoes:</span>
          <ul className="space-y-1">
            {diagnostics.map((d, i) => (
              <li key={i} className="text-xs text-yellow-300/80 flex items-start gap-1">
                <span className="text-yellow-400 mt-0.5">*</span>
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

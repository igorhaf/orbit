/**
 * PipelinePlanModal — gating modal shown before triggering a Deep Pipeline.
 *
 * Shows: estimated cost per phase × current quota budget × verdict.
 * User picks mode (aggressive | balanced | conservative) and either:
 *   - Disparar (proceeds with chosen mode)
 *   - Forçar (force=true: skips quota check, may exhaust)
 *   - Cancelar
 *
 * v2.4.0
 */
'use client';

import React, { useEffect, useState } from 'react';
import { Loader2, Zap, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { claudiusApi, type PipelineMode, type PlanResult } from '@/lib/api/claudius';

interface Props {
  projectId: string;
  projectName?: string;
  projectMeta: Record<string, any>;  // {n_files, n_domains?, n_epics?}
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (mode: PipelineMode, force: boolean) => Promise<void> | void;
}

const MODES: Array<{ id: PipelineMode; label: string; hint: string }> = [
  { id: 'aggressive',   label: 'Agressivo',    hint: 'Usa 100% da cota restante. Risco de esgotar no meio.' },
  { id: 'balanced',     label: 'Equilibrado',  hint: 'Usa 70% da cota. Margem de segurança razoável (padrão).' },
  { id: 'conservative', label: 'Conservador',  hint: 'Usa 50% da cota. Reduz batch + troca Sonnet por Haiku.' },
];

function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function pctOfBudget(used: number, budget: number): string {
  if (budget <= 0) return '∞%';
  return `${((used / budget) * 100).toFixed(0)}%`;
}

export function PipelinePlanModal({ projectId, projectName, projectMeta, isOpen, onClose, onConfirm }: Props) {
  const [mode, setMode] = useState<PipelineMode>('balanced');
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let mounted = true;
    setLoading(true);
    setError(null);
    claudiusApi
      .quotaPlan(projectMeta, mode)
      .then((r) => mounted && setPlan(r))
      .catch((e) => mounted && setError(e?.message || 'Erro ao calcular plano'))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [isOpen, mode, JSON.stringify(projectMeta)]);

  if (!isOpen) return null;

  const verdict = plan?.recommendation;
  const verdictColor = verdict === 'wait' ? 'red' : verdict === 'adjust' ? 'yellow' : 'emerald';
  const VerdictIcon = verdict === 'wait' ? AlertTriangle : verdict === 'adjust' ? Zap : CheckCircle2;

  const handleConfirm = async (force: boolean) => {
    setConfirming(true);
    try {
      await onConfirm(mode, force);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Erro ao disparar');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Plano de Pipeline</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {projectName ? `${projectName} · ` : ''}{projectMeta.n_files} arquivos · {projectMeta.n_domains || '?'} domínios conhecidos
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Mode selector */}
        <div className="px-5 py-4 border-b border-gray-100">
          <p className="text-xs text-gray-600 mb-2">Modo de execução</p>
          <div className="grid grid-cols-3 gap-2">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`p-2.5 text-left rounded-md border transition-all text-xs ${
                  mode === m.id
                    ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-200'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <p className="font-medium text-gray-900">{m.label}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{m.hint}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Plan body */}
        <div className="px-5 py-4 space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Estimando custo…
            </div>
          ) : error ? (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
              {error}
            </div>
          ) : plan ? (
            <>
              {/* Verdict */}
              <div className={`p-3 rounded-md border flex items-start gap-2 bg-${verdictColor}-50 border-${verdictColor}-200`}>
                <VerdictIcon className={`w-4 h-4 text-${verdictColor}-600 mt-0.5 flex-shrink-0`} />
                <div className="flex-1">
                  <p className={`text-sm font-medium text-${verdictColor}-900`}>
                    {verdict === 'proceed' ? 'Cabe na cota — pode disparar.' :
                     verdict === 'adjust' ? 'Não cabe; o sistema vai ajustar.' :
                     'Cota insuficiente. Aguarde reset ou force.'}
                  </p>
                  {plan.reason && <p className={`text-xs text-${verdictColor}-700 mt-0.5`}>{plan.reason}</p>}
                  {plan.suggested_mode && plan.suggested_mode !== mode && (
                    <button
                      onClick={() => setMode(plan.suggested_mode as PipelineMode)}
                      className="text-xs text-blue-600 hover:underline mt-1"
                    >
                      Mudar pra {plan.suggested_mode} →
                    </button>
                  )}
                </div>
              </div>

              {/* Totals vs budget */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-gray-50 rounded">
                  <p className="text-gray-500">Tokens input</p>
                  <p className="text-base font-semibold text-gray-900 tabular-nums">
                    {compactNumber(plan.estimate.total_input)}
                  </p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    de {compactNumber(plan.budget.input)} disponíveis ({pctOfBudget(plan.estimate.total_input, plan.budget.input)})
                  </p>
                </div>
                <div className="p-3 bg-gray-50 rounded">
                  <p className="text-gray-500">Tokens output</p>
                  <p className="text-base font-semibold text-gray-900 tabular-nums">
                    {compactNumber(plan.estimate.total_output)}
                  </p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    de {compactNumber(plan.budget.output)} disponíveis ({pctOfBudget(plan.estimate.total_output, plan.budget.output)})
                  </p>
                </div>
              </div>

              {/* Per-phase */}
              <details className="text-xs">
                <summary className="cursor-pointer text-gray-600 hover:text-gray-900">Detalhe por fase</summary>
                <table className="w-full mt-2">
                  <thead>
                    <tr className="text-left text-gray-500">
                      <th className="py-1 font-medium">Fase</th>
                      <th className="py-1 font-medium text-right">Unidades</th>
                      <th className="py-1 font-medium text-right">Input</th>
                      <th className="py-1 font-medium text-right">Output</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {plan.estimate.by_phase.map((p) => (
                      <tr key={p.phase}>
                        <td className="py-1 font-mono">{p.phase}</td>
                        <td className="py-1 text-right tabular-nums">{p.units}</td>
                        <td className="py-1 text-right tabular-nums">{compactNumber(p.input_tokens)}</td>
                        <td className="py-1 text-right tabular-nums">{compactNumber(p.output_tokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>

              {plan.suggested_profile && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-gray-600 hover:text-gray-900">Ajustes propostos</summary>
                  <pre className="mt-2 p-2 bg-gray-50 rounded text-[11px] overflow-x-auto">
                    {JSON.stringify(plan.suggested_profile, null, 2)}
                  </pre>
                </details>
              )}
            </>
          ) : null}
        </div>

        {/* Actions */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 rounded">
            Cancelar
          </button>
          {verdict === 'wait' && (
            <button
              onClick={() => handleConfirm(true)}
              disabled={confirming}
              className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded disabled:opacity-60"
            >
              {confirming ? 'Disparando…' : 'Forçar (risco)'}
            </button>
          )}
          {verdict !== 'wait' && (
            <button
              onClick={() => handleConfirm(false)}
              disabled={confirming}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-60"
            >
              {confirming && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Disparar ({mode})
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

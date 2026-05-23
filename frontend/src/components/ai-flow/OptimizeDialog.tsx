/**
 * Optimize Dialog
 * PROMPT #124 - Smart Chain Reorder & Optimization
 *
 * Dialog for analyzing model performance and recommending optimal chain order.
 */

'use client';

import React, { useEffect, useState } from 'react';
import { Spinner } from '@/components/ui';
import { Button } from '@/components/ui/Button';
import { USAGE_TYPE_OPTIONS } from './FlowConstants';
import { ProviderIcon } from './FlowIcons';
import { aiFlowApi } from '@/lib/api';
import type {
  AIFlowOptimizeChainResponse,
  AIFlowOptimizeModelScore,
} from '@/lib/types';

export interface OptimizeDialogProps {
  open: boolean;
  onClose: () => void;
  onApply: (order: string[]) => void;
  usageType: string;
}

export default function OptimizeDialog({
  open,
  onClose,
  onApply,
  usageType,
}: OptimizeDialogProps) {
  const [strategy, setStrategy] = useState('balanced');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AIFlowOptimizeChainResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleOptimize = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await aiFlowApi.optimizeChain(usageType, strategy);
      setResult(res);
    } catch (err: any) {
      const msg = err?.message || 'Falha ao otimizar';
      if (msg.includes('No chain configured')) {
        setError('Nenhuma cadeia configurada para esta operação. Adicione modelos à cadeia primeiro.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setResult(null);
      setError(null);
      setStrategy('balanced');
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto">
        <div className="p-5 border-b">
          <h3 className="text-lg font-semibold text-gray-900">Otimizar Ordem da Cadeia</h3>
          <p className="text-sm text-gray-500 mt-1">
            Analisar desempenho dos modelos e obter uma ordem recomendada para{' '}
            {USAGE_TYPE_OPTIONS.find(o => o.value === usageType)?.label || usageType}
          </p>
        </div>

        <div className="p-5 space-y-4">
          {/* Strategy selector */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-2">Estratégia</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'balanced', label: 'Equilibrado', desc: 'Melhor geral' },
                { value: 'reliability', label: 'Confiabilidade', desc: 'Maior taxa de sucesso' },
                { value: 'cost', label: 'Custo', desc: 'Menor custo primeiro' },
                { value: 'quality', label: 'Qualidade', desc: 'Melhores modelos primeiro' },
              ].map((s) => (
                <button
                  key={s.value}
                  onClick={() => setStrategy(s.value)}
                  className={`p-2.5 rounded-lg border text-left transition-colors ${
                    strategy === s.value
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 hover:border-gray-300 text-gray-700'
                  }`}
                >
                  <div className="text-sm font-medium">{s.label}</div>
                  <div className="text-[10px] text-gray-500">{s.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          {!result && (
            <Button
              variant="primary"
              onClick={handleOptimize}
              disabled={loading}
              className="w-full"
            >
              {loading ? (
                <div className="flex items-center justify-center gap-2">
                  <Spinner size="sm" />
                  Analisando...
                </div>
              ) : (
                'Analisar e Recomendar'
              )}
            </Button>
          )}

          {/* Result */}
          {result && (
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-gray-900">Ordem Recomendada</h4>
              <div className="space-y-1.5">
                {result.models.map((m: AIFlowOptimizeModelScore, i: number) => (
                  <div key={m.model_id} className="flex items-center gap-2 p-2 rounded-md bg-gray-50 border text-xs">
                    <span className="font-bold text-gray-500 w-5">{i + 1}</span>
                    <ProviderIcon provider={m.provider} size="w-4 h-4" />
                    <span className="flex-1 font-medium">{m.model_name}</span>
                    <span className="text-gray-500">Pontuação: {m.score.toFixed(2)}</span>
                  </div>
                ))}
              </div>

              {result.estimated_improvement && Object.keys(result.estimated_improvement).length > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-700">
                  <div className="font-medium mb-1">Melhoria Estimada</div>
                  {Object.entries(result.estimated_improvement).map(([k, v]) => (
                    <div key={k}>{k}: {v}</div>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="primary" onClick={() => onApply(result.recommended_order)} className="flex-1">
                  Aplicar Ordem Recomendada
                </Button>
                <Button variant="ghost" onClick={onClose}>Cancelar</Button>
              </div>
            </div>
          )}

          {!result && (
            <div className="flex justify-end">
              <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

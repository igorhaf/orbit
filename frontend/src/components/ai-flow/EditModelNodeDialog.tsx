/**
 * Edit Model Node Dialog
 * PROMPT #226 - Per-instance overrides for model nodes in the flow.
 *
 * Dialog for editing per-flow model overrides (temperature, max_tokens, timeout, etc.).
 */

'use client';

import React, { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PROVIDER_COLORS } from './FlowConstants';
import { ProviderIcon } from './FlowIcons';
import type { AIFlowChainModel } from '@/lib/types';

export interface ModelOverrides {
  temperature?: number | null;
  max_tokens?: number | null;
  timeout_seconds?: number | null;
  max_concurrent_requests?: number | null;
}

export interface EditModelNodeDialogProps {
  model: AIFlowChainModel;
  overrides: ModelOverrides;
  onSave: (modelId: string, overrides: ModelOverrides) => void;
  onClose: () => void;
}

export default function EditModelNodeDialog({
  model,
  overrides,
  onSave,
  onClose,
}: EditModelNodeDialogProps) {
  const [temperature, setTemperature] = useState<string>(
    overrides.temperature != null ? String(overrides.temperature) : ''
  );
  const [maxTokens, setMaxTokens] = useState<string>(
    overrides.max_tokens != null ? String(overrides.max_tokens) : ''
  );
  const [timeoutSeconds, setTimeoutSeconds] = useState<string>(
    overrides.timeout_seconds != null ? String(overrides.timeout_seconds) : ''
  );
  const [maxConcurrent, setMaxConcurrent] = useState<string>(
    overrides.max_concurrent_requests != null ? String(overrides.max_concurrent_requests) : ''
  );

  const handleSave = () => {
    onSave(model.id, {
      temperature: temperature !== '' ? parseFloat(temperature) : null,
      max_tokens: maxTokens !== '' ? parseInt(maxTokens) : null,
      timeout_seconds: timeoutSeconds !== '' ? parseInt(timeoutSeconds) : null,
      max_concurrent_requests: maxConcurrent !== '' ? parseInt(maxConcurrent) : null,
    });
  };

  const providerColor = PROVIDER_COLORS[model.provider] || '#6b7280';

  return (
    <Dialog open={true} onClose={onClose} title={`Editar Modelo: ${model.name}`} size="md">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3 pb-3 border-b border-gray-200">
          <div className="p-2 rounded-lg" style={{ backgroundColor: providerColor + '15' }}>
            <ProviderIcon provider={model.provider} />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-gray-900">{model.name}</div>
            <div className="text-xs text-gray-500 capitalize">{model.provider} &middot; {model.config?.model || 'N/A'}</div>
          </div>
        </div>

        {/* Info */}
        <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700">
          Sobrescrever padrões do modelo para esta posição específica do fluxo. Deixe campos vazios para usar as configurações globais do modelo.
        </div>

        {/* Override fields */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-gray-900">Sobreposições por Fluxo</h4>

          <Input
            label="Temperature"
            type="number"
            min="0"
            max="2"
            step="0.1"
            placeholder={`Padrão: ${model.config?.temperature ?? 'padrão do modelo'}`}
            value={temperature}
            onChange={(e) => setTemperature(e.target.value)}
            helperText="0.0 = determinístico, 2.0 = muito criativo. Vazio = usar padrão do modelo."
          />

          <Input
            label="Max Tokens"
            type="number"
            min="1"
            placeholder={`Padrão: ${model.config?.max_tokens ?? 'padrão do modelo'}`}
            value={maxTokens}
            onChange={(e) => setMaxTokens(e.target.value)}
            helperText="Tamanho máximo da resposta. Vazio = usar padrão do modelo."
          />

          <Input
            label="Timeout (segundos)"
            type="number"
            min="1"
            placeholder="Padrão: padrão do modelo/sistema"
            value={timeoutSeconds}
            onChange={(e) => setTimeoutSeconds(e.target.value)}
            helperText="Timeout da chamada API. Vazio = usar padrão do modelo."
          />

          <Input
            label="Max Requisições Simultâneas"
            type="number"
            min="1"
            placeholder={`Padrão: ${model.max_concurrent_requests || 'Ilimitado'}`}
            value={maxConcurrent}
            onChange={(e) => setMaxConcurrent(e.target.value)}
            helperText="Máx. chamadas API em paralelo. Vazio = usar padrão do modelo."
          />
        </div>

        {/* Current global settings (read-only) */}
        <div className="space-y-1 pt-2 border-t border-gray-200">
          <h4 className="text-xs font-semibold text-gray-500 uppercase">Configurações Globais do Modelo</h4>
          <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
            <div>Max Tokens: <span className="font-medium text-gray-900">{model.config?.max_tokens || 'N/A'}</span></div>
            <div>Temperature: <span className="font-medium text-gray-900">{model.config?.temperature ?? 'N/A'}</span></div>
            <div>Limite de Taxa: <span className="font-medium text-gray-900">{model.rate_limit_requests ? `${model.rate_limit_requests} req/${model.rate_limit_window_seconds}s` : 'Nenhum'}</span></div>
            <div>Concorrência: <span className="font-medium text-gray-900">{model.max_concurrent_requests ? `${model.max_concurrent_requests}x` : 'Ilimitado'}</span></div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={handleSave}>Salvar Sobreposições</Button>
        </div>
      </div>
    </Dialog>
  );
}

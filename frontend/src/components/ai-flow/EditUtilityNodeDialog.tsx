/**
 * Edit Utility Node Dialog
 * PROMPT #208 - Edit Utility Node Dialog
 *
 * Dialog for editing utility node configuration (cache, RAG, transformer, etc.).
 */

'use client';

import React, { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { UTILITY_NODE_COLORS } from './FlowConstants';
import { UtilityNodeIcon } from './FlowIcons';
import type { AIFlowUtilityNode } from '@/lib/types';

export interface EditUtilityNodeDialogProps {
  node: AIFlowUtilityNode;
  onSave: (updated: AIFlowUtilityNode) => void;
  onClose: () => void;
}

export default function EditUtilityNodeDialog({
  node,
  onSave,
  onClose,
}: EditUtilityNodeDialogProps) {
  const [label, setLabel] = useState(node.label);
  const [enabled, setEnabled] = useState(node.enabled);
  const [config, setConfig] = useState<Record<string, any>>({ ...node.config });

  const updateConfig = (key: string, value: any) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    onSave({ ...node, label, enabled, config });
  };

  const color = UTILITY_NODE_COLORS[node.type] || '#6b7280';

  const renderFields = () => {
    switch (node.type) {
      case 'cache':
        return (
          <>
            <Input
              label="TTL (seconds)"
              type="number"
              min="1"
              value={config.ttl_seconds ?? 86400}
              onChange={(e) => updateConfig('ttl_seconds', parseInt(e.target.value) || 86400)}
            />
            <Select
              label="Nivel de Cache"
              value={config.cache_level ?? 'exact'}
              onChange={(e) => updateConfig('cache_level', e.target.value)}
              options={[
                { value: 'exact', label: 'Correspondencia Exata' },
                { value: 'semantic', label: 'Correspondencia Semantica' },
                { value: 'template', label: 'Cache de Template' },
              ]}
            />
          </>
        );

      case 'rag_context':
        return (
          <>
            <Input
              label="Max Resultados"
              type="number"
              min="1"
              max="20"
              value={config.max_results ?? 5}
              onChange={(e) => updateConfig('max_results', parseInt(e.target.value) || 5)}
            />
            <Input
              label="Limiar de Similaridade (0-1)"
              type="number"
              min="0"
              max="1"
              step="0.05"
              value={config.similarity_threshold ?? 0.7}
              onChange={(e) => updateConfig('similarity_threshold', parseFloat(e.target.value) || 0.7)}
            />
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="include-metadata"
                className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                checked={config.include_metadata ?? true}
                onChange={(e) => updateConfig('include_metadata', e.target.checked)}
              />
              <label htmlFor="include-metadata" className="text-sm text-gray-700">Incluir Metadados</label>
            </div>
            <div className="border-t border-gray-200 pt-3 mt-3">
              <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">PROMPT #229 - Otimizacao RAG</p>
            </div>
            <Input
              label="Filtrar Tipos (separados por virgula)"
              placeholder="ex: spec, business_rule, feature"
              value={config.filter_types ?? ''}
              onChange={(e) => updateConfig('filter_types', e.target.value || null)}
              helperText="Incluir apenas estes tipos de documento. Deixe vazio para todos."
            />
            <Input
              label="Excluir Tipos (separados por virgula)"
              placeholder="ex: commit, log"
              value={config.exclude_types ?? ''}
              onChange={(e) => updateConfig('exclude_types', e.target.value || null)}
              helperText="Excluir estes tipos de documento dos resultados."
            />
            <Input
              label="Limiar de Deduplicacao (0-1)"
              type="number"
              min="0"
              max="1"
              step="0.05"
              value={config.dedupe_threshold ?? 0.95}
              onChange={(e) => updateConfig('dedupe_threshold', parseFloat(e.target.value) || 0.95)}
              helperText="Similaridade Jaccard acima deste valor remove documentos duplicados."
            />
            <Input
              label="Max Caracteres de Contexto"
              type="number"
              min="500"
              step="500"
              value={config.max_context_chars ?? 6000}
              onChange={(e) => updateConfig('max_context_chars', parseInt(e.target.value) || 6000)}
              helperText="Comprimir contexto para este tamanho antes de enviar ao LLM."
            />
            <Select
              label="Estrategia de Compressao"
              value={config.compression_strategy ?? 'key_sentences'}
              onChange={(e) => updateConfig('compression_strategy', e.target.value)}
              options={[
                { value: 'key_sentences', label: 'Frases-Chave (pontuacao por posicao + tamanho)' },
                { value: 'extractive', label: 'Extrativa (primeira + ultima + melhores do meio)' },
                { value: 'truncate', label: 'Truncar (corte simples no max de caracteres)' },
              ]}
            />
            <Input
              label="Rerank Top K"
              type="number"
              min="1"
              max="20"
              value={config.rerank_top_k ?? 3}
              onChange={(e) => updateConfig('rerank_top_k', parseInt(e.target.value) || 3)}
              helperText="Apos a recuperacao inicial, manter apenas os K documentos mais relevantes."
            />
          </>
        );

      case 'prompt_transformer':
        return (
          <>
            <Select
              label="Transformacao"
              value={config.transformation ?? 'compress'}
              onChange={(e) => updateConfig('transformation', e.target.value)}
              options={[
                { value: 'compress', label: 'Comprimir (truncar mensagens longas)' },
                { value: 'summarize_context', label: 'Resumir Contexto (manter ultimos N)' },
                { value: 'add_instructions', label: 'Adicionar Instrucoes' },
              ]}
            />
            <Input
              label="Max Tokens"
              type="number"
              min="100"
              value={config.max_tokens ?? 4000}
              onChange={(e) => updateConfig('max_tokens', parseInt(e.target.value) || 4000)}
            />
            <Input
              label="Sobrescrever Max Tokens"
              type="number"
              min="0"
              placeholder="Deixe vazio para usar padrao do modelo"
              value={config.override_max_tokens ?? ''}
              onChange={(e) => updateConfig('override_max_tokens', e.target.value ? parseInt(e.target.value) : null)}
              helperText="Limitado pelo max_tokens do modelo. Deixe vazio para nao sobrescrever."
            />
            <Input
              label="Sobrescrever Temperature"
              type="number"
              min="0"
              max="2"
              step="0.1"
              placeholder="Deixe vazio para usar padrao do modelo"
              value={config.override_temperature ?? ''}
              onChange={(e) => updateConfig('override_temperature', e.target.value ? parseFloat(e.target.value) : null)}
              helperText="Valor livre (0.0-2.0). Deixe vazio para nao sobrescrever."
            />
          </>
        );

      case 'router':
        return (
          <>
            <Select
              label="Condicao"
              value={config.condition ?? 'complexity'}
              onChange={(e) => updateConfig('condition', e.target.value)}
              options={[
                { value: 'complexity', label: 'Complexidade' },
                { value: 'cost', label: 'Custo' },
                { value: 'message_count', label: 'Quantidade de Mensagens' },
              ]}
            />
            <Select
              label="Limiar"
              value={config.threshold ?? 'medium'}
              onChange={(e) => updateConfig('threshold', e.target.value)}
              options={[
                { value: 'low', label: 'Baixo' },
                { value: 'medium', label: 'Medio' },
                { value: 'high', label: 'Alto' },
              ]}
            />
          </>
        );

      case 'retry':
        return (
          <>
            <Input
              label="Max Tentativas"
              type="number"
              min="1"
              max="10"
              value={config.max_retries ?? 3}
              onChange={(e) => updateConfig('max_retries', parseInt(e.target.value) || 3)}
            />
            <Input
              label="Backoff Base (ms)"
              type="number"
              min="100"
              value={config.backoff_base_ms ?? 1000}
              onChange={(e) => updateConfig('backoff_base_ms', parseInt(e.target.value) || 1000)}
            />
            <Input
              label="Multiplicador de Backoff"
              type="number"
              min="1"
              max="10"
              step="0.5"
              value={config.backoff_multiplier ?? 2.0}
              onChange={(e) => updateConfig('backoff_multiplier', parseFloat(e.target.value) || 2.0)}
            />
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="skip-permanent-errors"
                className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                checked={config.skip_permanent_errors ?? true}
                onChange={(e) => updateConfig('skip_permanent_errors', e.target.checked)}
              />
              <label htmlFor="skip-permanent-errors" className="text-sm text-gray-700">Ignorar Erros Permanentes (401, 404)</label>
            </div>
            <p className="text-xs text-gray-500 ml-6">Quando ativado, erros permanentes nunca sao retentados - passa direto para o fallback da cadeia.</p>
          </>
        );

      case 'validator':
        return (
          <>
            <Select
              label="Tipo de Validacao"
              value={config.validation_type ?? 'json'}
              onChange={(e) => updateConfig('validation_type', e.target.value)}
              options={[
                { value: 'json', label: 'Parsing JSON' },
                { value: 'length', label: 'Verificacao de Tamanho' },
                { value: 'keywords', label: 'Palavras-chave Obrigatorias' },
                { value: 'not_empty', label: 'Nao Vazio' },
              ]}
            />
            <Input
              label="Tamanho Maximo (0 = sem limite)"
              type="number"
              min="0"
              value={config.max_length ?? 0}
              onChange={(e) => updateConfig('max_length', parseInt(e.target.value) || 0)}
            />
            <Input
              label="Palavras-chave Obrigatorias (separadas por virgula)"
              placeholder="ex: result, status, data"
              value={Array.isArray(config.required_keywords) ? config.required_keywords.join(', ') : (config.required_keywords || '')}
              onChange={(e) => updateConfig('required_keywords', e.target.value ? e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) : [])}
            />
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="retry-on-fail"
                className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                checked={config.retry_on_fail ?? true}
                onChange={(e) => updateConfig('retry_on_fail', e.target.checked)}
              />
              <label htmlFor="retry-on-fail" className="text-sm text-gray-700">Retentar em Falha de Validacao</label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="auto-repair-json"
                className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                checked={config.auto_repair_json ?? true}
                onChange={(e) => updateConfig('auto_repair_json', e.target.checked)}
              />
              <label htmlFor="auto-repair-json" className="text-sm text-gray-700">Auto-reparar JSON</label>
            </div>
            <p className="text-xs text-gray-500 ml-6">Tentar corrigir JSON malformado (virgulas finais, aspas simples, blocos de codigo) antes de acionar retry.</p>
          </>
        );

      case 'cost_guard':
        return (
          <>
            <Input
              label="Custo Maximo por Chamada ($)"
              type="number"
              min="0.01"
              step="0.01"
              value={config.max_cost_per_call ?? 0.10}
              onChange={(e) => updateConfig('max_cost_per_call', parseFloat(e.target.value) || 0.10)}
            />
            <Input
              label="Orcamento Diario ($)"
              type="number"
              min="0"
              step="0.50"
              value={config.daily_budget ?? 10.0}
              onChange={(e) => updateConfig('daily_budget', parseFloat(e.target.value) || 10.0)}
            />
            <Input
              label="Orcamento Mensal ($)"
              type="number"
              min="0"
              step="1"
              value={config.monthly_budget ?? 100.0}
              onChange={(e) => updateConfig('monthly_budget', parseFloat(e.target.value) || 100.0)}
            />
            <Select
              label="Acao ao Exceder"
              value={config.action_on_exceed ?? 'block'}
              onChange={(e) => updateConfig('action_on_exceed', e.target.value)}
              options={[
                { value: 'block', label: 'Bloquear Requisicao' },
                { value: 'warn', label: 'Apenas Avisar' },
              ]}
            />
          </>
        );

      case 'rate_limiter':
        return (
          <>
            <Input
              label="Max Requisicoes"
              type="number"
              min="1"
              value={config.max_requests ?? 60}
              onChange={(e) => updateConfig('max_requests', parseInt(e.target.value) || 60)}
            />
            <Input
              label="Janela (segundos)"
              type="number"
              min="1"
              value={config.window_seconds ?? 60}
              onChange={(e) => updateConfig('window_seconds', parseInt(e.target.value) || 60)}
            />
            <Select
              label="Acao ao Exceder"
              value={config.action_on_exceed ?? 'queue'}
              onChange={(e) => updateConfig('action_on_exceed', e.target.value)}
              options={[
                { value: 'queue', label: 'Fila (aguardar)' },
                { value: 'block', label: 'Bloquear Requisicao' },
              ]}
            />
          </>
        );

      case 'timeout':
        return (
          <Input
            label="Timeout (segundos)"
            type="number"
            min="1"
            value={config.timeout_seconds ?? 120}
            onChange={(e) => updateConfig('timeout_seconds', parseInt(e.target.value) || 120)}
            helperText="Sobrescreve o timeout do Modelo de IA e o padrao das Configuracoes do Sistema."
          />
        );

      case 'prompt_node':
        return (
          <>
            <Input
              label="Arquivo YAML do Prompt"
              placeholder="rag/extract_rules"
              value={config.prompt_yaml ?? ''}
              onChange={(e) => updateConfig('prompt_yaml', e.target.value)}
              helperText="Caminho relativo em backend/app/prompts/ (sem .yaml)"
            />
            <Input
              label="Repeticoes"
              type="number"
              min="1"
              max="10"
              value={config.repeat ?? 1}
              onChange={(e) => updateConfig('repeat', parseInt(e.target.value) || 1)}
              helperText="Numero de vezes que o prompt sera executado"
            />
            <Input
              label="Descricao"
              placeholder="Extrair regras de negocio do codebase..."
              value={config.description ?? ''}
              onChange={(e) => updateConfig('description', e.target.value)}
            />
          </>
        );

      default:
        return <p className="text-sm text-gray-500">Nenhuma configuracao editavel para este tipo de no.</p>;
    }
  };

  return (
    <Dialog open={true} onClose={onClose} title={`Editar ${node.type.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}`} size="md">
      <div className="space-y-4">
        {/* Header with icon and color indicator */}
        <div className="flex items-center gap-3 pb-3 border-b border-gray-200">
          <div className="p-2 rounded-lg" style={{ backgroundColor: color + '15' }}>
            <UtilityNodeIcon type={node.type} size="w-6 h-6" />
          </div>
          <div className="flex-1">
            <Input
              label="Rotulo"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Rotulo do no"
            />
          </div>
        </div>

        {/* Enabled toggle */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="node-enabled"
            className="h-4 w-4 text-blue-600 border-gray-300 rounded"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <label htmlFor="node-enabled" className="text-sm font-medium text-gray-700">Ativado</label>
        </div>

        {/* Type-specific fields */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-gray-900">Configuracao</h4>
          {renderFields()}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={handleSave}>Salvar</Button>
        </div>
      </div>
    </Dialog>
  );
}

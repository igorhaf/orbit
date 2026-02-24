/**
 * AI Flow Node Components
 * PROMPT #122 - Visual Fallback Chain Configuration
 * PROMPT #124 - Metrics, Animation, Analytics & Smart Reorder
 * PROMPT #204 - Utility Node Components
 *
 * Custom ReactFlow node renderers for model nodes and utility nodes.
 */

'use client';

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { PROVIDER_COLORS, UTILITY_NODE_COLORS } from './FlowConstants';
import { ProviderIcon, UtilityNodeIcon } from './FlowIcons';
import type { AIFlowModelMetrics } from '@/lib/types';

// ---------------------------------------------------------------------------
// Node Animation State type (shared across components)
// ---------------------------------------------------------------------------

export type NodeAnimationState = 'idle' | 'executing' | 'success' | 'failed';

// ---------------------------------------------------------------------------
// Custom ReactFlow Node: ModelNode (PROMPT #124 - with metrics & animation)
// ---------------------------------------------------------------------------

export function ModelNode({ data }: { data: any }) {
  const providerColor = PROVIDER_COLORS[data.provider?.toLowerCase()] || '#6b7280';
  const metrics: AIFlowModelMetrics | undefined = data.metrics;
  const animation: NodeAnimationState = data.animation || 'idle';

  // Animation CSS classes
  let animationClasses = '';
  let borderOverride: Record<string, string> = {};
  if (animation === 'executing') {
    animationClasses = 'animate-pulse';
    borderOverride = {
      borderColor: '#3b82f6',
      boxShadow: '0 0 12px rgba(59,130,246,0.5)',
    };
  } else if (animation === 'success') {
    borderOverride = {
      borderColor: '#22c55e',
      boxShadow: '0 0 12px rgba(34,197,94,0.5)',
    };
  } else if (animation === 'failed') {
    animationClasses = 'animate-shake';
    borderOverride = {
      borderColor: '#ef4444',
      boxShadow: '0 0 12px rgba(239,68,68,0.5)',
    };
  }

  // Health indicator color
  const healthColor = metrics
    ? metrics.health === 'green' ? 'bg-green-500' : metrics.health === 'yellow' ? 'bg-yellow-500' : 'bg-red-500'
    : data.is_active ? 'bg-green-500' : 'bg-gray-400';

  return (
    <div
      className={`bg-white rounded-lg shadow-md border-2 min-w-[200px] relative cursor-grab active:cursor-grabbing hover:shadow-lg transition-all ${animationClasses}`}
      style={{
        borderLeftColor: providerColor,
        borderLeftWidth: '4px',
        borderTopColor: '#e5e7eb',
        borderRightColor: '#e5e7eb',
        borderBottomColor: '#e5e7eb',
        ...borderOverride,
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-blue-500 hover:!w-4 hover:!h-4 transition-all"
      />

      <div className="px-4 py-3">
        <div className="flex items-center gap-3">
          <ProviderIcon provider={data.provider || 'unknown'} />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-gray-900 truncate">{data.name}</div>
            <div className="text-xs text-gray-500 capitalize">{data.provider}</div>
          </div>
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${healthColor}`} />
        </div>
        {data.config?.model && (
          <div className="text-[10px] text-gray-400 mt-1.5 font-mono truncate">{data.config.model}</div>
        )}
        {data.position_label && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
              data.position_label === 'Primário'
                ? 'bg-blue-100 text-blue-700'
                : 'bg-amber-100 text-amber-700'
            }`}>
              {data.position_label}
            </span>
            {data.hasOverrides && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-purple-100 text-purple-700" title="Sobreposições aplicadas por fluxo">
                Sobreposições
              </span>
            )}
          </div>
        )}

        {/* PROMPT #124 - Metrics display */}
        {metrics && metrics.total_executions > 0 && (
          <div className="mt-2 pt-2 border-t border-gray-100 grid grid-cols-2 gap-x-3 gap-y-1">
            <div className="text-[10px] text-gray-500">
              <span className={`font-semibold ${
                metrics.health === 'green' ? 'text-green-600' : metrics.health === 'yellow' ? 'text-yellow-600' : 'text-red-600'
              }`}>{metrics.success_rate.toFixed(1)}%</span> sucesso
            </div>
            <div className="text-[10px] text-gray-500">
              <span className="font-semibold text-gray-700">{metrics.avg_latency_ms >= 1000 ? `${(metrics.avg_latency_ms / 1000).toFixed(1)}s` : `${Math.round(metrics.avg_latency_ms)}ms`}</span> média
            </div>
            <div className="text-[10px] text-gray-500">
              <span className="font-semibold text-gray-700">${metrics.avg_cost_per_call.toFixed(4)}</span>/chamada
            </div>
            <div className="text-[10px] text-gray-500">
              <span className="font-semibold text-gray-700">{metrics.total_executions}</span> chamadas
            </div>
          </div>
        )}
      </div>

      {data.onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); data.onRemove(); }}
          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 shadow-sm"
        >
          x
        </button>
      )}

      <Handle
        type="source"
        position={Position.Right}
        id="right"
        className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-blue-500 hover:!w-4 hover:!h-4 transition-all"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        className="!bg-red-400 !w-3 !h-3 !border-2 !border-white hover:!bg-red-500 transition-all"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PROMPT #204 - Utility Node Components
// ---------------------------------------------------------------------------

export function CacheNode({ data }: { data: any }) {
  const color = UTILITY_NODE_COLORS.cache;
  return (
    <div className="bg-white rounded-lg shadow-md border-2 min-w-[180px] relative cursor-grab active:cursor-grabbing hover:shadow-lg transition-all"
      style={{ borderLeftColor: color, borderLeftWidth: '4px', borderTopColor: '#e5e7eb', borderRightColor: '#e5e7eb', borderBottomColor: '#e5e7eb' }}>
      <Handle type="target" position={Position.Left} id="left" className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-violet-500 transition-all" />
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <UtilityNodeIcon type="cache" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-gray-900">{data.label || 'Cache'}</div>
            <div className="text-xs text-violet-600">Verificação de Cache Redis</div>
          </div>
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${data.enabled !== false ? 'bg-violet-500' : 'bg-gray-400'}`} />
        </div>
        <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
          <div className="text-[10px] text-gray-500">TTL: <span className="font-semibold text-gray-700">{data.config?.ttl_seconds || 86400}s</span></div>
          <div className="text-[10px] text-gray-500">Nível: <span className="font-semibold text-gray-700">{data.config?.cache_level || 'exact'}</span></div>
        </div>
      </div>
      {data.onRemove && (
        <button onClick={(e) => { e.stopPropagation(); data.onRemove(); }}
          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 shadow-sm">x</button>
      )}
      <Handle type="source" position={Position.Right} id="right" className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-violet-500 transition-all" />
    </div>
  );
}

export function RAGContextNode({ data }: { data: any }) {
  const color = UTILITY_NODE_COLORS.rag_context;
  return (
    <div className="bg-white rounded-lg shadow-md border-2 min-w-[180px] relative cursor-grab active:cursor-grabbing hover:shadow-lg transition-all"
      style={{ borderLeftColor: color, borderLeftWidth: '4px', borderTopColor: '#e5e7eb', borderRightColor: '#e5e7eb', borderBottomColor: '#e5e7eb' }}>
      <Handle type="target" position={Position.Left} id="left" className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-cyan-500 transition-all" />
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <UtilityNodeIcon type="rag_context" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-gray-900">{data.label || 'Contexto RAG'}</div>
            <div className="text-xs text-cyan-600">Contexto Semântico</div>
          </div>
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${data.enabled !== false ? 'bg-cyan-500' : 'bg-gray-400'}`} />
        </div>
        <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
          <div className="text-[10px] text-gray-500">Max Resultados: <span className="font-semibold text-gray-700">{data.config?.max_results || 5}</span></div>
          <div className="text-[10px] text-gray-500">Limiar: <span className="font-semibold text-gray-700">{data.config?.similarity_threshold || 0.7}</span></div>
        </div>
      </div>
      {data.onRemove && (
        <button onClick={(e) => { e.stopPropagation(); data.onRemove(); }}
          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 shadow-sm">x</button>
      )}
      <Handle type="source" position={Position.Right} id="right" className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-cyan-500 transition-all" />
    </div>
  );
}

export function PromptTransformerNode({ data }: { data: any }) {
  const color = UTILITY_NODE_COLORS.prompt_transformer;
  return (
    <div className="bg-white rounded-lg shadow-md border-2 min-w-[180px] relative cursor-grab active:cursor-grabbing hover:shadow-lg transition-all"
      style={{ borderLeftColor: color, borderLeftWidth: '4px', borderTopColor: '#e5e7eb', borderRightColor: '#e5e7eb', borderBottomColor: '#e5e7eb' }}>
      <Handle type="target" position={Position.Left} id="left" className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-amber-500 transition-all" />
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <UtilityNodeIcon type="prompt_transformer" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-gray-900">{data.label || 'Transformer'}</div>
            <div className="text-xs text-amber-600">Transformação de Prompt</div>
          </div>
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${data.enabled !== false ? 'bg-amber-500' : 'bg-gray-400'}`} />
        </div>
        <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
          <div className="text-[10px] text-gray-500">Modo: <span className="font-semibold text-gray-700">{data.config?.transformation || 'compress'}</span></div>
          <div className="text-[10px] text-gray-500">Max Tokens: <span className="font-semibold text-gray-700">{data.config?.max_tokens || 4000}</span></div>
        </div>
      </div>
      {data.onRemove && (
        <button onClick={(e) => { e.stopPropagation(); data.onRemove(); }}
          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 shadow-sm">x</button>
      )}
      <Handle type="source" position={Position.Right} id="right" className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-amber-500 transition-all" />
    </div>
  );
}

export function RouterNode({ data }: { data: any }) {
  const color = UTILITY_NODE_COLORS.router;
  return (
    <div className="bg-white rounded-lg shadow-md border-2 min-w-[180px] relative cursor-grab active:cursor-grabbing hover:shadow-lg transition-all"
      style={{ borderLeftColor: color, borderLeftWidth: '4px', borderTopColor: '#e5e7eb', borderRightColor: '#e5e7eb', borderBottomColor: '#e5e7eb' }}>
      <Handle type="target" position={Position.Left} id="left" className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-emerald-500 transition-all" />
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <UtilityNodeIcon type="router" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-gray-900">{data.label || 'Router'}</div>
            <div className="text-xs text-emerald-600">Roteamento Condicional</div>
          </div>
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${data.enabled !== false ? 'bg-emerald-500' : 'bg-gray-400'}`} />
        </div>
        <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
          <div className="text-[10px] text-gray-500">Condição: <span className="font-semibold text-gray-700">{data.config?.condition || 'complexity'}</span></div>
          <div className="text-[10px] text-gray-500">Limiar: <span className="font-semibold text-gray-700">{data.config?.threshold || 'medium'}</span></div>
        </div>
      </div>
      {data.onRemove && (
        <button onClick={(e) => { e.stopPropagation(); data.onRemove(); }}
          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 shadow-sm">x</button>
      )}
      <Handle type="source" position={Position.Right} id="right" className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-emerald-500 transition-all" />
    </div>
  );
}

export function RetryNode({ data }: { data: any }) {
  const color = UTILITY_NODE_COLORS.retry;
  return (
    <div className="bg-white rounded-lg shadow-md border-2 min-w-[180px] relative cursor-grab active:cursor-grabbing hover:shadow-lg transition-all"
      style={{ borderLeftColor: color, borderLeftWidth: '4px', borderTopColor: '#e5e7eb', borderRightColor: '#e5e7eb', borderBottomColor: '#e5e7eb' }}>
      <Handle type="target" position={Position.Left} id="left" className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-blue-500 transition-all" />
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <UtilityNodeIcon type="retry" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-gray-900">{data.label || 'Retry'}</div>
            <div className="text-xs text-blue-600">Retry com Backoff</div>
          </div>
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${data.enabled !== false ? 'bg-blue-500' : 'bg-gray-400'}`} />
        </div>
        <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
          <div className="text-[10px] text-gray-500">Max Tentativas: <span className="font-semibold text-gray-700">{data.config?.max_retries || 3}</span></div>
          <div className="text-[10px] text-gray-500">Base: <span className="font-semibold text-gray-700">{data.config?.backoff_base_ms || 1000}ms</span></div>
        </div>
      </div>
      {data.onRemove && (
        <button onClick={(e) => { e.stopPropagation(); data.onRemove(); }}
          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 shadow-sm">x</button>
      )}
      <Handle type="source" position={Position.Right} id="right" className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-blue-500 transition-all" />
    </div>
  );
}

export function ValidatorNode({ data }: { data: any }) {
  const color = UTILITY_NODE_COLORS.validator;
  return (
    <div className="bg-white rounded-lg shadow-md border-2 min-w-[180px] relative cursor-grab active:cursor-grabbing hover:shadow-lg transition-all"
      style={{ borderLeftColor: color, borderLeftWidth: '4px', borderTopColor: '#e5e7eb', borderRightColor: '#e5e7eb', borderBottomColor: '#e5e7eb' }}>
      <Handle type="target" position={Position.Left} id="left" className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-green-500 transition-all" />
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <UtilityNodeIcon type="validator" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-gray-900">{data.label || 'Validador'}</div>
            <div className="text-xs text-green-600">Validação de Saída</div>
          </div>
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${data.enabled !== false ? 'bg-green-500' : 'bg-gray-400'}`} />
        </div>
        <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
          <div className="text-[10px] text-gray-500">Tipo: <span className="font-semibold text-gray-700">{data.config?.validation_type || 'json'}</span></div>
          <div className="text-[10px] text-gray-500">Retry: <span className="font-semibold text-gray-700">{data.config?.retry_on_fail !== false ? 'Sim' : 'Não'}</span></div>
        </div>
      </div>
      {data.onRemove && (
        <button onClick={(e) => { e.stopPropagation(); data.onRemove(); }}
          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 shadow-sm">x</button>
      )}
      <Handle type="source" position={Position.Right} id="right" className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-green-500 transition-all" />
    </div>
  );
}

export function CostGuardNode({ data }: { data: any }) {
  const color = UTILITY_NODE_COLORS.cost_guard;
  return (
    <div className="bg-white rounded-lg shadow-md border-2 min-w-[180px] relative cursor-grab active:cursor-grabbing hover:shadow-lg transition-all"
      style={{ borderLeftColor: color, borderLeftWidth: '4px', borderTopColor: '#e5e7eb', borderRightColor: '#e5e7eb', borderBottomColor: '#e5e7eb' }}>
      <Handle type="target" position={Position.Left} id="left" className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-red-500 transition-all" />
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <UtilityNodeIcon type="cost_guard" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-gray-900">{data.label || 'Controle de Custo'}</div>
            <div className="text-xs text-red-600">Limitador de Orçamento</div>
          </div>
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${data.enabled !== false ? 'bg-red-500' : 'bg-gray-400'}`} />
        </div>
        <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
          <div className="text-[10px] text-gray-500">Por Chamada: <span className="font-semibold text-gray-700">${data.config?.max_cost_per_call || 0.10}</span></div>
          <div className="text-[10px] text-gray-500">Diário: <span className="font-semibold text-gray-700">${data.config?.daily_budget || 10.0}</span></div>
        </div>
      </div>
      {data.onRemove && (
        <button onClick={(e) => { e.stopPropagation(); data.onRemove(); }}
          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 shadow-sm">x</button>
      )}
      <Handle type="source" position={Position.Right} id="right" className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-red-500 transition-all" />
    </div>
  );
}

export function RateLimiterNode({ data }: { data: any }) {
  const color = UTILITY_NODE_COLORS.rate_limiter;
  return (
    <div className="bg-white rounded-lg shadow-md border-2 min-w-[180px] relative cursor-grab active:cursor-grabbing hover:shadow-lg transition-all"
      style={{ borderLeftColor: color, borderLeftWidth: '4px', borderTopColor: '#e5e7eb', borderRightColor: '#e5e7eb', borderBottomColor: '#e5e7eb' }}>
      <Handle type="target" position={Position.Left} id="left" className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-pink-500 transition-all" />
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <UtilityNodeIcon type="rate_limiter" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-gray-900">{data.label || 'Limitador de Taxa'}</div>
            <div className="text-xs text-pink-600">Limitação de Requisições</div>
          </div>
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${data.enabled !== false ? 'bg-pink-500' : 'bg-gray-400'}`} />
        </div>
        <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
          <div className="text-[10px] text-gray-500">Limite: <span className="font-semibold text-gray-700">{data.config?.max_requests || 60} req</span></div>
          <div className="text-[10px] text-gray-500">Janela: <span className="font-semibold text-gray-700">{data.config?.window_seconds || 60}s</span></div>
        </div>
      </div>
      {data.onRemove && (
        <button onClick={(e) => { e.stopPropagation(); data.onRemove(); }}
          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 shadow-sm">x</button>
      )}
      <Handle type="source" position={Position.Right} id="right" className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-pink-500 transition-all" />
    </div>
  );
}

export function TimeoutNode({ data }: { data: any }) {
  const color = UTILITY_NODE_COLORS.timeout;
  return (
    <div className="bg-white rounded-lg shadow-md border-2 min-w-[180px] relative cursor-grab active:cursor-grabbing hover:shadow-lg transition-all"
      style={{ borderLeftColor: color, borderLeftWidth: '4px', borderTopColor: '#e5e7eb', borderRightColor: '#e5e7eb', borderBottomColor: '#e5e7eb' }}>
      <Handle type="target" position={Position.Left} id="left" className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-orange-500 transition-all" />
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <UtilityNodeIcon type="timeout" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-gray-900">{data.label || 'Timeout'}</div>
            <div className="text-xs text-orange-600">API Timeout</div>
          </div>
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${data.enabled !== false ? 'bg-orange-500' : 'bg-gray-400'}`} />
        </div>
        <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
          <div className="text-[10px] text-gray-500">Timeout: <span className="font-semibold text-gray-700">{data.config?.timeout_seconds || 120}s</span></div>
        </div>
      </div>
      {data.onRemove && (
        <button onClick={(e) => { e.stopPropagation(); data.onRemove(); }}
          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 shadow-sm">x</button>
      )}
      <Handle type="source" position={Position.Right} id="right" className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-orange-500 transition-all" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PROMPT #250 - Prompt Node (Reusable structured prompt for Claude Code)
// ---------------------------------------------------------------------------

export function PromptNodeNode({ data }: { data: any }) {
  const color = UTILITY_NODE_COLORS.prompt_node;
  return (
    <div
      className="bg-white rounded-lg shadow-md border-2 min-w-[180px] relative cursor-grab active:cursor-grabbing hover:shadow-lg transition-all"
      style={{ borderLeftColor: color, borderLeftWidth: '4px', borderTopColor: '#e5e7eb', borderRightColor: '#e5e7eb', borderBottomColor: '#e5e7eb' }}
    >
      <Handle type="target" position={Position.Left} id="left" className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-indigo-500 transition-all" />
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <UtilityNodeIcon type="prompt_node" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-gray-900">{data.label || 'Prompt Node'}</div>
            <div className="text-xs text-indigo-600">Prompt Estruturado</div>
          </div>
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${data.enabled !== false ? 'bg-indigo-500' : 'bg-gray-400'}`} />
        </div>
        <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
          <div className="text-[10px] text-gray-500">YAML: <span className="font-semibold text-gray-700">{data.config?.prompt_yaml || 'não configurado'}</span></div>
          <div className="text-[10px] text-gray-500">Repetições: <span className="font-semibold text-gray-700">{data.config?.repeat || 1}x</span></div>
          {data.config?.description && (
            <div className="text-[10px] text-gray-500 truncate">{data.config.description}</div>
          )}
        </div>
      </div>
      {data.onRemove && (
        <button onClick={(e) => { e.stopPropagation(); data.onRemove(); }}
          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 shadow-sm">x</button>
      )}
      <Handle type="source" position={Position.Right} id="right" className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-indigo-500 transition-all" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PROMPT #258 - Contracts List Node (aggregator with ordered list + drop zone)
// ---------------------------------------------------------------------------

export function ContractsListNode({ data }: { data: any }) {
  const contracts: any[] = data.contracts || [];
  const [dragOver, setDragOver] = React.useState(false);

  const domainColors: Record<string, string> = {
    business: 'bg-yellow-100 text-yellow-700',
    interview: 'bg-purple-100 text-purple-700',
    generation: 'bg-blue-100 text-blue-700',
    memory: 'bg-green-100 text-green-700',
    component: 'bg-gray-100 text-gray-700',
    pipeline: 'bg-teal-100 text-teal-700',
    execution: 'bg-orange-100 text-orange-700',
    validation: 'bg-red-100 text-red-700',
    commits: 'bg-indigo-100 text-indigo-700',
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    try {
      const raw = e.dataTransfer.getData('application/json');
      if (raw && data.onDropPrompt) {
        const promptData = JSON.parse(raw);
        data.onDropPrompt(promptData);
      }
    } catch {
      // ignore invalid data
    }
  };

  const handleItemDoubleClick = (e: React.MouseEvent, contract: any) => {
    e.stopPropagation();
    if (data.onViewContract) {
      data.onViewContract(contract);
    }
  };

  return (
    <div
      className={`bg-white rounded-xl shadow-md border-2 relative cursor-grab active:cursor-grabbing hover:shadow-lg transition-all ${dragOver ? 'border-teal-400 ring-2 ring-teal-200' : 'border-teal-300'}`}
      style={{ width: 280 }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <Handle type="source" position={Position.Right} id="right" className="!bg-teal-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-teal-600 transition-all" />

      {/* Header */}
      <div className="px-3 py-2 bg-teal-50 rounded-t-xl border-b border-teal-200 flex items-center gap-2">
        <svg className="w-4 h-4 text-teal-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span className="font-bold text-xs text-teal-800 flex-1">Contratos</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-200 text-teal-800 font-semibold">
          {contracts.length}
        </span>
      </div>

      {/* List */}
      <div className="max-h-[220px] overflow-y-auto">
        {contracts.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {contracts.map((contract, index) => {
              const shortName = contract.name?.includes('/') ? contract.name.split('/').pop() : (contract.name || contract.label || 'Prompt');
              const domainBadge = domainColors[contract.domain] || 'bg-gray-100 text-gray-700';
              const hasPrompt = !!(contract.system_prompt || contract.user_prompt);
              return (
                <div
                  key={contract.id || index}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-teal-50 cursor-pointer transition-colors"
                  onDoubleClick={(e) => handleItemDoubleClick(e, contract)}
                  title="Duplo-clique para ver detalhes"
                >
                  <span className="text-[10px] font-bold text-gray-400 w-4 text-right flex-shrink-0">{index + 1}</span>
                  <span className="text-[11px] text-gray-800 truncate flex-1 font-medium">{shortName}</span>
                  <span className={`text-[8px] px-1 py-0.5 rounded font-medium flex-shrink-0 ${domainBadge}`}>
                    {contract.domain}
                  </span>
                  {hasPrompt && (
                    <span className="text-[8px] text-teal-600 font-semibold flex-shrink-0">P</span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-3 py-4 text-center text-[11px] text-gray-400">Nenhum contrato</div>
        )}
      </div>

      {/* Drop zone */}
      <div
        className={`mx-2 mb-2 mt-1 border-2 border-dashed rounded-lg px-3 py-2 text-center transition-colors ${dragOver ? 'border-teal-400 bg-teal-50 text-teal-600' : 'border-gray-200 text-gray-400'}`}
      >
        <span className="text-[10px] font-medium">Arraste prompts aqui</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Node Type Registry
// ---------------------------------------------------------------------------

export const nodeTypes = {
  modelNode: ModelNode,
  cacheNode: CacheNode,
  ragContextNode: RAGContextNode,
  promptTransformerNode: PromptTransformerNode,
  routerNode: RouterNode,
  retryNode: RetryNode,
  validatorNode: ValidatorNode,
  costGuardNode: CostGuardNode,
  rateLimiterNode: RateLimiterNode,
  timeoutNode: TimeoutNode,
  promptNodeNode: PromptNodeNode,
  contractsListNode: ContractsListNode,  // PROMPT #258 - aggregator with list
};

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
        {data.config?.model_id && !data.config?.model && (
          <div className="text-[10px] text-gray-400 mt-1.5 font-mono truncate">{data.config.model_id}</div>
        )}
        {/* v3.1: usage_type badges from chains */}
        {Array.isArray(data.usage_badges) && data.usage_badges.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {data.usage_badges.map((u: string) => (
              <span key={u} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-mono">
                {u}
              </span>
            ))}
          </div>
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

        {/* Health summary (simplified) */}
        {metrics && metrics.total_executions > 0 && (
          <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between">
            <span className={`text-[10px] font-semibold ${
              metrics.health === 'green' ? 'text-green-600' : metrics.health === 'yellow' ? 'text-yellow-600' : 'text-red-600'
            }`}>{metrics.success_rate.toFixed(0)}% sucesso</span>
            <span className="text-[10px] text-gray-400">
              {metrics.avg_latency_ms >= 1000 ? `${(metrics.avg_latency_ms / 1000).toFixed(1)}s` : `${Math.round(metrics.avg_latency_ms)}ms`}
            </span>
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
// PROMPT #250 - Prompt Node (Reusable structured prompt for ORBIT AI)
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

// ---------------------------------------------------------------------------
// Node Type Registry
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// v3.0 — Unified canvas: PipelinePhase + Subflow nodes
// ---------------------------------------------------------------------------

export function PipelinePhaseNode({ data }: { data: any }) {
  // v3.1: animation states drive border + marching ants
  const animation: NodeAnimationState = data.animation || 'idle';
  const isRunning = animation === 'executing';
  const isSuccess = animation === 'success';
  const isFailed = animation === 'failed';

  // Border color per state
  const borderLeftColor =
    isFailed ? '#ef4444' :
    isSuccess ? '#22c55e' :
    isRunning ? '#3b82f6' :
    '#9ca3af';   // idle: gray

  const phaseLabel = data.label || data.phase_key || 'Fase';
  const modelLabel: string | undefined = data.model_id;
  // Wrapper div hosts the marching-ants border when running
  return (
    <div
      className={`relative bg-white rounded-lg shadow-md min-w-[220px] cursor-grab active:cursor-grabbing hover:shadow-lg transition-all ${
        isRunning ? 'animate-marching-ants p-[2px]' : ''
      }`}
      style={!isRunning ? {
        border: '2px solid #e5e7eb',
        borderLeft: `4px solid ${borderLeftColor}`,
      } : { padding: 2 }}
    >
      <div className="bg-white rounded-md" style={isRunning ? { borderLeft: `4px solid ${borderLeftColor}` } : undefined}>
        <Handle type="target" position={Position.Left} id="left" className="!bg-blue-400 !w-3.5 !h-3.5 !border-2 !border-white" />
        <div className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center justify-center w-7 h-7 rounded text-xs font-bold ${
              isSuccess ? 'bg-green-50 text-green-600' :
              isFailed  ? 'bg-red-50 text-red-600' :
              isRunning ? 'bg-blue-50 text-blue-600' :
                          'bg-gray-100 text-gray-500'
            }`}>
              {isSuccess ? '✓' : isFailed ? '✕' : (data.phase_index ?? '#')}
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm text-gray-900 truncate">{phaseLabel}</div>
              <div className={`text-xs ${
                isSuccess ? 'text-green-600' :
                isFailed  ? 'text-red-600' :
                isRunning ? 'text-blue-600' : 'text-gray-500'
              }`}>
                {isRunning ? 'executando…' : isSuccess ? 'concluído' : isFailed ? 'falhou' : 'pendente'}
              </div>
            </div>
          </div>
          {data.description && (
            <p className="mt-2 text-[11px] text-gray-500 line-clamp-2">{data.description}</p>
          )}
          {modelLabel && (
            <div className="mt-2 pt-2 border-t border-gray-100 text-[10px] font-mono text-gray-500 truncate">
              {modelLabel}
            </div>
          )}
        </div>
        {data.onRemove && (
          <button onClick={(e) => { e.stopPropagation(); data.onRemove(); }}
            className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 shadow-sm">×</button>
        )}
        <Handle type="source" position={Position.Right} id="right" className="!bg-blue-400 !w-3.5 !h-3.5 !border-2 !border-white" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// v3.4 — GenericUtilityNode (single component for all new utility nodes)
//
// Backend catalog ships ~34 new utility templates that all share the same
// visual contract (left handle in, right handle out, configurable card with
// label/category/color/icon). Rendering each as its own component would mean
// 34 near-identical files. Instead, the backend marks them with
// `type: "utilityNode"` and `data.{kind, category, color, icon, config, ...}`
// — this single component renders them all.
//
// Pre-existing typed nodes (CacheNode, ValidatorNode, etc) are kept for
// back-compat; backend still ships them with their original `type` values.
// ---------------------------------------------------------------------------

export function GenericUtilityNode({ data }: { data: any }) {
  const accent: string = data.color || '#6b7280';
  const label: string = data.label || data.kind || 'Utility';
  const category: string = data.category || 'Utility';
  const enabled: boolean = data.enabled !== false;
  const description: string | undefined = data.description;
  // Config items: render up to 3 key=value pairs to keep the node compact.
  const cfg = (data.config || {}) as Record<string, any>;
  const cfgEntries = Object.entries(cfg).slice(0, 3);

  return (
    <div
      className="bg-white rounded-lg shadow-md border-2 min-w-[200px] relative cursor-grab active:cursor-grabbing hover:shadow-lg transition-all"
      style={{
        borderLeftColor: accent,
        borderLeftWidth: '4px',
        borderTopColor: '#e5e7eb',
        borderRightColor: '#e5e7eb',
        borderBottomColor: '#e5e7eb',
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        className="!w-3 !h-3 !border-2 !border-white"
        style={{ background: accent }}
      />
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center justify-center w-7 h-7 rounded text-xs font-bold flex-shrink-0"
            style={{ background: `${accent}1a`, color: accent }}
            title={category}
          >
            {/* Tiny inline svg dot — avoid pulling lucide-react for 34 icons */}
            <span style={{ fontSize: 14 }}>◆</span>
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: accent }}>
              {category}
            </div>
            <div className="text-xs font-semibold text-gray-900 truncate" title={label}>{label}</div>
          </div>
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${enabled ? '' : 'bg-gray-300'}`}
               style={enabled ? { background: accent } : undefined} />
        </div>
        {description && (
          <div className="mt-1.5 text-[10px] text-gray-500 line-clamp-2" title={description}>{description}</div>
        )}
        {cfgEntries.length > 0 && (
          <div className="mt-2 pt-2 border-t border-gray-100 space-y-0.5">
            {cfgEntries.map(([k, v]) => (
              <div key={k} className="text-[10px] text-gray-500 truncate">
                <span className="font-medium text-gray-600">{k}:</span>{' '}
                <span className="font-mono">{typeof v === 'object' ? JSON.stringify(v).slice(0, 24) : String(v).slice(0, 32)}</span>
              </div>
            ))}
            {Object.keys(cfg).length > 3 && (
              <div className="text-[9px] text-gray-400">+{Object.keys(cfg).length - 3} more</div>
            )}
          </div>
        )}
      </div>
      {data.onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); data.onRemove(); }}
          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 shadow-sm"
        >×</button>
      )}
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        className="!w-3 !h-3 !border-2 !border-white"
        style={{ background: accent }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// v3.3 — IONode (Entrada/Saída of a phase's trio inside a subflow)
// ---------------------------------------------------------------------------

export function IONode({ data }: { data: any }) {
  const isInput = data.io_kind === 'input';
  const accent = isInput ? '#10b981' : '#f97316'; // green for input, orange for output
  const label = data.label || (isInput ? 'Entrada' : 'Saída');
  const icon = isInput ? '→' : '⇒';
  return (
    <div
      className="rounded-lg shadow-sm border-2 bg-white cursor-grab active:cursor-grabbing hover:shadow-md transition-all"
      style={{ borderColor: accent, minWidth: 160 }}
    >
      {!isInput && (
        <Handle
          type="target"
          position={Position.Left}
          id="left"
          className="!w-3 !h-3 !border-2 !border-white"
          style={{ background: accent }}
        />
      )}
      <div className="px-3 py-2 flex items-center gap-2">
        <span
          className="inline-flex items-center justify-center w-6 h-6 rounded text-sm font-bold"
          style={{ background: `${accent}22`, color: accent }}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: accent }}>
            {isInput ? 'Entrada' : 'Saída'}
          </div>
          <div className="text-xs text-gray-700 truncate">{label.replace(/^(Entrada|Saída)\s*—\s*/, '')}</div>
        </div>
      </div>
      {isInput && (
        <Handle
          type="source"
          position={Position.Right}
          id="right"
          className="!w-3 !h-3 !border-2 !border-white"
          style={{ background: accent }}
        />
      )}
    </div>
  );
}

export function SubflowNode({ data }: { data: any }) {
  // v3.1: subflow represents a logical group of phases. Double-click opens
  // it in a new tab (via data.onOpen). Animation 'executing' = some inner
  // phase is currently running.
  const count: number = data.node_count ?? 0;
  const animation: NodeAnimationState = data.animation || 'idle';
  const isRunning = animation === 'executing';
  const isSuccess = animation === 'success';
  const isFailed = animation === 'failed';

  const accent =
    isFailed ? '#ef4444' :
    isSuccess ? '#22c55e' :
    isRunning ? '#0891b2' :
    '#06b6d4';

  return (
    <div
      onDoubleClick={(e) => { e.stopPropagation(); data.onOpen?.(); }}
      className={`rounded-lg shadow-md relative cursor-pointer hover:shadow-lg transition-all ${
        isRunning ? 'animate-marching-ants-subtle p-[2px]' : ''
      }`}
      style={!isRunning ? {
        border: `2px dashed ${accent}`,
        background: 'rgba(207, 250, 254, 0.6)',
        minWidth: 240,
      } : { padding: 2, minWidth: 240, background: accent }}
      title="Duplo-clique pra abrir em nova aba"
    >
      <div className="rounded-md bg-cyan-50/60" style={isRunning ? { padding: 2 } : undefined}>
        <Handle type="target" position={Position.Left} id="left" className="!bg-cyan-500 !w-3.5 !h-3.5 !border-2 !border-white" />
        <div className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center justify-center w-7 h-7 rounded text-base ${
              isSuccess ? 'bg-green-100 text-green-700' :
              isFailed  ? 'bg-red-100 text-red-700' :
              isRunning ? 'bg-blue-100 text-blue-700' : 'bg-cyan-100 text-cyan-700'
            }`}>
              {isSuccess ? '✓' : isFailed ? '✕' : '⊞'}
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm text-gray-900 truncate">{data.label || 'Subflow'}</div>
              <div className="text-xs text-cyan-700">
                {count} {count === 1 ? 'fase' : 'fases'}{isRunning ? ' · executando' : ''}
              </div>
            </div>
          </div>
          <div className="mt-2 pt-2 border-t border-cyan-200 flex items-center gap-2">
            {data.onOpen && (
              <button
                // mousedown stopPropagation prevents ReactFlow from starting
                // a node-drag, which would swallow the subsequent click.
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); data.onOpen(); }}
                className="text-[11px] font-medium px-2 py-1 rounded bg-cyan-600 text-white hover:bg-cyan-700 transition-colors"
              >
                Abrir aba →
              </button>
            )}
          </div>
        </div>
        {data.onRemove && (
          <button onClick={(e) => { e.stopPropagation(); data.onRemove(); }}
            className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 shadow-sm">×</button>
        )}
        <Handle type="source" position={Position.Right} id="right" className="!bg-cyan-500 !w-3.5 !h-3.5 !border-2 !border-white" />
      </div>
    </div>
  );
}

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
  // v3.0
  pipelinePhaseNode: PipelinePhaseNode,
  subflowNode: SubflowNode,
  // v3.3 — phase trio terminals (Entrada / Saída)
  ioNode: IONode,
  // v3.4 — generic renderer for all new utility nodes from the backend catalog
  utilityNode: GenericUtilityNode,
};

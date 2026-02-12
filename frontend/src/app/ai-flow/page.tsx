/**
 * AI Flow Page
 * PROMPT #122 - Visual Fallback Chain Configuration
 * PROMPT #124 - Metrics, Animation, Analytics & Smart Reorder
 *
 * n8n-style flow diagram for configuring per-operation AI model fallback chains.
 * Uses @xyflow/react for the node-based visualization.
 *
 * Flow: select operation → canvas shows saved chain (or empty) → add/remove/reorder
 * models from sidebar → Save.
 *
 * PROMPT #124 Features:
 * 1. Real-time metrics on model nodes (health, success rate, latency, cost)
 * 2. WebSocket animation for live chain execution visualization
 * 3. Chain Analytics dashboard (collapsible panel)
 * 4. Smart Reorder + Templates (sidebar quick actions)
 */

'use client';

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  MarkerType,
  reconnectEdge,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type OnReconnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { Layout, Breadcrumbs } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Dialog } from '@/components/ui/Dialog';
import { aiModelsApi, aiFlowApi } from '@/lib/api';
import { useNotification } from '@/hooks';
import type {
  AIModel,
  AIFlowChain,
  AIFlowChainModel,
  AIFlowModelMetrics,
  AIFlowChainAnalyticsResponse,
  AIFlowChainAnalyticsItem,
  AIFlowOptimizeChainResponse,
  AIFlowOptimizeModelScore,
  AIFlowChainTemplate,
  AIFlowUtilityNode,
  AIFlowUtilityNodeType,
  UtilityNodeType,
} from '@/lib/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const USAGE_TYPE_OPTIONS = [
  { value: 'interview', label: 'Interview' },
  { value: 'task_execution', label: 'Task Execution' },
  { value: 'prompt_generation', label: 'Prompt Generation' },
  { value: 'commit_generation', label: 'Commit Generation' },
  { value: 'pattern_discovery', label: 'Pattern Discovery' },
  { value: 'memory', label: 'Memory (Codebase Scan)' },
  { value: 'general', label: 'General' },
];

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#9333ea',
  openai: '#16a34a',
  google: '#2563eb',
  ollama: '#ea580c',
  cohere: '#e11d48',
};

const PROVIDER_BG: Record<string, string> = {
  anthropic: 'bg-purple-50 border-purple-200',
  openai: 'bg-green-50 border-green-200',
  google: 'bg-blue-50 border-blue-200',
  ollama: 'bg-orange-50 border-orange-200',
  cohere: 'bg-rose-50 border-rose-200',
};

// ---------------------------------------------------------------------------
// PROMPT #204 - Utility Node Colors & Icons
// ---------------------------------------------------------------------------

const UTILITY_NODE_COLORS: Record<string, string> = {
  cache: '#8b5cf6',
  rag_context: '#06b6d4',
  prompt_transformer: '#f59e0b',
  router: '#10b981',
  retry: '#3b82f6',
  validator: '#22c55e',
  cost_guard: '#ef4444',
  rate_limiter: '#ec4899',
  timeout: '#f97316',
};

const UTILITY_NODE_BG: Record<string, string> = {
  cache: 'bg-violet-50 border-violet-200',
  rag_context: 'bg-cyan-50 border-cyan-200',
  prompt_transformer: 'bg-amber-50 border-amber-200',
  router: 'bg-emerald-50 border-emerald-200',
  retry: 'bg-blue-50 border-blue-200',
  validator: 'bg-green-50 border-green-200',
  cost_guard: 'bg-red-50 border-red-200',
  rate_limiter: 'bg-pink-50 border-pink-200',
  timeout: 'bg-orange-50 border-orange-200',
};

function UtilityNodeIcon({ type, size = 'w-5 h-5' }: { type: string; size?: string }) {
  const color = UTILITY_NODE_COLORS[type] || '#6b7280';
  switch (type) {
    case 'cache':
      return (
        <svg className={size} style={{ color }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
        </svg>
      );
    case 'rag_context':
      return (
        <svg className={size} style={{ color }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      );
    case 'prompt_transformer':
      return (
        <svg className={size} style={{ color }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
        </svg>
      );
    case 'router':
      return (
        <svg className={size} style={{ color }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
        </svg>
      );
    case 'retry':
      return (
        <svg className={size} style={{ color }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      );
    case 'validator':
      return (
        <svg className={size} style={{ color }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case 'cost_guard':
      return (
        <svg className={size} style={{ color }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      );
    case 'rate_limiter':
      return (
        <svg className={size} style={{ color }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case 'timeout':
      return (
        <svg className={size} style={{ color }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M1 4l2-2m18 2l-2-2" />
        </svg>
      );
    default:
      return (
        <svg className={size} style={{ color: '#6b7280' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      );
  }
}

// ---------------------------------------------------------------------------
// Provider Icon
// ---------------------------------------------------------------------------

function ProviderIcon({ provider, size = 'w-5 h-5' }: { provider: string; size?: string }) {
  const color = PROVIDER_COLORS[provider.toLowerCase()] || '#6b7280';
  switch (provider.toLowerCase()) {
    case 'anthropic':
      return (
        <svg className={size} style={{ color }} fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z" />
        </svg>
      );
    case 'openai':
      return (
        <svg className={size} style={{ color }} fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" />
        </svg>
      );
    case 'google':
      return (
        <svg className={size} style={{ color }} fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
        </svg>
      );
    case 'ollama':
      return (
        <svg className={size} style={{ color }} fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
        </svg>
      );
    case 'cohere':
      return (
        <svg className={size} style={{ color }} fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" />
        </svg>
      );
    default:
      return (
        <svg className={size} style={{ color: '#6b7280' }} fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z" />
        </svg>
      );
  }
}

// ---------------------------------------------------------------------------
// PROMPT #124 - WebSocket hook for live chain execution events
// ---------------------------------------------------------------------------

type NodeAnimationState = 'idle' | 'executing' | 'success' | 'failed';

function useAIFlowWebSocket(selectedUsageType: string) {
  const [nodeAnimations, setNodeAnimations] = useState<Record<string, NodeAnimationState>>({});
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const wsUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000')
      .replace(/^http/, 'ws') + '/api/v1/ws/ai-flow';

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;
    } catch {
      return;
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const { type, data } = msg;

        // Only show animations for the currently selected usage type
        if (data?.usage_type && data.usage_type !== selectedUsageType) return;

        const modelId = data?.model_id;
        if (!modelId) return;

        const nodeId = `model-${modelId}`;

        if (type === 'chain_attempt_start') {
          setNodeAnimations((prev) => ({ ...prev, [nodeId]: 'executing' }));
        } else if (type === 'chain_attempt_success') {
          setNodeAnimations((prev) => ({ ...prev, [nodeId]: 'success' }));
          setTimeout(() => {
            setNodeAnimations((prev) => ({ ...prev, [nodeId]: 'idle' }));
          }, 2000);
        } else if (type === 'chain_attempt_failed') {
          setNodeAnimations((prev) => ({ ...prev, [nodeId]: 'failed' }));
          setTimeout(() => {
            setNodeAnimations((prev) => ({ ...prev, [nodeId]: 'idle' }));
          }, 2000);
        }
      } catch {
        // Ignore parse errors
      }
    };

    ws.onerror = () => {};
    ws.onclose = () => {};

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [selectedUsageType]);

  return nodeAnimations;
}

// ---------------------------------------------------------------------------
// Custom ReactFlow Node: ModelNode (PROMPT #124 - with metrics & animation)
// ---------------------------------------------------------------------------

function ModelNode({ data }: { data: any }) {
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
              data.position_label === 'Primary'
                ? 'bg-blue-100 text-blue-700'
                : 'bg-amber-100 text-amber-700'
            }`}>
              {data.position_label}
            </span>
            {data.hasOverrides && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-purple-100 text-purple-700" title="Per-flow overrides applied">
                Overrides
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
              }`}>{metrics.success_rate.toFixed(1)}%</span> success
            </div>
            <div className="text-[10px] text-gray-500">
              <span className="font-semibold text-gray-700">{metrics.avg_latency_ms >= 1000 ? `${(metrics.avg_latency_ms / 1000).toFixed(1)}s` : `${Math.round(metrics.avg_latency_ms)}ms`}</span> avg
            </div>
            <div className="text-[10px] text-gray-500">
              <span className="font-semibold text-gray-700">${metrics.avg_cost_per_call.toFixed(4)}</span>/call
            </div>
            <div className="text-[10px] text-gray-500">
              <span className="font-semibold text-gray-700">{metrics.total_executions}</span> calls
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
        className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-blue-500 hover:!w-4 hover:!h-4 transition-all"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PROMPT #204 - Utility Node Components
// ---------------------------------------------------------------------------

function CacheNode({ data }: { data: any }) {
  const color = UTILITY_NODE_COLORS.cache;
  return (
    <div className="bg-white rounded-lg shadow-md border-2 min-w-[180px] relative cursor-grab active:cursor-grabbing hover:shadow-lg transition-all"
      style={{ borderLeftColor: color, borderLeftWidth: '4px', borderTopColor: '#e5e7eb', borderRightColor: '#e5e7eb', borderBottomColor: '#e5e7eb' }}>
      <Handle type="target" position={Position.Left} className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-violet-500 transition-all" />
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <UtilityNodeIcon type="cache" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-gray-900">{data.label || 'Cache'}</div>
            <div className="text-xs text-violet-600">Redis Cache Check</div>
          </div>
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${data.enabled !== false ? 'bg-violet-500' : 'bg-gray-400'}`} />
        </div>
        <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
          <div className="text-[10px] text-gray-500">TTL: <span className="font-semibold text-gray-700">{data.config?.ttl_seconds || 86400}s</span></div>
          <div className="text-[10px] text-gray-500">Level: <span className="font-semibold text-gray-700">{data.config?.cache_level || 'exact'}</span></div>
        </div>
      </div>
      {data.onRemove && (
        <button onClick={(e) => { e.stopPropagation(); data.onRemove(); }}
          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 shadow-sm">x</button>
      )}
      <Handle type="source" position={Position.Right} className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-violet-500 transition-all" />
    </div>
  );
}

function RAGContextNode({ data }: { data: any }) {
  const color = UTILITY_NODE_COLORS.rag_context;
  return (
    <div className="bg-white rounded-lg shadow-md border-2 min-w-[180px] relative cursor-grab active:cursor-grabbing hover:shadow-lg transition-all"
      style={{ borderLeftColor: color, borderLeftWidth: '4px', borderTopColor: '#e5e7eb', borderRightColor: '#e5e7eb', borderBottomColor: '#e5e7eb' }}>
      <Handle type="target" position={Position.Left} className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-cyan-500 transition-all" />
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <UtilityNodeIcon type="rag_context" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-gray-900">{data.label || 'RAG Context'}</div>
            <div className="text-xs text-cyan-600">Semantic Enrichment</div>
          </div>
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${data.enabled !== false ? 'bg-cyan-500' : 'bg-gray-400'}`} />
        </div>
        <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
          <div className="text-[10px] text-gray-500">Max Results: <span className="font-semibold text-gray-700">{data.config?.max_results || 5}</span></div>
          <div className="text-[10px] text-gray-500">Threshold: <span className="font-semibold text-gray-700">{data.config?.similarity_threshold || 0.7}</span></div>
        </div>
      </div>
      {data.onRemove && (
        <button onClick={(e) => { e.stopPropagation(); data.onRemove(); }}
          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 shadow-sm">x</button>
      )}
      <Handle type="source" position={Position.Right} className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-cyan-500 transition-all" />
    </div>
  );
}

function PromptTransformerNode({ data }: { data: any }) {
  const color = UTILITY_NODE_COLORS.prompt_transformer;
  return (
    <div className="bg-white rounded-lg shadow-md border-2 min-w-[180px] relative cursor-grab active:cursor-grabbing hover:shadow-lg transition-all"
      style={{ borderLeftColor: color, borderLeftWidth: '4px', borderTopColor: '#e5e7eb', borderRightColor: '#e5e7eb', borderBottomColor: '#e5e7eb' }}>
      <Handle type="target" position={Position.Left} className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-amber-500 transition-all" />
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <UtilityNodeIcon type="prompt_transformer" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-gray-900">{data.label || 'Transformer'}</div>
            <div className="text-xs text-amber-600">Prompt Transform</div>
          </div>
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${data.enabled !== false ? 'bg-amber-500' : 'bg-gray-400'}`} />
        </div>
        <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
          <div className="text-[10px] text-gray-500">Mode: <span className="font-semibold text-gray-700">{data.config?.transformation || 'compress'}</span></div>
          <div className="text-[10px] text-gray-500">Max Tokens: <span className="font-semibold text-gray-700">{data.config?.max_tokens || 4000}</span></div>
        </div>
      </div>
      {data.onRemove && (
        <button onClick={(e) => { e.stopPropagation(); data.onRemove(); }}
          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 shadow-sm">x</button>
      )}
      <Handle type="source" position={Position.Right} className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-amber-500 transition-all" />
    </div>
  );
}

function RouterNode({ data }: { data: any }) {
  const color = UTILITY_NODE_COLORS.router;
  return (
    <div className="bg-white rounded-lg shadow-md border-2 min-w-[180px] relative cursor-grab active:cursor-grabbing hover:shadow-lg transition-all"
      style={{ borderLeftColor: color, borderLeftWidth: '4px', borderTopColor: '#e5e7eb', borderRightColor: '#e5e7eb', borderBottomColor: '#e5e7eb' }}>
      <Handle type="target" position={Position.Left} className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-emerald-500 transition-all" />
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <UtilityNodeIcon type="router" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-gray-900">{data.label || 'Router'}</div>
            <div className="text-xs text-emerald-600">Conditional Routing</div>
          </div>
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${data.enabled !== false ? 'bg-emerald-500' : 'bg-gray-400'}`} />
        </div>
        <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
          <div className="text-[10px] text-gray-500">Condition: <span className="font-semibold text-gray-700">{data.config?.condition || 'complexity'}</span></div>
          <div className="text-[10px] text-gray-500">Threshold: <span className="font-semibold text-gray-700">{data.config?.threshold || 'medium'}</span></div>
        </div>
      </div>
      {data.onRemove && (
        <button onClick={(e) => { e.stopPropagation(); data.onRemove(); }}
          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 shadow-sm">x</button>
      )}
      <Handle type="source" position={Position.Right} className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-emerald-500 transition-all" />
    </div>
  );
}

function RetryNode({ data }: { data: any }) {
  const color = UTILITY_NODE_COLORS.retry;
  return (
    <div className="bg-white rounded-lg shadow-md border-2 min-w-[180px] relative cursor-grab active:cursor-grabbing hover:shadow-lg transition-all"
      style={{ borderLeftColor: color, borderLeftWidth: '4px', borderTopColor: '#e5e7eb', borderRightColor: '#e5e7eb', borderBottomColor: '#e5e7eb' }}>
      <Handle type="target" position={Position.Left} className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-blue-500 transition-all" />
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <UtilityNodeIcon type="retry" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-gray-900">{data.label || 'Retry'}</div>
            <div className="text-xs text-blue-600">Retry with Backoff</div>
          </div>
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${data.enabled !== false ? 'bg-blue-500' : 'bg-gray-400'}`} />
        </div>
        <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
          <div className="text-[10px] text-gray-500">Max Retries: <span className="font-semibold text-gray-700">{data.config?.max_retries || 3}</span></div>
          <div className="text-[10px] text-gray-500">Base: <span className="font-semibold text-gray-700">{data.config?.backoff_base_ms || 1000}ms</span></div>
        </div>
      </div>
      {data.onRemove && (
        <button onClick={(e) => { e.stopPropagation(); data.onRemove(); }}
          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 shadow-sm">x</button>
      )}
      <Handle type="source" position={Position.Right} className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-blue-500 transition-all" />
    </div>
  );
}

function ValidatorNode({ data }: { data: any }) {
  const color = UTILITY_NODE_COLORS.validator;
  return (
    <div className="bg-white rounded-lg shadow-md border-2 min-w-[180px] relative cursor-grab active:cursor-grabbing hover:shadow-lg transition-all"
      style={{ borderLeftColor: color, borderLeftWidth: '4px', borderTopColor: '#e5e7eb', borderRightColor: '#e5e7eb', borderBottomColor: '#e5e7eb' }}>
      <Handle type="target" position={Position.Left} className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-green-500 transition-all" />
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <UtilityNodeIcon type="validator" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-gray-900">{data.label || 'Validator'}</div>
            <div className="text-xs text-green-600">Output Validation</div>
          </div>
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${data.enabled !== false ? 'bg-green-500' : 'bg-gray-400'}`} />
        </div>
        <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
          <div className="text-[10px] text-gray-500">Type: <span className="font-semibold text-gray-700">{data.config?.validation_type || 'json'}</span></div>
          <div className="text-[10px] text-gray-500">Retry: <span className="font-semibold text-gray-700">{data.config?.retry_on_fail !== false ? 'Yes' : 'No'}</span></div>
        </div>
      </div>
      {data.onRemove && (
        <button onClick={(e) => { e.stopPropagation(); data.onRemove(); }}
          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 shadow-sm">x</button>
      )}
      <Handle type="source" position={Position.Right} className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-green-500 transition-all" />
    </div>
  );
}

function CostGuardNode({ data }: { data: any }) {
  const color = UTILITY_NODE_COLORS.cost_guard;
  return (
    <div className="bg-white rounded-lg shadow-md border-2 min-w-[180px] relative cursor-grab active:cursor-grabbing hover:shadow-lg transition-all"
      style={{ borderLeftColor: color, borderLeftWidth: '4px', borderTopColor: '#e5e7eb', borderRightColor: '#e5e7eb', borderBottomColor: '#e5e7eb' }}>
      <Handle type="target" position={Position.Left} className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-red-500 transition-all" />
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <UtilityNodeIcon type="cost_guard" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-gray-900">{data.label || 'Cost Guard'}</div>
            <div className="text-xs text-red-600">Budget Limiter</div>
          </div>
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${data.enabled !== false ? 'bg-red-500' : 'bg-gray-400'}`} />
        </div>
        <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
          <div className="text-[10px] text-gray-500">Per Call: <span className="font-semibold text-gray-700">${data.config?.max_cost_per_call || 0.10}</span></div>
          <div className="text-[10px] text-gray-500">Daily: <span className="font-semibold text-gray-700">${data.config?.daily_budget || 10.0}</span></div>
        </div>
      </div>
      {data.onRemove && (
        <button onClick={(e) => { e.stopPropagation(); data.onRemove(); }}
          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 shadow-sm">x</button>
      )}
      <Handle type="source" position={Position.Right} className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-red-500 transition-all" />
    </div>
  );
}

function RateLimiterNode({ data }: { data: any }) {
  const color = UTILITY_NODE_COLORS.rate_limiter;
  return (
    <div className="bg-white rounded-lg shadow-md border-2 min-w-[180px] relative cursor-grab active:cursor-grabbing hover:shadow-lg transition-all"
      style={{ borderLeftColor: color, borderLeftWidth: '4px', borderTopColor: '#e5e7eb', borderRightColor: '#e5e7eb', borderBottomColor: '#e5e7eb' }}>
      <Handle type="target" position={Position.Left} className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-pink-500 transition-all" />
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <UtilityNodeIcon type="rate_limiter" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-gray-900">{data.label || 'Rate Limiter'}</div>
            <div className="text-xs text-pink-600">Request Throttling</div>
          </div>
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${data.enabled !== false ? 'bg-pink-500' : 'bg-gray-400'}`} />
        </div>
        <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
          <div className="text-[10px] text-gray-500">Limit: <span className="font-semibold text-gray-700">{data.config?.max_requests || 60} req</span></div>
          <div className="text-[10px] text-gray-500">Window: <span className="font-semibold text-gray-700">{data.config?.window_seconds || 60}s</span></div>
        </div>
      </div>
      {data.onRemove && (
        <button onClick={(e) => { e.stopPropagation(); data.onRemove(); }}
          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 shadow-sm">x</button>
      )}
      <Handle type="source" position={Position.Right} className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-pink-500 transition-all" />
    </div>
  );
}

function TimeoutNode({ data }: { data: any }) {
  const color = UTILITY_NODE_COLORS.timeout;
  return (
    <div className="bg-white rounded-lg shadow-md border-2 min-w-[180px] relative cursor-grab active:cursor-grabbing hover:shadow-lg transition-all"
      style={{ borderLeftColor: color, borderLeftWidth: '4px', borderTopColor: '#e5e7eb', borderRightColor: '#e5e7eb', borderBottomColor: '#e5e7eb' }}>
      <Handle type="target" position={Position.Left} className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-orange-500 transition-all" />
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
      <Handle type="source" position={Position.Right} className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-orange-500 transition-all" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PROMPT #208 - Edit Utility Node Dialog
// ---------------------------------------------------------------------------

function EditUtilityNodeDialog({
  node,
  onSave,
  onClose,
}: {
  node: AIFlowUtilityNode;
  onSave: (updated: AIFlowUtilityNode) => void;
  onClose: () => void;
}) {
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
              label="Cache Level"
              value={config.cache_level ?? 'exact'}
              onChange={(e) => updateConfig('cache_level', e.target.value)}
              options={[
                { value: 'exact', label: 'Exact Match' },
                { value: 'semantic', label: 'Semantic Match' },
                { value: 'template', label: 'Template Cache' },
              ]}
            />
          </>
        );

      case 'rag_context':
        return (
          <>
            <Input
              label="Max Results"
              type="number"
              min="1"
              max="20"
              value={config.max_results ?? 5}
              onChange={(e) => updateConfig('max_results', parseInt(e.target.value) || 5)}
            />
            <Input
              label="Similarity Threshold (0-1)"
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
              <label htmlFor="include-metadata" className="text-sm text-gray-700">Include Metadata</label>
            </div>
          </>
        );

      case 'prompt_transformer':
        return (
          <>
            <Select
              label="Transformation"
              value={config.transformation ?? 'compress'}
              onChange={(e) => updateConfig('transformation', e.target.value)}
              options={[
                { value: 'compress', label: 'Compress (truncate long messages)' },
                { value: 'summarize_context', label: 'Summarize Context (keep last N)' },
                { value: 'add_instructions', label: 'Add Instructions' },
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
              label="Override Max Tokens"
              type="number"
              min="0"
              placeholder="Leave empty to use model default"
              value={config.override_max_tokens ?? ''}
              onChange={(e) => updateConfig('override_max_tokens', e.target.value ? parseInt(e.target.value) : null)}
              helperText="Capped by model max_tokens. Leave empty for no override."
            />
            <Input
              label="Override Temperature"
              type="number"
              min="0"
              max="2"
              step="0.1"
              placeholder="Leave empty to use model default"
              value={config.override_temperature ?? ''}
              onChange={(e) => updateConfig('override_temperature', e.target.value ? parseFloat(e.target.value) : null)}
              helperText="Free value (0.0-2.0). Leave empty for no override."
            />
          </>
        );

      case 'router':
        return (
          <>
            <Select
              label="Condition"
              value={config.condition ?? 'complexity'}
              onChange={(e) => updateConfig('condition', e.target.value)}
              options={[
                { value: 'complexity', label: 'Complexity' },
                { value: 'cost', label: 'Cost' },
                { value: 'message_count', label: 'Message Count' },
              ]}
            />
            <Select
              label="Threshold"
              value={config.threshold ?? 'medium'}
              onChange={(e) => updateConfig('threshold', e.target.value)}
              options={[
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
              ]}
            />
          </>
        );

      case 'retry':
        return (
          <>
            <Input
              label="Max Retries"
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
              label="Backoff Multiplier"
              type="number"
              min="1"
              max="10"
              step="0.5"
              value={config.backoff_multiplier ?? 2.0}
              onChange={(e) => updateConfig('backoff_multiplier', parseFloat(e.target.value) || 2.0)}
            />
          </>
        );

      case 'validator':
        return (
          <>
            <Select
              label="Validation Type"
              value={config.validation_type ?? 'json'}
              onChange={(e) => updateConfig('validation_type', e.target.value)}
              options={[
                { value: 'json', label: 'JSON Parsing' },
                { value: 'length', label: 'Length Check' },
                { value: 'keywords', label: 'Required Keywords' },
                { value: 'not_empty', label: 'Not Empty' },
              ]}
            />
            <Input
              label="Max Length (0 = no limit)"
              type="number"
              min="0"
              value={config.max_length ?? 0}
              onChange={(e) => updateConfig('max_length', parseInt(e.target.value) || 0)}
            />
            <Input
              label="Required Keywords (comma-separated)"
              placeholder="e.g., result, status, data"
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
              <label htmlFor="retry-on-fail" className="text-sm text-gray-700">Retry on Validation Failure</label>
            </div>
          </>
        );

      case 'cost_guard':
        return (
          <>
            <Input
              label="Max Cost per Call ($)"
              type="number"
              min="0.01"
              step="0.01"
              value={config.max_cost_per_call ?? 0.10}
              onChange={(e) => updateConfig('max_cost_per_call', parseFloat(e.target.value) || 0.10)}
            />
            <Input
              label="Daily Budget ($)"
              type="number"
              min="0"
              step="0.50"
              value={config.daily_budget ?? 10.0}
              onChange={(e) => updateConfig('daily_budget', parseFloat(e.target.value) || 10.0)}
            />
            <Input
              label="Monthly Budget ($)"
              type="number"
              min="0"
              step="1"
              value={config.monthly_budget ?? 100.0}
              onChange={(e) => updateConfig('monthly_budget', parseFloat(e.target.value) || 100.0)}
            />
            <Select
              label="Action on Exceed"
              value={config.action_on_exceed ?? 'block'}
              onChange={(e) => updateConfig('action_on_exceed', e.target.value)}
              options={[
                { value: 'block', label: 'Block Request' },
                { value: 'warn', label: 'Warn Only' },
              ]}
            />
          </>
        );

      case 'rate_limiter':
        return (
          <>
            <Input
              label="Max Requests"
              type="number"
              min="1"
              value={config.max_requests ?? 60}
              onChange={(e) => updateConfig('max_requests', parseInt(e.target.value) || 60)}
            />
            <Input
              label="Window (seconds)"
              type="number"
              min="1"
              value={config.window_seconds ?? 60}
              onChange={(e) => updateConfig('window_seconds', parseInt(e.target.value) || 60)}
            />
            <Select
              label="Action on Exceed"
              value={config.action_on_exceed ?? 'queue'}
              onChange={(e) => updateConfig('action_on_exceed', e.target.value)}
              options={[
                { value: 'queue', label: 'Queue (wait)' },
                { value: 'block', label: 'Block Request' },
              ]}
            />
          </>
        );

      case 'timeout':
        return (
          <Input
            label="Timeout (seconds)"
            type="number"
            min="1"
            value={config.timeout_seconds ?? 120}
            onChange={(e) => updateConfig('timeout_seconds', parseInt(e.target.value) || 120)}
            helperText="Overrides AI Model timeout and System Settings default."
          />
        );

      default:
        return <p className="text-sm text-gray-500">No editable configuration for this node type.</p>;
    }
  };

  return (
    <Dialog open={true} onClose={onClose} title={`Edit ${node.type.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}`} size="md">
      <div className="space-y-4">
        {/* Header with icon and color indicator */}
        <div className="flex items-center gap-3 pb-3 border-b border-gray-200">
          <div className="p-2 rounded-lg" style={{ backgroundColor: color + '15' }}>
            <UtilityNodeIcon type={node.type} size="w-6 h-6" />
          </div>
          <div className="flex-1">
            <Input
              label="Label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Node label"
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
          <label htmlFor="node-enabled" className="text-sm font-medium text-gray-700">Enabled</label>
        </div>

        {/* Type-specific fields */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-gray-900">Configuration</h4>
          {renderFields()}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave}>Save</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// PROMPT #226 - Edit Model Node Dialog (per-instance overrides)
// ---------------------------------------------------------------------------

interface ModelOverrides {
  temperature?: number | null;
  max_tokens?: number | null;
  timeout_seconds?: number | null;
}

function EditModelNodeDialog({
  model,
  overrides,
  onSave,
  onClose,
}: {
  model: AIFlowChainModel;
  overrides: ModelOverrides;
  onSave: (modelId: string, overrides: ModelOverrides) => void;
  onClose: () => void;
}) {
  const [temperature, setTemperature] = useState<string>(
    overrides.temperature != null ? String(overrides.temperature) : ''
  );
  const [maxTokens, setMaxTokens] = useState<string>(
    overrides.max_tokens != null ? String(overrides.max_tokens) : ''
  );
  const [timeoutSeconds, setTimeoutSeconds] = useState<string>(
    overrides.timeout_seconds != null ? String(overrides.timeout_seconds) : ''
  );

  const handleSave = () => {
    onSave(model.id, {
      temperature: temperature !== '' ? parseFloat(temperature) : null,
      max_tokens: maxTokens !== '' ? parseInt(maxTokens) : null,
      timeout_seconds: timeoutSeconds !== '' ? parseInt(timeoutSeconds) : null,
    });
  };

  const providerColor = PROVIDER_COLORS[model.provider] || '#6b7280';

  return (
    <Dialog open={true} onClose={onClose} title={`Edit Model: ${model.name}`} size="md">
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
          Override model defaults for this specific flow position. Leave fields empty to use the model's global settings.
        </div>

        {/* Override fields */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-gray-900">Per-Flow Overrides</h4>

          <Input
            label="Temperature"
            type="number"
            min="0"
            max="2"
            step="0.1"
            placeholder={`Default: ${model.config?.temperature ?? 'model default'}`}
            value={temperature}
            onChange={(e) => setTemperature(e.target.value)}
            helperText="0.0 = deterministic, 2.0 = very creative. Empty = use model default."
          />

          <Input
            label="Max Tokens"
            type="number"
            min="1"
            placeholder={`Default: ${model.config?.max_tokens ?? 'model default'}`}
            value={maxTokens}
            onChange={(e) => setMaxTokens(e.target.value)}
            helperText="Maximum response length. Empty = use model default."
          />

          <Input
            label="Timeout (seconds)"
            type="number"
            min="1"
            placeholder="Default: model/system default"
            value={timeoutSeconds}
            onChange={(e) => setTimeoutSeconds(e.target.value)}
            helperText="API call timeout. Empty = use model default."
          />
        </div>

        {/* Current global settings (read-only) */}
        <div className="space-y-1 pt-2 border-t border-gray-200">
          <h4 className="text-xs font-semibold text-gray-500 uppercase">Global Model Settings</h4>
          <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
            <div>Max Tokens: <span className="font-medium text-gray-900">{model.config?.max_tokens || 'N/A'}</span></div>
            <div>Temperature: <span className="font-medium text-gray-900">{model.config?.temperature ?? 'N/A'}</span></div>
            <div>Rate Limit: <span className="font-medium text-gray-900">{model.rate_limit_requests ? `${model.rate_limit_requests} req/${model.rate_limit_window_seconds}s` : 'None'}</span></div>
            <div>Active: <span className="font-medium text-gray-900">{model.is_active ? 'Yes' : 'No'}</span></div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave}>Save Overrides</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Node Type Registry
// ---------------------------------------------------------------------------

const nodeTypes = {
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
};

// Map utility node type string to ReactFlow node type string
const UTILITY_TYPE_TO_NODE_TYPE: Record<string, string> = {
  cache: 'cacheNode',
  rag_context: 'ragContextNode',
  prompt_transformer: 'promptTransformerNode',
  router: 'routerNode',
  retry: 'retryNode',
  validator: 'validatorNode',
  cost_guard: 'costGuardNode',
  rate_limiter: 'rateLimiterNode',
  timeout: 'timeoutNode',
};

// ---------------------------------------------------------------------------
// PROMPT #225 - Pipeline classification & edge helper
// ---------------------------------------------------------------------------

// Utility nodes that execute BEFORE the AI model call
const PRE_PROCESS_TYPES = ['cache', 'rag_context', 'prompt_transformer', 'router', 'rate_limiter', 'timeout'];
// Utility nodes that execute AFTER the AI model call
const POST_PROCESS_TYPES = ['retry', 'validator', 'cost_guard'];

interface EdgeProps {
  label: string;
  color: string;
  strokeWidth: number;
  dashed: boolean;
  animated: boolean;
}

function computeEdgeProps(
  sourceId: string,
  targetId: string,
  chainModels: AIFlowChainModel[],
  preNodes: AIFlowUtilityNode[],
  postNodes: AIFlowUtilityNode[],
  animationsMap?: Record<string, NodeAnimationState>,
): EdgeProps {
  const isSourceModel = sourceId.startsWith('model-');
  const isTargetModel = targetId.startsWith('model-');
  const firstModelId = chainModels.length > 0 ? `model-${chainModels[0].id}` : null;
  const lastModelId = chainModels.length > 0 ? `model-${chainModels[chainModels.length - 1].id}` : null;
  const allUtility = [...preNodes, ...postNodes];
  const targetUtility = allUtility.find((n) => n.id === targetId);
  const isAnimating = animationsMap?.[targetId] === 'executing';

  // Edge going TO the first model (the "try" edge)
  if (targetId === firstModelId && !isSourceModel) {
    return { label: 'try', color: '#3b82f6', strokeWidth: isAnimating ? 3 : 2, dashed: false, animated: true };
  }

  // Model-to-model fallback
  if (isSourceModel && isTargetModel) {
    return { label: 'fallback', color: isAnimating ? '#3b82f6' : '#f59e0b', strokeWidth: isAnimating ? 3 : 2, dashed: false, animated: true };
  }

  // Last model → first post-process or response
  if (sourceId === lastModelId && !isTargetModel && targetId !== 'error') {
    if (targetId === 'response') {
      return { label: 'success', color: '#22c55e', strokeWidth: 2, dashed: false, animated: false };
    }
    const utilColor = targetUtility ? (UTILITY_NODE_COLORS[targetUtility.type] || '#6b7280') : '#22c55e';
    return { label: targetUtility ? targetUtility.type.replace(/_/g, ' ') : 'process', color: utilColor, strokeWidth: 1.5, dashed: false, animated: false };
  }

  // Any node → Response (final edge)
  if (targetId === 'response') {
    return { label: 'done', color: '#22c55e', strokeWidth: 2, dashed: false, animated: false };
  }

  // Utility-to-utility or start-to-utility edges
  if (targetUtility) {
    const utilColor = UTILITY_NODE_COLORS[targetUtility.type] || '#6b7280';
    return { label: targetUtility.type.replace(/_/g, ' '), color: utilColor, strokeWidth: 1.5, dashed: false, animated: false };
  }

  // Fallback
  return { label: '', color: '#6b7280', strokeWidth: 1.5, dashed: false, animated: false };
}

// ---------------------------------------------------------------------------
// Build ReactFlow nodes & edges from chain
// ---------------------------------------------------------------------------

function buildFlowFromChain(
  chainModels: AIFlowChainModel[],
  savedPositions?: Record<string, { x: number; y: number }> | null,
  onRemove?: (modelId: string) => void,
  metricsMap?: Record<string, AIFlowModelMetrics>,
  animationsMap?: Record<string, NodeAnimationState>,
  utilityNodes?: AIFlowUtilityNode[],
  onRemoveUtility?: (nodeId: string) => void,
  modelOverridesMap?: Record<string, ModelOverrides>,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // PROMPT #225 - Linear pipeline layout constants
  const MODEL_SPACING_X = 300;
  const UTILITY_SPACING_X = 230;
  const START_X = 50;
  const MAIN_Y = 150;
  const ERROR_Y_OFFSET = 200;

  // --- Classify utility nodes into pre/post-process ---
  const preNodes: AIFlowUtilityNode[] = [];
  const postNodes: AIFlowUtilityNode[] = [];
  if (utilityNodes) {
    for (const uNode of utilityNodes) {
      if (!UTILITY_TYPE_TO_NODE_TYPE[uNode.type]) continue;
      if (PRE_PROCESS_TYPES.includes(uNode.type)) preNodes.push(uNode);
      else if (POST_PROCESS_TYPES.includes(uNode.type)) postNodes.push(uNode);
    }
  }

  let cursorX = START_X;

  // --- 1. Start node (blue circle) ---
  const startPos = savedPositions?.['start'] || { x: cursorX, y: MAIN_Y };
  nodes.push({
    id: 'start',
    type: 'input',
    data: { label: 'Request' },
    position: startPos,
    style: {
      background: '#3b82f6',
      color: 'white',
      borderRadius: '50%',
      width: 80,
      height: 80,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 700,
      fontSize: '13px',
      border: 'none',
    },
  });
  cursorX += preNodes.length > 0 ? UTILITY_SPACING_X : MODEL_SPACING_X;

  // --- 2. Pre-process utility nodes ---
  for (const uNode of preNodes) {
    const rfNodeType = UTILITY_TYPE_TO_NODE_TYPE[uNode.type];
    const defaultPos = { x: cursorX, y: MAIN_Y - 10 };
    const pos = savedPositions?.[uNode.id] || uNode.position || defaultPos;
    nodes.push({
      id: uNode.id,
      type: rfNodeType,
      data: {
        ...uNode,
        onRemove: onRemoveUtility ? () => onRemoveUtility(uNode.id) : undefined,
      },
      position: pos,
    });
    cursorX += UTILITY_SPACING_X;
  }

  // Extra gap between pre-process and models for visual separation
  if (preNodes.length > 0 && chainModels.length > 0) {
    cursorX += 40;
  }

  // --- 3. Model nodes ---
  let lastModelNodeX = cursorX;
  chainModels.forEach((model, index) => {
    const nodeId = `model-${model.id}`;
    const defaultPos = { x: cursorX, y: MAIN_Y - 20 };
    const pos = savedPositions?.[nodeId] || defaultPos;
    const overrides = modelOverridesMap?.[model.id];
    nodes.push({
      id: nodeId,
      type: 'modelNode',
      data: {
        ...model,
        position_label: index === 0 ? 'Primary' : `Fallback ${index}`,
        onRemove: onRemove ? () => onRemove(model.id) : undefined,
        metrics: metricsMap?.[model.id],
        animation: animationsMap?.[nodeId] || 'idle',
        hasOverrides: overrides && (overrides.temperature != null || overrides.max_tokens != null || overrides.timeout_seconds != null),
      },
      position: pos,
    });
    lastModelNodeX = cursorX;
    cursorX += MODEL_SPACING_X;
  });

  // Extra gap between models and post-process
  if (chainModels.length > 0 && postNodes.length > 0) {
    cursorX += 40;
  }

  // --- 4. Post-process utility nodes ---
  for (const uNode of postNodes) {
    const rfNodeType = UTILITY_TYPE_TO_NODE_TYPE[uNode.type];
    const defaultPos = { x: cursorX, y: MAIN_Y - 10 };
    const pos = savedPositions?.[uNode.id] || uNode.position || defaultPos;
    nodes.push({
      id: uNode.id,
      type: rfNodeType,
      data: {
        ...uNode,
        onRemove: onRemoveUtility ? () => onRemoveUtility(uNode.id) : undefined,
      },
      position: pos,
    });
    cursorX += UTILITY_SPACING_X;
  }

  // --- 5. Response node (green circle) ---
  const responsePos = savedPositions?.['response'] || { x: cursorX, y: MAIN_Y };
  nodes.push({
    id: 'response',
    type: 'output',
    data: { label: 'Response' },
    position: responsePos,
    style: {
      background: '#22c55e',
      color: 'white',
      borderRadius: '50%',
      width: 80,
      height: 80,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 700,
      fontSize: '13px',
      border: 'none',
    },
  });

  // --- 6. Error node (below the model chain, only when models exist) ---
  if (chainModels.length > 0) {
    const errorDefaultPos = { x: lastModelNodeX, y: MAIN_Y + ERROR_Y_OFFSET };
    const errorPos = savedPositions?.['error'] || errorDefaultPos;
    nodes.push({
      id: 'error',
      type: 'output',
      data: { label: 'Error' },
      position: errorPos,
      style: {
        background: '#ef4444',
        color: 'white',
        borderRadius: '8px',
        width: 80,
        height: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: '13px',
        border: 'none',
      },
    });
  }

  // --- 7. Build pipeline edges (linear chain) ---
  const pipeline: string[] = ['start'];
  preNodes.forEach((n) => pipeline.push(n.id));
  chainModels.forEach((m) => pipeline.push(`model-${m.id}`));
  postNodes.forEach((n) => pipeline.push(n.id));
  pipeline.push('response');

  for (let i = 0; i < pipeline.length - 1; i++) {
    const sourceId = pipeline[i];
    const targetId = pipeline[i + 1];
    const props = computeEdgeProps(sourceId, targetId, chainModels, preNodes, postNodes, animationsMap);

    edges.push({
      id: `edge-${sourceId}-${targetId}`,
      source: sourceId,
      target: targetId,
      label: props.label,
      labelStyle: {
        fontSize: (props.label === 'try' || props.label === 'fallback') ? 11 : 9,
        fontWeight: (props.label === 'try' || props.label === 'fallback') ? 600 : 500,
      },
      labelBgStyle: { fill: 'white', fillOpacity: 0.9 },
      animated: props.animated,
      style: {
        stroke: props.color,
        strokeWidth: props.strokeWidth,
        ...(props.dashed ? { strokeDasharray: '4,4' } : {}),
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: props.color },
    });
  }

  // --- 8. "All failed" edge from last model to Error ---
  if (chainModels.length > 0) {
    const lastModelId = `model-${chainModels[chainModels.length - 1].id}`;
    edges.push({
      id: `edge-${lastModelId}-error`,
      source: lastModelId,
      target: 'error',
      label: 'all failed',
      labelStyle: { fontSize: 10, fontWeight: 500 },
      labelBgStyle: { fill: 'white', fillOpacity: 0.9 },
      style: { stroke: '#ef4444', strokeWidth: 1.5, strokeDasharray: '5,5' },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#ef4444' },
      animated: false,
    });
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// PROMPT #124 - Chain Analytics Panel
// ---------------------------------------------------------------------------

function AnalyticsPanel({
  analytics,
  loading,
  onRefresh,
}: {
  analytics: AIFlowChainAnalyticsResponse | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
        <span className="ml-2 text-sm text-gray-500">Loading analytics...</span>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="text-center py-6 text-sm text-gray-400">
        No analytics data available. Chain executions will appear here.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="text-xs text-blue-600 font-medium">Total Cost</div>
          <div className="text-lg font-bold text-blue-900">${analytics.total_cost_all_chains.toFixed(4)}</div>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
          <div className="text-xs text-green-600 font-medium">Fallback Savings</div>
          <div className="text-lg font-bold text-green-900">${analytics.total_fallback_savings.toFixed(4)}</div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <div className="text-xs text-amber-600 font-medium">Most Failing</div>
          <div className="text-sm font-bold text-amber-900 truncate">
            {analytics.most_failing_model?.model_name || 'None'}
          </div>
          {analytics.most_failing_model && (
            <div className="text-[10px] text-amber-600">{(analytics.most_failing_model.failure_rate * 100).toFixed(1)}% failure</div>
          )}
        </div>
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
          <div className="text-xs text-purple-600 font-medium">Lookback</div>
          <div className="text-lg font-bold text-purple-900">{analytics.lookback_days}d</div>
        </div>
      </div>

      {/* Per operation breakdown */}
      {analytics.analytics.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Operation</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Executions</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Fallback Rate</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Primary Success</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Avg Depth</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Total Cost</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Savings</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {analytics.analytics.map((item: AIFlowChainAnalyticsItem) => (
                <tr key={item.usage_type} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-900">
                    {USAGE_TYPE_OPTIONS.find(o => o.value === item.usage_type)?.label || item.usage_type}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700">{item.total_executions}</td>
                  <td className="px-3 py-2 text-right">
                    <span className={`font-medium ${item.fallback_rate > 0.3 ? 'text-red-600' : item.fallback_rate > 0.1 ? 'text-amber-600' : 'text-green-600'}`}>
                      {(item.fallback_rate * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className={`font-medium ${item.primary_success_rate > 0.9 ? 'text-green-600' : item.primary_success_rate > 0.7 ? 'text-amber-600' : 'text-red-600'}`}>
                      {(item.primary_success_rate * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700">{item.avg_chain_depth.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right text-gray-700">${item.total_cost.toFixed(4)}</td>
                  <td className="px-3 py-2 text-right text-green-600 font-medium">${item.cost_savings.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-end">
        <button onClick={onRefresh} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
          Refresh Analytics
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PROMPT #124 - Optimize Chain Dialog
// ---------------------------------------------------------------------------

function OptimizeDialog({
  open,
  onClose,
  onApply,
  usageType,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (order: string[]) => void;
  usageType: string;
}) {
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
      const msg = err?.message || 'Failed to optimize';
      if (msg.includes('No chain configured')) {
        setError('No chain configured for this operation. Add models to the chain first.');
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
          <h3 className="text-lg font-semibold text-gray-900">Optimize Chain Order</h3>
          <p className="text-sm text-gray-500 mt-1">
            Analyze model performance and get a recommended order for{' '}
            {USAGE_TYPE_OPTIONS.find(o => o.value === usageType)?.label || usageType}
          </p>
        </div>

        <div className="p-5 space-y-4">
          {/* Strategy selector */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-2">Strategy</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'balanced', label: 'Balanced', desc: 'Best overall' },
                { value: 'reliability', label: 'Reliability', desc: 'Highest success rate' },
                { value: 'cost', label: 'Cost', desc: 'Lowest cost first' },
                { value: 'quality', label: 'Quality', desc: 'Best models first' },
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
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  Analyzing...
                </div>
              ) : (
                'Analyze & Recommend'
              )}
            </Button>
          )}

          {/* Result */}
          {result && (
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-gray-900">Recommended Order</h4>
              <div className="space-y-1.5">
                {result.models.map((m: AIFlowOptimizeModelScore, i: number) => (
                  <div key={m.model_id} className="flex items-center gap-2 p-2 rounded-md bg-gray-50 border text-xs">
                    <span className="font-bold text-gray-500 w-5">{i + 1}</span>
                    <ProviderIcon provider={m.provider} size="w-4 h-4" />
                    <span className="flex-1 font-medium">{m.model_name}</span>
                    <span className="text-gray-500">Score: {m.score.toFixed(2)}</span>
                  </div>
                ))}
              </div>

              {result.estimated_improvement && Object.keys(result.estimated_improvement).length > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-700">
                  <div className="font-medium mb-1">Estimated Improvement</div>
                  {Object.entries(result.estimated_improvement).map(([k, v]) => (
                    <div key={k}>{k}: {v}</div>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="primary" onClick={() => onApply(result.recommended_order)} className="flex-1">
                  Apply Recommended Order
                </Button>
                <Button variant="ghost" onClick={onClose}>Cancel</Button>
              </div>
            </div>
          )}

          {!result && (
            <div className="flex justify-end">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function AIFlowPage() {
  const { showError, showSuccess, NotificationComponent } = useNotification();

  // Data state
  const [allModels, setAllModels] = useState<AIModel[]>([]);
  const [chains, setChains] = useState<AIFlowChain[]>([]);
  const [selectedUsageType, setSelectedUsageType] = useState('interview');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // The working chain for the selected usage_type (always editable)
  const [workingChain, setWorkingChain] = useState<string[]>([]);

  // PROMPT #124 - Metrics state
  const [metricsMap, setMetricsMap] = useState<Record<string, AIFlowModelMetrics>>({});

  // PROMPT #124 - Analytics state
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [analyticsData, setAnalyticsData] = useState<AIFlowChainAnalyticsResponse | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  // PROMPT #124 - Optimize dialog
  const [showOptimize, setShowOptimize] = useState(false);

  // PROMPT #124 - Templates
  const [templates, setTemplates] = useState<AIFlowChainTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  // PROMPT #204 - Utility nodes state
  const [workingUtilityNodes, setWorkingUtilityNodes] = useState<AIFlowUtilityNode[]>([]);
  const [utilityNodeTypes, setUtilityNodeTypes] = useState<AIFlowUtilityNodeType[]>([]);
  // PROMPT #208 - Edit utility node dialog
  const [editingNode, setEditingNode] = useState<AIFlowUtilityNode | null>(null);

  // PROMPT #226 - Edit model node dialog (per-flow overrides)
  const [editingModel, setEditingModel] = useState<AIFlowChainModel | null>(null);
  const [modelOverrides, setModelOverrides] = useState<Record<string, ModelOverrides>>({});

  // PROMPT #124 - WebSocket animations
  const nodeAnimations = useAIFlowWebSocket(selectedUsageType);

  // ReactFlow state
  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);
  const edgeReconnectSuccessful = useRef(true);
  const nodesRef = useRef<Node[]>([]);

  // Keep ref in sync so getNodePositions always reads latest
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  // Current saved chain for selected usage_type
  const currentChain = useMemo(
    () => chains.find((c) => c.usage_type === selectedUsageType),
    [chains, selectedUsageType]
  );

  // Resolve working chain IDs to model info objects for the diagram
  const workingChainModels: AIFlowChainModel[] = useMemo(() => {
    return workingChain
      .map((id) => {
        const m = allModels.find((am) => am.id === id);
        if (!m) return null;
        return {
          id: m.id,
          name: m.name,
          provider: m.provider,
          usage_type: typeof m.usage_type === 'string' ? m.usage_type : m.usage_type,
          is_active: m.is_active,
          config: m.config || {},
        } as AIFlowChainModel;
      })
      .filter(Boolean) as AIFlowChainModel[];
  }, [workingChain, allModels]);

  // Models available to add (only matching usage_type or general, not already in chain)
  const availableModels = useMemo(() => {
    const chainIds = new Set(workingChain);
    return allModels.filter((m) => {
      if (!m.is_active || chainIds.has(m.id)) return false;
      const usage = typeof m.usage_type === 'string' ? m.usage_type : (m.usage_type as any)?.value || '';
      return usage === selectedUsageType || usage === 'general';
    });
  }, [allModels, workingChain, selectedUsageType]);

  // Fetch data
  const loadData = useCallback(async () => {
    try {
      const [modelsRes, chainsRes] = await Promise.all([
        aiModelsApi.list(),
        aiFlowApi.listChains(),
      ]);
      setAllModels(Array.isArray(modelsRes) ? modelsRes : modelsRes.data || []);
      setChains(Array.isArray(chainsRes) ? chainsRes : chainsRes.data || []);
    } catch (error) {
      console.error('Failed to load AI flow data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // When selected usage_type or chains change, sync working chain from saved data
  useEffect(() => {
    setWorkingChain(currentChain?.chain || []);
    setWorkingUtilityNodes(currentChain?.utility_nodes || []);
    // PROMPT #226 - Load model overrides from node_positions
    const savedOverrides = (currentChain?.node_positions as any)?.__model_overrides;
    setModelOverrides(savedOverrides && typeof savedOverrides === 'object' ? savedOverrides : {});
  }, [currentChain, selectedUsageType]);

  // PROMPT #204 - Fetch utility node types catalog
  useEffect(() => {
    const fetchNodeTypes = async () => {
      try {
        const res = await aiFlowApi.utilityNodeTypes();
        setUtilityNodeTypes(res?.node_types || []);
      } catch {
        setUtilityNodeTypes([]);
      }
    };
    fetchNodeTypes();
  }, []);

  // PROMPT #124 - Fetch metrics when working chain changes
  useEffect(() => {
    if (workingChain.length === 0) {
      setMetricsMap({});
      return;
    }

    const fetchMetrics = async () => {
      try {
        const res = await aiFlowApi.modelMetrics(workingChain, 7);
        const map: Record<string, AIFlowModelMetrics> = {};
        if (res?.metrics) {
          res.metrics.forEach((m: AIFlowModelMetrics) => {
            map[m.model_id] = m;
          });
        }
        setMetricsMap(map);
      } catch {
        // Silently fail - metrics are non-critical
      }
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 30000); // Poll every 30s
    return () => clearInterval(interval);
  }, [workingChain]);

  // PROMPT #124 - Fetch templates when usage type changes
  useEffect(() => {
    const fetchTemplates = async () => {
      setTemplatesLoading(true);
      try {
        const res = await aiFlowApi.chainTemplates(selectedUsageType);
        setTemplates(res?.templates || []);
      } catch {
        setTemplates([]);
      } finally {
        setTemplatesLoading(false);
      }
    };
    fetchTemplates();
  }, [selectedUsageType]);

  // PROMPT #124 - Fetch analytics
  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const res = await aiFlowApi.chainAnalytics(undefined, 30);
      setAnalyticsData(res);
    } catch {
      setAnalyticsData(null);
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (showAnalytics) {
      loadAnalytics();
    }
  }, [showAnalytics, loadAnalytics]);

  // Build diagram whenever working chain changes
  const handleRemoveFromChain = useCallback(
    (modelId: string) => {
      setWorkingChain((prev) => prev.filter((id) => id !== modelId));
    },
    []
  );

  // PROMPT #204 - Remove utility node
  const handleRemoveUtilityNode = useCallback(
    (nodeId: string) => {
      setWorkingUtilityNodes((prev) => prev.filter((n) => n.id !== nodeId));
    },
    []
  );

  useEffect(() => {
    const savedPositions = currentChain?.node_positions;
    const { nodes: n, edges: e } = buildFlowFromChain(
      workingChainModels,
      savedPositions,
      handleRemoveFromChain,
      metricsMap,
      nodeAnimations,
      workingUtilityNodes,
      handleRemoveUtilityNode,
      modelOverrides,
    );
    setNodes(n);
    setEdges(e);
  }, [workingChainModels, handleRemoveFromChain, handleRemoveUtilityNode, setNodes, setEdges, currentChain?.node_positions, metricsMap, nodeAnimations, workingUtilityNodes, modelOverrides]);

  // Edge reconnection handlers
  const onReconnectStart = useCallback(() => {
    edgeReconnectSuccessful.current = false;
  }, []);

  const onReconnect: OnReconnect = useCallback((oldEdge, newConnection) => {
    edgeReconnectSuccessful.current = true;
    setEdges((els) => reconnectEdge(oldEdge, newConnection, els));
  }, [setEdges]);

  const onReconnectEnd = useCallback((_: unknown, edge: Edge) => {
    if (!edgeReconnectSuccessful.current) {
      setEdges((eds) => eds.filter((e) => e.id !== edge.id));
    }
    edgeReconnectSuccessful.current = true;
  }, [setEdges]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            animated: true,
            style: { stroke: '#f59e0b', strokeWidth: 2 },
            label: 'fallback',
            labelStyle: { fontSize: 11, fontWeight: 600 },
            labelBgStyle: { fill: 'white', fillOpacity: 0.9 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#f59e0b' },
          },
          eds
        )
      );
    },
    [setEdges]
  );

  // Collect current node positions from ReactFlow state
  const getNodePositions = useCallback((): Record<string, { x: number; y: number }> => {
    const positions: Record<string, { x: number; y: number }> = {};
    nodesRef.current.forEach((node) => {
      positions[node.id] = { x: node.position.x, y: node.position.y };
    });
    return positions;
  }, []);

  // Actions
  const handleAddToChain = (modelId: string) => {
    setWorkingChain((prev) => [...prev, modelId]);
  };

  // PROMPT #226 - Save model override
  const handleSaveModelOverride = useCallback((modelId: string, overrides: ModelOverrides) => {
    const hasValues = overrides.temperature != null || overrides.max_tokens != null || overrides.timeout_seconds != null;
    setModelOverrides(prev => {
      if (!hasValues) {
        const next = { ...prev };
        delete next[modelId];
        return next;
      }
      return { ...prev, [modelId]: overrides };
    });
    setEditingModel(null);
  }, []);

  // PROMPT #208 - Save edited utility node
  const handleSaveNodeEdit = useCallback((updatedNode: AIFlowUtilityNode) => {
    setWorkingUtilityNodes(prev =>
      prev.map(n => n.id === updatedNode.id ? updatedNode : n)
    );
    setEditingNode(null);
  }, []);

  // PROMPT #208 / #226 - Double-click handler for utility nodes AND model nodes
  const handleNodeDoubleClick = useCallback((_event: React.MouseEvent, node: Node) => {
    // Check utility nodes first
    const utilityNode = workingUtilityNodes.find(n => n.id === node.id);
    if (utilityNode) {
      setEditingNode({ ...utilityNode, config: { ...utilityNode.config } });
      return;
    }
    // Check model nodes (id starts with "model-")
    if (node.id.startsWith('model-')) {
      const modelId = node.id.replace('model-', '');
      const chainModel = workingChainModels.find(m => m.id === modelId);
      if (chainModel) {
        setEditingModel(chainModel);
      }
    }
  }, [workingUtilityNodes, workingChainModels]);

  // PROMPT #204 - Add utility node
  const handleAddUtilityNode = (nodeType: AIFlowUtilityNodeType) => {
    const existingCount = workingUtilityNodes.filter((n) => n.type === nodeType.type).length;
    const newNode: AIFlowUtilityNode = {
      id: `${nodeType.type}-${Date.now()}`,
      type: nodeType.type as UtilityNodeType,
      label: existingCount > 0 ? `${nodeType.label} ${existingCount + 1}` : nodeType.label,
      enabled: true,
      config: { ...nodeType.default_config },
      position: null,
    };
    setWorkingUtilityNodes((prev) => [...prev, newNode]);
  };

  const handleMoveUp = (index: number) => {
    if (index <= 0) return;
    setWorkingChain((prev) => {
      const arr = [...prev];
      [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
      return arr;
    });
  };

  const handleMoveDown = (index: number) => {
    setWorkingChain((prev) => {
      if (index >= prev.length - 1) return prev;
      const arr = [...prev];
      [arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
      return arr;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const nodePositions = getNodePositions();
      // PROMPT #226 - Store model overrides alongside positions
      const positionsWithOverrides = {
        ...nodePositions,
        ...(Object.keys(modelOverrides).length > 0 ? { __model_overrides: modelOverrides } : {}),
      };
      if (workingChain.length === 0 && workingUtilityNodes.length === 0 && currentChain) {
        // Chain was emptied — delete it
        await aiFlowApi.deleteChain(selectedUsageType);
        showSuccess('Flow chain deleted');
      } else if (workingChain.length > 0 || workingUtilityNodes.length > 0) {
        await aiFlowApi.upsertChain(selectedUsageType, {
          chain: workingChain,
          node_positions: positionsWithOverrides,
          utility_nodes: workingUtilityNodes.length > 0 ? workingUtilityNodes : null,
          is_active: true,
        } as any);
        showSuccess('Flow saved');
      }
      await loadData();
    } catch (error) {
      console.error('Failed to save chain:', error);
      showError('Failed to save flow chain');
    } finally {
      setSaving(false);
    }
  };

  // PROMPT #124 / #209 - Apply template (models + utility nodes)
  const handleApplyTemplate = (template: AIFlowChainTemplate) => {
    setWorkingChain(template.chain);
    if (template.utility_nodes && template.utility_nodes.length > 0) {
      setWorkingUtilityNodes(template.utility_nodes);
    }
    showSuccess(`Template "${template.name}" applied (unsaved)`);
  };

  // PROMPT #124 - Apply optimize result
  const handleApplyOptimize = (order: string[]) => {
    setWorkingChain(order);
    setShowOptimize(false);
    showSuccess('Optimized order applied (unsaved)');
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </Layout>
    );
  }

  // Check if working chain differs from saved chain
  const savedChainStr = JSON.stringify(currentChain?.chain || []);
  const workingChainStr = JSON.stringify(workingChain);
  const savedUtilityStr = JSON.stringify(currentChain?.utility_nodes || []);
  const workingUtilityStr = JSON.stringify(workingUtilityNodes);
  const savedOverridesStr = JSON.stringify((currentChain?.node_positions as any)?.__model_overrides || {});
  const workingOverridesStr = JSON.stringify(modelOverrides);
  const hasUnsavedChanges = savedChainStr !== workingChainStr || savedUtilityStr !== workingUtilityStr || savedOverridesStr !== workingOverridesStr;

  return (
    <Layout>
      <Breadcrumbs />
      <div className="flex flex-col" style={{ height: showAnalytics ? 'calc(100vh - 120px)' : 'calc(100vh - 120px)' }}>
        {/* Controls bar */}
        <div className="flex items-center justify-between px-3 py-2 bg-white border rounded-lg mb-3 flex-shrink-0">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-700">Operation:</label>
            <select
              value={selectedUsageType}
              onChange={(e) => setSelectedUsageType(e.target.value)}
              className="px-2 py-1.5 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {USAGE_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            {(workingChain.length > 0 || workingUtilityNodes.length > 0) && (
              <span className="text-xs text-gray-500">
                {workingChain.length} model{workingChain.length !== 1 ? 's' : ''}
                {workingUtilityNodes.length > 0 && ` + ${workingUtilityNodes.length} node${workingUtilityNodes.length !== 1 ? 's' : ''}`}
              </span>
            )}
            {hasUnsavedChanges && (
              <span className="text-xs text-amber-600 font-medium">Unsaved changes</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Analytics toggle */}
            <Button
              variant={showAnalytics ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setShowAnalytics(!showAnalytics)}
            >
              <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Analytics
            </Button>

            <Button
              variant="primary"
              size="sm"
              onClick={handleSave}
              disabled={saving || !hasUnsavedChanges}
            >
              {saving ? (
                <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white mr-1" />
              ) : (
                <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
              Save
            </Button>
          </div>
        </div>

        {/* Main content */}
        <div className="flex gap-3 flex-1 min-h-0">
          {/* ReactFlow Canvas */}
          <div className="flex-1 border rounded-lg overflow-hidden bg-gray-50">
            {(workingChain.length > 0 || workingUtilityNodes.length > 0) ? (
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onReconnect={onReconnect}
                onReconnectStart={onReconnectStart}
                onReconnectEnd={onReconnectEnd}
                onNodeDoubleClick={handleNodeDoubleClick}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.5, minZoom: 0.8, maxZoom: 1.2 }}
                nodesDraggable={true}
                nodesConnectable={true}
                elementsSelectable={true}
                snapToGrid={true}
                snapGrid={[20, 20]}
                proOptions={{ hideAttribution: true }}
                minZoom={0.2}
                maxZoom={2}
              >
                <Background color="#e5e7eb" gap={20} />
                <Controls />
                <MiniMap
                  nodeStrokeWidth={3}
                  zoomable
                  pannable
                  style={{ height: 90, width: 140 }}
                />
              </ReactFlow>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <p className="text-lg font-medium">No flow configured</p>
                <p className="text-sm mt-1">
                  Add models from the sidebar to build a fallback chain for {USAGE_TYPE_OPTIONS.find(o => o.value === selectedUsageType)?.label || selectedUsageType}
                </p>
              </div>
            )}
          </div>

          {/* Right sidebar: quick actions + chain order + available models */}
          <div className="w-72 border rounded-lg bg-white overflow-hidden flex flex-col flex-shrink-0">
            {/* PROMPT #124 - Quick Actions */}
            <div className="border-b p-3">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Quick Actions</h3>
              <div className="space-y-1.5">
                <button
                  onClick={() => setShowOptimize(true)}
                  disabled={workingChain.length < 2}
                  className="w-full flex items-center gap-2 p-2 rounded-md border border-blue-200 bg-blue-50 hover:bg-blue-100 text-sm text-blue-700 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                  Optimize Order
                </button>

                {/* Templates */}
                {templatesLoading ? (
                  <div className="text-xs text-gray-400 text-center py-1">Loading templates...</div>
                ) : templates.length > 0 ? (
                  templates.map((tmpl) => (
                    <button
                      key={tmpl.id}
                      onClick={() => handleApplyTemplate(tmpl)}
                      className="w-full flex items-center gap-2 p-2 rounded-md border border-gray-200 hover:bg-gray-50 text-xs text-gray-700 transition-colors text-left"
                    >
                      <svg className="w-3.5 h-3.5 flex-shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6z" />
                      </svg>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{tmpl.name}</div>
                        <div className="text-[10px] text-gray-500 truncate">{tmpl.description}</div>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="text-[10px] text-gray-400 italic">No templates for this operation</div>
                )}
              </div>
            </div>

            {/* Chain order */}
            <div className="border-b p-3">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Chain Order</h3>
              {workingChain.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No models added yet</p>
              ) : (
                <div className="space-y-1.5">
                  {workingChain.map((id, index) => {
                    const model = allModels.find((m) => m.id === id);
                    if (!model) return null;
                    return (
                      <div key={id} className={`flex items-center gap-2 p-2 rounded-md border text-sm ${PROVIDER_BG[model.provider.toLowerCase()] || 'bg-gray-50 border-gray-200'}`}>
                        <span className="text-xs font-bold text-gray-500 w-5">{index + 1}</span>
                        <ProviderIcon provider={model.provider} size="w-4 h-4" />
                        <span className="flex-1 truncate text-xs font-medium">{model.name}</span>
                        <div className="flex items-center gap-0.5">
                          <button
                            onClick={() => handleMoveUp(index)}
                            disabled={index === 0}
                            className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleMoveDown(index)}
                            disabled={index === workingChain.length - 1}
                            className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleRemoveFromChain(id)}
                            className="p-0.5 text-red-400 hover:text-red-600"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Scrollable area: Available models + Flow Nodes */}
            <div className="flex-1 overflow-y-auto">
              {/* Available models */}
              <div className="border-b p-3">
                <h3 className="text-sm font-semibold text-gray-900 mb-2">Available Models</h3>
                {availableModels.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">All active models are in the chain</p>
                ) : (
                  <div className="space-y-1.5">
                    {availableModels.map((model) => (
                      <div
                        key={model.id}
                        className="flex items-center gap-2 p-2 rounded-md hover:bg-gray-50 border border-transparent hover:border-gray-200 transition-colors"
                      >
                        <ProviderIcon provider={model.provider} size="w-4 h-4" />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-gray-900 truncate">{model.name}</div>
                          <div className="text-[10px] text-gray-500 capitalize">{model.provider}</div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs px-2 py-1 h-auto"
                          onClick={() => handleAddToChain(model.id)}
                        >
                          + Add
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* PROMPT #204 - Utility Nodes */}
              <div className="p-3">
                <h3 className="text-sm font-semibold text-gray-900 mb-2">Flow Nodes</h3>
                {workingUtilityNodes.length > 0 && (
                  <div className="mb-3 space-y-1">
                    <div className="text-[10px] text-gray-500 font-medium uppercase tracking-wide mb-1">Active</div>
                    {workingUtilityNodes.map((uNode) => (
                      <div key={uNode.id} className={`flex items-center gap-2 p-2 rounded-md border text-xs ${UTILITY_NODE_BG[uNode.type] || 'bg-gray-50 border-gray-200'}`}>
                        <UtilityNodeIcon type={uNode.type} size="w-4 h-4" />
                        <span className="flex-1 truncate font-medium">{uNode.label}</span>
                        <button
                          onClick={() => handleRemoveUtilityNode(uNode.id)}
                          className="p-0.5 text-red-400 hover:text-red-600"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="text-[10px] text-gray-500 font-medium uppercase tracking-wide mb-1">Add Node</div>
                <div className="space-y-1">
                  {utilityNodeTypes.map((nodeType) => (
                    <button
                      key={nodeType.type}
                      onClick={() => handleAddUtilityNode(nodeType)}
                      className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-gray-50 border border-transparent hover:border-gray-200 transition-colors text-left"
                    >
                      <UtilityNodeIcon type={nodeType.type} size="w-4 h-4" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-gray-900">{nodeType.label}</div>
                        <div className="text-[10px] text-gray-500 truncate">{nodeType.description}</div>
                      </div>
                      <span className="text-xs text-gray-400">+</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* PROMPT #124 - Analytics Panel (collapsible) */}
        {showAnalytics && (
          <div className="mt-3 border rounded-lg bg-white p-4 flex-shrink-0 max-h-[300px] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">Chain Analytics</h3>
              <button onClick={() => setShowAnalytics(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <AnalyticsPanel
              analytics={analyticsData}
              loading={analyticsLoading}
              onRefresh={loadAnalytics}
            />
          </div>
        )}

        {/* Bottom info */}
        <div className="flex items-center gap-2 mt-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700 flex-shrink-0">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>
            Models are tried in order. If one fails, the next is used automatically.
            Add utility nodes (Cache, RAG, Validator, etc.) for pre/post-processing.
            Metrics refresh every 30s.
            {' '}<a href="/ai-models" className="underline font-medium">Manage models</a>
          </span>
        </div>
      </div>

      {/* PROMPT #124 - Optimize Dialog */}
      <OptimizeDialog
        open={showOptimize}
        onClose={() => setShowOptimize(false)}
        onApply={handleApplyOptimize}
        usageType={selectedUsageType}
      />

      {/* PROMPT #208 - Edit Utility Node Dialog */}
      {editingNode && (
        <EditUtilityNodeDialog
          node={editingNode}
          onSave={handleSaveNodeEdit}
          onClose={() => setEditingNode(null)}
        />
      )}

      {/* PROMPT #226 - Edit Model Node Dialog */}
      {editingModel && (
        <EditModelNodeDialog
          model={editingModel}
          overrides={modelOverrides[editingModel.id] || {}}
          onSave={handleSaveModelOverride}
          onClose={() => setEditingModel(null)}
        />
      )}

      {NotificationComponent}

      {/* PROMPT #124 - Shake animation CSS */}
      <style jsx global>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-3px); }
          20%, 40%, 60%, 80% { transform: translateX(3px); }
        }
        .animate-shake {
          animation: shake 0.5s ease-in-out;
        }
      `}</style>
    </Layout>
  );
}

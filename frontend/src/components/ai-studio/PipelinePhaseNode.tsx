'use client';

/**
 * PipelinePhaseNode - ReactFlow node for Deep Pipeline phases.
 * Follows the same visual pattern as ModelNode in AI Flow Operations tab:
 * - Left accent border with provider color
 * - ProviderIcon + name + subtitle
 * - Health dot
 * - Same handle sizes and padding
 */

import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { PROVIDER_COLORS } from '@/components/ai-flow/FlowConstants';
import { ProviderIcon } from '@/components/ai-flow/FlowIcons';

export interface PipelinePhaseData {
  phaseKey: string;
  label: string;
  description: string;
  model: string;
  modelShort: string;
  provider: string;
  maxTokens: number;
  concurrency: number;
  score?: number | null;
  duration?: number | null;
  onSelect?: (phaseKey: string) => void;
}

function getScoreColor(score: number | null | undefined): string {
  if (score == null) return 'bg-gray-400';
  if (score >= 75) return 'bg-green-500';
  if (score >= 50) return 'bg-yellow-500';
  return 'bg-red-500';
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '--';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

function formatTokens(tokens: number): string {
  if (!tokens) return '--';
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}K`;
  return `${tokens}`;
}

export function PipelinePhaseNode({ data }: NodeProps) {
  const d = data as unknown as PipelinePhaseData;
  const providerColor = PROVIDER_COLORS[d.provider] || '#6b7280';

  return (
    <div
      className="bg-white rounded-lg shadow-md border-2 min-w-[200px] relative cursor-pointer hover:shadow-lg transition-all"
      style={{
        borderLeftColor: providerColor,
        borderLeftWidth: '4px',
        borderTopColor: '#e5e7eb',
        borderRightColor: '#e5e7eb',
        borderBottomColor: '#e5e7eb',
      }}
      onClick={() => d.onSelect?.(d.phaseKey)}
      onDoubleClick={() => d.onSelect?.(d.phaseKey)}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-purple-500 hover:!w-4 hover:!h-4 transition-all"
      />

      <div className="px-4 py-3">
        {/* Row 1: Icon + Label + Health dot */}
        <div className="flex items-center gap-3">
          <ProviderIcon provider={d.provider || 'unknown'} />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-gray-900 truncate">{d.label}</div>
            <div className="text-xs text-gray-500">{d.description}</div>
          </div>
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${getScoreColor(d.score)}`} />
        </div>

        {/* Row 2: Model name */}
        <div className="text-[10px] text-gray-400 mt-1.5 font-mono truncate" title={d.model}>
          {d.modelShort}
        </div>

        {/* Row 3: Config badges */}
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-purple-100 text-purple-700">
            {formatTokens(d.maxTokens)} tokens
          </span>
          {d.concurrency > 1 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700">
              {d.concurrency}x conc.
            </span>
          )}
        </div>

        {/* Row 4: Score + Duration (matches metrics area in ModelNode) */}
        {(d.score != null || d.duration != null) && (
          <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between">
            <span className={`text-[10px] font-semibold ${
              d.score == null ? 'text-gray-400' :
              d.score >= 75 ? 'text-green-600' :
              d.score >= 50 ? 'text-yellow-600' : 'text-red-600'
            }`}>
              {d.score != null ? `${d.score}/100` : '--'}
            </span>
            <span className="text-[10px] text-gray-400">
              {formatDuration(d.duration)}
            </span>
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="right"
        className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-purple-500 hover:!w-4 hover:!h-4 transition-all"
      />
    </div>
  );
}

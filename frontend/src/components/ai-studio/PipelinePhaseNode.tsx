'use client';

/**
 * PipelinePhaseNode - ReactFlow node representing a Deep Pipeline phase.
 * Shows: phase name, model used, score badge, provider-colored border.
 */

import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { PROVIDER_COLORS } from '@/components/ai-flow/FlowConstants';

export interface PipelinePhaseData {
  phaseKey: string;
  label: string;
  description: string;
  model: string;
  modelShort: string;
  provider: string;
  maxTokens: number;
  concurrency: number;
  contract?: string;
  score?: number | null;
  duration?: number | null;
  isConditional?: boolean;
  onSelect?: (phaseKey: string) => void;
}

const SCORE_COLORS = {
  good: 'bg-green-500',
  ok: 'bg-yellow-500',
  bad: 'bg-red-500',
  none: 'bg-gray-300',
};

function getScoreColor(score: number | null | undefined): string {
  if (score == null) return SCORE_COLORS.none;
  if (score >= 75) return SCORE_COLORS.good;
  if (score >= 50) return SCORE_COLORS.ok;
  return SCORE_COLORS.bad;
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

export function PipelinePhaseNode({ data }: NodeProps) {
  const d = data as unknown as PipelinePhaseData;
  const borderColor = PROVIDER_COLORS[d.provider] || '#6b7280';

  return (
    <div
      className="relative bg-white rounded-lg shadow-md border-2 cursor-pointer hover:shadow-lg transition-shadow"
      style={{ borderColor, width: 160, minHeight: 100 }}
      onClick={() => d.onSelect?.(d.phaseKey)}
    >
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-gray-400" />

      {/* Header */}
      <div
        className="px-3 py-1.5 rounded-t-md text-white text-xs font-semibold truncate"
        style={{ backgroundColor: borderColor }}
      >
        {d.label}
      </div>

      {/* Body */}
      <div className="px-3 py-2 space-y-1.5">
        {/* Model */}
        <div className="text-xs text-gray-600 truncate" title={d.model}>
          {d.modelShort}
        </div>

        {/* Score + Duration row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-full inline-block ${getScoreColor(d.score)}`} />
            <span className="text-xs font-medium text-gray-700">
              {d.score != null ? d.score : '--'}
            </span>
          </div>
          <span className="text-[10px] text-gray-400">
            {formatDuration(d.duration)}
          </span>
        </div>

        {/* Conditional badge */}
        {d.isConditional && (
          <div className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded text-center">
            condicional
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-gray-400" />
    </div>
  );
}

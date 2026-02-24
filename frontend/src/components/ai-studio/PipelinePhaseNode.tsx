'use client';

/**
 * PipelinePhaseNode - ReactFlow node representing a Deep Pipeline phase.
 * Shows: phase name, description, model, max_tokens, concurrency, score, duration.
 * Double-click opens the configuration panel.
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

function getScoreBg(score: number | null | undefined): string {
  if (score == null) return 'bg-gray-100 text-gray-500';
  if (score >= 75) return 'bg-green-100 text-green-700';
  if (score >= 50) return 'bg-yellow-100 text-yellow-700';
  return 'bg-red-100 text-red-700';
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
  const borderColor = PROVIDER_COLORS[d.provider] || '#6b7280';

  return (
    <div
      className="relative bg-white rounded-lg shadow-md border-2 cursor-pointer hover:shadow-lg hover:ring-2 hover:ring-purple-200 transition-all"
      style={{ borderColor, width: 180, minHeight: 130 }}
      onClick={() => d.onSelect?.(d.phaseKey)}
      onDoubleClick={() => d.onSelect?.(d.phaseKey)}
      title="Clique para configurar esta fase"
    >
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-gray-400" />

      {/* Header */}
      <div
        className="px-3 py-1.5 rounded-t-md text-white text-xs font-semibold flex items-center justify-between"
        style={{ backgroundColor: borderColor }}
      >
        <span className="truncate">{d.label}</span>
        {d.score != null && (
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${getScoreBg(d.score)}`}>
            {d.score}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2 space-y-1">
        {/* Description */}
        <div className="text-[10px] text-gray-500 leading-tight">{d.description}</div>

        {/* Model */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-400">Modelo:</span>
          <span className="text-[10px] font-semibold text-gray-700" title={d.model}>
            {d.modelShort}
          </span>
        </div>

        {/* Max Tokens + Concurrency row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-gray-400">Tokens:</span>
            <span className="text-[10px] font-medium text-gray-600">{formatTokens(d.maxTokens)}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-gray-400">Conc:</span>
            <span className="text-[10px] font-medium text-gray-600">{d.concurrency || 1}</span>
          </div>
        </div>

        {/* Score + Duration row */}
        <div className="flex items-center justify-between pt-1 border-t border-gray-100">
          <div className="flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full inline-block ${getScoreColor(d.score)}`} />
            <span className="text-[10px] font-medium text-gray-600">
              {d.score != null ? `${d.score}/100` : '--'}
            </span>
          </div>
          <span className="text-[10px] text-gray-400">
            {formatDuration(d.duration)}
          </span>
        </div>
      </div>

      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-gray-400" />
    </div>
  );
}

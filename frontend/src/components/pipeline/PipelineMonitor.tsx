'use client';

/**
 * PipelineMonitor — PROMPT #237
 * Real-time microscopic pipeline monitoring component.
 * Shows live token I/O, cost, current action, phase health, and activity feed.
 * Connects via WebSocket (/ws/console) with REST polling fallback.
 */

import React, { useMemo } from 'react';
import { usePipelineTelemetry, PipelineActivity } from '@/hooks/usePipelineTelemetry';

// Phase display config
const PHASE_LABELS: Record<string, string> = {
  phase_0: 'Scan',
  phase_1: 'Arquivos',
  phase_2: 'Regras',
  phase_3: 'Arquitetura',
  phase_4: 'Cards',
  phase_4a: 'Epics',
  phase_4b: 'Stories',
  phase_4c: 'Tasks',
  phase_4d: 'Subtasks',
  phase_5: 'Wiki',
  phase_5a: 'Wiki Plan',
  phase_5b: 'Wiki Overview',
  phase_5c: 'Wiki Domínios',
  phase_5d: 'Wiki Fluxos',
  phase_6: 'QA',
  phase_7: 'Gap Filling',
};

const PHASE_WEIGHTS: Record<string, number> = {
  phase_0: 5,
  phase_1: 15,
  phase_2: 20,
  phase_3: 10,
  phase_4: 25,
  phase_5: 15,
  phase_6: 10,
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(n: number): string {
  if (n < 0.0001) return `$${n.toFixed(6)}`;
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function scoreColor(score: number): string {
  if (score >= 80) return 'bg-green-500';
  if (score >= 60) return 'bg-yellow-500';
  return 'bg-red-500';
}

function scoreTextColor(score: number): string {
  if (score >= 80) return 'text-green-600';
  if (score >= 60) return 'text-yellow-600';
  return 'text-red-600';
}

// Sparkline SVG: last 60 data points of tokens/second
function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const w = 200;
  const h = 24;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (v / max) * h;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={w} height={h} className="inline-block">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-blue-500"
      />
    </svg>
  );
}

function computeHealthScore(phaseScores: Record<string, number>): number {
  let totalWeight = 0;
  let weightedSum = 0;
  for (const [phase, weight] of Object.entries(PHASE_WEIGHTS)) {
    if (phase in phaseScores) {
      weightedSum += phaseScores[phase] * weight;
      totalWeight += weight;
    }
  }
  return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
}

interface PipelineMonitorProps {
  projectId: string;
}

export default function PipelineMonitor({ projectId }: PipelineMonitorProps) {
  const telemetry = usePipelineTelemetry(projectId);

  const healthScore = useMemo(
    () => computeHealthScore(telemetry.phaseScores),
    [telemetry.phaseScores]
  );

  // Sparkline data from activities (tokens per event, last 60)
  const sparkData = useMemo(() => {
    return telemetry.activities
      .slice(0, 60)
      .reverse()
      .map(a => a.inputTokens + a.outputTokens);
  }, [telemetry.activities]);

  // Don't render if idle (after all hooks)
  if (telemetry.status === 'idle') return null;

  const phaseLabel = PHASE_LABELS[telemetry.currentPhase] || telemetry.currentPhase;
  const overallPct = telemetry.itemsTotal > 0
    ? Math.round((telemetry.itemsDone / telemetry.itemsTotal) * 100)
    : 0;

  const recentActivities = telemetry.activities.slice(0, 5);

  const statusBadge = telemetry.status === 'running' ? (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
      <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
      RUNNING
    </span>
  ) : telemetry.status === 'completed' ? (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
      COMPLETED
    </span>
  ) : (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
      FAILED
    </span>
  );

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden mb-6">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-gray-900">Pipeline Monitor</h3>
          {statusBadge}
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>{formatDuration(telemetry.elapsedMs)}</span>
          {!telemetry.isConnected && (
            <span className="text-orange-500" title="WebSocket desconectado, usando polling">
              <svg className="w-3.5 h-3.5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728M5.636 5.636a9 9 0 000 12.728" />
              </svg>
            </span>
          )}
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-4 gap-0 border-b border-gray-200">
        <MetricCell label="Progresso" value={`${overallPct}%`} sub={`${telemetry.itemsDone}/${telemetry.itemsTotal}`}>
          <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
            <div
              className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${Math.min(100, overallPct)}%` }}
            />
          </div>
        </MetricCell>
        <MetricCell label="Tokens In" value={formatTokens(telemetry.tokensIn)} sub={`${formatTokens(telemetry.tokensPerSecond)} tok/s`} />
        <MetricCell label="Tokens Out" value={formatTokens(telemetry.tokensOut)} />
        <MetricCell label="Custo" value={formatCost(telemetry.costUsd)} />
      </div>

      {/* Current Action */}
      {telemetry.status === 'running' && (
        <div className="px-4 py-2.5 border-b border-gray-200 bg-blue-50/50">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-gray-900">{phaseLabel}</span>
            <span className="text-gray-400">&middot;</span>
            <span className="text-gray-600">{telemetry.currentAction.replace(/_/g, ' ')}</span>
            <span className="text-gray-400">&middot;</span>
            <span className="text-xs text-gray-500 font-mono">{telemetry.modelActive}</span>
          </div>
          <div className="text-xs text-gray-500 mt-0.5 truncate">
            &rarr; {telemetry.currentItem}
          </div>
        </div>
      )}

      {/* Token Throughput Sparkline */}
      {sparkData.length > 2 && (
        <div className="px-4 py-2 border-b border-gray-200 flex items-center gap-2">
          <span className="text-xs text-gray-500">Token I/O</span>
          <Sparkline data={sparkData} />
          <span className="text-xs font-medium text-gray-700">{formatTokens(telemetry.tokensPerSecond)} tok/s</span>
        </div>
      )}

      {/* Phase Health Scores */}
      {Object.keys(telemetry.phaseScores).length > 0 && (
        <div className="px-4 py-2.5 border-b border-gray-200">
          <div className="text-xs text-gray-500 mb-1.5">
            Fases
            {healthScore > 0 && (
              <span className={`ml-2 font-medium ${scoreTextColor(healthScore)}`}>
                Score: {healthScore}
              </span>
            )}
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {Object.entries(PHASE_WEIGHTS).map(([phase]) => {
              const score = telemetry.phaseScores[phase];
              const label = PHASE_LABELS[phase] || phase;
              if (score === undefined) {
                return (
                  <div key={phase} className="flex items-center gap-1" title={`${label}: pendente`}>
                    <div className="w-8 h-2 rounded-full bg-gray-200" />
                    <span className="text-xs text-gray-400">{label.slice(0, 4)}</span>
                  </div>
                );
              }
              return (
                <div key={phase} className="flex items-center gap-1" title={`${label}: ${score}/100`}>
                  <div className="w-8 h-2 rounded-full bg-gray-200 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${scoreColor(score)}`}
                      style={{ width: `${score}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-600">{score}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Activity Feed */}
      {recentActivities.length > 0 && (
        <div className="px-4 py-2">
          <div className="text-xs text-gray-500 mb-1">Atividade recente</div>
          <div className="space-y-0.5">
            {recentActivities.map((act, idx) => (
              <ActivityRow key={idx} activity={act} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCell({
  label,
  value,
  sub,
  children,
}: {
  label: string;
  value: string;
  sub?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-2.5 border-r border-gray-200 last:border-r-0">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-semibold text-gray-900 leading-tight">{value}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
      {children}
    </div>
  );
}

function ActivityRow({ activity }: { activity: PipelineActivity }) {
  const time = activity.timestamp
    ? new Date(activity.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '';

  return (
    <div className="flex items-center gap-2 text-xs text-gray-600 py-0.5">
      <span className="text-gray-400 font-mono w-16 shrink-0">{time}</span>
      <span className="text-green-600">&#10003;</span>
      <span className="font-medium text-gray-700 w-28 truncate">{activity.action.replace(/_/g, ' ')}</span>
      <span className="truncate text-gray-500 flex-1">{activity.itemName}</span>
      {(activity.inputTokens > 0 || activity.outputTokens > 0) && (
        <span className="text-gray-400 shrink-0 font-mono">
          {formatTokens(activity.inputTokens + activity.outputTokens)}
        </span>
      )}
    </div>
  );
}

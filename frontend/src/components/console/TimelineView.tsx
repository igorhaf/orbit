'use client';

/**
 * TimelineView - PROMPT #296
 * Groups console logs by trace_id into collapsible operation cards
 * with phase bars, duration badges, token/cost info.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Spinner } from '@/components/ui';
import OperationSummaryCard, { PhaseInfo } from './OperationSummaryCard';

interface LogEntry {
  id: string;
  timestamp: string;
  level: string;
  category: string;
  title: string;
  message: string;
  details?: Record<string, unknown>;
  project_id?: string;
  job_id?: string;
  duration_ms?: number;
  tokens_used?: number;
  trace_id?: string;
  operation_name?: string;
  phase_name?: string;
  cost_usd?: number;
  model_name?: string;
  input_tokens?: number;
  output_tokens?: number;
}

interface Operation {
  trace_id: string;
  operation_name: string;
  events: LogEntry[];
  phases: PhaseInfo[];
  total_duration_ms: number;
  total_tokens: number;
  total_cost: number;
  models_used: string[];
  started_at: string;
  ended_at: string;
  bottleneck: string | null;
  diagnostics: string[];
  project_id?: string;
}

interface TimelineViewProps {
  logs: LogEntry[];
}

function getDurationBadgeClass(ms: number): string {
  if (ms < 15000) return 'bg-green-900/40 text-green-400 border-green-800';
  if (ms < 60000) return 'bg-yellow-900/40 text-yellow-400 border-yellow-800';
  return 'bg-red-900/40 text-red-400 border-red-800';
}

function getDurationLabel(ms: number): string {
  if (ms < 15000) return 'Rápido';
  if (ms < 60000) return 'Moderado';
  return 'Lento';
}

export default function TimelineView({ logs }: TimelineViewProps) {
  const [operations, setOperations] = useState<Operation[]>([]);
  const [ungroupedLogs, setUngroupedLogs] = useState<LogEntry[]>([]);
  const [expandedOps, setExpandedOps] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  // Group logs by trace_id locally from SSE data
  const groupLogs = useCallback(() => {
    const opsMap = new Map<string, Operation>();
    const ungrouped: LogEntry[] = [];

    for (const log of logs) {
      if (!log.trace_id) {
        ungrouped.push(log);
        continue;
      }

      if (!opsMap.has(log.trace_id)) {
        opsMap.set(log.trace_id, {
          trace_id: log.trace_id,
          operation_name: log.operation_name || 'Operação',
          events: [],
          phases: [],
          total_duration_ms: 0,
          total_tokens: 0,
          total_cost: 0,
          models_used: [],
          started_at: log.timestamp,
          ended_at: log.timestamp,
          bottleneck: null,
          diagnostics: [],
          project_id: log.project_id,
        });
      }

      const op = opsMap.get(log.trace_id)!;
      op.events.push(log);

      if (log.timestamp < op.started_at) op.started_at = log.timestamp;
      if (log.timestamp > op.ended_at) op.ended_at = log.timestamp;

      const details = log.details || {};
      const eventType = details.event_type as string;

      if (eventType === 'phase_end') {
        const phaseInfo: PhaseInfo = {
          name: (details.phase_name as string) || log.phase_name || '',
          duration_ms: log.duration_ms || 0,
          tokens: log.tokens_used || 0,
          cost_usd: log.cost_usd || 0,
          model: log.model_name || '',
        };
        op.phases.push(phaseInfo);
        op.total_tokens += phaseInfo.tokens || 0;
        op.total_cost += phaseInfo.cost_usd || 0;
      }

      if (eventType === 'operation_summary') {
        op.total_duration_ms = (details.total_duration_ms as number) || 0;
        op.bottleneck = (details.bottleneck as string) || null;
        op.diagnostics = (details.diagnostics as string[]) || [];
        op.total_tokens = (details.total_tokens as number) || op.total_tokens;
        op.total_cost = (details.total_cost as number) || op.total_cost;
      }

      if (log.model_name && !op.models_used.includes(log.model_name)) {
        op.models_used.push(log.model_name);
      }
    }

    // Calculate total duration from phases if no summary yet
    for (const op of opsMap.values()) {
      if (!op.total_duration_ms && op.phases.length > 0) {
        op.total_duration_ms = op.phases.reduce((s, p) => s + p.duration_ms, 0);
      }
    }

    const sorted = Array.from(opsMap.values()).sort(
      (a, b) => b.ended_at.localeCompare(a.ended_at)
    );

    setOperations(sorted);
    setUngroupedLogs(ungrouped);
  }, [logs]);

  useEffect(() => {
    groupLogs();
  }, [groupLogs]);

  // Also try to fetch from /operations endpoint for richer data
  useEffect(() => {
    const fetchOperations = async () => {
      try {
        setLoading(true);
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
        const res = await fetch(`${apiUrl}/api/v1/console/operations?limit=50`);
        if (res.ok) {
          const data = await res.json();
          if (data.operations && data.operations.length > 0) {
            setOperations(data.operations);
          }
        }
      } catch {
        // Fallback to local grouping
      } finally {
        setLoading(false);
      }
    };

    fetchOperations();
    const interval = setInterval(fetchOperations, 10000);
    return () => clearInterval(interval);
  }, []);

  const toggleExpand = (traceId: string) => {
    setExpandedOps(prev => {
      const next = new Set(prev);
      if (next.has(traceId)) {
        next.delete(traceId);
      } else {
        next.add(traceId);
      }
      return next;
    });
  };

  if (operations.length === 0 && !loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        <div className="text-center">
          <p className="text-lg">Nenhuma operação registrada</p>
          <p className="text-xs mt-1">Operações com trace_id aparecerão aqui</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3 overflow-auto h-full">
      {loading && operations.length === 0 && (
        <div className="flex items-center justify-center py-8">
          <Spinner size="lg" />
        </div>
      )}

      {operations.map((op) => {
        const isExpanded = expandedOps.has(op.trace_id);
        const badgeClass = getDurationBadgeClass(op.total_duration_ms);
        const badgeLabel = getDurationLabel(op.total_duration_ms);

        return (
          <div
            key={op.trace_id}
            className="bg-gray-900/50 border border-gray-800 rounded-lg overflow-hidden"
          >
            {/* Operation header */}
            <button
              onClick={() => toggleExpand(op.trace_id)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-800/50 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <span className="text-gray-500 text-xs">
                  {isExpanded ? '\u25BC' : '\u25B6'}
                </span>
                <span className="text-gray-200 font-medium text-sm">
                  {op.operation_name}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded border ${badgeClass}`}>
                  {badgeLabel} - {(op.total_duration_ms / 1000).toFixed(1)}s
                </span>
                {op.phases.length > 0 && (
                  <span className="text-gray-500 text-xs">
                    {op.phases.length} fases
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-500">
                {op.total_tokens > 0 && (
                  <span>{op.total_tokens} tokens</span>
                )}
                {op.total_cost > 0 && (
                  <span>${op.total_cost.toFixed(4)}</span>
                )}
                {op.models_used.length > 0 && (
                  <span className="truncate max-w-[150px]">
                    {op.models_used.join(', ')}
                  </span>
                )}
                <span>
                  {new Date(op.started_at).toLocaleTimeString()}
                </span>
              </div>
            </button>

            {/* Expanded content */}
            {isExpanded && (
              <div className="px-4 pb-4 space-y-3 border-t border-gray-800">
                {/* Summary card */}
                {op.phases.length > 0 && (
                  <div className="mt-3">
                    <OperationSummaryCard
                      operationName={op.operation_name}
                      totalDurationMs={op.total_duration_ms}
                      phases={op.phases}
                      totalTokens={op.total_tokens}
                      totalCost={op.total_cost}
                      bottleneck={op.bottleneck}
                      diagnostics={op.diagnostics}
                    />
                  </div>
                )}

                {/* Raw events */}
                <div className="mt-2">
                  <span className="text-xs text-gray-500 font-semibold">
                    Eventos ({op.events.length})
                  </span>
                  <div className="mt-1 space-y-0.5 max-h-60 overflow-auto">
                    {op.events.map((evt) => (
                      <div
                        key={evt.id}
                        className="text-xs font-mono flex items-start gap-2"
                      >
                        <span className="text-gray-600 shrink-0">
                          {new Date(evt.timestamp).toLocaleTimeString()}
                        </span>
                        <span className={
                          evt.level === 'error' ? 'text-red-400' :
                          evt.level === 'success' ? 'text-green-400' :
                          evt.level === 'warning' ? 'text-yellow-400' :
                          'text-gray-400'
                        }>
                          {evt.title}
                        </span>
                        {evt.duration_ms ? (
                          <span className="text-gray-500">
                            {evt.duration_ms}ms
                          </span>
                        ) : null}
                        <span className="text-gray-600 truncate">
                          {evt.message}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Ungrouped events */}
      {ungroupedLogs.length > 0 && (
        <div className="mt-4">
          <span className="text-xs text-gray-500 font-semibold">
            Eventos Avulsos ({ungroupedLogs.length})
          </span>
          <div className="mt-1 space-y-0.5 max-h-40 overflow-auto">
            {ungroupedLogs.slice(-50).map((log) => (
              <div
                key={log.id}
                className="text-xs font-mono flex items-start gap-2"
              >
                <span className="text-gray-600 shrink-0">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
                <span className="text-gray-500">[{log.category}]</span>
                <span className="text-gray-400">{log.title}</span>
                <span className="text-gray-600 truncate">{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

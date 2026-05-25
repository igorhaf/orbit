/**
 * useAIFlowProgress — escuta o engine de execução (POST /api/v1/ai-flow/run)
 * via WebSocket e expõe estado por NODE_ID pra animar o canvas.
 *
 * Eventos esperados (payload do job_progress, ai_flow_event field):
 *   - graph_started:    {total_nodes}
 *   - node_started:     {node_id, kind}
 *   - node_completed:   {node_id, kind, duration_ms, output_keys}
 *   - node_skipped:     {node_id, kind, reason}
 *   - node_failed:      {node_id, kind, error}
 *   - graph_completed:  {ok, nodes_executed, nodes_failed, duration_seconds}
 *
 * Returns:
 *   nodeStates: { node_id: 'idle' | 'running' | 'success' | 'failed' | 'skipped' }
 *   activeJobId: string | null
 *   error: string | null
 *   flowingEdges: Set<string>  // edges com source/target em transição
 *   runProgress: number  // 0-100% baseado em (completed+skipped+failed)/total
 */
'use client';

import { useEffect, useState, useRef, useCallback } from 'react';

export type NodeRunState = 'idle' | 'running' | 'success' | 'failed' | 'skipped';

export interface AIFlowProgressState {
  nodeStates: Record<string, NodeRunState>;
  activeJobId: string | null;
  error: string | null;
  flowingEdges: Set<string>;
  runProgress: number;        // 0..1
  totalNodes: number;
  completedCount: number;
}

interface AIFlowEvent {
  ai_flow_event?: string;
  job_id?: string;
  run_id?: string;
  node_id?: string;
  kind?: string;
  total_nodes?: number;
  ok?: boolean;
  nodes_executed?: number;
  nodes_failed?: number;
  duration_seconds?: number;
  reason?: string;
  error?: string;
}

export function useAIFlowProgress(jobId: string | null): AIFlowProgressState {
  const [nodeStates, setNodeStates] = useState<Record<string, NodeRunState>>({});
  const [activeJobId, setActiveJobId] = useState<string | null>(jobId);
  const [error, setError] = useState<string | null>(null);
  const [flowingEdges, setFlowingEdges] = useState<Set<string>>(new Set());
  const [totalNodes, setTotalNodes] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);

  const currentJobIdRef = useRef<string | null>(jobId);

  // Reset quando jobId muda
  useEffect(() => {
    currentJobIdRef.current = jobId;
    setActiveJobId(jobId);
    if (!jobId) {
      setNodeStates({});
      setError(null);
      setFlowingEdges(new Set());
      setTotalNodes(0);
      setCompletedCount(0);
    }
  }, [jobId]);

  // Handler de event vindo do CustomEvent (NotificationContext rebroadcasta)
  const handleAIFlowEvent = useCallback((event: AIFlowEvent) => {
    const expectedJob = currentJobIdRef.current;
    if (expectedJob && event.job_id && event.job_id !== expectedJob) return;

    const evType = event.ai_flow_event;
    if (!evType) return;

    switch (evType) {
      case 'graph_started':
        if (event.total_nodes) setTotalNodes(event.total_nodes);
        setCompletedCount(0);
        setError(null);
        break;
      case 'node_started':
        if (event.node_id) {
          setNodeStates((s) => ({ ...s, [event.node_id!]: 'running' }));
        }
        break;
      case 'node_completed':
        if (event.node_id) {
          setNodeStates((s) => ({ ...s, [event.node_id!]: 'success' }));
          setCompletedCount((c) => c + 1);
        }
        break;
      case 'node_skipped':
        if (event.node_id) {
          setNodeStates((s) => ({ ...s, [event.node_id!]: 'skipped' }));
          setCompletedCount((c) => c + 1);
        }
        break;
      case 'node_failed':
        if (event.node_id) {
          setNodeStates((s) => ({ ...s, [event.node_id!]: 'failed' }));
          setCompletedCount((c) => c + 1);
        }
        if (event.error) setError(event.error);
        break;
      case 'graph_completed':
        if (!event.ok && event.nodes_failed && event.nodes_failed > 0 && !error) {
          setError(`${event.nodes_failed} nodes failed`);
        }
        break;
    }
  }, [error]);

  // Listen via window CustomEvent — NotificationContext republica
  // os events que vêm do WS `job_progress` quando `ai_flow_event` está presente.
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<AIFlowEvent>;
      if (ce.detail) handleAIFlowEvent(ce.detail);
    };
    window.addEventListener('aiFlowProgress', handler as EventListener);
    return () => window.removeEventListener('aiFlowProgress', handler as EventListener);
  }, [handleAIFlowEvent]);

  const runProgress = totalNodes > 0 ? completedCount / totalNodes : 0;

  return {
    nodeStates,
    activeJobId,
    error,
    flowingEdges,
    runProgress,
    totalNodes,
    completedCount,
  };
}

/**
 * usePipelineTelemetry — PROMPT #237 / #238
 * Real-time pipeline monitoring via /ws/console WebSocket channel.
 * Filters pipeline_activity events by project_id and maintains aggregated state.
 * Falls back to REST polling when WebSocket disconnects.
 * Recovers full state from Redis on mount and reconnect (PROMPT #238).
 */

import { useState, useEffect, useRef, useCallback } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const WS_URL = API_URL.replace('http', 'ws');

export interface PipelineActivity {
  timestamp: string;
  phase: string;
  action: string;
  itemName: string;
  itemIndex: number;
  itemTotal: number;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface PipelineTelemetry {
  status: 'idle' | 'running' | 'completed' | 'failed';
  currentPhase: string;
  currentAction: string;
  currentItem: string;
  itemsDone: number;
  itemsTotal: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  tokensPerSecond: number;
  phaseScores: Record<string, number>;
  modelActive: string;
  elapsedMs: number;
  activities: PipelineActivity[];
  isConnected: boolean;
}

const INITIAL_STATE: PipelineTelemetry = {
  status: 'idle',
  currentPhase: '',
  currentAction: '',
  currentItem: '',
  itemsDone: 0,
  itemsTotal: 0,
  tokensIn: 0,
  tokensOut: 0,
  costUsd: 0,
  tokensPerSecond: 0,
  phaseScores: {},
  modelActive: '',
  elapsedMs: 0,
  activities: [],
  isConnected: false,
};

export function usePipelineTelemetry(projectId: string | null): PipelineTelemetry {
  const [state, setState] = useState<PipelineTelemetry>(INITIAL_STATE);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);
  const tokenWindowRef = useRef<{ ts: number; tokens: number }[]>([]);

  const calcTokensPerSecond = useCallback((newTokens: number) => {
    const now = Date.now();
    tokenWindowRef.current.push({ ts: now, tokens: newTokens });
    // Keep last 10 seconds
    tokenWindowRef.current = tokenWindowRef.current.filter(e => now - e.ts < 10000);
    const windowMs = tokenWindowRef.current.length > 1
      ? now - tokenWindowRef.current[0].ts
      : 1000;
    const totalTokens = tokenWindowRef.current.reduce((s, e) => s + e.tokens, 0);
    return windowMs > 0 ? Math.round(totalTokens / (windowMs / 1000) * 10) / 10 : 0;
  }, []);

  // REST polling fallback + initial state recovery from Redis
  const pollLiveState = useCallback(async () => {
    if (!projectId) return;
    try {
      const resp = await fetch(`${API_URL}/api/v1/projects/${projectId}/rag/pipeline-live`);
      if (!resp.ok) return;
      const data = await resp.json();

      if (data.status === 'idle') return;

      // Initialize startTime from Redis (real elapsed time) or fallback
      if (data.started_at && !startTimeRef.current) {
        startTimeRef.current = parseInt(data.started_at, 10);
      } else if (!startTimeRef.current && data.status === 'running') {
        startTimeRef.current = Date.now();
      }

      setState(prev => ({
        ...prev,
        status: data.status || prev.status,
        currentPhase: data.current_phase || prev.currentPhase,
        currentAction: data.current_action || prev.currentAction,
        currentItem: data.current_item || prev.currentItem,
        itemsDone: parseInt(data.items_done || '0', 10),
        itemsTotal: parseInt(data.items_total || '0', 10),
        tokensIn: parseInt(data.tokens_in || '0', 10),
        tokensOut: parseInt(data.tokens_out || '0', 10),
        costUsd: parseFloat(data.cost_usd || '0'),
        modelActive: data.model_active || prev.modelActive,
        phaseScores: data.phase_scores || prev.phaseScores,
        elapsedMs: startTimeRef.current ? Date.now() - startTimeRef.current : 0,
      }));
    } catch {
      // ignore
    }
  }, [projectId]);

  // WebSocket connection
  const connect = useCallback(() => {
    if (!projectId) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(`${WS_URL}/api/v1/ws/console`);
      wsRef.current = ws;

      ws.onopen = () => {
        setState(prev => ({ ...prev, isConnected: true }));
        // Clear polling fallback
        if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
        // Catch-up: recover current state from Redis on reconnect
        pollLiveState();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.event !== 'console_log') return;

          const data = msg.data;
          // Only process pipeline_activity events for our project
          if (data.category !== 'pipeline_activity') return;
          if (data.project_id && data.project_id !== projectId) return;

          const details = data.details || {};

          if (!startTimeRef.current) {
            startTimeRef.current = Date.now();
          }

          const inputTokens = data.input_tokens || 0;
          const outputTokens = data.output_tokens || 0;
          const tps = calcTokensPerSecond(inputTokens + outputTokens);

          const activity: PipelineActivity = {
            timestamp: data.timestamp,
            phase: details.phase || '',
            action: details.action || '',
            itemName: details.item_name || '',
            itemIndex: details.item_index || 0,
            itemTotal: details.item_total || 0,
            modelName: data.model_name || '',
            inputTokens,
            outputTokens,
            costUsd: data.cost_usd || 0,
          };

          setState(prev => ({
            ...prev,
            status: 'running',
            currentPhase: details.phase || prev.currentPhase,
            currentAction: details.action || prev.currentAction,
            currentItem: details.item_name || prev.currentItem,
            itemsDone: details.item_index || prev.itemsDone,
            itemsTotal: details.item_total || prev.itemsTotal,
            tokensIn: details.cumulative_tokens_in ?? prev.tokensIn,
            tokensOut: details.cumulative_tokens_out ?? prev.tokensOut,
            costUsd: details.cumulative_cost ?? prev.costUsd,
            tokensPerSecond: tps,
            phaseScores: details.phase_scores || prev.phaseScores,
            modelActive: data.model_name || prev.modelActive,
            elapsedMs: Date.now() - startTimeRef.current,
            activities: [activity, ...prev.activities].slice(0, 100),
            isConnected: true,
          }));
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        setState(prev => ({ ...prev, isConnected: false }));
        // Start polling fallback
        if (!pollTimerRef.current && projectId) {
          pollTimerRef.current = setInterval(() => pollLiveState(), 3000);
        }
        // Reconnect after 2s
        reconnectTimerRef.current = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // Fallback to polling
      if (!pollTimerRef.current && projectId) {
        pollTimerRef.current = setInterval(() => pollLiveState(), 3000);
      }
    }
  }, [projectId, calcTokensPerSecond, pollLiveState]);

  useEffect(() => {
    if (!projectId) {
      setState(INITIAL_STATE);
      return;
    }

    startTimeRef.current = 0;
    tokenWindowRef.current = [];
    pollLiveState();   // Hydrate immediately from Redis live state
    connect();         // Then connect WebSocket for streaming updates

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [projectId, connect, pollLiveState]);

  return state;
}

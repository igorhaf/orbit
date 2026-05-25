/**
 * useDeepPipelineProgress — watch a running Deep Pipeline job over WebSocket
 * and expose per-phase state for canvas animation.
 *
 * v3.1 — Listens to `quotaChanged`/`job_progress` events surfaced by
 * NotificationContext (via window CustomEvent `deepPipelineProgress`) OR
 * falls back to polling /api/v1/projects/{projectId}/rag/deep-pipeline/status.
 *
 * Returns:
 *   phaseStates: { phase_0: 'idle' | 'running' | 'success' | 'failed', ... }
 *   activeJobId: string | null
 *   error: string | null
 *   flowingEdges: Set<string>  // edges currently animated (between completed
 *                              // phase and next-up phase)
 */
'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useNotifications } from '@/contexts/NotificationContext';

export type PhaseState = 'idle' | 'running' | 'success' | 'failed';

export interface DeepPipelineProgressState {
  phaseStates: Record<string, PhaseState>;
  activeJobId: string | null;
  error: string | null;
  flowingEdges: Set<string>;
  // Ordered list of phases to walk forward
  phaseOrder: string[];
}

const DEFAULT_PHASE_ORDER = [
  'phase_0', 'phase_1', 'phase_2', 'phase_3',
  'phase_4a', 'phase_4b', 'phase_4c',
  'phase_5', 'phase_6',
];

function emptyStates(order: string[]): Record<string, PhaseState> {
  const s: Record<string, PhaseState> = {};
  order.forEach((p) => { s[p] = 'idle'; });
  return s;
}

export function useDeepPipelineProgress(
  projectId: string | null,
  phaseOrder: string[] = DEFAULT_PHASE_ORDER,
): DeepPipelineProgressState {
  const { activeJobs, notifications } = useNotifications();
  const [phaseStates, setPhaseStates] = useState<Record<string, PhaseState>>(() => emptyStates(phaseOrder));
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flowingEdges, setFlowingEdges] = useState<Set<string>>(new Set());

  // Track the currently-active deep_pipeline job (latest)
  const currentJobIdRef = useRef<string | null>(null);

  // Reset when projectId changes
  useEffect(() => {
    setPhaseStates(emptyStates(phaseOrder));
    setActiveJobId(null);
    setError(null);
    setFlowingEdges(new Set());
    currentJobIdRef.current = null;
  }, [projectId, phaseOrder.join(',')]);

  // Listen to the WS events surfaced by NotificationContext via CustomEvent.
  // The notification context already broadcasts job_progress; we hook into the
  // raw event window listener it dispatches (we'll add a tiny custom event there).
  useEffect(() => {
    if (!projectId) return;

    const handler = (ev: Event) => {
      const e = ev as CustomEvent;
      const data = e.detail || {};
      if (data.job_type !== 'deep_pipeline') return;
      if (data.project_id && data.project_id !== projectId) return;
      // Track the active job
      if (data.job_id && currentJobIdRef.current !== data.job_id) {
        currentJobIdRef.current = data.job_id;
        setActiveJobId(data.job_id);
      }

      // Update phase state if we have phase_key + phase_status
      const phaseKey: string | undefined = data.phase_key;
      const phaseStatus: string | undefined = data.phase_status;
      if (phaseKey && phaseOrder.includes(phaseKey)) {
        setPhaseStates((prev) => {
          const next = { ...prev };
          // When a phase starts, mark prior phases as success
          const idx = phaseOrder.indexOf(phaseKey);
          for (let i = 0; i < idx; i++) {
            if (next[phaseOrder[i]] === 'idle' || next[phaseOrder[i]] === 'running') {
              next[phaseOrder[i]] = 'success';
            }
          }
          if (phaseStatus === 'completed') {
            next[phaseKey] = 'success';
          } else if (phaseStatus === 'failed') {
            next[phaseKey] = 'failed';
          } else {
            next[phaseKey] = 'running';
          }
          return next;
        });
        // Animate the incoming edge (prev phase → this phase) when transition occurs
        const incomingIdx = phaseOrder.indexOf(phaseKey);
        if (incomingIdx > 0) {
          const prevKey = phaseOrder[incomingIdx - 1];
          const edgeId = `edge-phase-${prevKey}-${phaseKey}`;
          setFlowingEdges((prev) => new Set([...prev, edgeId]));
          // Stop animating after a beat
          setTimeout(() => {
            setFlowingEdges((prev) => {
              const next = new Set(prev);
              next.delete(edgeId);
              return next;
            });
          }, 2000);
        }
      }
    };

    window.addEventListener('deepPipelineProgress', handler as EventListener);
    return () => window.removeEventListener('deepPipelineProgress', handler as EventListener);
  }, [projectId, phaseOrder]);

  // When job_completed/failed reaches us (via NotificationContext notifications)
  useEffect(() => {
    if (!projectId || !activeJobId) return;
    const lastNotif = notifications.find((n: any) => n.jobId === activeJobId);
    if (!lastNotif) return;
    if (lastNotif.status === 'completed') {
      setPhaseStates((prev) => {
        const next = { ...prev };
        for (const p of phaseOrder) {
          if (next[p] === 'idle' || next[p] === 'running') next[p] = 'success';
        }
        return next;
      });
    } else if (lastNotif.status === 'failed') {
      setPhaseStates((prev) => {
        const next = { ...prev };
        let foundRunning = false;
        for (const p of phaseOrder) {
          if (next[p] === 'running') { next[p] = 'failed'; foundRunning = true; break; }
        }
        if (!foundRunning) {
          // Mark last non-idle as failed
          for (let i = phaseOrder.length - 1; i >= 0; i--) {
            if (next[phaseOrder[i]] !== 'idle') { next[phaseOrder[i]] = 'failed'; break; }
          }
        }
        return next;
      });
      setError(lastNotif.title || 'Pipeline failed');
    }
  }, [notifications, activeJobId, projectId, phaseOrder]);

  // Detect an in-progress job from activeJobs (initial mount)
  useEffect(() => {
    if (!projectId || activeJobId) return;
    const dp = (activeJobs as any[]).find((j: any) =>
      (j.jobType === 'deep_pipeline' || j.job_type === 'deep_pipeline'),
    );
    if (dp) {
      currentJobIdRef.current = dp.id || dp.job_id;
      setActiveJobId(dp.id || dp.job_id);
    }
  }, [activeJobs, projectId, activeJobId]);

  return { phaseStates, activeJobId, error, flowingEdges, phaseOrder };
}

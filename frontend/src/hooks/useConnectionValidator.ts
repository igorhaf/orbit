/**
 * useConnectionValidator — typed-connection guardrail for the unified
 * AI Studio canvas (v3.0).
 *
 * Wraps ReactFlow's onConnect handler so we can reject invalid edges
 * (e.g. pipeline_phase → utility_node) before they reach state.
 * Returns a tuple of (handler, lastRejection) so the page can surface
 * a toast/tooltip when a connection is rejected.
 */
'use client';

import { useCallback, useState } from 'react';
import type { Node, Edge, Connection } from '@xyflow/react';
import { addEdge, MarkerType } from '@xyflow/react';
import { validateConnection } from '@/components/ai-flow/flowUtils';

export interface ConnectionRejection {
  reason: string;
  source: string;
  target: string;
  at: number;
}

export interface UseConnectionValidatorResult {
  onConnect: (connection: Connection) => void;
  lastRejection: ConnectionRejection | null;
  clearRejection: () => void;
}

export function useConnectionValidator(
  nodes: Node[],
  setEdges: (updater: (edges: Edge[]) => Edge[]) => void,
  onAccept?: () => void,
): UseConnectionValidatorResult {
  const [lastRejection, setLastRejection] = useState<ConnectionRejection | null>(null);

  const onConnect = useCallback(
    (connection: Connection) => {
      const source = nodes.find((n) => n.id === connection.source);
      const target = nodes.find((n) => n.id === connection.target);
      const result = validateConnection(source, target);
      if (!result.ok) {
        setLastRejection({
          reason: result.reason || 'conexão inválida',
          source: connection.source || '?',
          target: connection.target || '?',
          at: Date.now(),
        });
        return;
      }
      const color = result.edgeColor || '#94a3b8';
      setEdges((eds: Edge[]) =>
        addEdge(
          {
            ...connection,
            type: 'smartEdge',
            style: { stroke: color, strokeWidth: 1.8 },
            markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
          } as Edge,
          eds,
        ),
      );
      onAccept?.();
    },
    [nodes, setEdges, onAccept],
  );

  const clearRejection = useCallback(() => setLastRejection(null), []);

  return { onConnect, lastRejection, clearRejection };
}

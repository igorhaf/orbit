/**
 * useConnectionValidator — typed-connection guardrail for the unified
 * AI Studio canvas.
 *
 * v3.5: além da matriz category-based legada (modelNode → utilityNode, etc.),
 * agora checa COMPATIBILIDADE DE TIPO por handle: o output.type do source
 * tem que matchear o input.type do target (ou `Any` em qualquer lado).
 * Quando a conexão é num handle específico (multi-handle control flow node),
 * o type do handle específico é usado.
 *
 * Wraps ReactFlow's onConnect handler so we can reject invalid edges
 * before they reach state. Returns a tuple of (handler, lastRejection) so
 * the page can surface a toast/tooltip when rejected.
 */
'use client';

import { useCallback, useState } from 'react';
import type { Node, Edge, Connection } from '@xyflow/react';
import { addEdge, MarkerType } from '@xyflow/react';
import { validateConnection } from '@/components/ai-flow/flowUtils';
import { schemaFor, typesCompatible, type NodeSchema } from '@/components/ai-flow/flowTypes';

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

/**
 * Resolve the type of a specific handle (output or input) on a node. Looks
 * first at node.data.outputs/inputs (when the template injected it), then
 * at the global types_schema map.
 */
function handleType(
  node: Node | undefined,
  side: 'source' | 'target',
  handleId: string | null | undefined,
  schemas: Record<string, NodeSchema> | undefined,
): string | null {
  if (!node) return null;
  const portList = side === 'source'
    ? ((node.data as any)?.outputs as Array<{ name: string; type: string }> | undefined)
    : ((node.data as any)?.inputs as Array<{ name: string; type: string }> | undefined);
  if (portList && portList.length > 0) {
    const port = handleId ? portList.find((p) => p.name === handleId) : portList[0];
    if (port) return port.type;
  }
  // Fallback to types_schema by kind
  const schema = schemaFor(node, schemas);
  if (!schema) return null;
  const ports = side === 'source' ? schema.outputs : schema.inputs;
  if (!ports || ports.length === 0) return null;
  const port = handleId ? ports.find((p) => p.name === handleId) : ports[0];
  return port ? port.type : null;
}

export function useConnectionValidator(
  nodes: Node[],
  setEdges: (updater: (edges: Edge[]) => Edge[]) => void,
  onAccept?: () => void,
  typesSchema?: Record<string, NodeSchema>,
): UseConnectionValidatorResult {
  const [lastRejection, setLastRejection] = useState<ConnectionRejection | null>(null);

  const onConnect = useCallback(
    (connection: Connection) => {
      const source = nodes.find((n) => n.id === connection.source);
      const target = nodes.find((n) => n.id === connection.target);

      // 1) Category-based check (legacy ALLOWED_CONNECTIONS)
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

      // 2) v3.5 — type compatibility per handle
      if (typesSchema) {
        const sourceType = handleType(source, 'source', connection.sourceHandle, typesSchema);
        const targetType = handleType(target, 'target', connection.targetHandle, typesSchema);
        if (sourceType && targetType && !typesCompatible(sourceType, targetType)) {
          setLastRejection({
            reason: `tipo incompatível: ${sourceType} → ${targetType}`,
            source: connection.source || '?',
            target: connection.target || '?',
            at: Date.now(),
          });
          return;
        }
      }

      // v3.5.4: unifica cor das edges criadas pelo usuário com as edges
      // geradas pelo backend (snapshot) — sempre azul #3b82f6, mesmo estilo.
      // PORT_TYPE_COLORS continua existindo pra labels/decorações em casos
      // especiais, mas a cor da seta segue o padrão visual do canvas.
      const color = '#3b82f6';
      setEdges((eds: Edge[]) =>
        addEdge(
          {
            ...connection,
            type: 'smartEdge',
            style: { stroke: color, strokeWidth: 1.8 },
            markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
            data: { port_type: 'user_connection', planned: false },
          } as Edge,
          eds,
        ),
      );
      onAccept?.();
    },
    [nodes, setEdges, onAccept, typesSchema],
  );

  const clearRejection = useCallback(() => setLastRejection(null), []);

  return { onConnect, lastRejection, clearRejection };
}

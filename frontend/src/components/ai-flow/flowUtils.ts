/**
 * AI Flow Utility Functions
 * PROMPT #225 - Pipeline classification & edge helper
 * PROMPT #122 - Build ReactFlow nodes & edges from chain
 *
 * Pure logic functions for building the flow diagram.
 */

import { MarkerType, type Node, type Edge } from '@xyflow/react';
import {
  UTILITY_NODE_COLORS,
  UTILITY_TYPE_TO_NODE_TYPE,
  PRE_PROCESS_TYPES,
  POST_PROCESS_TYPES,
  ALLOWED_CONNECTIONS,
  NODE_TYPE_TO_CATEGORY,
  PORT_TYPE_COLORS,
  type CanvasNodeCategory,
} from './FlowConstants';
import type { NodeAnimationState } from './FlowNodes';
import type { AIFlowChainModel, AIFlowUtilityNode } from '@/lib/types';

// v3.0: ModelOverrides moved inline (was in deleted EditModelNodeDialog)
export interface ModelOverrides {
  temperature?: number | null;
  max_tokens?: number | null;
  timeout_seconds?: number | null;
  max_concurrent_requests?: number | null;
}

// ---------------------------------------------------------------------------
// PROMPT #225 - Edge property computation
// ---------------------------------------------------------------------------

export interface EdgeProps {
  label: string;
  color: string;
  strokeWidth: number;
  dashed: boolean;
  animated: boolean;
}

export function computeEdgeProps(
  sourceId: string,
  targetId: string,
  chainModels: AIFlowChainModel[],
  preNodes: AIFlowUtilityNode[],
  postNodes: AIFlowUtilityNode[],
  animationsMap?: Record<string, NodeAnimationState>,
): EdgeProps {
  const isSourceModel = sourceId.startsWith('model-');
  const isTargetModel = targetId.startsWith('model-');
  const firstModelId = chainModels.length > 0 ? `model-${chainModels[0].id}` : null;
  const lastModelId = chainModels.length > 0 ? `model-${chainModels[chainModels.length - 1].id}` : null;
  const allUtility = [...preNodes, ...postNodes];
  const targetUtility = allUtility.find((n) => n.id === targetId);
  const isAnimating = animationsMap?.[targetId] === 'executing';

  // Edge going TO the first model (the "try" edge)
  if (targetId === firstModelId && !isSourceModel) {
    return { label: 'tentar', color: '#3b82f6', strokeWidth: isAnimating ? 3 : 2, dashed: false, animated: true };
  }

  // Model-to-model fallback
  if (isSourceModel && isTargetModel) {
    return { label: 'fallback', color: isAnimating ? '#3b82f6' : '#f59e0b', strokeWidth: isAnimating ? 3 : 2, dashed: false, animated: true };
  }

  // Last model -> first post-process or response
  if (sourceId === lastModelId && !isTargetModel && targetId !== 'error') {
    if (targetId === 'response') {
      return { label: 'sucesso', color: '#22c55e', strokeWidth: 2, dashed: false, animated: false };
    }
    const utilColor = targetUtility ? (UTILITY_NODE_COLORS[targetUtility.type] || '#6b7280') : '#22c55e';
    return { label: targetUtility ? targetUtility.type.replace(/_/g, ' ') : 'processar', color: utilColor, strokeWidth: 1.5, dashed: false, animated: false };
  }

  // Any node -> Response (final edge)
  if (targetId === 'response') {
    return { label: 'concluido', color: '#22c55e', strokeWidth: 2, dashed: false, animated: false };
  }

  // Utility-to-utility or start-to-utility edges
  if (targetUtility) {
    const utilColor = UTILITY_NODE_COLORS[targetUtility.type] || '#6b7280';
    return { label: targetUtility.type.replace(/_/g, ' '), color: utilColor, strokeWidth: 1.5, dashed: false, animated: false };
  }

  // Fallback
  return { label: '', color: '#6b7280', strokeWidth: 1.5, dashed: false, animated: false };
}

// ---------------------------------------------------------------------------
// Build ReactFlow nodes & edges from chain
// ---------------------------------------------------------------------------

export function buildFlowFromChain(
  chainModels: AIFlowChainModel[],
  savedPositions?: Record<string, { x: number; y: number }> | null,
  onRemove?: (modelId: string) => void,
  metricsMap?: Record<string, any>,
  animationsMap?: Record<string, NodeAnimationState>,
  utilityNodes?: AIFlowUtilityNode[],
  onRemoveUtility?: (nodeId: string) => void,
  modelOverridesMap?: Record<string, ModelOverrides>,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Layout constants
  const MODEL_SPACING_X = 300;
  const UTILITY_SPACING_X = 230;
  const ERROR_Y_OFFSET = 200;
  const MAIN_Y = 150;

  let cursorX = 50;

  // --- Classify utility nodes into pre/post-process ---
  const preNodes: AIFlowUtilityNode[] = [];
  const postNodes: AIFlowUtilityNode[] = [];
  if (utilityNodes) {
    for (const uNode of utilityNodes) {
      if (!UTILITY_TYPE_TO_NODE_TYPE[uNode.type]) continue;
      if (PRE_PROCESS_TYPES.includes(uNode.type)) preNodes.push(uNode);
      else if (POST_PROCESS_TYPES.includes(uNode.type)) postNodes.push(uNode);
    }
  }

  // --- 1. Start node (blue circle) ---
  const startPos = savedPositions?.['start'] || { x: cursorX, y: MAIN_Y };
  nodes.push({
    id: 'start',
    type: 'input',
    data: { label: 'Requisição' },
    position: startPos,
    style: {
      background: '#3b82f6',
      color: 'white',
      borderRadius: '50%',
      width: 80,
      height: 80,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 700,
      fontSize: '13px',
      border: 'none',
    },
  });
  cursorX += preNodes.length > 0 ? UTILITY_SPACING_X : MODEL_SPACING_X;

  // --- 2. Pre-process utility nodes ---
  for (const uNode of preNodes) {
    const rfNodeType = UTILITY_TYPE_TO_NODE_TYPE[uNode.type];
    const defaultPos = { x: cursorX, y: MAIN_Y - 10 };
    const pos = savedPositions?.[uNode.id] || uNode.position || defaultPos;
    nodes.push({
      id: uNode.id,
      type: rfNodeType,
      data: {
        ...uNode,
        onRemove: onRemoveUtility ? () => onRemoveUtility(uNode.id) : undefined,
      },
      position: pos,
    });
    cursorX += UTILITY_SPACING_X;
  }

  if (preNodes.length > 0 && chainModels.length > 0) {
    cursorX += 40;
  }

  // --- 3. Model nodes ---
  let lastModelNodeX = cursorX;
  chainModels.forEach((model, index) => {
    const nodeId = `model-${model.id}`;
    const defaultPos = { x: cursorX, y: MAIN_Y - 20 };
    const pos = savedPositions?.[nodeId] || defaultPos;
    const overrides = modelOverridesMap?.[model.id];
    nodes.push({
      id: nodeId,
      type: 'modelNode',
      data: {
        ...model,
        position_label: index === 0 ? 'Primário' : `Fallback ${index}`,
        onRemove: onRemove ? () => onRemove(model.id) : undefined,
        metrics: metricsMap?.[model.id],
        animation: animationsMap?.[nodeId] || 'idle',
        hasOverrides: overrides && (overrides.temperature != null || overrides.max_tokens != null || overrides.timeout_seconds != null || overrides.max_concurrent_requests != null),
      },
      position: pos,
    });
    lastModelNodeX = cursorX;
    cursorX += MODEL_SPACING_X;
  });

  if (chainModels.length > 0 && postNodes.length > 0) {
    cursorX += 40;
  }

  // --- 4. Post-process utility nodes ---
  for (const uNode of postNodes) {
    const rfNodeType = UTILITY_TYPE_TO_NODE_TYPE[uNode.type];
    const defaultPos = { x: cursorX, y: MAIN_Y - 10 };
    const pos = savedPositions?.[uNode.id] || uNode.position || defaultPos;
    nodes.push({
      id: uNode.id,
      type: rfNodeType,
      data: {
        ...uNode,
        onRemove: onRemoveUtility ? () => onRemoveUtility(uNode.id) : undefined,
      },
      position: pos,
    });
    cursorX += UTILITY_SPACING_X;
  }

  // --- 5. Response node (green circle) ---
  const responsePos = savedPositions?.['response'] || { x: cursorX, y: MAIN_Y };
  nodes.push({
    id: 'response',
    type: 'output',
    data: { label: 'Resposta' },
    position: responsePos,
    style: {
      background: '#22c55e',
      color: 'white',
      borderRadius: '50%',
      width: 80,
      height: 80,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 700,
      fontSize: '13px',
      border: 'none',
    },
  });

  // --- 6. Error node (below the model chain, only when models exist) ---
  if (chainModels.length > 0) {
    const errorDefaultPos = { x: lastModelNodeX, y: MAIN_Y + ERROR_Y_OFFSET };
    const errorPos = savedPositions?.['error'] || errorDefaultPos;
    nodes.push({
      id: 'error',
      type: 'output',
      data: { label: 'Erro' },
      position: errorPos,
      style: {
        background: '#ef4444',
        color: 'white',
        borderRadius: '8px',
        width: 80,
        height: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: '13px',
        border: 'none',
      },
    });
  }

  // --- 7. Build pipeline edges (smart routing with collision avoidance) ---
  const pipeline: string[] = ['start'];
  preNodes.forEach((n) => pipeline.push(n.id));
  chainModels.forEach((m) => pipeline.push(`model-${m.id}`));
  postNodes.forEach((n) => pipeline.push(n.id));
  pipeline.push('response');

  // Set of custom node IDs (have named handles left/right)
  const customNodeIds = new Set<string>();
  preNodes.forEach((n) => customNodeIds.add(n.id));
  postNodes.forEach((n) => customNodeIds.add(n.id));
  chainModels.forEach((m) => customNodeIds.add(`model-${m.id}`));

  for (let i = 0; i < pipeline.length - 1; i++) {
    const sourceId = pipeline[i];
    const targetId = pipeline[i + 1];
    const props = computeEdgeProps(sourceId, targetId, chainModels, preNodes, postNodes, animationsMap);

    // Magnetic handle direction: always exit right, enter left for custom nodes
    const sourceHasHandles = customNodeIds.has(sourceId);
    const targetHasHandles = customNodeIds.has(targetId);

    edges.push({
      id: `edge-${sourceId}-${targetId}`,
      source: sourceId,
      target: targetId,
      sourceHandle: sourceHasHandles ? 'right' : undefined,
      targetHandle: targetHasHandles ? 'left' : undefined,
      type: 'smartEdge',
      label: props.label,
      labelStyle: {
        fontSize: (props.label === 'tentar' || props.label === 'fallback') ? 11 : 9,
        fontWeight: (props.label === 'tentar' || props.label === 'fallback') ? 600 : 500,
      },
      labelBgStyle: { fill: 'white', fillOpacity: 0.9 },
      animated: props.animated,
      style: {
        stroke: props.color,
        strokeWidth: props.strokeWidth,
        ...(props.dashed ? { strokeDasharray: '4,4' } : {}),
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: props.color, width: 16, height: 16 },
    } as Edge);
  }

  // --- 9. "All failed" edge from last model to Error (smart routing) ---
  if (chainModels.length > 0) {
    const lastModelId = `model-${chainModels[chainModels.length - 1].id}`;
    edges.push({
      id: `edge-${lastModelId}-error`,
      source: lastModelId,
      target: 'error',
      sourceHandle: 'bottom',
      type: 'smartEdge',
      label: 'todos falharam',
      labelStyle: { fontSize: 10, fontWeight: 500 },
      labelBgStyle: { fill: 'white', fillOpacity: 0.9 },
      style: { stroke: '#ef4444', strokeWidth: 1.5, strokeDasharray: '5,5' },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#ef4444', width: 14, height: 14 },
      animated: false,
    } as Edge);
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// v3.0 — Typed connection validation for the unified canvas
// ---------------------------------------------------------------------------

/** Resolve a node's canvas category from its ReactFlow type (or fallback). */
export function categoryOf(node: Node | undefined | null): CanvasNodeCategory | null {
  if (!node || !node.type) return null;
  return NODE_TYPE_TO_CATEGORY[node.type] ?? null;
}

export interface ConnectionValidation {
  ok: boolean;
  reason?: string;
  edgeColor?: string;
}

/**
 * Validate a proposed connection against the ALLOWED_CONNECTIONS matrix.
 *
 * @param source The source node (where the edge starts)
 * @param target The target node (where the edge ends)
 */
export function validateConnection(
  source: Node | undefined | null,
  target: Node | undefined | null,
): ConnectionValidation {
  const srcCat = categoryOf(source);
  const tgtCat = categoryOf(target);
  if (!srcCat || !tgtCat) {
    return { ok: false, reason: 'tipo de node desconhecido' };
  }
  if (source?.id === target?.id) {
    return { ok: false, reason: 'não pode conectar um node a ele mesmo' };
  }
  const allowed = ALLOWED_CONNECTIONS[srcCat] || [];
  if (!allowed.includes(tgtCat)) {
    return {
      ok: false,
      reason: `${srcCat} → ${tgtCat} não é permitido`,
    };
  }
  const key = `${srcCat}->${tgtCat}`;
  return {
    ok: true,
    edgeColor: PORT_TYPE_COLORS[key] ?? PORT_TYPE_COLORS.default,
  };
}

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
} from './FlowConstants';
import type { NodeAnimationState } from './FlowNodes';
import type { AIFlowChainModel, AIFlowUtilityNode } from '@/lib/types';
import type { ModelOverrides } from './EditModelNodeDialog';

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

// PROMPT #257 - Contract data shape for flow positioning
export interface FlowContract {
  id: string;
  name: string;
  domain: string;
  version: number;
  description: string;
  system_prompt?: string;
  user_prompt?: string;
  usage_type?: string;
}

export function buildFlowFromChain(
  chainModels: AIFlowChainModel[],
  savedPositions?: Record<string, { x: number; y: number }> | null,
  onRemove?: (modelId: string) => void,
  metricsMap?: Record<string, any>,
  animationsMap?: Record<string, NodeAnimationState>,
  utilityNodes?: AIFlowUtilityNode[],
  onRemoveUtility?: (nodeId: string) => void,
  modelOverridesMap?: Record<string, ModelOverrides>,
  contracts?: FlowContract[],
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // PROMPT #225 - Linear pipeline layout constants
  const MODEL_SPACING_X = 300;
  const UTILITY_SPACING_X = 230;
  const CONTRACT_SPACING_Y = 120;
  const CONTRACT_COLUMN_X = 50;
  const MAIN_Y = 150;
  const ERROR_Y_OFFSET = 200;

  // --- PROMPT #257 - Contract nodes (column to the left of start) ---
  const hasContracts = contracts && contracts.length > 0;
  const START_X = hasContracts ? CONTRACT_COLUMN_X + 280 : 50;

  if (hasContracts) {
    const contractStartY = Math.max(0, MAIN_Y - ((contracts.length - 1) * CONTRACT_SPACING_Y) / 2);
    contracts.forEach((contract, index) => {
      const nodeId = `contract-${contract.id}`;
      const defaultPos = { x: CONTRACT_COLUMN_X, y: contractStartY + index * CONTRACT_SPACING_Y };
      const pos = savedPositions?.[nodeId] || defaultPos;
      const shortName = contract.name.includes('/') ? contract.name.split('/').pop() : contract.name;
      nodes.push({
        id: nodeId,
        type: 'contractNode',
        data: {
          ...contract,
          label: shortName,
          hasPrompt: !!(contract.system_prompt || contract.user_prompt),
        },
        position: pos,
      });
    });
  }

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

  let cursorX = START_X;

  // --- 1. Start node (blue circle) ---
  // Use 'default' type when contracts are present so start has a target handle
  const startPos = savedPositions?.['start'] || { x: cursorX, y: MAIN_Y };
  nodes.push({
    id: 'start',
    type: hasContracts ? 'default' : 'input',
    data: { label: 'Requisicao' },
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

  // Extra gap between pre-process and models for visual separation
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
        position_label: index === 0 ? 'Primario' : `Fallback ${index}`,
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

  // Extra gap between models and post-process
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

  // --- 7. Build pipeline edges (linear chain) ---
  const pipeline: string[] = ['start'];
  preNodes.forEach((n) => pipeline.push(n.id));
  chainModels.forEach((m) => pipeline.push(`model-${m.id}`));
  postNodes.forEach((n) => pipeline.push(n.id));
  pipeline.push('response');

  for (let i = 0; i < pipeline.length - 1; i++) {
    const sourceId = pipeline[i];
    const targetId = pipeline[i + 1];
    const props = computeEdgeProps(sourceId, targetId, chainModels, preNodes, postNodes, animationsMap);

    edges.push({
      id: `edge-${sourceId}-${targetId}`,
      source: sourceId,
      target: targetId,
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
      markerEnd: { type: MarkerType.ArrowClosed, color: props.color },
    });
  }

  // --- PROMPT #257 - Contract → Start edges ---
  if (hasContracts) {
    const contractColor = '#0d9488'; // teal
    contracts.forEach((contract) => {
      const nodeId = `contract-${contract.id}`;
      edges.push({
        id: `edge-${nodeId}-start`,
        source: nodeId,
        target: 'start',
        label: '',
        style: { stroke: contractColor, strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: contractColor },
        animated: false,
      });
    });
  }

  // --- 8. "All failed" edge from last model to Error ---
  if (chainModels.length > 0) {
    const lastModelId = `model-${chainModels[chainModels.length - 1].id}`;
    edges.push({
      id: `edge-${lastModelId}-error`,
      source: lastModelId,
      target: 'error',
      label: 'todos falharam',
      labelStyle: { fontSize: 10, fontWeight: 500 },
      labelBgStyle: { fill: 'white', fillOpacity: 0.9 },
      style: { stroke: '#ef4444', strokeWidth: 1.5, strokeDasharray: '5,5' },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#ef4444' },
      animated: false,
    });
  }

  return { nodes, edges };
}

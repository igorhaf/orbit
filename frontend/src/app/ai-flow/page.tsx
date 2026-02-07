/**
 * AI Flow Page
 * PROMPT #122 - Visual Fallback Chain Configuration
 *
 * n8n-style flow diagram for configuring per-operation AI model fallback chains.
 * Uses @xyflow/react for the node-based visualization.
 *
 * Flow: select operation → canvas shows saved chain (or empty) → add/remove/reorder
 * models from sidebar → Save.
 */

'use client';

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  MarkerType,
  reconnectEdge,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type OnReconnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { Layout, Breadcrumbs } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { aiModelsApi, aiFlowApi } from '@/lib/api';
import { useNotification } from '@/hooks';
import type { AIModel, AIFlowChain, AIFlowChainModel } from '@/lib/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const USAGE_TYPE_OPTIONS = [
  { value: 'interview', label: 'Interview' },
  { value: 'task_execution', label: 'Task Execution' },
  { value: 'prompt_generation', label: 'Prompt Generation' },
  { value: 'commit_generation', label: 'Commit Generation' },
  { value: 'pattern_discovery', label: 'Pattern Discovery' },
  { value: 'memory', label: 'Memory (Codebase Scan)' },
  { value: 'general', label: 'General' },
];

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#9333ea',
  openai: '#16a34a',
  google: '#2563eb',
  ollama: '#ea580c',
  cohere: '#e11d48',
};

const PROVIDER_BG: Record<string, string> = {
  anthropic: 'bg-purple-50 border-purple-200',
  openai: 'bg-green-50 border-green-200',
  google: 'bg-blue-50 border-blue-200',
  ollama: 'bg-orange-50 border-orange-200',
  cohere: 'bg-rose-50 border-rose-200',
};

// ---------------------------------------------------------------------------
// Provider Icon
// ---------------------------------------------------------------------------

function ProviderIcon({ provider, size = 'w-5 h-5' }: { provider: string; size?: string }) {
  const color = PROVIDER_COLORS[provider.toLowerCase()] || '#6b7280';
  switch (provider.toLowerCase()) {
    case 'anthropic':
      return (
        <svg className={size} style={{ color }} fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z" />
        </svg>
      );
    case 'openai':
      return (
        <svg className={size} style={{ color }} fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" />
        </svg>
      );
    case 'google':
      return (
        <svg className={size} style={{ color }} fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
        </svg>
      );
    case 'ollama':
      return (
        <svg className={size} style={{ color }} fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
        </svg>
      );
    case 'cohere':
      return (
        <svg className={size} style={{ color }} fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" />
        </svg>
      );
    default:
      return (
        <svg className={size} style={{ color: '#6b7280' }} fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z" />
        </svg>
      );
  }
}

// ---------------------------------------------------------------------------
// Custom ReactFlow Node: ModelNode
// ---------------------------------------------------------------------------

function ModelNode({ data }: { data: any }) {
  const providerColor = PROVIDER_COLORS[data.provider?.toLowerCase()] || '#6b7280';

  return (
    <div
      className="bg-white rounded-lg shadow-md border-2 min-w-[200px] relative cursor-grab active:cursor-grabbing hover:shadow-lg transition-shadow"
      style={{ borderLeftColor: providerColor, borderLeftWidth: '4px', borderTopColor: '#e5e7eb', borderRightColor: '#e5e7eb', borderBottomColor: '#e5e7eb' }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-blue-500 hover:!w-4 hover:!h-4 transition-all"
      />

      <div className="px-4 py-3">
        <div className="flex items-center gap-3">
          <ProviderIcon provider={data.provider || 'unknown'} />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-gray-900 truncate">{data.name}</div>
            <div className="text-xs text-gray-500 capitalize">{data.provider}</div>
          </div>
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${data.is_active ? 'bg-green-500' : 'bg-gray-400'}`} />
        </div>
        {data.config?.model && (
          <div className="text-[10px] text-gray-400 mt-1.5 font-mono truncate">{data.config.model}</div>
        )}
        {data.position_label && (
          <div className="mt-1.5">
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
              data.position_label === 'Primary'
                ? 'bg-blue-100 text-blue-700'
                : 'bg-amber-100 text-amber-700'
            }`}>
              {data.position_label}
            </span>
          </div>
        )}
      </div>

      {data.onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); data.onRemove(); }}
          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 shadow-sm"
        >
          x
        </button>
      )}

      <Handle
        type="source"
        position={Position.Right}
        className="!bg-gray-400 !w-3.5 !h-3.5 !border-2 !border-white hover:!bg-blue-500 hover:!w-4 hover:!h-4 transition-all"
      />
    </div>
  );
}

const nodeTypes = { modelNode: ModelNode };

// ---------------------------------------------------------------------------
// Build ReactFlow nodes & edges from chain
// ---------------------------------------------------------------------------

function buildFlowFromChain(
  chainModels: AIFlowChainModel[],
  savedPositions?: Record<string, { x: number; y: number }> | null,
  onRemove?: (modelId: string) => void
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const SPACING_X = 300;
  const START_X = 50;
  const Y = 150;

  // Start node
  const startPos = savedPositions?.['start'] || { x: START_X, y: Y };
  nodes.push({
    id: 'start',
    type: 'input',
    data: { label: 'Request' },
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

  // Model nodes
  chainModels.forEach((model, index) => {
    const nodeId = `model-${model.id}`;
    const defaultPos = { x: START_X + SPACING_X * (index + 1), y: Y - 20 };
    const pos = savedPositions?.[nodeId] || defaultPos;
    nodes.push({
      id: nodeId,
      type: 'modelNode',
      data: {
        ...model,
        position_label: index === 0 ? 'Primary' : `Fallback ${index}`,
        onRemove: onRemove ? () => onRemove(model.id) : undefined,
      },
      position: pos,
    });

    const sourceId = index === 0 ? 'start' : `model-${chainModels[index - 1].id}`;
    edges.push({
      id: `edge-${sourceId}-${nodeId}`,
      source: sourceId,
      target: nodeId,
      label: index === 0 ? 'try' : 'fallback',
      labelStyle: { fontSize: 11, fontWeight: 600 },
      labelBgStyle: { fill: 'white', fillOpacity: 0.9 },
      animated: true,
      style: { stroke: index === 0 ? '#3b82f6' : '#f59e0b', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: index === 0 ? '#3b82f6' : '#f59e0b' },
    });
  });

  // Error/End node
  const lastSourceId = chainModels.length > 0 ? `model-${chainModels[chainModels.length - 1].id}` : 'start';
  const errorDefaultPos = { x: START_X + SPACING_X * (chainModels.length + 1), y: Y };
  const errorPos = savedPositions?.['error'] || errorDefaultPos;
  nodes.push({
    id: 'error',
    type: 'output',
    data: { label: 'Error' },
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

  edges.push({
    id: `edge-${lastSourceId}-error`,
    source: lastSourceId,
    target: 'error',
    label: 'all failed',
    labelStyle: { fontSize: 10, fontWeight: 500 },
    labelBgStyle: { fill: 'white', fillOpacity: 0.9 },
    style: { stroke: '#ef4444', strokeWidth: 1.5, strokeDasharray: '5,5' },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#ef4444' },
    animated: false,
  });

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function AIFlowPage() {
  const { showError, showSuccess, NotificationComponent } = useNotification();

  // Data state
  const [allModels, setAllModels] = useState<AIModel[]>([]);
  const [chains, setChains] = useState<AIFlowChain[]>([]);
  const [selectedUsageType, setSelectedUsageType] = useState('interview');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // The working chain for the selected usage_type (always editable)
  const [workingChain, setWorkingChain] = useState<string[]>([]);

  // ReactFlow state
  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);
  const edgeReconnectSuccessful = useRef(true);
  const nodesRef = useRef<Node[]>([]);

  // Keep ref in sync so getNodePositions always reads latest
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  // Current saved chain for selected usage_type
  const currentChain = useMemo(
    () => chains.find((c) => c.usage_type === selectedUsageType),
    [chains, selectedUsageType]
  );

  // Resolve working chain IDs to model info objects for the diagram
  const workingChainModels: AIFlowChainModel[] = useMemo(() => {
    return workingChain
      .map((id) => {
        const m = allModels.find((am) => am.id === id);
        if (!m) return null;
        return {
          id: m.id,
          name: m.name,
          provider: m.provider,
          usage_type: typeof m.usage_type === 'string' ? m.usage_type : m.usage_type,
          is_active: m.is_active,
          config: m.config || {},
        } as AIFlowChainModel;
      })
      .filter(Boolean) as AIFlowChainModel[];
  }, [workingChain, allModels]);

  // Models available to add (only matching usage_type or general, not already in chain)
  const availableModels = useMemo(() => {
    const chainIds = new Set(workingChain);
    return allModels.filter((m) => {
      if (!m.is_active || chainIds.has(m.id)) return false;
      const usage = typeof m.usage_type === 'string' ? m.usage_type : (m.usage_type as any)?.value || '';
      return usage === selectedUsageType || usage === 'general';
    });
  }, [allModels, workingChain, selectedUsageType]);

  // Fetch data
  const loadData = useCallback(async () => {
    try {
      const [modelsRes, chainsRes] = await Promise.all([
        aiModelsApi.list(),
        aiFlowApi.listChains(),
      ]);
      setAllModels(Array.isArray(modelsRes) ? modelsRes : modelsRes.data || []);
      setChains(Array.isArray(chainsRes) ? chainsRes : chainsRes.data || []);
    } catch (error) {
      console.error('Failed to load AI flow data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // When selected usage_type or chains change, sync working chain from saved data
  useEffect(() => {
    setWorkingChain(currentChain?.chain || []);
  }, [currentChain, selectedUsageType]);

  // Build diagram whenever working chain changes
  const handleRemoveFromChain = useCallback(
    (modelId: string) => {
      setWorkingChain((prev) => prev.filter((id) => id !== modelId));
    },
    []
  );

  useEffect(() => {
    const savedPositions = currentChain?.node_positions;
    const { nodes: n, edges: e } = buildFlowFromChain(
      workingChainModels,
      savedPositions,
      handleRemoveFromChain
    );
    setNodes(n);
    setEdges(e);
  }, [workingChainModels, handleRemoveFromChain, setNodes, setEdges, currentChain?.node_positions]);

  // Edge reconnection handlers
  const onReconnectStart = useCallback(() => {
    edgeReconnectSuccessful.current = false;
  }, []);

  const onReconnect: OnReconnect = useCallback((oldEdge, newConnection) => {
    edgeReconnectSuccessful.current = true;
    setEdges((els) => reconnectEdge(oldEdge, newConnection, els));
  }, [setEdges]);

  const onReconnectEnd = useCallback((_: unknown, edge: Edge) => {
    if (!edgeReconnectSuccessful.current) {
      setEdges((eds) => eds.filter((e) => e.id !== edge.id));
    }
    edgeReconnectSuccessful.current = true;
  }, [setEdges]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            animated: true,
            style: { stroke: '#f59e0b', strokeWidth: 2 },
            label: 'fallback',
            labelStyle: { fontSize: 11, fontWeight: 600 },
            labelBgStyle: { fill: 'white', fillOpacity: 0.9 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#f59e0b' },
          },
          eds
        )
      );
    },
    [setEdges]
  );

  // Collect current node positions from ReactFlow state
  const getNodePositions = useCallback((): Record<string, { x: number; y: number }> => {
    const positions: Record<string, { x: number; y: number }> = {};
    nodesRef.current.forEach((node) => {
      positions[node.id] = { x: node.position.x, y: node.position.y };
    });
    return positions;
  }, []);

  // Actions
  const handleAddToChain = (modelId: string) => {
    setWorkingChain((prev) => [...prev, modelId]);
  };

  const handleMoveUp = (index: number) => {
    if (index <= 0) return;
    setWorkingChain((prev) => {
      const arr = [...prev];
      [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
      return arr;
    });
  };

  const handleMoveDown = (index: number) => {
    setWorkingChain((prev) => {
      if (index >= prev.length - 1) return prev;
      const arr = [...prev];
      [arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
      return arr;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const nodePositions = getNodePositions();
      if (workingChain.length === 0 && currentChain) {
        // Chain was emptied — delete it
        await aiFlowApi.deleteChain(selectedUsageType);
        showSuccess('Flow chain deleted');
      } else if (workingChain.length > 0) {
        await aiFlowApi.upsertChain(selectedUsageType, {
          chain: workingChain,
          node_positions: nodePositions,
          is_active: true,
        });
        showSuccess('Flow saved');
      }
      await loadData();
    } catch (error) {
      console.error('Failed to save chain:', error);
      showError('Failed to save flow chain');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </Layout>
    );
  }

  // Check if working chain differs from saved chain
  const savedChainStr = JSON.stringify(currentChain?.chain || []);
  const workingChainStr = JSON.stringify(workingChain);
  const hasUnsavedChanges = savedChainStr !== workingChainStr;

  return (
    <Layout>
      <Breadcrumbs />
      <div className="flex flex-col" style={{ height: 'calc(100vh - 120px)' }}>
        {/* Controls bar */}
        <div className="flex items-center justify-between px-3 py-2 bg-white border rounded-lg mb-3 flex-shrink-0">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-700">Operation:</label>
            <select
              value={selectedUsageType}
              onChange={(e) => setSelectedUsageType(e.target.value)}
              className="px-2 py-1.5 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {USAGE_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            {workingChain.length > 0 && (
              <span className="text-xs text-gray-500">
                {workingChain.length} model{workingChain.length !== 1 ? 's' : ''} in chain
              </span>
            )}
            {hasUnsavedChanges && (
              <span className="text-xs text-amber-600 font-medium">Unsaved changes</span>
            )}
          </div>

          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={saving || !hasUnsavedChanges}
          >
            {saving ? (
              <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white mr-1" />
            ) : (
              <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            )}
            Save
          </Button>
        </div>

        {/* Main content */}
        <div className="flex gap-3 flex-1 min-h-0">
          {/* ReactFlow Canvas */}
          <div className="flex-1 border rounded-lg overflow-hidden bg-gray-50">
            {workingChain.length > 0 ? (
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onReconnect={onReconnect}
                onReconnectStart={onReconnectStart}
                onReconnectEnd={onReconnectEnd}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.5, minZoom: 0.8, maxZoom: 1.2 }}
                nodesDraggable={true}
                nodesConnectable={true}
                elementsSelectable={true}
                snapToGrid={true}
                snapGrid={[20, 20]}
                proOptions={{ hideAttribution: true }}
                minZoom={0.2}
                maxZoom={2}
              >
                <Background color="#e5e7eb" gap={20} />
                <Controls />
                <MiniMap
                  nodeStrokeWidth={3}
                  zoomable
                  pannable
                  style={{ height: 90, width: 140 }}
                />
              </ReactFlow>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <p className="text-lg font-medium">No flow configured</p>
                <p className="text-sm mt-1">
                  Add models from the sidebar to build a fallback chain for {USAGE_TYPE_OPTIONS.find(o => o.value === selectedUsageType)?.label || selectedUsageType}
                </p>
              </div>
            )}
          </div>

          {/* Right sidebar: chain order + available models */}
          <div className="w-72 border rounded-lg bg-white overflow-hidden flex flex-col flex-shrink-0">
            {/* Chain order */}
            <div className="border-b p-3">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Chain Order</h3>
              {workingChain.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No models added yet</p>
              ) : (
                <div className="space-y-1.5">
                  {workingChain.map((id, index) => {
                    const model = allModels.find((m) => m.id === id);
                    if (!model) return null;
                    return (
                      <div key={id} className={`flex items-center gap-2 p-2 rounded-md border text-sm ${PROVIDER_BG[model.provider.toLowerCase()] || 'bg-gray-50 border-gray-200'}`}>
                        <span className="text-xs font-bold text-gray-500 w-5">{index + 1}</span>
                        <ProviderIcon provider={model.provider} size="w-4 h-4" />
                        <span className="flex-1 truncate text-xs font-medium">{model.name}</span>
                        <div className="flex items-center gap-0.5">
                          <button
                            onClick={() => handleMoveUp(index)}
                            disabled={index === 0}
                            className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleMoveDown(index)}
                            disabled={index === workingChain.length - 1}
                            className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleRemoveFromChain(id)}
                            className="p-0.5 text-red-400 hover:text-red-600"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Available models */}
            <div className="flex-1 overflow-y-auto p-3">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Available Models</h3>
              {availableModels.length === 0 ? (
                <p className="text-xs text-gray-400 italic">All active models are in the chain</p>
              ) : (
                <div className="space-y-1.5">
                  {availableModels.map((model) => (
                    <div
                      key={model.id}
                      className="flex items-center gap-2 p-2 rounded-md hover:bg-gray-50 border border-transparent hover:border-gray-200 transition-colors"
                    >
                      <ProviderIcon provider={model.provider} size="w-4 h-4" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-gray-900 truncate">{model.name}</div>
                        <div className="text-[10px] text-gray-500 capitalize">{model.provider}</div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs px-2 py-1 h-auto"
                        onClick={() => handleAddToChain(model.id)}
                      >
                        + Add
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom info */}
        <div className="flex items-center gap-2 mt-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700 flex-shrink-0">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>
            Models are tried in order. If one fails, the next is used automatically.
            {' '}<a href="/ai-models" className="underline font-medium">Manage models</a>
          </span>
        </div>
      </div>
      {NotificationComponent}
    </Layout>
  );
}

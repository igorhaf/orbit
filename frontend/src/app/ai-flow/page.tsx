/**
 * AI Flow Page
 * PROMPT #122 - Visual Fallback Chain Configuration
 *
 * n8n-style flow diagram for configuring per-operation AI model fallback chains.
 * Uses @xyflow/react for the node-based visualization.
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

      {data.editMode && data.onRemove && (
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
  editMode: boolean,
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
        editMode,
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

  // Edit state
  const [editMode, setEditMode] = useState(false);
  const [editChain, setEditChain] = useState<string[]>([]);

  // ReactFlow state
  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);
  const edgeReconnectSuccessful = useRef(true);

  // Current chain for selected usage_type
  const currentChain = useMemo(
    () => chains.find((c) => c.usage_type === selectedUsageType),
    [chains, selectedUsageType]
  );

  const chainModels: AIFlowChainModel[] = useMemo(() => {
    if (!currentChain?.models) return [];
    return currentChain.models;
  }, [currentChain]);

  // Models available to add (not already in the chain)
  const availableModels = useMemo(() => {
    const chainIds = new Set(editMode ? editChain : currentChain?.chain || []);
    return allModels.filter((m) => m.is_active && !chainIds.has(m.id));
  }, [allModels, editChain, currentChain, editMode]);

  // Resolve edit chain to model objects
  const editChainModels: AIFlowChainModel[] = useMemo(() => {
    if (!editMode) return [];
    return editChain
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
  }, [editMode, editChain, allModels]);

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

  // Build diagram from chain
  const handleRemoveFromChain = useCallback(
    (modelId: string) => {
      setEditChain((prev) => prev.filter((id) => id !== modelId));
    },
    []
  );

  useEffect(() => {
    const models = editMode ? editChainModels : chainModels;
    const savedPositions = editMode ? null : currentChain?.node_positions;
    const { nodes: n, edges: e } = buildFlowFromChain(
      models,
      editMode,
      savedPositions,
      editMode ? handleRemoveFromChain : undefined
    );
    setNodes(n);
    setEdges(e);
  }, [chainModels, editChainModels, editMode, handleRemoveFromChain, setNodes, setEdges, currentChain?.node_positions]);

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
    nodes.forEach((node) => {
      positions[node.id] = { x: node.position.x, y: node.position.y };
    });
    return positions;
  }, [nodes]);

  // Actions
  const handleEditStart = () => {
    setEditChain(currentChain?.chain || []);
    setEditMode(true);
  };

  const handleEditCancel = () => {
    setEditMode(false);
    setEditChain([]);
  };

  const handleAddToChain = (modelId: string) => {
    setEditChain((prev) => [...prev, modelId]);
  };

  const handleMoveUp = (index: number) => {
    if (index <= 0) return;
    setEditChain((prev) => {
      const arr = [...prev];
      [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
      return arr;
    });
  };

  const handleMoveDown = (index: number) => {
    setEditChain((prev) => {
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
      await aiFlowApi.upsertChain(selectedUsageType, {
        chain: editChain,
        node_positions: nodePositions,
        is_active: true,
      });
      showSuccess('Flow chain saved successfully');
      setEditMode(false);
      setEditChain([]);
      await loadData();
    } catch (error) {
      console.error('Failed to save chain:', error);
      showError('Failed to save flow chain');
    } finally {
      setSaving(false);
    }
  };

  // Save positions only (without entering edit mode)
  const handleSavePositions = async () => {
    if (!currentChain) return;
    try {
      const nodePositions = getNodePositions();
      await aiFlowApi.upsertChain(selectedUsageType, {
        chain: currentChain.chain,
        node_positions: nodePositions,
        is_active: currentChain.is_active,
      });
      showSuccess('Layout saved');
      await loadData();
    } catch (error) {
      console.error('Failed to save positions:', error);
    }
  };

  const handleDelete = async () => {
    if (!currentChain) return;
    try {
      await aiFlowApi.deleteChain(selectedUsageType);
      showSuccess('Flow chain deleted');
      await loadData();
    } catch (error) {
      console.error('Failed to delete chain:', error);
      showError('Failed to delete flow chain');
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

  const hasChainData = editMode ? editChain.length > 0 : chainModels.length > 0;

  return (
    <Layout>
      <Breadcrumbs />
      <div className="flex flex-col" style={{ height: 'calc(100vh - 120px)' }}>
        {/* Header row - compact */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">AI Flow</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Configure fallback chains per operation. Models are tried in order.
            </p>
          </div>
        </div>

        {/* Controls bar - compact inline */}
        <div className="flex items-center justify-between px-3 py-2 bg-white border rounded-lg mb-3 flex-shrink-0">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-700">Operation:</label>
            <select
              value={selectedUsageType}
              onChange={(e) => {
                setSelectedUsageType(e.target.value);
                setEditMode(false);
                setEditChain([]);
              }}
              className="px-2 py-1.5 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              disabled={editMode}
            >
              {USAGE_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            {currentChain && !editMode && (
              <span className="text-xs text-gray-500">
                {currentChain.chain.length} model{currentChain.chain.length !== 1 ? 's' : ''} in chain
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!editMode ? (
              <>
                {currentChain && (
                  <Button variant="outline" size="sm" onClick={handleSavePositions}>
                    <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    Save Layout
                  </Button>
                )}
                <Button variant="primary" size="sm" onClick={handleEditStart}>
                  <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  {currentChain ? 'Edit' : 'Configure'}
                </Button>
                {currentChain && (
                  <Button variant="outline" size="sm" onClick={handleDelete}>
                    <svg className="w-3.5 h-3.5 mr-1 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Delete
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={handleEditCancel}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSave}
                  disabled={saving || editChain.length === 0}
                >
                  {saving ? (
                    <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white mr-1" />
                  ) : (
                    <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  Save Flow
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Main content - fills remaining height */}
        <div className="flex gap-3 flex-1 min-h-0">
          {/* ReactFlow Canvas */}
          <div className={`border rounded-lg overflow-hidden bg-gray-50 ${editMode ? 'flex-1' : 'w-full'}`}>
            {hasChainData ? (
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
                <p className="text-lg font-medium">
                  {editMode ? 'Add models from the sidebar' : 'No flow configured'}
                </p>
                <p className="text-sm mt-1">
                  {editMode
                    ? 'Click "+ Add" on available models to build your fallback chain'
                    : `Click "Configure" to set up a fallback chain for ${USAGE_TYPE_OPTIONS.find(o => o.value === selectedUsageType)?.label || selectedUsageType}`
                  }
                </p>
              </div>
            )}
          </div>

          {/* Right sidebar: available models (edit mode) */}
          {editMode && (
            <div className="w-72 border rounded-lg bg-white overflow-hidden flex flex-col flex-shrink-0">
              {/* Chain order */}
              <div className="border-b p-3">
                <h3 className="text-sm font-semibold text-gray-900 mb-2">Chain Order</h3>
                {editChain.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No models added yet</p>
                ) : (
                  <div className="space-y-1.5">
                    {editChain.map((id, index) => {
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
                              disabled={index === editChain.length - 1}
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
          )}
        </div>

        {/* Bottom info - compact */}
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

/**
 * AI Flow Page
 * PROMPT #122 - Visual Fallback Chain Configuration
 * PROMPT #124 - Metrics, Animation, Analytics & Smart Reorder
 *
 * n8n-style flow diagram for configuring per-operation AI model fallback chains.
 * Uses @xyflow/react for the node-based visualization.
 *
 * Flow: select operation -> canvas shows saved chain (or empty) -> add/remove/reorder
 * models from sidebar -> Save.
 *
 * PROMPT #124 Features:
 * 1. Real-time metrics on model nodes (health, success rate, latency, cost)
 * 2. WebSocket animation for live chain execution visualization
 * 3. Chain Analytics dashboard (collapsible panel)
 * 4. Smart Reorder + Templates (sidebar quick actions)
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
  reconnectEdge,
  addEdge,
  MarkerType,
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
import type {
  AIModel,
  AIFlowChain,
  AIFlowChainModel,
  AIFlowModelMetrics,
  AIFlowChainAnalyticsResponse,
  AIFlowChainTemplate,
  AIFlowUtilityNode,
  AIFlowUtilityNodeType,
  UtilityNodeType,
} from '@/lib/types';

// Extracted sub-components
import {
  USAGE_TYPE_OPTIONS,
  PROVIDER_BG,
  UTILITY_NODE_BG,
  nodeTypes,
  ProviderIcon,
  UtilityNodeIcon,
  EditUtilityNodeDialog,
  EditModelNodeDialog,
  AnalyticsPanel,
  OptimizeDialog,
  buildFlowFromChain,
} from '@/components/ai-flow';
import type { NodeAnimationState, ModelOverrides } from '@/components/ai-flow';

// ---------------------------------------------------------------------------
// PROMPT #124 - WebSocket hook for live chain execution events
// ---------------------------------------------------------------------------

const EMPTY_ANIMATIONS: Record<string, NodeAnimationState> = {};

function useAIFlowWebSocket(_selectedUsageType: string) {
  // PROMPT #227 - Disabled real-time WebSocket polling.
  // Metrics are loaded once when the chain changes, no continuous connection needed.
  return EMPTY_ANIMATIONS;
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

  // PROMPT #124 - Metrics state
  const [metricsMap, setMetricsMap] = useState<Record<string, AIFlowModelMetrics>>({});

  // PROMPT #124 - Analytics state
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [analyticsData, setAnalyticsData] = useState<AIFlowChainAnalyticsResponse | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  // PROMPT #124 - Optimize dialog
  const [showOptimize, setShowOptimize] = useState(false);

  // PROMPT #124 - Templates
  const [templates, setTemplates] = useState<AIFlowChainTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  // PROMPT #204 - Utility nodes state
  const [workingUtilityNodes, setWorkingUtilityNodes] = useState<AIFlowUtilityNode[]>([]);
  const [utilityNodeTypes, setUtilityNodeTypes] = useState<AIFlowUtilityNodeType[]>([]);
  // PROMPT #208 - Edit utility node dialog
  const [editingNode, setEditingNode] = useState<AIFlowUtilityNode | null>(null);

  // PROMPT #226 - Edit model node dialog (per-flow overrides)
  const [editingModel, setEditingModel] = useState<AIFlowChainModel | null>(null);
  const [modelOverrides, setModelOverrides] = useState<Record<string, ModelOverrides>>({});

  // PROMPT #124 - WebSocket animations
  const nodeAnimations = useAIFlowWebSocket(selectedUsageType);

  // ReactFlow state
  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);
  const edgeReconnectSuccessful = useRef(true);
  const nodesRef = useRef<Node[]>([]);
  const [positionsChanged, setPositionsChanged] = useState(false);

  // Wrap onNodesChange to detect position changes (drag)
  const handleNodesChange = useCallback((changes: any[]) => {
    onNodesChange(changes);
    if (changes.some((c: any) => c.type === 'position' && c.dragging === false)) {
      setPositionsChanged(true);
    }
  }, [onNodesChange]);

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
    setWorkingUtilityNodes(currentChain?.utility_nodes || []);
    setPositionsChanged(false);
    // PROMPT #226 - Load model overrides from node_positions
    const savedOverrides = (currentChain?.node_positions as any)?.__model_overrides;
    setModelOverrides(savedOverrides && typeof savedOverrides === 'object' ? savedOverrides : {});
  }, [currentChain, selectedUsageType]);

  // PROMPT #204 - Fetch utility node types catalog
  useEffect(() => {
    const fetchNodeTypes = async () => {
      try {
        const res = await aiFlowApi.utilityNodeTypes();
        setUtilityNodeTypes(res?.node_types || []);
      } catch {
        setUtilityNodeTypes([]);
      }
    };
    fetchNodeTypes();
  }, []);

  // PROMPT #124 - Fetch metrics when working chain changes
  useEffect(() => {
    if (workingChain.length === 0) {
      setMetricsMap({});
      return;
    }

    const fetchMetrics = async () => {
      try {
        const res = await aiFlowApi.modelMetrics(workingChain, 7);
        const map: Record<string, AIFlowModelMetrics> = {};
        if (res?.metrics) {
          res.metrics.forEach((m: AIFlowModelMetrics) => {
            map[m.model_id] = m;
          });
        }
        setMetricsMap(map);
      } catch {
        // Silently fail - metrics are non-critical
      }
    };

    fetchMetrics();
  }, [workingChain]);

  // PROMPT #124 - Fetch templates when usage type changes
  useEffect(() => {
    const fetchTemplates = async () => {
      setTemplatesLoading(true);
      try {
        const res = await aiFlowApi.chainTemplates(selectedUsageType);
        setTemplates(res?.templates || []);
      } catch {
        setTemplates([]);
      } finally {
        setTemplatesLoading(false);
      }
    };
    fetchTemplates();
  }, [selectedUsageType]);

  // PROMPT #124 - Fetch analytics
  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const res = await aiFlowApi.chainAnalytics(undefined, 30);
      setAnalyticsData(res);
    } catch {
      setAnalyticsData(null);
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (showAnalytics) {
      loadAnalytics();
    }
  }, [showAnalytics, loadAnalytics]);

  // Build diagram whenever working chain changes
  const handleRemoveFromChain = useCallback(
    (modelId: string) => {
      setWorkingChain((prev) => prev.filter((id) => id !== modelId));
    },
    []
  );

  // PROMPT #204 - Remove utility node
  const handleRemoveUtilityNode = useCallback(
    (nodeId: string) => {
      setWorkingUtilityNodes((prev) => prev.filter((n) => n.id !== nodeId));
    },
    []
  );

  useEffect(() => {
    const savedPositions = currentChain?.node_positions;
    const { nodes: n, edges: e } = buildFlowFromChain(
      workingChainModels,
      savedPositions,
      handleRemoveFromChain,
      metricsMap,
      nodeAnimations,
      workingUtilityNodes,
      handleRemoveUtilityNode,
      modelOverrides,
    );
    setNodes(n);
    setEdges(e);
  }, [workingChainModels, handleRemoveFromChain, handleRemoveUtilityNode, setNodes, setEdges, currentChain?.node_positions, metricsMap, nodeAnimations, workingUtilityNodes, modelOverrides]);

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

  // PROMPT #226 - Save model override
  const handleSaveModelOverride = useCallback((modelId: string, overrides: ModelOverrides) => {
    const hasValues = overrides.temperature != null || overrides.max_tokens != null || overrides.timeout_seconds != null;
    setModelOverrides(prev => {
      if (!hasValues) {
        const next = { ...prev };
        delete next[modelId];
        return next;
      }
      return { ...prev, [modelId]: overrides };
    });
    setEditingModel(null);
  }, []);

  // PROMPT #208 - Save edited utility node
  const handleSaveNodeEdit = useCallback((updatedNode: AIFlowUtilityNode) => {
    setWorkingUtilityNodes(prev =>
      prev.map(n => n.id === updatedNode.id ? updatedNode : n)
    );
    setEditingNode(null);
  }, []);

  // PROMPT #208 / #226 - Double-click handler for utility nodes AND model nodes
  const handleNodeDoubleClick = useCallback((_event: React.MouseEvent, node: Node) => {
    // Check utility nodes first
    const utilityNode = workingUtilityNodes.find(n => n.id === node.id);
    if (utilityNode) {
      setEditingNode({ ...utilityNode, config: { ...utilityNode.config } });
      return;
    }
    // Check model nodes (id starts with "model-")
    if (node.id.startsWith('model-')) {
      const modelId = node.id.replace('model-', '');
      const chainModel = workingChainModels.find(m => m.id === modelId);
      if (chainModel) {
        setEditingModel(chainModel);
      }
    }
  }, [workingUtilityNodes, workingChainModels]);

  // PROMPT #204 - Add utility node
  const handleAddUtilityNode = (nodeType: AIFlowUtilityNodeType) => {
    const existingCount = workingUtilityNodes.filter((n) => n.type === nodeType.type).length;
    const newNode: AIFlowUtilityNode = {
      id: `${nodeType.type}-${Date.now()}`,
      type: nodeType.type as UtilityNodeType,
      label: existingCount > 0 ? `${nodeType.label} ${existingCount + 1}` : nodeType.label,
      enabled: true,
      config: { ...nodeType.default_config },
      position: null,
    };
    setWorkingUtilityNodes((prev) => [...prev, newNode]);
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
      // PROMPT #226 - Store model overrides alongside positions
      const positionsWithOverrides = {
        ...nodePositions,
        ...(Object.keys(modelOverrides).length > 0 ? { __model_overrides: modelOverrides } : {}),
      };
      if (workingChain.length === 0 && workingUtilityNodes.length === 0 && currentChain) {
        // Chain was emptied -- delete it
        await aiFlowApi.deleteChain(selectedUsageType);
        showSuccess('Cadeia de fluxo excluida');
      } else if (workingChain.length > 0 || workingUtilityNodes.length > 0) {
        await aiFlowApi.upsertChain(selectedUsageType, {
          chain: workingChain,
          node_positions: positionsWithOverrides,
          utility_nodes: workingUtilityNodes.length > 0 ? workingUtilityNodes : null,
          is_active: true,
        } as any);
        showSuccess('Fluxo salvo');
      }
      setPositionsChanged(false);
      await loadData();
    } catch (error) {
      console.error('Failed to save chain:', error);
      showError('Falha ao salvar cadeia de fluxo');
    } finally {
      setSaving(false);
    }
  };

  // PROMPT #124 / #209 - Apply template (models + utility nodes)
  const handleApplyTemplate = (template: AIFlowChainTemplate) => {
    setWorkingChain(template.chain);
    if (template.utility_nodes && template.utility_nodes.length > 0) {
      setWorkingUtilityNodes(template.utility_nodes);
    }
    showSuccess(`Template "${template.name}" aplicado (nao salvo)`);
  };

  // PROMPT #124 - Apply optimize result
  const handleApplyOptimize = (order: string[]) => {
    setWorkingChain(order);
    setShowOptimize(false);
    showSuccess('Ordem otimizada aplicada (nao salvo)');
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
  const savedUtilityStr = JSON.stringify(currentChain?.utility_nodes || []);
  const workingUtilityStr = JSON.stringify(workingUtilityNodes);
  const savedOverridesStr = JSON.stringify((currentChain?.node_positions as any)?.__model_overrides || {});
  const workingOverridesStr = JSON.stringify(modelOverrides);
  const hasUnsavedChanges = savedChainStr !== workingChainStr || savedUtilityStr !== workingUtilityStr || savedOverridesStr !== workingOverridesStr || positionsChanged;

  return (
    <Layout>
      <Breadcrumbs />
      <div className="flex flex-col" style={{ height: showAnalytics ? 'calc(100vh - 120px)' : 'calc(100vh - 120px)' }}>
        {/* Controls bar */}
        <div className="flex items-center justify-between px-3 py-2 bg-white border rounded-lg mb-3 flex-shrink-0">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-700">Operacao:</label>
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

            {(workingChain.length > 0 || workingUtilityNodes.length > 0) && (
              <span className="text-xs text-gray-500">
                {workingChain.length} modelo{workingChain.length !== 1 ? 's' : ''}
                {workingUtilityNodes.length > 0 && ` + ${workingUtilityNodes.length} no${workingUtilityNodes.length !== 1 ? 's' : ''}`}
              </span>
            )}
            {hasUnsavedChanges && (
              <span className="text-xs text-amber-600 font-medium">Alteracoes nao salvas</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Analytics toggle */}
            <Button
              variant={showAnalytics ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setShowAnalytics(!showAnalytics)}
            >
              <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Analytics
            </Button>

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
              Salvar
            </Button>
          </div>
        </div>

        {/* Main content */}
        <div className="flex gap-3 flex-1 min-h-0">
          {/* ReactFlow Canvas */}
          <div className="flex-1 border rounded-lg overflow-hidden bg-gray-50">
            {(workingChain.length > 0 || workingUtilityNodes.length > 0) ? (
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={handleNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onReconnect={onReconnect}
                onReconnectStart={onReconnectStart}
                onReconnectEnd={onReconnectEnd}
                onNodeDoubleClick={handleNodeDoubleClick}
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
                <p className="text-lg font-medium">Nenhum fluxo configurado</p>
                <p className="text-sm mt-1">
                  Adicione modelos pela barra lateral para construir uma cadeia de fallback para {USAGE_TYPE_OPTIONS.find(o => o.value === selectedUsageType)?.label || selectedUsageType}
                </p>
              </div>
            )}
          </div>

          {/* Right sidebar: quick actions + chain order + available models */}
          <div className="w-72 border rounded-lg bg-white overflow-hidden flex flex-col flex-shrink-0">
            {/* PROMPT #124 - Quick Actions */}
            <div className="border-b p-3">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Acoes Rapidas</h3>
              <div className="space-y-1.5">
                <button
                  onClick={() => setShowOptimize(true)}
                  disabled={workingChain.length < 2}
                  className="w-full flex items-center gap-2 p-2 rounded-md border border-blue-200 bg-blue-50 hover:bg-blue-100 text-sm text-blue-700 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                  Otimizar Ordem
                </button>

                {/* Templates */}
                {templatesLoading ? (
                  <div className="text-xs text-gray-400 text-center py-1">Carregando templates...</div>
                ) : templates.length > 0 ? (
                  templates.map((tmpl) => (
                    <button
                      key={tmpl.id}
                      onClick={() => handleApplyTemplate(tmpl)}
                      className="w-full flex items-center gap-2 p-2 rounded-md border border-gray-200 hover:bg-gray-50 text-xs text-gray-700 transition-colors text-left"
                    >
                      <svg className="w-3.5 h-3.5 flex-shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6z" />
                      </svg>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{tmpl.name}</div>
                        <div className="text-[10px] text-gray-500 truncate">{tmpl.description}</div>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="text-[10px] text-gray-400 italic">Nenhum template para esta operacao</div>
                )}
              </div>
            </div>

            {/* Chain order */}
            <div className="border-b p-3">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Ordem da Cadeia</h3>
              {workingChain.length === 0 ? (
                <p className="text-xs text-gray-400 italic">Nenhum modelo adicionado ainda</p>
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

            {/* Scrollable area: Available models + Flow Nodes */}
            <div className="flex-1 overflow-y-auto">
              {/* Available models */}
              <div className="border-b p-3">
                <h3 className="text-sm font-semibold text-gray-900 mb-2">Modelos Disponiveis</h3>
                {availableModels.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">Todos os modelos ativos estao na cadeia</p>
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
                          + Adicionar
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* PROMPT #204 - Utility Nodes */}
              <div className="p-3">
                <h3 className="text-sm font-semibold text-gray-900 mb-2">Nos do Fluxo</h3>
                {workingUtilityNodes.length > 0 && (
                  <div className="mb-3 space-y-1">
                    <div className="text-[10px] text-gray-500 font-medium uppercase tracking-wide mb-1">Ativos</div>
                    {workingUtilityNodes.map((uNode) => (
                      <div key={uNode.id} className={`flex items-center gap-2 p-2 rounded-md border text-xs ${UTILITY_NODE_BG[uNode.type] || 'bg-gray-50 border-gray-200'}`}>
                        <UtilityNodeIcon type={uNode.type} size="w-4 h-4" />
                        <span className="flex-1 truncate font-medium">{uNode.label}</span>
                        <button
                          onClick={() => handleRemoveUtilityNode(uNode.id)}
                          className="p-0.5 text-red-400 hover:text-red-600"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="text-[10px] text-gray-500 font-medium uppercase tracking-wide mb-1">Adicionar No</div>
                <div className="space-y-1">
                  {utilityNodeTypes.map((nodeType) => (
                    <button
                      key={nodeType.type}
                      onClick={() => handleAddUtilityNode(nodeType)}
                      className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-gray-50 border border-transparent hover:border-gray-200 transition-colors text-left"
                    >
                      <UtilityNodeIcon type={nodeType.type} size="w-4 h-4" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-gray-900">{nodeType.label}</div>
                        <div className="text-[10px] text-gray-500 truncate">{nodeType.description}</div>
                      </div>
                      <span className="text-xs text-gray-400">+</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* PROMPT #124 - Analytics Panel (collapsible) */}
        {showAnalytics && (
          <div className="mt-3 border rounded-lg bg-white p-4 flex-shrink-0 max-h-[300px] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">Analiticos da Cadeia</h3>
              <button onClick={() => setShowAnalytics(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <AnalyticsPanel
              analytics={analyticsData}
              loading={analyticsLoading}
              onRefresh={loadAnalytics}
            />
          </div>
        )}

        {/* Bottom info */}
        <div className="flex items-center gap-2 mt-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700 flex-shrink-0">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>
            Os modelos sao testados em ordem. Se um falhar, o proximo e usado automaticamente.
            Adicione nos utilitarios (Cache, RAG, Validador, etc.) para pre/pos-processamento.
            Metricas atualizam a cada 30s.
            {' '}<a href="/ai-models" className="underline font-medium">Gerenciar modelos</a>
          </span>
        </div>
      </div>

      {/* PROMPT #124 - Optimize Dialog */}
      <OptimizeDialog
        open={showOptimize}
        onClose={() => setShowOptimize(false)}
        onApply={handleApplyOptimize}
        usageType={selectedUsageType}
      />

      {/* PROMPT #208 - Edit Utility Node Dialog */}
      {editingNode && (
        <EditUtilityNodeDialog
          node={editingNode}
          onSave={handleSaveNodeEdit}
          onClose={() => setEditingNode(null)}
        />
      )}

      {/* PROMPT #226 - Edit Model Node Dialog */}
      {editingModel && (
        <EditModelNodeDialog
          model={editingModel}
          overrides={modelOverrides[editingModel.id] || {}}
          onSave={handleSaveModelOverride}
          onClose={() => setEditingModel(null)}
        />
      )}

      {NotificationComponent}

      {/* PROMPT #124 - Shake animation CSS */}
      <style jsx global>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-3px); }
          20%, 40%, 60%, 80% { transform: translateX(3px); }
        }
        .animate-shake {
          animation: shake 0.5s ease-in-out;
        }
      `}</style>
    </Layout>
  );
}

/**
 * AI Studio Page (formerly AI Flow)
 * PROMPT #122 - Visual Fallback Chain Configuration
 * PROMPT #124 - Metrics, Animation, Analytics & Smart Reorder
 * PROMPT #263 - AI Studio: Unified AI Administration with tabs
 *
 * Two tabs:
 * - Operations: n8n-style flow for per-operation AI model fallback chains
 * - Pipeline: Visual configurator for the 7-phase Deep Pipeline
 *
 * Uses @xyflow/react for node-based visualization in both tabs.
 */

'use client';

import React, { Suspense, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Spinner } from '@/components/ui';
import { useSearchParams } from 'next/navigation';
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
  ConnectionLineType,
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
import { PipelineTab, ModelsTab } from '@/components/ai-studio';
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
  AIFlowProfile,
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
  SmartEdge,
} from '@/components/ai-flow';
import type { NodeAnimationState, ModelOverrides } from '@/components/ai-flow';

// Custom edge types with collision-aware routing
const edgeTypes = { smartEdge: SmartEdge };

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

function AIFlowPageContent() {
  const { showError, showSuccess, NotificationComponent } = useNotification();
  const searchParams = useSearchParams();

  // Tab state (operations | pipeline)
  const tabParam = searchParams.get('tab');
  const projectParam = searchParams.get('project');
  const [activeTab, setActiveTabState] = useState<'models' | 'operations' | 'pipeline'>(
    tabParam === 'pipeline' ? 'pipeline' : tabParam === 'operations' ? 'operations' : 'models'
  );
  const setActiveTab = (tab: 'models' | 'operations' | 'pipeline') => {
    setActiveTabState(tab);
    const url = new URL(window.location.href);
    if (tab === 'models') {
      url.searchParams.delete('tab');
    } else {
      url.searchParams.set('tab', tab);
    }
    window.history.replaceState({}, '', url.toString());
  };

  // Data state
  const [allModels, setAllModels] = useState<AIModel[]>([]);
  const [chains, setChains] = useState<AIFlowChain[]>([]);
  const [selectedUsageType, setSelectedUsageType] = useState('interview');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Profiles state
  const [profiles, setProfiles] = useState<AIFlowProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<AIFlowProfile | null>(null);
  const selectedProfileRef = useRef<AIFlowProfile | null>(null);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileUsageType, setNewProfileUsageType] = useState('interview');
  const [editingProfile, setEditingProfile] = useState<AIFlowProfile | null>(null);
  const [editProfileName, setEditProfileName] = useState('');
  const [editProfileUsageType, setEditProfileUsageType] = useState('interview');

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


  // Keep ref in sync so loadData callback always sees latest selectedProfile
  // Also persist to sessionStorage for reload continuity
  useEffect(() => {
    selectedProfileRef.current = selectedProfile;
    if (selectedProfile && typeof window !== 'undefined') {
      sessionStorage.setItem('ai-flow-selected-profile', selectedProfile.id);
    }
  }, [selectedProfile]);

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
      const [modelsRes, chainsRes, profilesRes] = await Promise.all([
        aiModelsApi.list(),
        aiFlowApi.listChains(),
        aiFlowApi.listProfiles(),
      ]);
      setAllModels(Array.isArray(modelsRes) ? modelsRes : modelsRes.data || []);
      setChains(Array.isArray(chainsRes) ? chainsRes : chainsRes.data || []);
      const loadedProfiles = Array.isArray(profilesRes) ? profilesRes : profilesRes?.data || [];
      setProfiles(loadedProfiles);
      if (selectedProfileRef.current) {
        // Sync selected profile with fresh server data (covers page reload)
        const fresh = loadedProfiles.find((p: AIFlowProfile) => p.id === selectedProfileRef.current!.id);
        if (fresh) {
          setSelectedProfile(fresh);
          setWorkingChain(fresh.chain || []);
          setWorkingUtilityNodes(fresh.utility_nodes || []);
          const savedOverrides = (fresh.node_positions as any)?.__model_overrides;
          setModelOverrides(savedOverrides && typeof savedOverrides === 'object' ? savedOverrides : {});
        }
      } else if (loadedProfiles.length > 0) {
        // Try to restore previously selected profile from sessionStorage (survives reload)
        const savedId = typeof window !== 'undefined' ? sessionStorage.getItem('ai-flow-selected-profile') : null;
        const restored = savedId ? loadedProfiles.find((p: AIFlowProfile) => p.id === savedId) : null;
        // Fallback: first active profile, or first profile
        const first = restored || loadedProfiles.find((p: AIFlowProfile) => p.is_active) || loadedProfiles[0];
        setSelectedProfile(first);
        setSelectedUsageType(first.usage_type);
        setWorkingChain(first.chain || []);
        setWorkingUtilityNodes(first.utility_nodes || []);
        const savedOverrides = (first.node_positions as any)?.__model_overrides;
        setModelOverrides(savedOverrides && typeof savedOverrides === 'object' ? savedOverrides : {});
      }
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
  // Skip when a profile is selected — profile state is managed by handleSelectProfile/handleSave
  useEffect(() => {
    if (selectedProfile) return;
    setWorkingChain(currentChain?.chain || []);
    setWorkingUtilityNodes(currentChain?.utility_nodes || []);
    setPositionsChanged(false);
    // PROMPT #226 - Load model overrides from node_positions
    const savedOverrides = (currentChain?.node_positions as any)?.__model_overrides;
    setModelOverrides(savedOverrides && typeof savedOverrides === 'object' ? savedOverrides : {});
  }, [currentChain, selectedUsageType, selectedProfile]);

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
    const savedPositions = selectedProfile?.node_positions || currentChain?.node_positions;
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
  }, [workingChainModels, handleRemoveFromChain, handleRemoveUtilityNode, setNodes, setEdges, selectedProfile?.node_positions, currentChain?.node_positions, metricsMap, nodeAnimations, workingUtilityNodes, modelOverrides]);

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
            type: 'smartEdge',
            animated: true,
            style: { stroke: '#f59e0b', strokeWidth: 2 },
            label: 'fallback',
            labelStyle: { fontSize: 11, fontWeight: 600 },
            labelBgStyle: { fill: 'white', fillOpacity: 0.9 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#f59e0b', width: 16, height: 16 },
          } as any,
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

  // PROMPT #208 / #226 - Double-click handler for utility nodes and model nodes
  // (Contract items are handled inside ContractsListNode via onViewContract callback)
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

      if (selectedProfile) {
        // Save to profile
        const updated = await aiFlowApi.updateProfile(selectedProfile.id, {
          chain: workingChain,
          utility_nodes: workingUtilityNodes,
          node_positions: positionsWithOverrides,
        });
        setSelectedProfile(updated);
        // Update profiles list in-place (no need for full loadData reload)
        setProfiles(prev => prev.map(p => p.id === updated.id ? updated : p));
        showSuccess(`Profile "${updated.name}" salvo (v${updated.version})`);
      } else {
        // Fallback: save to chain (backward compat)
        if (workingChain.length === 0 && workingUtilityNodes.length === 0 && currentChain) {
          await aiFlowApi.deleteChain(selectedUsageType);
          showSuccess('Cadeia de fluxo excluída');
        } else if (workingChain.length > 0 || workingUtilityNodes.length > 0) {
          await aiFlowApi.upsertChain(selectedUsageType, {
            chain: workingChain,
            node_positions: positionsWithOverrides,
            utility_nodes: workingUtilityNodes.length > 0 ? workingUtilityNodes : null,
            is_active: true,
          } as any);
          showSuccess('Fluxo salvo');
        }
        await loadData();
      }
      setPositionsChanged(false);
    } catch (error) {
      console.error('Failed to save:', error);
      showError('Falha ao salvar');
    } finally {
      setSaving(false);
    }
  };

  // Profile handlers
  const handleSelectProfile = (profile: AIFlowProfile) => {
    setSelectedProfile(profile);
    setSelectedUsageType(profile.usage_type);
    setWorkingChain(profile.chain || []);
    setWorkingUtilityNodes(profile.utility_nodes || []);
    setPositionsChanged(false);
    const savedOverrides = (profile.node_positions as any)?.__model_overrides;
    setModelOverrides(savedOverrides && typeof savedOverrides === 'object' ? savedOverrides : {});
  };

  const handleCreateProfile = async () => {
    if (!newProfileName.trim()) return;
    try {
      const created = await aiFlowApi.createProfile({
        name: newProfileName.trim(),
        usage_type: newProfileUsageType,
        chain: [],
      });
      setProfiles(prev => [...prev, created]);
      setSelectedProfile(created);
      setSelectedUsageType(created.usage_type);
      setWorkingChain([]);
      setWorkingUtilityNodes([]);
      setModelOverrides({});
      setCreatingProfile(false);
      setNewProfileName('');
      showSuccess(`Profile "${created.name}" criado`);
    } catch (error) {
      showError('Falha ao criar profile');
    }
  };

  const handleDeleteProfile = async (profileId: string) => {
    try {
      await aiFlowApi.deleteProfile(profileId);
      setProfiles(prev => prev.filter(p => p.id !== profileId));
      if (selectedProfile?.id === profileId) {
        setSelectedProfile(null);
        setWorkingChain([]);
        setWorkingUtilityNodes([]);
      }
      showSuccess('Profile excluído');
    } catch (error) {
      showError('Falha ao excluir profile');
    }
  };

  const handleActivateProfile = async (profileId: string) => {
    try {
      const activated = await aiFlowApi.activateProfile(profileId);
      // Update profiles list
      setProfiles(prev => prev.map(p => {
        if (p.id === profileId) return { ...p, is_active: true };
        if (p.usage_type === activated.usage_type) return { ...p, is_active: false };
        return p;
      }));
      setSelectedProfile(activated);
      showSuccess(`Profile "${activated.name}" ativado`);
    } catch (error) {
      showError('Falha ao ativar profile');
    }
  };

  // ── Open edit profile modal ──────────────────────────────────────
  const handleOpenEditProfile = (profile: AIFlowProfile) => {
    setEditingProfile(profile);
    setEditProfileName(profile.name);
    setEditProfileUsageType(profile.usage_type);
  };

  const handleSaveEditProfile = async () => {
    if (!editingProfile?.id || !editProfileName.trim()) return;
    try {
      const updated = await aiFlowApi.updateProfile(editingProfile.id, {
        name: editProfileName.trim(),
        usage_type: editProfileUsageType as any,
      });
      setProfiles(prev => prev.map(p => (p.id === updated.id ? updated : p)));
      if (selectedProfile?.id === updated.id) {
        setSelectedProfile(updated);
      }
      setEditingProfile(null);
      showSuccess(`Profile "${updated.name}" atualizado`);
    } catch {
      showError('Falha ao atualizar profile');
    }
  };

  // PROMPT #124 / #209 - Apply template (models + utility nodes)
  const handleApplyTemplate = (template: AIFlowChainTemplate) => {
    setWorkingChain(template.chain);
    if (template.utility_nodes && template.utility_nodes.length > 0) {
      setWorkingUtilityNodes(template.utility_nodes);
    }
    showSuccess(`Template "${template.name}" aplicado (não salvo)`);
  };

  // PROMPT #124 - Apply optimize result
  const handleApplyOptimize = (order: string[]) => {
    setWorkingChain(order);
    setShowOptimize(false);
    showSuccess('Ordem otimizada aplicada (não salvo)');
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-screen">
          <Spinner size="xl" />
        </div>
      </Layout>
    );
  }

  // Check if working chain differs from saved chain
  // Compare working state with saved state (profile or chain)
  const savedSource = selectedProfile || currentChain;
  const savedChainStr = JSON.stringify(savedSource?.chain || []);
  const workingChainStr = JSON.stringify(workingChain);
  const savedUtilityStr = JSON.stringify(savedSource?.utility_nodes || []);
  const workingUtilityStr = JSON.stringify(workingUtilityNodes);
  const savedOverridesStr = JSON.stringify((savedSource?.node_positions as any)?.__model_overrides || {});
  const workingOverridesStr = JSON.stringify(modelOverrides);
  const hasUnsavedChanges = savedChainStr !== workingChainStr || savedUtilityStr !== workingUtilityStr || savedOverridesStr !== workingOverridesStr || positionsChanged;

  return (
    <Layout>
      <Breadcrumbs />

      {/* Tab Navigation */}
      <div className="flex items-center gap-1 mb-3 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('models')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'models'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            Modelos
          </span>
        </button>
        <button
          onClick={() => setActiveTab('operations')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'operations'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Operacoes
          </span>
        </button>
        <button
          onClick={() => setActiveTab('pipeline')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'pipeline'
              ? 'border-purple-600 text-purple-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
            Pipeline
          </span>
        </button>
      </div>

      {/* Tab Content: Models */}
      {activeTab === 'models' && (
        <div className="flex flex-col" style={{ height: 'calc(100vh - 170px)' }}>
          <ModelsTab />
        </div>
      )}

      {/* Tab Content: Pipeline */}
      {activeTab === 'pipeline' && (
        <div className="flex flex-col" style={{ height: 'calc(100vh - 170px)' }}>
          <PipelineTab projectId={projectParam || undefined} />
        </div>
      )}

      {/* Tab Content: Operations */}
      {activeTab === 'operations' && (
      <div className="flex flex-col" style={{ height: showAnalytics ? 'calc(100vh - 170px)' : 'calc(100vh - 170px)' }}>
        {/* Controls bar */}
        <div className="flex items-center justify-between px-3 py-2 bg-white border rounded-lg mb-3 flex-shrink-0">
          <div className="flex items-center gap-3">
            {selectedProfile && (
              <span className="text-sm font-medium text-gray-900">
                {selectedProfile.name} <span className="text-gray-400">v{selectedProfile.version}</span>
              </span>
            )}
            {(workingChain.length > 0 || workingUtilityNodes.length > 0) && (
              <span className="text-xs text-gray-500">
                {workingChain.length} modelo{workingChain.length !== 1 ? 's' : ''}
                {workingUtilityNodes.length > 0 && ` + ${workingUtilityNodes.length} nó${workingUtilityNodes.length !== 1 ? 's' : ''}`}
              </span>
            )}
            {hasUnsavedChanges && (
              <span className="text-xs text-amber-600 font-medium">Alterações não salvas</span>
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
                <Spinner size="xs" />
              ) : (
                <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
              Salvar
            </Button>
          </div>
        </div>

        {/* Main content - 3 columns */}
        <div className="flex gap-3 flex-1 min-h-0">

          {/* LEFT COLUMN: Profiles */}
          <div className="w-64 border rounded-lg bg-white overflow-hidden flex flex-col flex-shrink-0">
            {/* Optimize button */}
            <div className="border-b p-3">
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
            </div>

            {/* Profiles list */}
            <div className="flex-1 overflow-y-auto p-3">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Profiles</h3>
              <div className="space-y-1.5">
                {profiles.map((profile) => {
                  const isSelected = selectedProfile?.id === profile.id;
                  const usageLabel = USAGE_TYPE_OPTIONS.find(o => o.value === profile.usage_type)?.label || profile.usage_type;
                  return (
                    <div
                      key={profile.id}
                      onClick={() => handleSelectProfile(profile)}
                      onDoubleClick={() => handleOpenEditProfile(profile)}
                      className={`group relative cursor-pointer p-2.5 rounded-md border transition-colors ${
                        isSelected
                          ? 'bg-blue-50 border-blue-200'
                          : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex-1 min-w-0">
                          <div className={`text-xs font-medium truncate ${isSelected ? 'text-blue-700' : 'text-gray-900'}`}>
                            {profile.name}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{usageLabel}</span>
                            <span className="text-[10px] text-gray-400">v{profile.version}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          {!profile.is_active && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleActivateProfile(profile.id); }}
                              title="Ativar"
                              className="p-0.5 text-green-500 hover:text-green-700"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            </button>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteProfile(profile.id); }}
                            title="Excluir"
                            className="p-0.5 text-red-400 hover:text-red-600"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      {profile.is_active && (
                        <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-green-400" title="Ativo" />
                      )}
                    </div>
                  );
                })}

                {profiles.length === 0 && (
                  <p className="text-xs text-gray-400 italic">Nenhum profile criado</p>
                )}
              </div>

              {/* Create profile */}
              {creatingProfile ? (
                <div className="mt-3 space-y-2 border-t pt-3">
                  <input
                    type="text"
                    value={newProfileName}
                    onChange={(e) => setNewProfileName(e.target.value)}
                    placeholder="Nome do profile"
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && handleCreateProfile()}
                  />
                  <select
                    value={newProfileUsageType}
                    onChange={(e) => setNewProfileUsageType(e.target.value)}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {USAGE_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <div className="flex gap-1.5">
                    <button
                      onClick={handleCreateProfile}
                      className="flex-1 px-2 py-1 bg-blue-600 text-white text-xs rounded-md hover:bg-blue-700"
                    >
                      Criar
                    </button>
                    <button
                      onClick={() => { setCreatingProfile(false); setNewProfileName(''); }}
                      className="flex-1 px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-md hover:bg-gray-200"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setCreatingProfile(true)}
                  className="w-full mt-3 flex items-center justify-center gap-1.5 p-2 rounded-md border border-dashed border-gray-300 text-xs text-gray-500 hover:bg-gray-50 hover:border-gray-400 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Novo Profile
                </button>
              )}
            </div>
          </div>

          {/* CENTER: ReactFlow Canvas */}
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
                edgeTypes={edgeTypes}
                defaultEdgeOptions={{ type: 'smartEdge' }}
                connectionLineType={ConnectionLineType.SmoothStep}
                connectionLineStyle={{ stroke: '#6b7280', strokeWidth: 2 }}
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

          {/* RIGHT COLUMN: Operations */}
          <div className="w-72 border rounded-lg bg-white overflow-hidden flex flex-col flex-shrink-0">
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
                <h3 className="text-sm font-semibold text-gray-900 mb-2">Modelos Disponíveis</h3>
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
                <h3 className="text-sm font-semibold text-gray-900 mb-2">Nós do Fluxo</h3>
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
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/json', JSON.stringify({
                          type: nodeType.type,
                          label: nodeType.label,
                          description: nodeType.description,
                        }));
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-gray-50 border border-transparent hover:border-gray-200 transition-colors text-left cursor-grab active:cursor-grabbing"
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
              <h3 className="text-sm font-semibold text-gray-900">Analíticos da Cadeia</h3>
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
            Os modelos são testados em ordem. Se um falhar, o próximo é usado automaticamente.
            Adicione nós utilitários (Cache, RAG, Validador, etc.) para pré/pós-processamento.
            Métricas atualizam a cada 30s.
            {' '}<a href="/ai-models" className="underline font-medium">Gerenciar modelos</a>
          </span>
        </div>
      </div>
      )} {/* End of activeTab === 'operations' */}

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

      {/* Edit Profile Dialog */}
      {editingProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setEditingProfile(null)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between bg-gray-50">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Editar Profile</h3>
                <p className="text-xs text-gray-500 mt-0.5">Altere o nome e o tipo de uso do profile.</p>
              </div>
              <button onClick={() => setEditingProfile(null)} className="text-gray-400 hover:text-gray-600 ml-4 flex-shrink-0 mt-0.5">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nome</label>
                <input
                  type="text"
                  value={editProfileName}
                  onChange={(e) => setEditProfileName(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:ring-1 focus:ring-purple-500 focus:border-purple-500"
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveEditProfile()}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Tipo de Uso</label>
                <select
                  value={editProfileUsageType}
                  onChange={(e) => setEditProfileUsageType(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:ring-1 focus:ring-purple-500 focus:border-purple-500"
                >
                  {USAGE_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
              <button
                onClick={() => setEditingProfile(null)}
                className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveEditProfile}
                disabled={!editProfileName.trim()}
                className="px-3 py-1.5 text-sm text-white bg-purple-600 rounded-md hover:bg-purple-700 transition-colors disabled:opacity-40"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
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

export default function AIFlowPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <Spinner size="xl" />
      </div>
    }>
      <AIFlowPageContent />
    </Suspense>
  );
}

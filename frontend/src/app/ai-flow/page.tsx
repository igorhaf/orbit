/**
 * AI Studio — unified node-red style canvas (v3.0).
 *
 * Single infinite canvas where Modelos, Pipeline Phases, Utility Nodes
 * and collapsible Subflows are all node types. Typed connections.
 * Right-side NodeInspector edits the selected node. Bottom DebugPanel
 * shows the last run's telemetry. Top NodeCatalogToolbar adds nodes
 * and triggers runs.
 *
 * Replaces the previous 3-tab layout (models | operations | pipeline).
 */
'use client';

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { Layout, Breadcrumbs } from '@/components/layout';
import { Spinner } from '@/components/ui';
import { useNotification } from '@/hooks';
import { aiFlowApi, aiModelsApi } from '@/lib/api';

import { nodeTypes } from '@/components/ai-flow/FlowNodes';
import SmartEdge from '@/components/ai-flow/SmartEdge';
import { NodeCatalogToolbar } from '@/components/ai-flow/NodeCatalogToolbar';
import { NodeInspector } from '@/components/ai-flow/NodeInspector';
import { DebugPanel, type DebugEvent } from '@/components/ai-flow/DebugPanel';
import { CanvasTabBar } from '@/components/ai-flow/CanvasTabBar';
import { CanvasSidebar } from '@/components/ai-flow/CanvasSidebar';
import { SubflowRunDialog } from '@/components/ai-flow/SubflowRunDialog';
import { useCanvasState, type Subflow } from '@/hooks/useCanvasState';
import { useConnectionValidator } from '@/hooks/useConnectionValidator';
import { useDeepPipelineProgress, type PhaseState } from '@/hooks/useDeepPipelineProgress';

interface CatalogItem {
  id: string;
  type: string;
  data: any;
}
interface Catalog {
  models: CatalogItem[];
  utilities: CatalogItem[];
}

const edgeTypes = { smartEdge: SmartEdge };

interface Profile {
  id: string;
  name: string;
  usage_type: string;
  version: number;
  is_active: boolean;
  chain: string[];
  utility_nodes?: any[];
  node_positions?: Record<string, { x: number; y: number }>;
  subflows?: Record<string, Subflow>;
}

export default function AIFlowPage() {
  return (
    <ReactFlowProvider>
      <AIFlowPageInner />
    </ReactFlowProvider>
  );
}

function AIFlowPageInner() {
  const { showError, showSuccess, NotificationComponent } = useNotification();
  const reactFlowInstance = useReactFlow();

  // Profiles + active selection
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);

  // Models catalog (for resolving Modelo node data when reloading)
  const [models, setModels] = useState<any[]>([]);

  // v3.2: sidebar catalog (pre-configured templates — drag to canvas)
  const [catalog, setCatalog] = useState<Catalog>({ models: [], utilities: [] });

  // Canvas state
  const canvas = useCanvasState({});

  // Connection validator (typed)
  const validator = useConnectionValidator(canvas.nodes, canvas.setEdges, canvas.markDirty);

  // Debug panel state
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugEvents, setDebugEvents] = useState<DebugEvent[]>([]);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  // Track selection count for subflow grouping
  const [selectionIds, setSelectionIds] = useState<string[]>([]);

  // v3.1: SubflowRunDialog visibility + currently-running project
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [runningProjectId, setRunningProjectId] = useState<string | null>(null);

  // v3.1: hook into deep_pipeline progress for phase animation
  const progress = useDeepPipelineProgress(runningProjectId);

  // ── Load full project snapshot on mount (v3.0) ─────────────────────
  // The snapshot endpoint returns ALL models, chains and Deep Pipeline
  // phases pre-arranged as canvas nodes/edges/subflows.
  useEffect(() => {
    Promise.all([
      aiFlowApi.canvasSnapshot(),
      aiFlowApi.listProfiles(),
      aiModelsApi.list(),
    ])
      .then(([snap, ps, ms]) => {
        setProfiles(ps as Profile[]);
        setModels(ms as any[]);
        const active = (ps as Profile[]).find((p) => p.is_active) || (ps as Profile[])[0];
        if (active) setActiveProfileId(active.id);
        // Hydrate canvas from snapshot
        canvas.setNodes(snap.nodes as Node[]);
        canvas.setEdges(snap.edges as any);
        canvas.setSubflows(snap.subflows as any);
        // v3.2: sidebar catalog
        if ((snap as any).catalog) {
          setCatalog((snap as any).catalog as Catalog);
        }
        canvas.markClean();
      })
      .catch((e) => showError(`Falha ao carregar canvas: ${e?.message || e}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const loadProfileIntoCanvas = useCallback(
    (profile: Profile, modelsCatalog: any[]) => {
      const nodes: Node[] = [];
      const positions = profile.node_positions || {};
      // Model nodes (from chain)
      profile.chain.forEach((modelId, idx) => {
        const m = modelsCatalog.find((mm) => mm.id === modelId);
        const id = `model-${modelId}`;
        nodes.push({
          id,
          type: 'modelNode',
          position: positions[id] || { x: 100 + idx * 240, y: 100 },
          data: {
            label: m?.name || modelId,
            provider: 'claudius',
            config: m?.config || {},
            rate_limit_requests: m?.rate_limit_requests,
            timeout_seconds: m?.timeout_seconds,
            model_id: modelId,
          },
        });
      });
      // Utility nodes
      (profile.utility_nodes || []).forEach((un: any, idx) => {
        const id = un.id || `util-${idx}`;
        nodes.push({
          id,
          type: `${un.type.replace(/_(.)/g, (_, c) => c.toUpperCase())}Node`.replace('Node', 'Node'), // basic conversion
          position: positions[id] || { x: 600, y: 100 + idx * 120 },
          data: { label: un.label, config: un.config || {}, enabled: un.enabled !== false, type: un.type },
        });
      });
      // Subflow nodes (representation)
      Object.entries(profile.subflows || {}).forEach(([sfId, sf]) => {
        nodes.push({
          id: `sf-${sfId}`,
          type: 'subflowNode',
          position: sf.position || { x: 100, y: 400 },
          data: {
            label: sf.label,
            collapsed: sf.collapsed,
            node_count: sf.node_ids.length,
          },
        });
      });
      canvas.setNodes(nodes);
      canvas.setEdges([]);
      canvas.setSubflows(profile.subflows || {});
      canvas.markClean();
    },
    [canvas],
  );

  const onSelectProfile = useCallback(
    (id: string) => {
      setActiveProfileId(id);
      const p = profiles.find((pp) => pp.id === id);
      if (p) loadProfileIntoCanvas(p, models);
    },
    [profiles, models, loadProfileIntoCanvas],
  );

  // ── Toolbar handlers ────────────────────────────────────────────────
  const addModelNode = useCallback(
    async (modelId: 'claude-opus-4-7' | 'claude-sonnet-4-6' | 'claude-haiku-4-5') => {
      // Create a model in the catalog if it doesn't already exist for this usage_type
      const existing = models.find((m: any) => m.config?.model_id === modelId);
      let m = existing;
      if (!m) {
        try {
          m = await aiModelsApi.create({
            name: `Claudius ${modelId} (Canvas)`,
            provider: 'claudius',
            api_key: 'not-needed',
            usage_type: 'general',
            is_active: true,
            config: { model_id: modelId, max_tokens: 4096, temperature: 0.7 },
          });
          setModels((arr) => [...arr, m]);
        } catch (e: any) {
          showError(`Falha ao criar modelo: ${e?.message || e}`);
          return;
        }
      }
      const newNode: Node = {
        id: `model-${m.id}-${Date.now()}`,
        type: 'modelNode',
        position: { x: 200 + Math.random() * 100, y: 200 + Math.random() * 100 },
        data: {
          label: m.name,
          provider: 'claudius',
          config: m.config || {},
          model_id: modelId,
        },
      };
      canvas.setNodes((ns) => [...ns, newNode]);
      canvas.markDirty();
    },
    [models, canvas, showError],
  );

  const addPhaseNode = useCallback(
    (phaseKey: string) => {
      const newNode: Node = {
        id: `phase-${phaseKey}-${Date.now()}`,
        type: 'pipelinePhaseNode',
        position: { x: 200 + Math.random() * 100, y: 200 + Math.random() * 100 },
        data: { label: phaseKey, phase_key: phaseKey, model_count: 0 },
      };
      canvas.setNodes((ns) => [...ns, newNode]);
      canvas.markDirty();
    },
    [canvas],
  );

  const addUtilityNode = useCallback(
    (utilityType: string) => {
      const typeMap: Record<string, string> = {
        cache: 'cacheNode',
        rag_context: 'ragContextNode',
        prompt_transformer: 'promptTransformerNode',
        router: 'routerNode',
        retry: 'retryNode',
        validator: 'validatorNode',
        cost_guard: 'costGuardNode',
        rate_limiter: 'rateLimiterNode',
        timeout: 'timeoutNode',
      };
      const newNode: Node = {
        id: `util-${utilityType}-${Date.now()}`,
        type: typeMap[utilityType] || 'cacheNode',
        position: { x: 200 + Math.random() * 100, y: 200 + Math.random() * 100 },
        data: { label: utilityType, type: utilityType, config: {}, enabled: true },
      };
      canvas.setNodes((ns) => [...ns, newNode]);
      canvas.markDirty();
    },
    [canvas],
  );

  const groupIntoSubflow = useCallback(() => {
    if (selectionIds.length < 2) return;
    const sfId = `sf_${Date.now()}`;
    const memberNodes = canvas.nodes.filter((n) => selectionIds.includes(n.id));
    const avgX = memberNodes.reduce((s, n) => s + n.position.x, 0) / memberNodes.length;
    const avgY = memberNodes.reduce((s, n) => s + n.position.y, 0) / memberNodes.length;
    const sf: Subflow = {
      label: `Subflow ${Object.keys(canvas.subflows).length + 1}`,
      node_ids: selectionIds,
      position: { x: avgX, y: avgY },
      collapsed: true,
    };
    canvas.setSubflows({ ...canvas.subflows, [sfId]: sf });
    // Add a representative subflow node
    canvas.setNodes((ns) => [
      ...ns,
      {
        id: `sf-${sfId}`,
        type: 'subflowNode',
        position: sf.position,
        data: { label: sf.label, collapsed: true, node_count: sf.node_ids.length },
      },
    ]);
    canvas.markDirty();
    showSuccess(`${selectionIds.length} nodes agrupados em "${sf.label}"`);
  }, [selectionIds, canvas, showSuccess]);

  const onSave = useCallback(async () => {
    try {
      // 1. Persist per-model edits (every modelNode that has ai_model_id)
      const modelNodes = canvas.nodes.filter((n) => n.type === 'modelNode' && n.data?.ai_model_id);
      const modelPatches = modelNodes.map(async (n) => {
        const d: any = n.data || {};
        try {
          await aiModelsApi.update(d.ai_model_id, {
            name: d.label,
            config: d.config,
            rate_limit_requests: d.rate_limit_requests,
            timeout_seconds: d.timeout_seconds,
          });
        } catch (err) {
          // best-effort per model; collect failures below
          // eslint-disable-next-line no-console
          console.warn(`PATCH ai-models/${d.ai_model_id} failed`, err);
        }
      });
      await Promise.allSettled(modelPatches);

      // 2. Persist layout + subflows in the active profile (creates one if missing)
      const node_positions: Record<string, { x: number; y: number }> = {};
      canvas.nodes.forEach((n) => { node_positions[n.id] = n.position; });

      // Build chain from non-subflow model node order (left→right)
      const chain = canvas.nodes
        .filter((n) => n.type === 'modelNode')
        .sort((a, b) => a.position.x - b.position.x)
        .map((n) => (n.data?.ai_model_id as string) || n.id);

      const utility_nodes = canvas.nodes
        .filter((n) => n.type && (n.type as string).endsWith('Node')
          && n.type !== 'modelNode'
          && n.type !== 'pipelinePhaseNode'
          && n.type !== 'subflowNode')
        .map((n) => ({
          id: n.id,
          type: (n.data?.type as string) || (n.type as string).replace('Node', '').toLowerCase(),
          label: n.data?.label,
          config: n.data?.config || {},
          enabled: n.data?.enabled !== false,
        }));

      if (activeProfileId) {
        await aiFlowApi.updateProfile(activeProfileId, {
          chain,
          utility_nodes,
          node_positions,
          subflows: canvas.subflows,
        });
      } else {
        const created = await aiFlowApi.createProfile({
          name: 'Canvas',
          usage_type: 'general',
          chain,
          utility_nodes,
          node_positions,
          subflows: canvas.subflows,
        });
        setActiveProfileId((created as any).id);
      }
      canvas.markClean();
      showSuccess(`Canvas salvo · ${modelNodes.length} modelos atualizados`);
      const ps = await aiFlowApi.listProfiles();
      setProfiles(ps as Profile[]);
      const ms = await aiModelsApi.list();
      setModels(ms as any[]);
    } catch (e: any) {
      showError(`Falha ao salvar: ${e?.message || e}`);
    }
  }, [activeProfileId, canvas, showError, showSuccess]);

  const onRun = useCallback(async () => {
    setRunning(true);
    setLastRunAt(new Date().toISOString());
    // v3.1: Run opens the SubflowRunDialog (project + mode picker).
    // Confirmed dispatch flows back via SubflowRunDialog.onConfirmed.
    setRunDialogOpen(true);
    setRunning(false);
  }, []);

  // v3.1 — open subflow tab on canvas open action
  const openSubflowTab = canvas.openSubflowTab;
  // Inject runtime callbacks + animation states into nodes
  const enhancedNodes = useMemo(() => {
    return canvas.visibleNodes.map((n) => {
      // SubflowNode: aggregate state of inner phases
      if (n.type === 'subflowNode') {
        const sfId = n.id.replace(/^sf-/, '');
        const sf = canvas.subflows[sfId];
        let animation: PhaseState = 'idle';
        if (sf?.node_ids?.length) {
          const innerStates = sf.node_ids
            .map((nid: string) => {
              // Phase node ids look like "phase-{phase_key}"
              const m = /^phase-(.+)$/.exec(nid);
              return m ? progress.phaseStates[m[1]] : undefined;
            })
            .filter(Boolean) as PhaseState[];
          if (innerStates.some((s) => s === 'running')) animation = 'running';
          else if (innerStates.some((s) => s === 'failed')) animation = 'failed';
          else if (innerStates.length > 0 && innerStates.every((s) => s === 'success')) animation = 'success';
        }
        return {
          ...n,
          data: {
            ...n.data,
            animation: animation === 'running' ? 'executing' : animation,
            onOpen: () => openSubflowTab(sfId, n.data?.label || sf?.label || sfId),
            onToggleCollapsed: () => canvas.toggleSubflowCollapsed(sfId),
          },
        };
      }
      // PipelinePhaseNode: animation from progress.phaseStates
      if (n.type === 'pipelinePhaseNode') {
        const pk = n.data?.phase_key;
        const state: PhaseState = (pk && progress.phaseStates[pk]) || 'idle';
        return {
          ...n,
          data: {
            ...n.data,
            animation: state === 'running' ? 'executing' : state,
          },
        };
      }
      return n;
    });
  }, [canvas.visibleNodes, canvas.subflows, canvas.toggleSubflowCollapsed, openSubflowTab, progress.phaseStates]);

  // v3.1 — annotate edges with flowing=true when they're currently animated
  const enhancedEdges = useMemo(() => {
    return canvas.visibleEdges.map((e) => {
      const flowing = progress.flowingEdges.has(e.id);
      return flowing
        ? { ...e, data: { ...(e.data || {}), flowing: true } }
        : e;
    });
  }, [canvas.visibleEdges, progress.flowingEdges]);

  // Tabs running indicator (used by CanvasTabBar)
  const runningTabIds = useMemo(() => {
    const s = new Set<string>();
    if (Object.values(progress.phaseStates).some((st) => st === 'running')) {
      // Mark the canvas tab as running too
      s.add('canvas');
      // Mark each subflow tab whose group has a running phase
      canvas.openTabs.forEach((t) => {
        if (!t.subflowId) return;
        const sf = canvas.subflows[t.subflowId];
        if (!sf) return;
        const hasRunning = sf.node_ids.some((nid: string) => {
          const m = /^phase-(.+)$/.exec(nid);
          return m && progress.phaseStates[m[1]] === 'running';
        });
        if (hasRunning) s.add(t.id);
      });
    }
    return s;
  }, [canvas.openTabs, canvas.subflows, progress.phaseStates]);

  // Stable refs to avoid re-subscribing xyflow on every render
  const setSelectedNodeIdRef = useRef(canvas.setSelectedNodeId);
  setSelectedNodeIdRef.current = canvas.setSelectedNodeId;

  const onSelectionChange = useCallback(({ nodes }: { nodes: Node[] }) => {
    setSelectionIds((prev) => {
      const next = nodes.map((n) => n.id);
      // Avoid setState when nothing actually changed
      if (prev.length === next.length && prev.every((id, i) => id === next[i])) return prev;
      return next;
    });
    if (nodes.length === 1) setSelectedNodeIdRef.current(nodes[0].id);
    else if (nodes.length === 0) setSelectedNodeIdRef.current(null);
  }, []);

  // Show validator rejection as toast
  useEffect(() => {
    if (validator.lastRejection) {
      showError(`Conexão inválida: ${validator.lastRejection.reason}`);
      validator.clearRejection();
    }
  }, [validator.lastRejection, validator.clearRejection, showError]);

  // v3.2: drag-and-drop from sidebar catalog onto the canvas
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData('application/x-ai-flow-catalog-item');
      if (!raw) return;
      let item: CatalogItem;
      try {
        item = JSON.parse(raw);
      } catch {
        return;
      }
      const position = reactFlowInstance.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });
      const newNode: Node = {
        id: `${item.id}-${Date.now()}`,
        type: item.type,
        position,
        data: { ...item.data },
      };
      canvas.setNodes((ns) => [...ns, newNode]);
      canvas.markDirty();
    },
    [reactFlowInstance, canvas],
  );

  return (
    <Layout>
      <Breadcrumbs />
      <div className="flex flex-col" style={{ height: 'calc(100vh - 110px)' }}>
        <NodeCatalogToolbar
          profiles={profiles.map((p) => ({ id: p.id, name: p.name, is_active: p.is_active }))}
          activeProfileId={activeProfileId}
          onSelectProfile={onSelectProfile}
          onAddModel={addModelNode}
          onAddPhase={addPhaseNode}
          onAddUtility={addUtilityNode}
          onGroupSubflow={groupIntoSubflow}
          onRun={onRun}
          onSave={onSave}
          onOptimize={() => showError('Otimização — pendente nesta entrega')}
          onToggleDebug={() => setDebugOpen((o) => !o)}
          dirty={canvas.dirty}
          running={running}
          selectionCount={selectionIds.length}
        />

        {/* v3.1: tabs replace breadcrumbs as the subflow navigation */}
        <CanvasTabBar
          tabs={canvas.openTabs}
          activeTabId={canvas.activeTabId}
          onSelectTab={canvas.setActiveTab}
          onCloseTab={canvas.closeTab}
          runningTabIds={runningTabIds}
        />

        <div className="flex flex-1 min-h-0">
          {/* v3.2: left sidebar — catalog (top) + canvas objects (bottom) */}
          <CanvasSidebar
            catalog={catalog}
            canvasNodes={canvas.nodes}
            selectedNodeId={canvas.selectedNodeId}
            onSelectCanvasNode={canvas.setSelectedNodeId}
          />
          <div className="flex-1 relative" onDrop={onDrop} onDragOver={onDragOver}>
            <ReactFlow
              nodes={enhancedNodes}
              edges={enhancedEdges}
              onNodesChange={canvas.onNodesChange}
              onEdgesChange={canvas.onEdgesChange}
              onConnect={validator.onConnect}
              onSelectionChange={onSelectionChange}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              fitView
              snapToGrid
              snapGrid={[20, 20]}
              minZoom={0.2}
              maxZoom={2}
            >
              <Background gap={20} size={1} />
              <Controls />
              <MiniMap pannable zoomable />
            </ReactFlow>
          </div>
          {canvas.selectedNode && (
            <NodeInspector
              node={canvas.selectedNode}
              onClose={() => canvas.setSelectedNodeId(null)}
              onUpdate={(id, patch) => {
                canvas.setNodes((ns) =>
                  ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
                );
                canvas.markDirty();
              }}
              onDelete={(id) => {
                canvas.setNodes((ns) => ns.filter((n) => n.id !== id));
                canvas.setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
                canvas.markDirty();
              }}
            />
          )}
        </div>

        <DebugPanel
          open={debugOpen}
          onClose={() => setDebugOpen(false)}
          events={debugEvents}
          lastRunAt={lastRunAt}
        />
      </div>
      {/* v3.1: Run dialog (project picker + mode) */}
      <SubflowRunDialog
        isOpen={runDialogOpen}
        onClose={() => setRunDialogOpen(false)}
        onConfirmed={(projectId, _jobId) => {
          setRunningProjectId(projectId);
          showSuccess('Pipeline iniciado — observe a animação no canvas');
          setDebugOpen(true);
          setLastRunAt(new Date().toISOString());
        }}
      />

      {NotificationComponent}
    </Layout>
  );
}

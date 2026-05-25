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
import { SubflowBreadcrumbs } from '@/components/ai-flow/SubflowBreadcrumbs';
import { useCanvasState, type Subflow } from '@/hooks/useCanvasState';
import { useConnectionValidator } from '@/hooks/useConnectionValidator';

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
  const { showError, showSuccess, NotificationComponent } = useNotification();

  // Profiles + active selection
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);

  // Models catalog (for resolving Modelo node data when reloading)
  const [models, setModels] = useState<any[]>([]);

  // Canvas state
  const canvas = useCanvasState({});

  // Connection validator (typed)
  const validator = useConnectionValidator(canvas.nodes, canvas.setEdges);

  // Debug panel state
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugEvents, setDebugEvents] = useState<DebugEvent[]>([]);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  // Track selection count for subflow grouping
  const [selectionIds, setSelectionIds] = useState<string[]>([]);

  // ── Load profiles + models on mount ────────────────────────────────
  useEffect(() => {
    Promise.all([aiFlowApi.listProfiles(), aiModelsApi.list()])
      .then(([ps, ms]) => {
        setProfiles(ps as Profile[]);
        setModels(ms as any[]);
        const active = (ps as Profile[]).find((p) => p.is_active) || (ps as Profile[])[0];
        if (active) {
          setActiveProfileId(active.id);
          loadProfileIntoCanvas(active, ms as any[]);
        }
      })
      .catch((e) => showError(`Falha ao carregar profiles: ${e?.message || e}`));
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
    if (!activeProfileId) {
      showError('Nenhum profile selecionado pra salvar');
      return;
    }
    try {
      // Snapshot positions
      const node_positions: Record<string, { x: number; y: number }> = {};
      canvas.nodes.forEach((n) => { node_positions[n.id] = n.position; });
      // Snapshot chain (model node ids)
      const chain = canvas.nodes
        .filter((n) => n.type === 'modelNode')
        .map((n) => (n.data?.model_id as string) || n.id);
      // Utility nodes
      const utility_nodes = canvas.nodes
        .filter((n) => n.type && n.type.endsWith('Node') && n.type !== 'modelNode' && n.type !== 'pipelinePhaseNode' && n.type !== 'subflowNode')
        .map((n) => ({
          id: n.id,
          type: n.data?.type || (n.type as string).replace('Node', '').toLowerCase(),
          label: n.data?.label,
          config: n.data?.config || {},
          enabled: n.data?.enabled !== false,
        }));
      await aiFlowApi.updateProfile(activeProfileId, {
        chain,
        utility_nodes,
        node_positions,
        subflows: canvas.subflows,
      });
      canvas.markClean();
      showSuccess('Profile salvo');
      // Refetch
      const ps = await aiFlowApi.listProfiles();
      setProfiles(ps as Profile[]);
    } catch (e: any) {
      showError(`Falha ao salvar: ${e?.message || e}`);
    }
  }, [activeProfileId, canvas, showError, showSuccess]);

  const onRun = useCallback(async () => {
    setRunning(true);
    setLastRunAt(new Date().toISOString());
    setDebugOpen(true);
    setDebugEvents([
      { id: '1', node_id: 'system', node_label: 'system', status: 'success', ts: new Date().toISOString(),
        message: 'Run via canvas — implementação backend pendente (POST /api/v1/ai-flow/profiles/{id}/run-canvas)' },
    ]);
    setTimeout(() => setRunning(false), 800);
  }, []);

  // Inject toggle/enter callbacks into subflow nodes
  const enhancedNodes = useMemo(() => {
    return canvas.visibleNodes.map((n) => {
      if (n.type === 'subflowNode') {
        const sfId = n.id.replace(/^sf-/, '');
        return {
          ...n,
          data: {
            ...n.data,
            onToggleCollapsed: () => canvas.toggleSubflowCollapsed(sfId),
            onEnter: () => canvas.enterSubflow(sfId),
          },
        };
      }
      return n;
    });
  }, [canvas.visibleNodes, canvas.toggleSubflowCollapsed, canvas.enterSubflow]);

  const onSelectionChange = useCallback(({ nodes }: { nodes: Node[] }) => {
    setSelectionIds(nodes.map((n) => n.id));
    if (nodes.length === 1) canvas.setSelectedNodeId(nodes[0].id);
    else if (nodes.length === 0) canvas.setSelectedNodeId(null);
  }, [canvas]);

  // Show validator rejection as toast
  useEffect(() => {
    if (validator.lastRejection) {
      showError(`Conexão inválida: ${validator.lastRejection.reason}`);
      validator.clearRejection();
    }
  }, [validator.lastRejection, validator.clearRejection, showError]);

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

        <SubflowBreadcrumbs
          subflowStack={canvas.subflowStack}
          subflows={canvas.subflows}
          onPopTo={(i) => {
            if (i < 0) canvas.popToRoot();
            else while (canvas.subflowStack.length - 1 > i) canvas.exitSubflow();
          }}
        />

        <div className="flex flex-1 min-h-0">
          <div className="flex-1 relative">
            <ReactFlow
              nodes={enhancedNodes}
              edges={canvas.visibleEdges}
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
      {NotificationComponent}
    </Layout>
  );
}

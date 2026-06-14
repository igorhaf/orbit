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
  reconnectEdge,
  MarkerType,
  type Node,
  type Edge,
  type Connection,
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
import { useAIFlowProgress, type NodeRunState } from '@/hooks/useAIFlowProgress';
import { validatePipeline, validatePipelinePreRun } from '@/components/ai-flow/pipelineValidator';

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

  // v3.5: type schemas per kind (from snapshot) — used by validator + inspector
  const [typesSchema, setTypesSchema] = useState<Record<string, any>>({});

  // Canvas state
  const canvas = useCanvasState({});

  // Connection validator (typed) — v3.5 takes typesSchema for handle-level
  // type compatibility checks.
  const validator = useConnectionValidator(canvas.nodes, canvas.setEdges, canvas.markDirty, typesSchema);

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

  // v3.7.1: hook into AI Flow engine run progress (POST /ai-flow/run) —
  // anima nodes por node_id (não phase_key como Deep Pipeline).
  const [aiFlowJobId, setAiFlowJobId] = useState<string | null>(null);
  const flowProgress = useAIFlowProgress(aiFlowJobId);

  // Feed the DebugPanel from the same WS CustomEvent that drives node animation.
  // Previously setDebugEvents was never called — the panel was always empty.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const evType = detail.ai_flow_event;
      if (!evType || !detail.node_id) return;
      const statusMap: Record<string, DebugEvent['status']> = {
        node_started: 'running',
        node_completed: 'success',
        node_failed: 'failed',
        node_skipped: 'skipped',
      };
      const status = statusMap[evType];
      if (!status) return;
      setDebugEvents((prev) => [
        ...prev,
        {
          id: `${detail.node_id}-${evType}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          node_id: detail.node_id,
          node_label: detail.kind,
          status,
          duration_ms: detail.duration_ms,
          message: detail.error || undefined,
          output_keys: detail.output_keys,
          output_preview: detail.output_preview,
          ts: new Date().toISOString(),
        },
      ]);
    };
    window.addEventListener('aiFlowProgress', handler as EventListener);
    return () => window.removeEventListener('aiFlowProgress', handler as EventListener);
  }, []);

  // ── Load full project snapshot on mount (v3.0) ─────────────────────
  // v3.6.2: ref de mount guard evita hidratação dupla em React StrictMode
  // dev (que monta 2x propositalmente). Sem isso, a 2ª chamada sobrescreve
  // posições que o usuário pode ter movido entre a 1ª resposta e a 2ª.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
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
        if ((snap as any).catalog) {
          setCatalog((snap as any).catalog as Catalog);
        }
        if ((snap as any).types_schema) {
          setTypesSchema((snap as any).types_schema);
        }
        canvas.markClean();
      })
      .catch((e) => {
        hydratedRef.current = false; // permite retry se falhou
        showError(`Falha ao carregar canvas: ${e?.message || e}`);
      });
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

  // v3.6.3: estado do auto-save (visível no toolbar como indicador discreto)
  const [autoSaveState, setAutoSaveState] = useState<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle');

  const doSave = useCallback(async (silent: boolean) => {
    try {
      const validation = validatePipeline(canvas.nodes, canvas.edges, canvas.subflows, typesSchema);
      const errors = validation.issues.filter((i) => i.severity === 'error');
      if (errors.length > 0) {
        if (!silent) {
          const sample = errors.slice(0, 3).map((e) => `• ${e.message}`).join('\n');
          showError(`Pipeline inválido (${errors.length} erros):\n${sample}${errors.length > 3 ? `\n+${errors.length - 3} ...` : ''}`);
        }
        // eslint-disable-next-line no-console
        console.error('validatePipeline errors:', errors);
        setAutoSaveState('error');
        return false;
      }
      const warnings = validation.issues.filter((i) => i.severity === 'warning');
      if (warnings.length > 0) {
        // eslint-disable-next-line no-console
        console.warn('validatePipeline warnings:', warnings);
      }

      setAutoSaveState('saving');

      const modelEdits = canvas.nodes
        .filter((n) => n.type === 'modelNode' && n.data?.ai_model_id)
        .map((n) => {
          const d: any = n.data || {};
          return {
            ai_model_id: d.ai_model_id as string,
            name: d.label as string | undefined,
            config: d.config,
            rate_limit_requests: d.rate_limit_requests,
            timeout_seconds: d.timeout_seconds,
          };
        });

      const phase_configs: Record<string, any> = {};
      canvas.nodes.forEach((n) => {
        if (n.type === 'modelNode' && typeof n.data?.phase_key === 'string') {
          const pk = n.data.phase_key as string;
          const mid = (n.data as any)?.model_id || (n.data as any)?.config?.model_id;
          if (mid) {
            phase_configs[pk] = { ...(phase_configs[pk] || {}), model: mid };
          }
        }
      });

      const graph = {
        nodes: canvas.nodes,
        edges: canvas.edges,
        subflows: canvas.subflows,
      };

      const result = await aiFlowApi.canvasSave({
        models: modelEdits,
        phase_configs: Object.keys(phase_configs).length ? phase_configs : undefined,
        graph,
      });

      canvas.markClean();
      setAutoSaveState('saved');
      const errCount = (result.errors || []).length;

      if (!silent) {
        const msg = `Canvas salvo · ${result.models_updated} modelos · ${canvas.nodes.length} nodes` +
          (result.profile_updated ? ' · profile atualizado' : '') +
          (errCount ? ` · ${errCount} erros` : '');
        if (errCount) {
          showError(msg + ' — veja console');
          // eslint-disable-next-line no-console
          console.warn('canvas-save errors:', result.errors);
        } else {
          showSuccess(msg);
        }
        const ps = await aiFlowApi.listProfiles();
        setProfiles(ps as Profile[]);
        const ms = await aiModelsApi.list();
        setModels(ms as any[]);
      }
      return true;
    } catch (e: any) {
      setAutoSaveState('error');
      if (!silent) showError(`Falha ao salvar: ${e?.message || e}`);
      // eslint-disable-next-line no-console
      console.error('canvas-save failed:', e);
      return false;
    }
  }, [canvas, showError, showSuccess, typesSchema]);

  const onSave = useCallback(() => doSave(false), [doSave]);

  // v3.6.6: reset layout — descarta o grafo salvo no DB e recarrega o snapshot
  // default. Útil quando o usuário quer voltar pro padrão ou ver mudanças
  // estruturais no gerador do backend.
  const onResetLayout = useCallback(async () => {
    try {
      // Cancelar auto-save pendente pra não re-salvar enquanto resetamos
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      setAutoSaveState('saving');
      const result = await aiFlowApi.canvasReset();
      if (!result.reset) {
        showError(`Reset não aplicado: ${result.reason || 'desconhecido'}`);
        setAutoSaveState('idle');
        return;
      }
      // Re-hidrata o canvas com o snapshot default
      const snap = await aiFlowApi.canvasSnapshot();
      canvas.setNodes(snap.nodes as Node[]);
      canvas.setEdges(snap.edges as any);
      canvas.setSubflows(snap.subflows as any);
      if ((snap as any).catalog) setCatalog((snap as any).catalog as Catalog);
      if ((snap as any).types_schema) setTypesSchema((snap as any).types_schema);
      canvas.markClean();
      setAutoSaveState('idle');
      showSuccess(result.had_saved_graph
        ? 'Layout resetado — grafo customizado descartado'
        : 'Layout resetado (não havia customizações salvas)');
    } catch (e: any) {
      setAutoSaveState('error');
      showError(`Falha ao resetar: ${e?.message || e}`);
    }
  }, [canvas, showError, showSuccess]);

  // v3.6.3: AUTO-SAVE com debounce 1.5s. Dispara silenciosamente quando
  // `canvas.dirty` vira true (após arrastar node, criar/deletar edge etc).
  // Cancela o save anterior se nova mudança chega dentro da janela.
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!canvas.dirty) {
      // Reset indicador depois de alguns segundos quando salvo
      if (autoSaveState === 'saved') {
        const t = setTimeout(() => setAutoSaveState('idle'), 2500);
        return () => clearTimeout(t);
      }
      return;
    }
    setAutoSaveState('pending');
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      doSave(true);
    }, 1500);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [canvas.dirty, doSave, autoSaveState]);

  const onRun = useCallback(async () => {
    // Reset debug log for this run so the panel shows only the current execution.
    setDebugEvents([]);
    // v3.5.1: pre-run validation — rejeita rodar se houver subflows/nodes
    // soltos no fluxo. Mais estrito que o save validator.
    const validation = validatePipelinePreRun(canvas.nodes, canvas.edges, canvas.subflows, typesSchema);
    const errors = validation.issues.filter((i) => i.severity === 'error');
    if (errors.length > 0) {
      const sample = errors.slice(0, 4).map((e) => `• ${e.message}`).join('\n');
      showError(`Não posso executar — fluxo inválido (${errors.length} erros):\n${sample}${errors.length > 4 ? `\n+${errors.length - 4} mais...` : ''}`);
      // eslint-disable-next-line no-console
      console.error('validatePipelinePreRun errors:', errors);
      return;
    }

    // v3.7.0: dispara via Engine de execução (GraphExecutor backend).
    // Envia o grafo atual do canvas direto, sem precisar abrir dialog.
    setRunning(true);
    setLastRunAt(new Date().toISOString());
    try {
      const result = await aiFlowApi.runGraph({
        graph: {
          nodes: canvas.nodes as any[],
          edges: canvas.edges as any[],
          subflows: canvas.subflows as any,
        },
        // initial_inputs vazio por enquanto; iteração futura: project picker
      });
      if (result.error) {
        showError(`Engine: ${result.error}`);
      } else if (result.job_id) {
        // v3.7.1: salva jobId pra useAIFlowProgress animar nodes via WS
        setAiFlowJobId(result.job_id);
        showSuccess(`Engine iniciado · job ${result.job_id.slice(0, 8)} · ${result.total_nodes} nodes`);
        setDebugOpen(true); // mostra DebugPanel pra ver events do WS
      }
    } catch (e: any) {
      showError(`Falha ao executar: ${e?.message || e}`);
    } finally {
      setRunning(false);
    }
  }, [canvas, typesSchema, showError, showSuccess]);

  // v3.1 — open subflow tab on canvas open action
  const openSubflowTab = canvas.openSubflowTab;
  // Inject runtime callbacks + animation states into nodes
  // v3.7.1: helper unificado de animation por node.
  // PRIORIDADE: flowProgress.nodeStates (engine real, por node_id) > legacy
  // progress.phaseStates (Deep Pipeline antigo, por phase_key).
  const stateToAnim = (s: NodeRunState | PhaseState | undefined): string => {
    if (s === 'running') return 'executing';
    if (s === 'success') return 'success';
    if (s === 'failed') return 'failed';
    if (s === 'skipped') return 'skipped';
    return 'idle';
  };

  const enhancedNodes = useMemo(() => {
    return canvas.visibleNodes.map((n) => {
      // 1. Engine real (v3.7.1) tem prioridade absoluta — animação por node_id
      const flowState = flowProgress.nodeStates[n.id];

      // SubflowNode: aggregate state dos children
      if (n.type === 'subflowNode') {
        const sfId = n.id.replace(/^sf-/, '');
        const sf = canvas.subflows[sfId];
        let animation: NodeRunState | PhaseState = 'idle';
        if (sf?.node_ids?.length) {
          // v3.7.1: primeiro tenta engine real (flowProgress); fallback Deep Pipeline.
          const childStates: (NodeRunState | PhaseState)[] = [];
          for (const nid of sf.node_ids) {
            const fs = flowProgress.nodeStates[nid];
            if (fs) {
              childStates.push(fs);
              continue;
            }
            const m = /^phase-(.+)-model$/.exec(nid);
            if (m) {
              const ps = progress.phaseStates[m[1]];
              if (ps) childStates.push(ps);
            }
          }
          if (childStates.some((s) => s === 'running')) animation = 'running';
          else if (childStates.some((s) => s === 'failed')) animation = 'failed';
          else if (childStates.length > 0 && childStates.every((s) => s === 'success' || s === 'skipped')) animation = 'success';
        }
        return {
          ...n,
          data: {
            ...n.data,
            animation: stateToAnim(animation),
            onOpen: () => openSubflowTab(sfId, n.data?.label || sf?.label || sfId),
            onToggleCollapsed: () => canvas.toggleSubflowCollapsed(sfId),
          },
        };
      }

      // 2. Engine real por node_id (todos os outros tipos)
      if (flowState) {
        return { ...n, data: { ...n.data, animation: stateToAnim(flowState) } };
      }

      // 3. Fallback Deep Pipeline (legacy): modelNode com phase_key
      if (n.type === 'modelNode' && typeof n.data?.phase_key === 'string') {
        const pk = n.data.phase_key;
        const state: PhaseState = (pk && progress.phaseStates[pk]) || 'idle';
        return { ...n, data: { ...n.data, animation: stateToAnim(state) } };
      }
      if (n.type === 'pipelinePhaseNode') {
        const pk = n.data?.phase_key;
        const state: PhaseState = (pk && progress.phaseStates[pk]) || 'idle';
        return { ...n, data: { ...n.data, animation: stateToAnim(state) } };
      }
      return n;
    });
  }, [canvas.visibleNodes, canvas.subflows, canvas.toggleSubflowCollapsed, openSubflowTab, progress.phaseStates, flowProgress.nodeStates]);

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

  // v3.5: edge reconnection (drag the arrow head to a new handle or off-canvas)
  //
  // ReactFlow chama onReconnectStart quando o usuário começa a arrastar uma
  // ponta de edge existente; onReconnect quando solta em outro handle;
  // onReconnectEnd quando solta (sucesso OU fora). Se a edge não foi
  // re-conectada (handle válido), removemos ela — comportamento desejado:
  // arrastar pra fora = desconectar.
  const edgeReconnectSuccessful = useRef(true);

  const onReconnectStart = useCallback(() => {
    edgeReconnectSuccessful.current = false;
  }, []);

  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      // Re-valida a nova conexão usando o mesmo validador do onConnect.
      const source = canvas.nodes.find((n) => n.id === newConnection.source);
      const target = canvas.nodes.find((n) => n.id === newConnection.target);
      if (!source || !target) return;
      edgeReconnectSuccessful.current = true;
      // v3.5.4: ao reconectar, normaliza o estilo da edge pro padrão azul
      // (mesmo que ela viesse marcada como `planned`/cinza no backend), pois
      // agora é uma conexão real estabelecida pelo usuário.
      const color = '#3b82f6';
      canvas.setEdges((eds) => {
        const next = reconnectEdge(oldEdge, newConnection, eds);
        return next.map((e) =>
          e.id === oldEdge.id
            ? {
                ...e,
                style: { ...(e.style || {}), stroke: color, strokeWidth: 1.8, strokeDasharray: undefined },
                markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
                data: { ...(e.data || {}), planned: false },
              }
            : e,
        );
      });
      canvas.markDirty();
    },
    [canvas],
  );

  const onReconnectEnd = useCallback(
    (_: any, edge: Edge) => {
      // Se reconectou com sucesso, edgeReconnectSuccessful.current = true;
      // senão, removemos a edge (desconexão por arrasto pra fora).
      if (!edgeReconnectSuccessful.current) {
        canvas.setEdges((eds) => eds.filter((e) => e.id !== edge.id));
        canvas.markDirty();
      }
      edgeReconnectSuccessful.current = true;
    },
    [canvas],
  );

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
          onResetLayout={onResetLayout}
          onOptimize={() => showError('Otimização — pendente nesta entrega')}
          onToggleDebug={() => setDebugOpen((o) => !o)}
          dirty={canvas.dirty}
          autoSaveState={autoSaveState}
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
            subflows={canvas.subflows}
            selectedNodeId={canvas.selectedNodeId}
            onSelectCanvasNode={canvas.setSelectedNodeId}
            onOpenSubflow={canvas.openSubflowTab}
          />
          <div className="flex-1 relative" onDrop={onDrop} onDragOver={onDragOver}>
            <ReactFlow
              nodes={enhancedNodes}
              edges={enhancedEdges}
              onNodesChange={canvas.onNodesChange}
              onEdgesChange={canvas.onEdgesChange}
              onConnect={validator.onConnect}
              onSelectionChange={onSelectionChange}
              // v3.5: edge dinâmica — arrastar a ponta da seta pra desconectar
              edgesReconnectable
              onReconnectStart={onReconnectStart}
              onReconnect={onReconnect}
              onReconnectEnd={onReconnectEnd}
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

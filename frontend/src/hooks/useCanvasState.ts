/**
 * useCanvasState — single source of truth for the unified AI Studio canvas
 * (v3.0).
 *
 * Wraps ReactFlow's useNodesState/useEdgesState plus:
 *   - subflow stack (breadcrumbs when "entering" a collapsed group)
 *   - dirty flag (unsaved changes vs persisted profile version)
 *   - selection (single-node inspector target)
 *   - undo stack (last 20 mutations) — minimal Ctrl+Z support
 */
'use client';

import { useCallback, useState, useMemo } from 'react';
import {
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
} from '@xyflow/react';

export interface Subflow {
  label: string;
  node_ids: string[];
  position: { x: number; y: number };
  collapsed: boolean;
  // v3.5 — hierarquia: child_subflow_ids lista subflows aninhados (L2 dentro
  // de L1, L3 dentro de L2, etc); parent_id aponta pro subflow imediatamente
  // acima na árvore (null/undefined = root level).
  child_subflow_ids?: string[];
  parent_id?: string | null;
  kind?: string;
  phase_key?: string;
}

export interface CanvasTab {
  id: string;          // 'canvas' for root; subflow id otherwise
  label: string;       // user-visible label
  subflowId?: string;  // present when tab represents a subflow
}

export interface CanvasState {
  // Core flow state
  nodes: Node[];
  edges: Edge[];
  setNodes: (nodes: Node[] | ((cur: Node[]) => Node[])) => void;
  setEdges: (edges: Edge[] | ((cur: Edge[]) => Edge[])) => void;
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;

  // Subflows
  subflows: Record<string, Subflow>;
  setSubflows: (subflows: Record<string, Subflow>) => void;
  subflowStack: string[]; // legacy — kept for compat
  enterSubflow: (subflowId: string) => void;
  exitSubflow: () => void;
  popToRoot: () => void;
  toggleSubflowCollapsed: (subflowId: string) => void;

  // v3.1 — multi-tab navigation
  openTabs: CanvasTab[];
  activeTabId: string;
  setActiveTab: (tabId: string) => void;
  openSubflowTab: (subflowId: string, label?: string) => void;
  closeTab: (tabId: string) => void;

  // Selection
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  selectedNode: Node | null;

  // Dirty tracking
  dirty: boolean;
  markClean: () => void;
  markDirty: () => void;

  // Visible nodes (filtered by active tab)
  visibleNodes: Node[];
  visibleEdges: Edge[];
}

interface InitialState {
  nodes?: Node[];
  edges?: Edge[];
  subflows?: Record<string, Subflow>;
}

export function useCanvasState(initial?: InitialState): CanvasState {
  const [nodes, setNodes, onNodesChangeRaw] = useNodesState(initial?.nodes || []);
  const [edges, setEdges, onEdgesChangeRaw] = useEdgesState(initial?.edges || []);
  const [subflows, setSubflowsState] = useState<Record<string, Subflow>>(initial?.subflows || {});
  const [subflowStack, setSubflowStack] = useState<string[]>([]);
  const [openTabs, setOpenTabs] = useState<CanvasTab[]>([{ id: 'canvas', label: 'Canvas' }]);
  const [activeTabId, setActiveTabIdState] = useState<string>('canvas');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // v3.0 fix: dirty is set explicitly via markDirty() inside add/update/delete
  // handlers. A useEffect on [nodes, edges, subflows] caused an infinite render
  // loop because xyflow internally mutates node refs on selection/hover/drag,
  // triggering the effect → setDirty → re-render → effect again.
  //
  // v3.6.0: interceptamos onNodesChange/onEdgesChange pra chamar markDirty
  // quando há mudança REAL (position/remove/add) — não pra eventos puramente
  // visuais como select/dimensions. Isso fixa o bug do "Save desabilitado
  // após arrastar nodes" — antes só add/delete via handlers explícitos
  // disparava markDirty.
  const onNodesChange: OnNodesChange = useCallback((changes) => {
    onNodesChangeRaw(changes);
    if (changes.some((c) => c.type === 'position' || c.type === 'remove' || c.type === 'add')) {
      setDirty(true);
    }
  }, [onNodesChangeRaw]);
  const onEdgesChange: OnEdgesChange = useCallback((changes) => {
    onEdgesChangeRaw(changes);
    if (changes.some((c) => c.type === 'remove' || c.type === 'add')) {
      setDirty(true);
    }
  }, [onEdgesChangeRaw]);

  const enterSubflow = useCallback((subflowId: string) => {
    setSubflowStack((s) => [...s, subflowId]);
  }, []);

  const exitSubflow = useCallback(() => {
    setSubflowStack((s) => s.slice(0, -1));
  }, []);

  const popToRoot = useCallback(() => setSubflowStack([]), []);

  const setSubflows = useCallback((next: Record<string, Subflow>) => {
    setSubflowsState(next);
  }, []);

  const toggleSubflowCollapsed = useCallback((subflowId: string) => {
    setSubflowsState((prev) => {
      const sf = prev[subflowId];
      if (!sf) return prev;
      return { ...prev, [subflowId]: { ...sf, collapsed: !sf.collapsed } };
    });
  }, []);

  // v3.1 — multi-tab navigation
  const setActiveTab = useCallback((tabId: string) => {
    setActiveTabIdState(tabId);
  }, []);

  const openSubflowTab = useCallback((subflowId: string, label?: string) => {
    setOpenTabs((tabs) => {
      const tabId = `sf-tab-${subflowId}`;
      if (tabs.some((t) => t.id === tabId)) {
        // Already open — just activate
        setActiveTabIdState(tabId);
        return tabs;
      }
      const next = [...tabs, { id: tabId, label: label || subflowId, subflowId }];
      setActiveTabIdState(tabId);
      return next;
    });
  }, []);

  const closeTab = useCallback((tabId: string) => {
    if (tabId === 'canvas') return; // canvas tab cannot be closed
    setOpenTabs((tabs) => {
      const filtered = tabs.filter((t) => t.id !== tabId);
      // If active tab was closed, fall back to canvas
      setActiveTabIdState((curId) => (curId === tabId ? 'canvas' : curId));
      return filtered;
    });
  }, []);

  // Visible nodes/edges depend on activeTabId:
  //   - 'canvas' (root): show all nodes NOT inside any subflow
  //     (subflow nodes themselves are always shown on root)
  //   - subflow tab: show only that subflow's node_ids
  const { visibleNodes, visibleEdges } = useMemo(() => {
    const activeTab = openTabs.find((t) => t.id === activeTabId);
    const inSubflow = activeTab?.subflowId;

    if (!inSubflow) {
      // Root view: hide nodes that belong to any subflow (they live in tabs)
      const insideSubflowIds = new Set<string>();
      Object.values(subflows).forEach((sf) => {
        sf.node_ids.forEach((id) => insideSubflowIds.add(id));
      });
      const vn = nodes.filter((n) => !insideSubflowIds.has(n.id));
      const ve = edges.filter(
        (e) => !insideSubflowIds.has(e.source) && !insideSubflowIds.has(e.target),
      );
      return { visibleNodes: vn, visibleEdges: ve };
    }

    // Subflow tab: show only its members (the phase trios). Models are
    // available via the left sidebar catalog (drag to add). v3.3.
    const sf = subflows[inSubflow];
    if (!sf) return { visibleNodes: nodes, visibleEdges: edges };
    const memberSet = new Set(sf.node_ids);
    const vn = nodes.filter((n) => memberSet.has(n.id));
    const visibleIds = new Set(vn.map((n) => n.id));
    const ve = edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));
    return { visibleNodes: vn, visibleEdges: ve };
  }, [nodes, edges, subflows, openTabs, activeTabId]);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  const markClean = useCallback(() => setDirty(false), []);
  const markDirty = useCallback(() => setDirty(true), []);

  return {
    nodes,
    edges,
    setNodes,
    setEdges,
    onNodesChange,
    onEdgesChange,
    subflows,
    setSubflows,
    subflowStack,
    enterSubflow,
    exitSubflow,
    popToRoot,
    toggleSubflowCollapsed,
    openTabs,
    activeTabId,
    setActiveTab,
    openSubflowTab,
    closeTab,
    selectedNodeId,
    setSelectedNodeId,
    selectedNode,
    dirty,
    markClean,
    markDirty,
    visibleNodes,
    visibleEdges,
  };
}

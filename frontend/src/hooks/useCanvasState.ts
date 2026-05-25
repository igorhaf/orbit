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
  subflowStack: string[]; // breadcrumbs: [] = root, ['sf1'] = inside sf1
  enterSubflow: (subflowId: string) => void;
  exitSubflow: () => void;
  popToRoot: () => void;
  toggleSubflowCollapsed: (subflowId: string) => void;

  // Selection
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  selectedNode: Node | null;

  // Dirty tracking
  dirty: boolean;
  markClean: () => void;
  markDirty: () => void;

  // Visible nodes (filtered by current subflow context)
  visibleNodes: Node[];
  visibleEdges: Edge[];
}

interface InitialState {
  nodes?: Node[];
  edges?: Edge[];
  subflows?: Record<string, Subflow>;
}

export function useCanvasState(initial?: InitialState): CanvasState {
  const [nodes, setNodes, onNodesChange] = useNodesState(initial?.nodes || []);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial?.edges || []);
  const [subflows, setSubflowsState] = useState<Record<string, Subflow>>(initial?.subflows || {});
  const [subflowStack, setSubflowStack] = useState<string[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // v3.0 fix: dirty is set explicitly via markDirty() inside add/update/delete
  // handlers. A useEffect on [nodes, edges, subflows] caused an infinite render
  // loop because xyflow internally mutates node refs on selection/hover/drag,
  // triggering the effect → setDirty → re-render → effect again.

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

  // Visible nodes/edges depend on subflowStack:
  //   - root (stack=[]): show all nodes NOT inside any collapsed subflow,
  //     plus the subflow node itself
  //   - inside a subflow: show only that subflow's node_ids
  const { visibleNodes, visibleEdges } = useMemo(() => {
    if (subflowStack.length === 0) {
      // Root view: hide nodes belonging to collapsed subflows
      const hiddenIds = new Set<string>();
      Object.values(subflows).forEach((sf) => {
        if (sf.collapsed) sf.node_ids.forEach((id) => hiddenIds.add(id));
      });
      const vn = nodes.filter((n) => !hiddenIds.has(n.id));
      const ve = edges.filter(
        (e) => !hiddenIds.has(e.source) && !hiddenIds.has(e.target),
      );
      return { visibleNodes: vn, visibleEdges: ve };
    }
    // Inside a subflow: only its members
    const currentSfId = subflowStack[subflowStack.length - 1];
    const sf = subflows[currentSfId];
    if (!sf) return { visibleNodes: nodes, visibleEdges: edges };
    const memberSet = new Set(sf.node_ids);
    const vn = nodes.filter((n) => memberSet.has(n.id));
    const ve = edges.filter((e) => memberSet.has(e.source) && memberSet.has(e.target));
    return { visibleNodes: vn, visibleEdges: ve };
  }, [nodes, edges, subflows, subflowStack]);

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

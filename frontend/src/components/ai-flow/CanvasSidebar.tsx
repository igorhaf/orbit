/**
 * CanvasSidebar — left-side panel with two vertical sections (v3.2):
 *   TOP    — pre-configured catalog (models + utilities), draggable to canvas
 *   BOTTOM — objects currently on the canvas (live list), clickable to select
 *
 * Clicking any item in either section selects it; the right-side NodeInspector
 * shows its configuration. Catalog items support drag-and-drop into the
 * ReactFlow canvas (HTML5 drag API).
 *
 * v3.2
 */
'use client';

import React, { useState } from 'react';
import type { Node } from '@xyflow/react';
import { ChevronDown, ChevronRight, Cpu, Wrench, Layers, Sparkles } from 'lucide-react';

interface CatalogItem {
  id: string;
  type: string;
  data: any;
}

interface Props {
  catalog: {
    models: CatalogItem[];
    utilities: CatalogItem[];
  };
  canvasNodes: Node[];
  // v3.4.1 — needed by the hierarchical "No canvas atual" tree to know which
  // nodes belong to which subflow.
  subflows: Record<string, { label?: string; node_ids?: string[] }>;
  selectedNodeId: string | null;
  onSelectCanvasNode: (nodeId: string) => void;
  // Opens a subflow tab. Called when user clicks a subflow entry in the
  // bottom section (clicking should both select the node AND open its tab).
  onOpenSubflow?: (subflowId: string, label?: string) => void;
  // Called when user drops a catalog item on the canvas; page handles position calc
  // The drag payload is set on dragstart via dataTransfer.
}

type SectionId =
  | 'models'
  | 'utilities'
  // Canvas-objects section ids: derived from node type via
  //   `canvas-${type.replace('Node', '').toLowerCase()}`
  // so subflowNode → canvas-subflow (singular), pipelinePhaseNode → canvas-pipelinephase.
  | 'canvas-pipelinephase'
  | 'canvas-model'
  | 'canvas-subflow'
  | string;

const NODE_TYPE_ICON: Record<string, React.ElementType> = {
  modelNode: Cpu,
  pipelinePhaseNode: Sparkles,
  subflowNode: Layers,
};
function iconForType(type: string): React.ElementType {
  if (NODE_TYPE_ICON[type]) return NODE_TYPE_ICON[type];
  return Wrench; // utility nodes default
}

export function CanvasSidebar({
  catalog,
  canvasNodes,
  subflows,
  selectedNodeId,
  onSelectCanvasNode,
  onOpenSubflow,
}: Props) {
  // Collapsible sections. Defaults: catalog sections expanded; canvas-objects
  // sections also expanded so the user can immediately see (and click) subflows
  // and phases. Missing keys default to "expanded" because we read `!collapsed[id]`.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    'models': false,
    'utilities': false,
    'canvas-pipelinephase': false,
    'canvas-model': false,
    'canvas-subflow': false,
  });

  const toggleCollapse = (id: string) =>
    setCollapsed((p) => ({ ...p, [id]: !p[id] }));

  const handleDragStart = (e: React.DragEvent, item: CatalogItem) => {
    // Payload consumed by ReactFlow onDrop in page.tsx
    e.dataTransfer.setData('application/x-ai-flow-catalog-item', JSON.stringify(item));
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <aside className="w-64 border-r border-gray-200 bg-white flex flex-col text-xs">
      {/* ── TOP: pre-configured catalog ──────────────────────────────── */}
      <div className="flex-1 overflow-y-auto border-b border-gray-200">
        <header className="px-3 py-2 border-b border-gray-100 bg-gray-50">
          <span className="text-[10px] uppercase font-semibold text-gray-500 tracking-wider">Catálogo</span>
        </header>

        {/* Models */}
        <SectionHeader
          icon={Cpu}
          label="Modelos"
          count={catalog.models.length}
          collapsed={collapsed['models']}
          onToggle={() => toggleCollapse('models')}
        />
        {!collapsed['models'] && (
          <ul className="px-2 py-1">
            {catalog.models.map((m) => (
              <li
                key={m.id}
                draggable
                onDragStart={(e) => handleDragStart(e, m)}
                className="flex items-center gap-2 px-2 py-1.5 rounded cursor-grab active:cursor-grabbing hover:bg-gray-50"
                title={`Arraste pro canvas — ${m.data?.label}`}
              >
                <Cpu className="w-3.5 h-3.5 text-purple-600 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-gray-800">{m.data?.label}</div>
                  <div className="truncate text-[10px] font-mono text-gray-400">{m.data?.model_id}</div>
                  {Array.isArray(m.data?.usage_badges) && m.data.usage_badges.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {m.data.usage_badges.slice(0, 3).map((u: string) => (
                        <span key={u} className="text-[9px] px-1 py-0.5 rounded bg-gray-100 text-gray-600 font-mono">
                          {u}
                        </span>
                      ))}
                      {m.data.usage_badges.length > 3 && (
                        <span className="text-[9px] text-gray-400">+{m.data.usage_badges.length - 3}</span>
                      )}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* v3.4 — Utilities grouped by category (Discovery, Processing, ...) */}
        {(() => {
          const byCategory = new Map<string, CatalogItem[]>();
          for (const u of catalog.utilities) {
            const cat = (u.data?.category as string) || 'Outras';
            if (!byCategory.has(cat)) byCategory.set(cat, []);
            byCategory.get(cat)!.push(u);
          }
          // Sort categories alphabetically, but pin the legacy "Resilience"/"Routing"/"Storage"
          // groups near the top (they were the v3.0 set).
          const order = ['Discovery', 'Processing', 'AI', 'Storage', 'Validation', 'Observability', 'Specs', 'Routing', 'Resilience'];
          const cats = Array.from(byCategory.keys()).sort((a, b) => {
            const ai = order.indexOf(a); const bi = order.indexOf(b);
            if (ai === -1 && bi === -1) return a.localeCompare(b);
            if (ai === -1) return 1;
            if (bi === -1) return -1;
            return ai - bi;
          });
          return cats.map((cat) => {
            const items = byCategory.get(cat)!;
            const sectionId = `util-cat-${cat.toLowerCase()}`;
            const isCollapsed = !!collapsed[sectionId];
            return (
              <React.Fragment key={cat}>
                <SectionHeader
                  icon={Wrench}
                  label={cat}
                  count={items.length}
                  collapsed={isCollapsed}
                  onToggle={() => toggleCollapse(sectionId)}
                />
                {!isCollapsed && (
                  <ul className="px-2 py-1">
                    {items.map((u) => {
                      const accent = (u.data?.color as string) || '#94a3b8';
                      return (
                        <li
                          key={u.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, u)}
                          className="flex items-center gap-2 px-2 py-1.5 rounded cursor-grab active:cursor-grabbing hover:bg-gray-50"
                          title={u.data?.description || `Arraste pro canvas — ${u.data?.label}`}
                        >
                          <span
                            className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
                            style={{ background: accent }}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium text-gray-800">{u.data?.label}</div>
                            <div className="truncate text-[10px] font-mono text-gray-400">{u.data?.kind || u.data?.type}</div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </React.Fragment>
            );
          });
        })()}
      </div>

      {/* ── BOTTOM: tree global hierárquica (v3.4.1) ─────────────────────
          Reflete a herança real do canvas: Root contém subflowNodes; cada
          subflow contém seus inner nodes (Entrada, modelNodes, Saída).
          Click em qualquer item seleciona + (se subflow) abre a tab. */}
      <div className="flex-1 overflow-y-auto">
        <header className="px-3 py-2 border-b border-gray-100 bg-gray-50">
          <span className="text-[10px] uppercase font-semibold text-gray-500 tracking-wider">No canvas atual</span>
        </header>

        {canvasNodes.length === 0 ? (
          <div className="px-3 py-4 text-gray-400 text-center">
            Canvas vazio. Arraste itens do catálogo acima.
          </div>
        ) : (
          <CanvasTree
            canvasNodes={canvasNodes}
            subflows={subflows}
            selectedNodeId={selectedNodeId}
            collapsed={collapsed}
            onToggleCollapse={toggleCollapse}
            onSelectCanvasNode={onSelectCanvasNode}
            onOpenSubflow={onOpenSubflow}
          />
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// v3.4.1 — CanvasTree: hierarchical tree view of every node currently on
// the canvas. Root level shows top-level nodes (those NOT belonging to any
// subflow). Subflow nodes have a caret to expand/collapse their children.
// Click selects + opens the subflow tab when clicking a subflowNode.
// ---------------------------------------------------------------------------

interface CanvasTreeProps {
  canvasNodes: Node[];
  subflows: Record<string, { label?: string; node_ids?: string[] }>;
  selectedNodeId: string | null;
  collapsed: Record<string, boolean>;
  onToggleCollapse: (id: string) => void;
  onSelectCanvasNode: (id: string) => void;
  onOpenSubflow?: (sfId: string, label?: string) => void;
}

function CanvasTree({
  canvasNodes,
  subflows,
  selectedNodeId,
  collapsed,
  onToggleCollapse,
  onSelectCanvasNode,
  onOpenSubflow,
}: CanvasTreeProps) {
  // Map node_id → Node for O(1) lookup
  const nodeById = new Map<string, Node>();
  canvasNodes.forEach((n) => nodeById.set(n.id, n));

  // Build set of all node ids that belong to some subflow
  const insideSubflow = new Set<string>();
  Object.values(subflows).forEach((sf) => {
    (sf.node_ids || []).forEach((id) => insideSubflow.add(id));
  });

  // Root-level nodes: those NOT inside any subflow
  const rootNodes = canvasNodes.filter((n) => !insideSubflow.has(n.id));

  return (
    <ul className="px-1 py-1 text-xs">
      {rootNodes.map((n) => (
        <TreeNode
          key={n.id}
          node={n}
          depth={0}
          nodeById={nodeById}
          subflows={subflows}
          selectedNodeId={selectedNodeId}
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          onSelectCanvasNode={onSelectCanvasNode}
          onOpenSubflow={onOpenSubflow}
        />
      ))}
    </ul>
  );
}

interface TreeNodeProps {
  node: Node;
  depth: number;
  nodeById: Map<string, Node>;
  subflows: Record<string, { label?: string; node_ids?: string[] }>;
  selectedNodeId: string | null;
  collapsed: Record<string, boolean>;
  onToggleCollapse: (id: string) => void;
  onSelectCanvasNode: (id: string) => void;
  onOpenSubflow?: (sfId: string, label?: string) => void;
}

function TreeNode({
  node, depth, nodeById, subflows,
  selectedNodeId, collapsed,
  onToggleCollapse, onSelectCanvasNode, onOpenSubflow,
}: TreeNodeProps) {
  const isSelected = node.id === selectedNodeId;
  const isSubflow = node.type === 'subflowNode';
  const subflowId = isSubflow ? node.id.replace(/^sf-/, '') : null;
  const childIds: string[] = (isSubflow && subflowId && subflows[subflowId]?.node_ids) || [];
  const hasChildren = childIds.length > 0;
  const treeKey = `tree-${node.id}`;
  const isExpanded = collapsed[treeKey] === undefined ? false : !collapsed[treeKey];
  // Default: subflows start collapsed in the tree (lots of children); other
  // expandable nodes start expanded. The `collapsed` state stores `true` for
  // collapsed; `undefined` means "use default".
  const effectiveCollapsed = collapsed[treeKey] === undefined ? isSubflow : !!collapsed[treeKey];

  const label = (node.data as any)?.label || node.id;
  const subtitle =
    (node.data as any)?.model_id ||
    (node.data as any)?.phase_key ||
    (node.data as any)?.kind ||
    node.type;

  // Color by type
  const iconColor =
    node.type === 'modelNode' ? 'text-purple-600' :
    node.type === 'subflowNode' ? 'text-cyan-600' :
    node.type === 'ioNode' ? ((node.data as any)?.io_kind === 'input' ? 'text-emerald-600' : 'text-orange-600') :
    node.type === 'utilityNode' ? 'text-amber-600' :
    node.type === 'pipelinePhaseNode' ? 'text-blue-600' :
    'text-gray-500';
  const Icon = NODE_TYPE_ICON[node.type || ''] || Wrench;

  const handleClick = () => {
    onSelectCanvasNode(node.id);
    if (isSubflow && subflowId && onOpenSubflow) {
      onOpenSubflow(subflowId, label);
    }
  };

  return (
    <li>
      <div
        onClick={handleClick}
        title={isSubflow ? 'Clique pra abrir aba' : undefined}
        className={`flex items-center gap-1 px-1.5 py-1 rounded cursor-pointer ${
          isSelected ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50'
        }`}
        style={{ paddingLeft: 4 + depth * 12 }}
      >
        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleCollapse(treeKey); }}
            className="w-3.5 h-3.5 flex items-center justify-center text-gray-400 hover:text-gray-700 flex-shrink-0"
          >
            {effectiveCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        ) : (
          <span className="w-3.5 flex-shrink-0" />
        )}
        <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${iconColor}`} />
        <div className="min-w-0 flex-1">
          <div className={`truncate text-xs ${isSelected ? 'font-semibold text-blue-900' : 'text-gray-800'}`}>
            {label}
          </div>
          <div className="truncate text-[10px] font-mono text-gray-400">{subtitle}</div>
        </div>
        {isSubflow && onOpenSubflow && (
          <span className="text-[10px] text-cyan-600 flex-shrink-0">↗</span>
        )}
      </div>
      {hasChildren && !effectiveCollapsed && (
        <ul>
          {childIds.map((childId) => {
            const child = nodeById.get(childId);
            if (!child) return null;
            return (
              <TreeNode
                key={child.id}
                node={child}
                depth={depth + 1}
                nodeById={nodeById}
                subflows={subflows}
                selectedNodeId={selectedNodeId}
                collapsed={collapsed}
                onToggleCollapse={onToggleCollapse}
                onSelectCanvasNode={onSelectCanvasNode}
                onOpenSubflow={onOpenSubflow}
              />
            );
          })}
        </ul>
      )}
    </li>
  );
}

function SectionHeader({
  icon: Icon, label, count, collapsed, onToggle,
}: {
  icon: React.ElementType;
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left hover:bg-gray-50 transition-colors"
    >
      {collapsed ? <ChevronRight className="w-3 h-3 text-gray-400" /> : <ChevronDown className="w-3 h-3 text-gray-400" />}
      <Icon className="w-3.5 h-3.5 text-gray-500" />
      <span className="flex-1 text-xs font-medium text-gray-700">{label}</span>
      <span className="text-[10px] text-gray-400 tabular-nums">{count}</span>
    </button>
  );
}

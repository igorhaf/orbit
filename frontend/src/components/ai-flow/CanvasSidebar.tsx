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

  const toggleCollapse = (id: SectionId) =>
    setCollapsed((p) => ({ ...p, [id]: !p[id] }));

  // Group canvas nodes by type for the bottom section
  const grouped = canvasNodes.reduce<Record<string, Node[]>>((acc, n) => {
    const key = n.type || 'unknown';
    (acc[key] ||= []).push(n);
    return acc;
  }, {});

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

      {/* ── BOTTOM: objects currently in the canvas ───────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <header className="px-3 py-2 border-b border-gray-100 bg-gray-50">
          <span className="text-[10px] uppercase font-semibold text-gray-500 tracking-wider">No canvas atual</span>
        </header>

        {Object.entries(grouped).map(([type, list]) => {
          const sectionId = `canvas-${type.replace('Node', '').toLowerCase()}` as SectionId;
          const isOpen = !collapsed[sectionId];
          const Icon = iconForType(type);
          const label = ({
            modelNode: 'Modelos',
            pipelinePhaseNode: 'Fases',
            subflowNode: 'Subflows',
          } as Record<string, string>)[type] || type.replace('Node', '');
          return (
            <React.Fragment key={type}>
              <SectionHeader
                icon={Icon}
                label={label}
                count={list.length}
                collapsed={!isOpen}
                onToggle={() => toggleCollapse(sectionId)}
              />
              {isOpen && (
                <ul className="px-2 py-1">
                  {list.map((n) => {
                    const isSelected = n.id === selectedNodeId;
                    const label = (n.data as any)?.label || n.id;
                    const subtitle =
                      (n.data as any)?.model_id ||
                      (n.data as any)?.phase_key ||
                      (n.data as any)?.type ||
                      n.type;
                    const isSubflow = n.type === 'subflowNode';
                    // Subflow node ids look like "sf-<subflowId>"
                    const subflowId = isSubflow ? n.id.replace(/^sf-/, '') : null;
                    const handleClick = () => {
                      onSelectCanvasNode(n.id);
                      if (isSubflow && subflowId && onOpenSubflow) {
                        onOpenSubflow(subflowId, label);
                      }
                    };
                    return (
                      <li
                        key={n.id}
                        onClick={handleClick}
                        title={isSubflow ? 'Clique pra abrir aba' : undefined}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer ${
                          isSelected ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50'
                        }`}
                      >
                        <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${
                          type === 'modelNode' ? 'text-purple-600' :
                          type === 'pipelinePhaseNode' ? 'text-blue-600' :
                          type === 'subflowNode' ? 'text-cyan-600' :
                          'text-amber-600'
                        }`} />
                        <div className="min-w-0 flex-1">
                          <div className={`truncate text-xs ${isSelected ? 'font-semibold text-blue-900' : 'text-gray-800'}`}>
                            {label}
                          </div>
                          <div className="truncate text-[10px] font-mono text-gray-400">{subtitle}</div>
                        </div>
                        {isSubflow && onOpenSubflow && (
                          <span className="text-[10px] text-cyan-600 flex-shrink-0">↗</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </React.Fragment>
          );
        })}

        {Object.keys(grouped).length === 0 && (
          <div className="px-3 py-4 text-gray-400 text-center">
            Canvas vazio. Arraste itens do catálogo acima.
          </div>
        )}
      </div>
    </aside>
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

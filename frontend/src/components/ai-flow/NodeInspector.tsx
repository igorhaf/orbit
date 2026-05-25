/**
 * NodeInspector — right-side drawer that lets the user edit the selected
 * node's config. Switches form per node category.
 *
 * v3.0
 */
'use client';

import React, { useState, useEffect } from 'react';
import { X, Trash2, Save } from 'lucide-react';
import type { Node } from '@xyflow/react';
import { categoryOf } from './flowUtils';

interface Props {
  node: Node | null;
  onClose: () => void;
  onUpdate: (nodeId: string, dataPatch: Record<string, any>) => void;
  onDelete: (nodeId: string) => void;
}

const CLAUDE_MODELS = ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'];

export function NodeInspector({ node, onClose, onUpdate, onDelete }: Props) {
  const [draft, setDraft] = useState<any>({});
  const category = categoryOf(node);

  useEffect(() => {
    setDraft(node?.data || {});
  }, [node?.id]);

  if (!node) return null;

  const commit = () => {
    onUpdate(node.id, draft);
  };

  return (
    <aside className="w-80 border-l border-gray-200 bg-white flex flex-col">
      <header className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider">{category || 'node'}</p>
          <h3 className="text-sm font-semibold text-gray-900 truncate">
            {draft.label || node.id}
          </h3>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
          <X className="w-4 h-4 text-gray-500" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
        {/* Common: label */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Label</label>
          <input
            type="text"
            value={draft.label || ''}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm"
          />
        </div>

        {/* MODEL */}
        {category === 'model' && (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Claude model_id</label>
              <select
                value={draft.config?.model_id || 'claude-sonnet-4-6'}
                onChange={(e) => setDraft({
                  ...draft,
                  config: { ...(draft.config || {}), model_id: e.target.value },
                })}
                className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm"
              >
                {CLAUDE_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Max tokens</label>
              <input
                type="number"
                value={draft.config?.max_tokens ?? 4096}
                onChange={(e) => setDraft({
                  ...draft,
                  config: { ...(draft.config || {}), max_tokens: parseInt(e.target.value) || 0 },
                })}
                className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Temperature</label>
              <input
                type="number" step="0.1" min="0" max="2"
                value={draft.config?.temperature ?? 0.7}
                onChange={(e) => setDraft({
                  ...draft,
                  config: { ...(draft.config || {}), temperature: parseFloat(e.target.value) || 0 },
                })}
                className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Rate limit (req/min)</label>
              <input
                type="number"
                value={draft.rate_limit_requests ?? 60}
                onChange={(e) => setDraft({ ...draft, rate_limit_requests: parseInt(e.target.value) || 0 })}
                className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Timeout (s)</label>
              <input
                type="number"
                value={draft.timeout_seconds ?? 120}
                onChange={(e) => setDraft({ ...draft, timeout_seconds: parseInt(e.target.value) || 0 })}
                className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm"
              />
            </div>
          </>
        )}

        {/* PIPELINE PHASE */}
        {category === 'pipeline_phase' && (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Phase key</label>
              <input
                type="text"
                value={draft.phase_key || ''}
                onChange={(e) => setDraft({ ...draft, phase_key: e.target.value })}
                className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Descrição</label>
              <textarea
                value={draft.description || ''}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm h-16"
              />
            </div>
            <p className="text-[11px] text-gray-400">
              Conecte esta fase a um Model node pra definir qual modelo executa.
            </p>
          </>
        )}

        {/* UTILITY */}
        {category === 'utility' && (
          <>
            <div className="text-xs text-gray-500">
              Tipo: <span className="font-mono">{node.type}</span>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Enabled</label>
              <input
                type="checkbox"
                checked={draft.enabled !== false}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                className="w-4 h-4"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Config (JSON)</label>
              <textarea
                value={JSON.stringify(draft.config || {}, null, 2)}
                onChange={(e) => {
                  try {
                    setDraft({ ...draft, config: JSON.parse(e.target.value) });
                  } catch { /* ignore parse errors mid-typing */ }
                }}
                className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs font-mono h-32"
              />
            </div>
          </>
        )}

        {/* SUBFLOW */}
        {category === 'subflow' && (
          <>
            <p className="text-xs text-gray-500">
              {draft.node_count ?? 0} nodes agrupados
            </p>
            <button
              onClick={() => draft.onToggleCollapsed?.()}
              className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded hover:bg-gray-50"
            >
              {draft.collapsed ? 'Expandir' : 'Colapsar'}
            </button>
            <button
              onClick={() => draft.onEnter?.()}
              className="w-full px-3 py-1.5 text-xs border border-cyan-200 rounded text-cyan-700 hover:bg-cyan-50"
            >
              Entrar no subflow →
            </button>
          </>
        )}
      </div>

      <footer className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
        <button
          onClick={() => { onDelete(node.id); onClose(); }}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded"
        >
          <Trash2 className="w-3.5 h-3.5" /> Excluir
        </button>
        <button
          onClick={commit}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded"
        >
          <Save className="w-3.5 h-3.5" /> Aplicar
        </button>
      </footer>
    </aside>
  );
}

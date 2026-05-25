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
            {/* v3.4: header strip for new generic utilityNode (shows kind/category) */}
            {node.type === 'utilityNode' && (
              <div className="-mt-2 -mx-1 px-3 py-2 rounded bg-gray-50 border border-gray-200">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block w-3 h-3 rounded-sm"
                    style={{ background: draft.color || '#94a3b8' }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
                      {draft.category || 'Utility'}
                    </div>
                    <div className="text-xs font-mono text-gray-700 truncate">{draft.kind}</div>
                  </div>
                </div>
                {draft.description && (
                  <div className="mt-1.5 text-[10px] text-gray-500 leading-tight">
                    {draft.description}
                  </div>
                )}
              </div>
            )}
            <div className="text-xs text-gray-500">
              Tipo: <span className="font-mono">{node.type}</span>
              {draft.kind && node.type === 'utilityNode' && (
                <> · kind: <span className="font-mono">{draft.kind}</span></>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="util-enabled"
                checked={draft.enabled !== false}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                className="w-4 h-4"
              />
              <label htmlFor="util-enabled" className="text-xs font-medium text-gray-700">Habilitado</label>
            </div>
            {/* v3.4: kind-specific quick fields (rendered ABOVE the raw JSON
                textarea) so common configs are editable without typing JSON. */}
            <UtilityKindFields
              kind={draft.kind}
              config={draft.config || {}}
              onChange={(next) => setDraft({ ...draft, config: { ...(draft.config || {}), ...next } })}
            />
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Config (JSON avançado)</label>
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

// ---------------------------------------------------------------------------
// v3.4 — Kind-specific quick-edit fields for new GenericUtilityNode.
//
// Each new utility kind has a handful of config keys that matter most. This
// component renders typed inputs (number, select, text) for those, while the
// raw JSON textarea below still allows editing anything not covered here.
// Falls back gracefully when kind is unknown.
// ---------------------------------------------------------------------------

function UtilityKindFields({
  kind,
  config,
  onChange,
}: {
  kind?: string;
  config: Record<string, any>;
  onChange: (patch: Record<string, any>) => void;
}) {
  if (!kind) return null;
  // Schema-driven: each kind maps to a list of "FieldSpec" rendered below.
  type FieldSpec = {
    key: string;
    label: string;
    type: 'number' | 'text' | 'boolean' | 'select';
    options?: string[];
    default?: any;
    placeholder?: string;
    step?: number;
  };
  const FIELDS: Record<string, FieldSpec[]> = {
    // Discovery
    file_scanner: [
      { key: 'max_file_size', label: 'Max file size (bytes)', type: 'number', default: 100_000 },
      { key: 'follow_symlinks', label: 'Follow symlinks', type: 'boolean', default: false },
      { key: 'reuse_cached_paths', label: 'Reuse cached paths', type: 'boolean', default: true },
    ],
    change_detector: [
      { key: 'include_deleted', label: 'Detectar arquivos deletados', type: 'boolean', default: true },
    ],
    // Processing
    content_truncator: [
      { key: 'max_chars', label: 'Max chars', type: 'number', default: 8000 },
      { key: 'head_ratio', label: 'Head ratio (0–1)', type: 'number', step: 0.05, default: 0.75 },
    ],
    text_chunker: [
      { key: 'chunk_size', label: 'Chunk size', type: 'number', default: 1500 },
      { key: 'overlap', label: 'Overlap', type: 'number', default: 200 },
    ],
    git_commit_fetcher: [
      { key: 'max_commits', label: 'Max commits', type: 'number', default: 50 },
    ],
    domain_grouper: [
      { key: 'min_size', label: 'Min domain size', type: 'number', default: 2 },
      { key: 'fold_infra', label: 'Fold infra/config', type: 'boolean', default: true },
    ],
    epic_deduplicator: [
      { key: 'similarity_threshold', label: 'Similarity threshold', type: 'number', step: 0.05, default: 0.8 },
      { key: 'key_field', label: 'Key field', type: 'text', default: 'title' },
    ],
    prompt_context_compressor: [
      { key: 'token_budget', label: 'Token budget', type: 'number', default: 4000 },
    ],
    // Storage
    embed_and_store: [
      { key: 'collection', label: 'Collection', type: 'text', default: 'default' },
      { key: 'embedding_model', label: 'Embedding model', type: 'text', default: 'nomic-embed-text' },
    ],
    rag_query: [
      { key: 'top_k', label: 'top_k', type: 'number', default: 5 },
      { key: 'similarity_threshold', label: 'Similarity threshold', type: 'number', step: 0.05, default: 0.7 },
    ],
    business_rule_storer: [
      { key: 'rule_type', label: 'Rule type', type: 'select', options: ['domain', 'cross_cutting', 'infra', 'ui'], default: 'domain' },
      { key: 'priority', label: 'Priority', type: 'select', options: ['low', 'medium', 'high'], default: 'medium' },
    ],
    pipeline_artifact_writer: [
      { key: 'artifact_type', label: 'Artifact type', type: 'text', default: 'auto' },
    ],
    wiki_page_writer: [
      { key: 'respect_human_edits', label: 'Respeitar edições humanas (REGRA #0)', type: 'boolean', default: true },
    ],
    checkpoint_saver: [
      { key: 'scope', label: 'Scope', type: 'select', options: ['phase', 'file'], default: 'phase' },
      { key: 'include_scores', label: 'Incluir phase_scores', type: 'boolean', default: true },
    ],
    // AI
    claudius_single_call: [
      { key: 'model', label: 'Model', type: 'select', options: ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-7'], default: 'claude-sonnet-4-6' },
      { key: 'max_tokens', label: 'Max tokens', type: 'number', default: 4000 },
      { key: 'thinking_budget', label: 'Thinking budget (0=disabled)', type: 'number', default: 0 },
    ],
    claudius_batch_call: [
      { key: 'max_concurrency', label: 'Max concurrency', type: 'number', default: 10 },
      { key: 'abort_on_quota', label: 'Abort on quota exhausted', type: 'boolean', default: true },
    ],
    quota_probe: [
      { key: 'mode', label: 'Mode', type: 'select', options: ['status', 'probe', 'plan'], default: 'status' },
    ],
    provider_health_check: [
      { key: 'retries', label: 'Retries', type: 'number', default: 3 },
      { key: 'backoff', label: 'Backoff', type: 'select', options: ['linear', 'exponential'], default: 'exponential' },
    ],
    model_selector: [
      { key: 'usage_type', label: 'usage_type', type: 'text', default: 'general' },
      { key: 'prefer_chain', label: 'Prefer chain order', type: 'boolean', default: true },
    ],
    ai_execution_logger: [
      { key: 'include_system_prompt', label: 'Incluir system_prompt', type: 'boolean', default: false },
    ],
    // Specs
    spec_loader: [
      { key: 'active_only', label: 'Active only', type: 'boolean', default: true },
    ],
    spec_relevance_filter: [
      { key: 'max_per_category', label: 'Max per category', type: 'number', default: 3 },
    ],
    contract_renderer: [
      { key: 'contract_name', label: 'Contract name', type: 'text', placeholder: 'deep_file_analysis' },
      { key: 'allow_partial', label: 'Allow partial vars', type: 'boolean', default: false },
    ],
    // Validation
    json_schema_validator: [
      { key: 'schema', label: 'Schema', type: 'select', options: ['stories', 'cards', 'wiki', 'context', 'architectural_map'], default: 'stories' },
    ],
    // Observability
    telemetry_emitter: [
      { key: 'sinks', label: 'Sinks (csv)', type: 'text', default: 'ws,redis,db' },
    ],
    job_child_creator: [
      { key: 'job_type', label: 'JobType', type: 'text', default: 'generic' },
      { key: 'phase_label', label: 'Phase label', type: 'text', placeholder: 'Fase X — ...' },
    ],
  };

  const fields = FIELDS[kind];
  if (!fields || fields.length === 0) return null;

  return (
    <div className="space-y-2 pt-1 border-t border-gray-100">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">Config rápida</div>
      {fields.map((f) => {
        const value = config[f.key] ?? f.default ?? '';
        if (f.type === 'boolean') {
          return (
            <div key={f.key} className="flex items-center gap-2">
              <input
                type="checkbox"
                id={`uk-${f.key}`}
                checked={!!value}
                onChange={(e) => onChange({ [f.key]: e.target.checked })}
                className="w-4 h-4"
              />
              <label htmlFor={`uk-${f.key}`} className="text-xs text-gray-700">{f.label}</label>
            </div>
          );
        }
        if (f.type === 'select') {
          return (
            <div key={f.key}>
              <label className="block text-xs font-medium text-gray-700 mb-1">{f.label}</label>
              <select
                value={value}
                onChange={(e) => onChange({ [f.key]: e.target.value })}
                className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm"
              >
                {f.options!.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          );
        }
        if (f.type === 'number') {
          return (
            <div key={f.key}>
              <label className="block text-xs font-medium text-gray-700 mb-1">{f.label}</label>
              <input
                type="number"
                step={f.step}
                value={value}
                onChange={(e) => {
                  const n = f.step && f.step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value);
                  onChange({ [f.key]: isNaN(n) ? 0 : n });
                }}
                className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm"
              />
            </div>
          );
        }
        return (
          <div key={f.key}>
            <label className="block text-xs font-medium text-gray-700 mb-1">{f.label}</label>
            <input
              type="text"
              value={value}
              placeholder={f.placeholder}
              onChange={(e) => onChange({ [f.key]: e.target.value })}
              className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm"
            />
          </div>
        );
      })}
    </div>
  );
}

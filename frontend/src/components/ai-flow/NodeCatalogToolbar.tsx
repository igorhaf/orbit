/**
 * NodeCatalogToolbar — top action bar for the unified canvas (v3.0).
 *
 * Buttons:
 *  + Modelo   → add ModelNode (dropdown w/ 3 Claudius model_ids)
 *  + Pipeline → add PipelinePhaseNode (dropdown w/ known phase_keys)
 *  + Utility  → add utility node (dropdown w/ utility types)
 *  + Subflow  → group selected nodes into a collapsible subflow
 *  ▶ Run      → execute active profile (or current subflow)
 *  📊 Debug   → toggle bottom DebugPanel
 *  Profile selector + Save + Optimize
 */
'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Cpu, Sparkles, Wrench, FolderTree, Play, Bug, Save, Zap, ChevronDown, RotateCcw,
} from 'lucide-react';

export interface ToolbarProps {
  profiles: { id: string; name: string; is_active: boolean }[];
  activeProfileId: string | null;
  onSelectProfile: (id: string) => void;
  onAddModel: (modelId: 'claude-opus-4-7' | 'claude-sonnet-4-6' | 'claude-haiku-4-5') => void;
  onAddPhase: (phaseKey: string) => void;
  onAddUtility: (utilityType: string) => void;
  onGroupSubflow: () => void;
  onRun: () => void;
  onSave: () => void;
  onResetLayout?: () => void;  // v3.6.6
  onOptimize: () => void;
  onToggleDebug: () => void;
  dirty: boolean;
  // v3.6.3: estado do auto-save (mostra chip discreto ao lado do botão Save)
  autoSaveState?: 'idle' | 'pending' | 'saving' | 'saved' | 'error';
  running: boolean;
  selectionCount: number;
}

const CLAUDE_MODELS: Array<{ id: 'claude-opus-4-7' | 'claude-sonnet-4-6' | 'claude-haiku-4-5'; label: string }> = [
  { id: 'claude-opus-4-7',   label: 'Opus 4.7' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5',  label: 'Haiku 4.5' },
];

const PIPELINE_PHASES = [
  { key: 'phase_0', label: 'Phase 0 — Scan estrutural' },
  { key: 'phase_1', label: 'Phase 1 — Análise de arquivos' },
  { key: 'phase_2', label: 'Phase 2 — Síntese de regras' },
  { key: 'phase_3', label: 'Phase 3 — Mapa arquitetural' },
  { key: 'phase_4a', label: 'Phase 4a — Epics' },
  { key: 'phase_4b', label: 'Phase 4b — Stories' },
  { key: 'phase_4c', label: 'Phase 4c — Tasks' },
  { key: 'phase_5',  label: 'Phase 5 — Wiki' },
  { key: 'phase_6',  label: 'Phase 6 — QA' },
];

// v3.7.8: removidos do catálogo os 8 stubs pass-through (cache, router, retry,
// validator, cost_guard, rate_limiter, timeout, prompt_transformer) — não faziam
// nada útil e confundiam o usuário. rag_context é REAL (faz retrieve) e fica.
// (0 grafos salvos no DB usavam os stubs; os executores seguem registrados,
// inertes, pra não quebrar nada — removíveis numa 2ª passada.)
const UTILITY_TYPES = [
  { key: 'rag_context', label: 'RAG Context' },
];

function Dropdown({ trigger, items, onSelect }: {
  trigger: React.ReactNode;
  items: { key: string; label: string }[];
  onSelect: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)}>{trigger}</button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1 max-h-72 overflow-y-auto">
          {items.map((it) => (
            <button key={it.key}
              onClick={() => { onSelect(it.key); setOpen(false); }}
              className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50">
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function NodeCatalogToolbar(props: ToolbarProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 bg-white">
      <Dropdown
        trigger={
          <span className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-gray-200 hover:bg-gray-50">
            <Cpu className="w-3.5 h-3.5" /> Modelo <ChevronDown className="w-3 h-3" />
          </span>
        }
        items={CLAUDE_MODELS.map((m) => ({ key: m.id, label: m.label }))}
        onSelect={(k) => props.onAddModel(k as any)}
      />
      <Dropdown
        trigger={
          <span className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-gray-200 hover:bg-gray-50">
            <Sparkles className="w-3.5 h-3.5" /> Pipeline <ChevronDown className="w-3 h-3" />
          </span>
        }
        items={PIPELINE_PHASES}
        onSelect={(k) => props.onAddPhase(k)}
      />
      <Dropdown
        trigger={
          <span className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-gray-200 hover:bg-gray-50">
            <Wrench className="w-3.5 h-3.5" /> Utility <ChevronDown className="w-3 h-3" />
          </span>
        }
        items={UTILITY_TYPES}
        onSelect={(k) => props.onAddUtility(k)}
      />
      <button
        onClick={props.onGroupSubflow}
        disabled={props.selectionCount < 2}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
        title={props.selectionCount < 2 ? 'Selecione ≥ 2 nodes pra agrupar' : 'Agrupar seleção em subflow'}
      >
        <FolderTree className="w-3.5 h-3.5" /> Subflow ({props.selectionCount})
      </button>

      <div className="h-6 w-px bg-gray-200 mx-1" />

      <button
        onClick={props.onRun}
        disabled={props.running}
        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
      >
        <Play className="w-3.5 h-3.5" /> {props.running ? 'Executando…' : 'Run'}
      </button>
      <button
        onClick={props.onToggleDebug}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-gray-200 hover:bg-gray-50"
      >
        <Bug className="w-3.5 h-3.5" /> Debug
      </button>

      <div className="flex-1" />

      <span className="text-xs text-gray-500">Profile:</span>
      <select
        value={props.activeProfileId || ''}
        onChange={(e) => props.onSelectProfile(e.target.value)}
        className="text-xs border border-gray-200 rounded px-2 py-1.5 bg-white"
      >
        {props.profiles.length === 0 && <option value="">(nenhum)</option>}
        {props.profiles.map((p) => (
          <option key={p.id} value={p.id}>{p.name}{p.is_active ? ' ✓' : ''}</option>
        ))}
      </select>
      <button
        onClick={props.onSave}
        className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md ${
          props.dirty
            ? 'bg-emerald-600 text-white hover:bg-emerald-700'
            : 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
        }`}
        title={props.dirty ? 'Salvar mudanças' : 'Forçar save (re-persiste o canvas atual)'}
      >
        <Save className="w-3.5 h-3.5" /> {props.dirty ? 'Salvar' : 'Salvo ✓'}
      </button>
      {/* v3.6.3: indicador auto-save discreto. Aparece só durante save/erro
          ou logo após persistir, depois volta a idle (some). */}
      {props.autoSaveState && props.autoSaveState !== 'idle' && (
        <span
          className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md ${
            props.autoSaveState === 'pending' ? 'text-amber-700 bg-amber-50 border border-amber-200' :
            props.autoSaveState === 'saving'  ? 'text-blue-700 bg-blue-50 border border-blue-200' :
            props.autoSaveState === 'saved'   ? 'text-emerald-700 bg-emerald-50 border border-emerald-200' :
                                                'text-red-700 bg-red-50 border border-red-200'
          }`}
          title={`Auto-save: ${props.autoSaveState}`}
        >
          {props.autoSaveState === 'pending' && '⋯ aguardando…'}
          {props.autoSaveState === 'saving'  && '⟳ salvando…'}
          {props.autoSaveState === 'saved'   && '✓ auto-salvo'}
          {props.autoSaveState === 'error'   && '⚠ falhou'}
        </span>
      )}
      {/* v3.6.6: reset layout — descarta grafo salvo e regenera default */}
      {props.onResetLayout && (
        <button
          onClick={props.onResetLayout}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-orange-200 text-orange-700 hover:bg-orange-50"
          title="Descartar customizações e voltar ao layout default"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Resetar
        </button>
      )}
      <button
        onClick={props.onOptimize}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-gray-200 hover:bg-gray-50"
      >
        <Zap className="w-3.5 h-3.5" /> Otimizar
      </button>
    </div>
  );
}

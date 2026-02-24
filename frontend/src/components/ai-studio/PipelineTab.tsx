'use client';

/**
 * PipelineTab - Visual pipeline configurator using ReactFlow.
 * Shows 7 Deep Pipeline phases as connected nodes with profile selection,
 * run history table, and detail/compare dialogs.
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { ragApi } from '@/lib/api/knowledge';
import { aiModelsApi } from '@/lib/api';
import { PipelinePhaseNode, type PipelinePhaseData } from './PipelinePhaseNode';
import { PhaseConfigPanel } from './PhaseConfigPanel';
import { RunHistoryTable } from './RunHistoryTable';
import { RunDetailDialog } from './RunDetailDialog';
import { RunCompareDialog } from './RunCompareDialog';

// ── Phase definitions (fixed sequence, matches deep_pipeline.py) ────────
const PIPELINE_PHASES = [
  { key: 'phase_0', label: 'Scan', description: 'Scan Estrutural', defaultModel: '', provider: '', hasAI: false },
  { key: 'phase_1', label: 'Analise', description: 'Analise de Arquivos', defaultModel: 'claude-haiku-4-5', provider: 'anthropic', hasAI: true },
  { key: 'phase_2', label: 'Regras', description: 'Sintese de Regras', defaultModel: 'claude-sonnet-4-6', provider: 'anthropic', hasAI: true },
  { key: 'phase_3', label: 'Arquitetura', description: 'Mapa Arquitetural', defaultModel: 'claude-sonnet-4-6', provider: 'anthropic', hasAI: true },
  { key: 'phase_4a', label: 'Epics', description: 'Geracao de Epics', defaultModel: 'claude-opus-4-6', provider: 'anthropic', hasAI: true },
  { key: 'phase_4b', label: 'Stories', description: 'Decomp. Stories', defaultModel: 'claude-opus-4-6', provider: 'anthropic', hasAI: true },
  { key: 'phase_4c', label: 'Tasks', description: 'Decomp. Tasks', defaultModel: 'claude-sonnet-4-6', provider: 'anthropic', hasAI: true },
  { key: 'phase_4d', label: 'Subtasks', description: 'Decomp. Subtasks', defaultModel: 'claude-haiku-4-5', provider: 'anthropic', hasAI: true },
  { key: 'phase_5a', label: 'Wiki Plan', description: 'Estrutura Wiki', defaultModel: 'claude-sonnet-4-6', provider: 'anthropic', hasAI: true },
  { key: 'phase_5b', label: 'Wiki Geral', description: 'Paginas Gerais', defaultModel: 'claude-opus-4-6', provider: 'anthropic', hasAI: true },
  { key: 'phase_5c', label: 'Wiki Dom.', description: 'Paginas Dominio', defaultModel: 'claude-opus-4-6', provider: 'anthropic', hasAI: true },
  { key: 'phase_5d', label: 'Wiki Fluxos', description: 'Fluxos Cross-Dom', defaultModel: 'claude-sonnet-4-6', provider: 'anthropic', hasAI: true },
  { key: 'phase_6', label: 'QA', description: 'Quality Assurance', defaultModel: 'claude-sonnet-4-6', provider: 'anthropic', hasAI: true },
];

// ── Node layout (2 rows) ────────────────────────────────────────────────
const NODE_W = 160;
const NODE_H = 110;
const GAP_X = 50;
const GAP_Y = 60;
const START_X = 40;
const START_Y = 40;
const COLS_ROW1 = 7; // phases 0-6 (first 7)

function computeNodePositions() {
  const positions: Record<string, { x: number; y: number }> = {};
  PIPELINE_PHASES.forEach((phase, i) => {
    if (i < COLS_ROW1) {
      positions[phase.key] = { x: START_X + i * (NODE_W + GAP_X), y: START_Y };
    } else {
      const col = i - COLS_ROW1;
      positions[phase.key] = { x: START_X + col * (NODE_W + GAP_X), y: START_Y + NODE_H + GAP_Y };
    }
  });
  return positions;
}

function getModelShort(model: string): string {
  if (!model) return 'N/A';
  if (model.includes('haiku')) return 'Haiku';
  if (model.includes('sonnet')) return 'Sonnet';
  if (model.includes('opus')) return 'Opus';
  if (model.includes('gpt-4o')) return 'GPT-4o';
  if (model.includes('gpt-4')) return 'GPT-4';
  if (model.includes('gemini')) return 'Gemini';
  return model.split('-').pop() || model;
}

function getProviderFromModel(model: string): string {
  if (model.includes('claude') || model.includes('haiku') || model.includes('sonnet') || model.includes('opus')) return 'anthropic';
  if (model.includes('gpt')) return 'openai';
  if (model.includes('gemini')) return 'google';
  return 'claudio';
}

// ── Custom node types ───────────────────────────────────────────────────
const nodeTypes = {
  pipelinePhase: PipelinePhaseNode,
};

// ── Main Component ──────────────────────────────────────────────────────
interface PipelineTabProps {
  projectId?: string; // Optional: when coming from a project page
}

export function PipelineTab({ projectId }: PipelineTabProps) {
  // State
  const [profiles, setProfiles] = useState<any[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<string>('');
  const [phaseConfigs, setPhaseConfigs] = useState<Record<string, any>>({});
  const [lastRunScores, setLastRunScores] = useState<Record<string, number>>({});
  const [lastRunDurations, setLastRunDurations] = useState<Record<string, number>>({});
  const [lastRunScore, setLastRunScore] = useState<number | null>(null);
  const [selectedPhase, setSelectedPhase] = useState<string | null>(null);
  const [models, setModels] = useState<any[]>([]);

  // Run history
  const [showHistory, setShowHistory] = useState(false);
  const [runs, setRuns] = useState<any[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  // Dialogs
  const [detailRunId, setDetailRunId] = useState<string | null>(null);
  const [compareRuns, setCompareRuns] = useState<[string, string] | null>(null);

  // ReactFlow
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // ── Load profiles on mount ────────────────────────────────────────
  useEffect(() => {
    ragApi.pipelineProfiles().then((data) => {
      const list = Array.isArray(data) ? data : [];
      setProfiles(list);
      const defaultProfile = list.find((p: any) => p.is_default) || list[0];
      if (defaultProfile) {
        setSelectedProfile(defaultProfile.name);
        setPhaseConfigs(defaultProfile.phase_configs || {});
      }
    }).catch(() => {});

    aiModelsApi.list().then((res: any) => {
      const list = res?.data || res || [];
      setModels(Array.isArray(list) ? list.filter((m: any) => m.is_active) : []);
    }).catch(() => {});
  }, []);

  // ── Load last run data when projectId available ───────────────────
  useEffect(() => {
    if (!projectId) return;
    ragApi.deepPipelineRuns(projectId, 1).then((data) => {
      const list = Array.isArray(data) ? data : [];
      if (list.length > 0) {
        const lastRun = list[0];
        setLastRunScores(lastRun.phase_scores || {});
        setLastRunDurations(lastRun.phase_durations || {});
        setLastRunScore(lastRun.overall_score);
      }
    }).catch(() => {});
  }, [projectId]);

  // ── Apply profile changes ─────────────────────────────────────────
  const applyProfile = useCallback((profileName: string) => {
    const profile = profiles.find((p) => p.name === profileName);
    if (profile) {
      setSelectedProfile(profileName);
      setPhaseConfigs(profile.phase_configs || {});
    }
  }, [profiles]);

  // ── Build ReactFlow nodes & edges ─────────────────────────────────
  useEffect(() => {
    const positions = computeNodePositions();
    const newNodes: Node[] = PIPELINE_PHASES.map((phase) => {
      const cfg = phaseConfigs[phase.key] || {};
      const model = cfg.model || phase.defaultModel;
      const provider = model ? getProviderFromModel(model) : phase.provider;
      return {
        id: phase.key,
        type: 'pipelinePhase',
        position: positions[phase.key],
        data: {
          phaseKey: phase.key,
          label: phase.label,
          description: phase.description,
          model: model,
          modelShort: phase.hasAI ? getModelShort(model) : 'Local',
          provider: phase.hasAI ? provider : 'claudio',
          maxTokens: cfg.max_tokens || 0,
          concurrency: cfg.concurrency || 1,
          contract: cfg.contract,
          score: lastRunScores[phase.key] ?? null,
          duration: lastRunDurations[phase.key] ?? null,
          isConditional: phase.key === 'phase_7',
          onSelect: (key: string) => setSelectedPhase(key),
        } satisfies PipelinePhaseData,
        draggable: false,
      };
    });

    const newEdges: Edge[] = [];
    for (let i = 1; i < PIPELINE_PHASES.length; i++) {
      newEdges.push({
        id: `e-${PIPELINE_PHASES[i - 1].key}-${PIPELINE_PHASES[i].key}`,
        source: PIPELINE_PHASES[i - 1].key,
        target: PIPELINE_PHASES[i].key,
        type: 'smoothstep',
        animated: false,
        style: { stroke: '#9333ea', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#9333ea', width: 12, height: 12 },
      });
    }

    setNodes(newNodes);
    setEdges(newEdges);
  }, [phaseConfigs, lastRunScores, lastRunDurations, setNodes, setEdges]);

  // ── Phase config change handler ───────────────────────────────────
  const handlePhaseChange = useCallback((phaseKey: string, field: string, value: any) => {
    setPhaseConfigs((prev) => ({
      ...prev,
      [phaseKey]: { ...(prev[phaseKey] || {}), [field]: value },
    }));
  }, []);

  // ── Load run history ──────────────────────────────────────────────
  const loadHistory = useCallback(() => {
    if (!projectId) return;
    setRunsLoading(true);
    ragApi.deepPipelineRuns(projectId, 20)
      .then((data) => setRuns(Array.isArray(data) ? data : []))
      .catch(() => setRuns([]))
      .finally(() => setRunsLoading(false));
  }, [projectId]);

  const toggleHistory = useCallback(() => {
    const next = !showHistory;
    setShowHistory(next);
    if (next && runs.length === 0) loadHistory();
  }, [showHistory, runs.length, loadHistory]);

  // ── Selected phase config for side panel ──────────────────────────
  const selectedPhaseConfig = useMemo(() => {
    if (!selectedPhase) return null;
    const phase = PIPELINE_PHASES.find((p) => p.key === selectedPhase);
    if (!phase) return null;
    const cfg = phaseConfigs[selectedPhase] || {};
    return {
      phaseKey: selectedPhase,
      label: phase.description,
      config: {
        model: cfg.model || phase.defaultModel,
        max_tokens: cfg.max_tokens || 4000,
        concurrency: cfg.concurrency || 5,
        contract: cfg.contract,
        thinking_budget: cfg.thinking_budget,
      },
      stats: {
        score: lastRunScores[selectedPhase] ?? null,
        duration: lastRunDurations[selectedPhase] ?? null,
      },
    };
  }, [selectedPhase, phaseConfigs, lastRunScores, lastRunDurations]);

  // ── Canvas height ─────────────────────────────────────────────────
  const canvasHeight = 340;

  return (
    <div className="h-full flex flex-col">
      {/* Top bar: Profile selector + last run score */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-600">Perfil:</label>
          <select
            value={selectedProfile}
            onChange={(e) => applyProfile(e.target.value)}
            className="text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:ring-1 focus:ring-purple-500 focus:border-purple-500"
          >
            {profiles.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name.charAt(0).toUpperCase() + p.name.slice(1)}
                {p.is_default ? ' (padrao)' : ''}
              </option>
            ))}
          </select>
          {profiles.find((p) => p.name === selectedProfile)?.description && (
            <span className="text-xs text-gray-400 max-w-xs truncate">
              {profiles.find((p) => p.name === selectedProfile)?.description}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {lastRunScore != null && (
            <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full ${
              lastRunScore >= 75 ? 'bg-green-100 text-green-700' :
              lastRunScore >= 50 ? 'bg-yellow-100 text-yellow-700' :
              'bg-red-100 text-red-700'
            }`}>
              Ultimo Score: {lastRunScore}/100
            </span>
          )}
        </div>
      </div>

      {/* Canvas + optional side panel */}
      <div className="flex flex-1 min-h-0">
        <div className="flex-1" style={{ height: canvasHeight }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            panOnDrag
            zoomOnScroll
          >
            <Background gap={20} size={1} color="#f3f4f6" />
            <Controls showInteractive={false} position="bottom-left" />
            <MiniMap
              nodeColor="#e9d5ff"
              maskColor="rgba(0,0,0,0.05)"
              style={{ width: 120, height: 80 }}
              position="bottom-right"
            />
          </ReactFlow>
        </div>

        {/* Side panel */}
        {selectedPhaseConfig && (
          <PhaseConfigPanel
            phaseKey={selectedPhaseConfig.phaseKey}
            label={selectedPhaseConfig.label}
            config={selectedPhaseConfig.config}
            stats={selectedPhaseConfig.stats}
            models={models.map((m) => ({ id: m.id, name: m.name || m.model_name, provider: m.provider }))}
            onChange={handlePhaseChange}
            onClose={() => setSelectedPhase(null)}
          />
        )}
      </div>

      {/* Run History Section */}
      {projectId && (
        <div className="border-t border-gray-200 bg-white">
          <button
            onClick={toggleHistory}
            className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            <span className="font-medium">
              Historico de Execucoes {runs.length > 0 ? `(${runs.length})` : ''}
            </span>
            <svg className={`w-4 h-4 transition-transform ${showHistory ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showHistory && (
            <div className="px-4 pb-4">
              <RunHistoryTable
                runs={runs}
                loading={runsLoading}
                onViewDetail={(id) => setDetailRunId(id)}
                onCompare={(id1, id2) => setCompareRuns([id1, id2])}
              />
            </div>
          )}
        </div>
      )}

      {/* Dialogs */}
      {detailRunId && projectId && (
        <RunDetailDialog
          open={!!detailRunId}
          onClose={() => setDetailRunId(null)}
          projectId={projectId}
          runId={detailRunId}
        />
      )}
      {compareRuns && projectId && (
        <RunCompareDialog
          open={!!compareRuns}
          onClose={() => setCompareRuns(null)}
          projectId={projectId}
          runId1={compareRuns[0]}
          runId2={compareRuns[1]}
        />
      )}
    </div>
  );
}

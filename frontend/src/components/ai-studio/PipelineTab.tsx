'use client';

/**
 * PipelineTab - Visual pipeline configurator using ReactFlow.
 * Shows 13 Deep Pipeline phases as connected nodes with profile selection,
 * run history table, and detail/compare dialogs.
 *
 * Layout: 3 columns (profiles | canvas | phase config) matching Operations tab pattern.
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
  ConnectionLineType,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { ragApi } from '@/lib/api/knowledge';
import { aiModelsApi } from '@/lib/api';
import { PipelinePhaseNode, type PipelinePhaseData } from './PipelinePhaseNode';
import { PhaseConfigDialog } from './PhaseConfigDialog';
import { RunHistoryTable } from './RunHistoryTable';
import { RunDetailDialog } from './RunDetailDialog';
import { RunCompareDialog } from './RunCompareDialog';
import SmartEdge from '@/components/ai-flow/SmartEdge';
import { ProviderIcon } from '@/components/ai-flow';

// ── Phase definitions (fixed sequence, matches deep_pipeline.py) ────────
const PIPELINE_PHASES = [
  { key: 'phase_0', label: 'Scan', description: 'Scan Estrutural', defaultModel: '', provider: '', hasAI: false },
  { key: 'phase_1', label: 'Análise', description: 'Análise de Arquivos', defaultModel: 'claude-haiku-4-5', provider: 'anthropic', hasAI: true },
  { key: 'phase_2', label: 'Regras', description: 'Síntese de Regras', defaultModel: 'claude-sonnet-4-6', provider: 'anthropic', hasAI: true },
  { key: 'phase_3', label: 'Arquitetura', description: 'Mapa Arquitetural', defaultModel: 'claude-sonnet-4-6', provider: 'anthropic', hasAI: true },
  { key: 'phase_4a', label: 'Epics', description: 'Geração de Epics', defaultModel: 'claude-opus-4-6', provider: 'anthropic', hasAI: true },
  { key: 'phase_4b', label: 'Stories', description: 'Decomp. Stories', defaultModel: 'claude-opus-4-6', provider: 'anthropic', hasAI: true },
  { key: 'phase_4c', label: 'Tasks', description: 'Decomp. Tasks', defaultModel: 'claude-sonnet-4-6', provider: 'anthropic', hasAI: true },
  { key: 'phase_4d', label: 'Subtasks', description: 'Decomp. Subtasks', defaultModel: 'claude-haiku-4-5', provider: 'anthropic', hasAI: true },
  { key: 'phase_5a', label: 'Wiki Plan', description: 'Estrutura Wiki', defaultModel: 'claude-sonnet-4-6', provider: 'anthropic', hasAI: true },
  { key: 'phase_5b', label: 'Wiki Geral', description: 'Paginas Gerais', defaultModel: 'claude-opus-4-6', provider: 'anthropic', hasAI: true },
  { key: 'phase_5c', label: 'Wiki Dom.', description: 'Paginas Dominio', defaultModel: 'claude-opus-4-6', provider: 'anthropic', hasAI: true },
  { key: 'phase_5d', label: 'Wiki Fluxos', description: 'Fluxos Cross-Dom', defaultModel: 'claude-sonnet-4-6', provider: 'anthropic', hasAI: true },
  { key: 'phase_6', label: 'QA', description: 'Quality Assurance', defaultModel: 'claude-sonnet-4-6', provider: 'anthropic', hasAI: true },
];

// ── Node layout (2 rows, matching Operations tab node sizing) ───────────
const NODE_W = 200;
const NODE_H = 150;
const GAP_X = 60;
const GAP_Y = 80;
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

// ── Custom node & edge types (matching Operations tab) ──────────────────
const nodeTypes = {
  pipelinePhase: PipelinePhaseNode,
};
const edgeTypes = { smartEdge: SmartEdge };

// ── Main Component ──────────────────────────────────────────────────────
interface PipelineTabProps {
  projectId?: string; // Optional: when coming from a project page
}

export function PipelineTab({ projectId }: PipelineTabProps) {
  // State — profiles
  const [profiles, setProfiles] = useState<any[]>([]);
  const [selectedProfileObj, setSelectedProfileObj] = useState<any | null>(null);
  const [originalPhaseConfigs, setOriginalPhaseConfigs] = useState<Record<string, any>>({});
  const [phaseConfigs, setPhaseConfigs] = useState<Record<string, any>>({});
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileDescription, setNewProfileDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingProfile, setEditingProfile] = useState<any | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  // State — run data
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

  // ── Unsaved changes detection ─────────────────────────────────────
  const hasUnsavedChanges = useMemo(() => {
    return JSON.stringify(phaseConfigs) !== JSON.stringify(originalPhaseConfigs);
  }, [phaseConfigs, originalPhaseConfigs]);

  // ── Load profiles on mount ────────────────────────────────────────
  useEffect(() => {
    ragApi.pipelineProfiles().then((data) => {
      const list = Array.isArray(data) ? data : [];
      setProfiles(list);
      const defaultProfile = list.find((p: any) => p.is_default) || list[0];
      if (defaultProfile) {
        setSelectedProfileObj(defaultProfile);
        setPhaseConfigs(defaultProfile.phase_configs || {});
        setOriginalPhaseConfigs(defaultProfile.phase_configs || {});
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

  // ── Select profile handler ──────────────────────────────────────
  const handleSelectProfile = useCallback((profile: any) => {
    setSelectedProfileObj(profile);
    setPhaseConfigs(profile.phase_configs || {});
    setOriginalPhaseConfigs(profile.phase_configs || {});
  }, []);

  // ── Save handler ────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!selectedProfileObj?.id) return;
    setSaving(true);
    try {
      const updated = await ragApi.updatePipelineProfile(selectedProfileObj.id, {
        phase_configs: phaseConfigs,
      });
      setOriginalPhaseConfigs(phaseConfigs);
      setSelectedProfileObj(updated);
      setProfiles((prev) =>
        prev.map((p) => (p.id === updated.id ? updated : p))
      );
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  }, [selectedProfileObj, phaseConfigs]);

  // ── Create profile handler ──────────────────────────────────────
  const handleCreateProfile = useCallback(async () => {
    if (!newProfileName.trim()) return;
    try {
      const created = await ragApi.createPipelineProfile({
        name: newProfileName.trim(),
        description: newProfileDescription.trim(),
        phase_configs: {},
      });
      setProfiles((prev) => [...prev, created]);
      handleSelectProfile(created);
      setCreatingProfile(false);
      setNewProfileName('');
      setNewProfileDescription('');
    } catch {
      // silent
    }
  }, [newProfileName, newProfileDescription, handleSelectProfile]);

  // ── Delete profile handler ──────────────────────────────────────
  const handleDeleteProfile = useCallback(async (id: string) => {
    try {
      await ragApi.deletePipelineProfile(id);
      setProfiles((prev) => {
        const updated = prev.filter((p) => p.id !== id);
        if (selectedProfileObj?.id === id && updated.length > 0) {
          handleSelectProfile(updated[0]);
        }
        return updated;
      });
    } catch {
      // silent
    }
  }, [selectedProfileObj, handleSelectProfile]);

  // ── Set default handler ─────────────────────────────────────────
  const handleSetDefault = useCallback(async (id: string) => {
    try {
      await ragApi.setDefaultPipelineProfile(id);
      setProfiles((prev) =>
        prev.map((p) => ({ ...p, is_default: p.id === id }))
      );
    } catch {
      // silent
    }
  }, []);

  // ── Open edit profile modal ──────────────────────────────────────
  const handleOpenEditProfile = useCallback((profile: any) => {
    setEditingProfile(profile);
    setEditName(profile.name || '');
    setEditDescription(profile.description || '');
  }, []);

  // ── Save edit profile ───────────────────────────────────────────
  const handleSaveEditProfile = useCallback(async () => {
    if (!editingProfile?.id || !editName.trim()) return;
    try {
      const updated = await ragApi.updatePipelineProfile(editingProfile.id, {
        name: editName.trim(),
        description: editDescription.trim(),
      });
      setProfiles((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      if (selectedProfileObj?.id === updated.id) {
        setSelectedProfileObj(updated);
      }
      setEditingProfile(null);
    } catch {
      // silent
    }
  }, [editingProfile, editName, editDescription, selectedProfileObj]);

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
          score: lastRunScores[phase.key] ?? null,
          duration: lastRunDurations[phase.key] ?? null,
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
        sourceHandle: 'right',
        targetHandle: 'left',
        type: 'smartEdge',
        animated: false,
        style: { stroke: '#6b7280', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#6b7280', width: 16, height: 16 },
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

  // ── Selected phase config for dialog ──────────────────────────────
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
        thinking_budget: cfg.thinking_budget,
      },
      stats: {
        score: lastRunScores[selectedPhase] ?? null,
        duration: lastRunDurations[selectedPhase] ?? null,
      },
    };
  }, [selectedPhase, phaseConfigs, lastRunScores, lastRunDurations]);

  // ── Double-click handler for nodes ────────────────────────────────
  const handleNodeDoubleClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedPhase(node.id);
  }, []);

  return (
    <div className="h-full flex flex-col">
      {/* Controls bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-white border rounded-lg mb-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          {selectedProfileObj && (
            <span className="text-sm font-medium text-gray-900">
              {selectedProfileObj.name}
              {selectedProfileObj.is_default && (
                <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">padrão</span>
              )}
            </span>
          )}
          <span className="text-xs text-gray-500">{PIPELINE_PHASES.length} fases</span>
          {hasUnsavedChanges && (
            <span className="text-xs text-amber-600 font-medium">Alterações não salvas</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {lastRunScore != null && (
            <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full ${
              lastRunScore >= 75 ? 'bg-green-100 text-green-700' :
              lastRunScore >= 50 ? 'bg-yellow-100 text-yellow-700' :
              'bg-red-100 text-red-700'
            }`}>
              Score: {lastRunScore}/100
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={!hasUnsavedChanges || saving}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            )}
            Salvar
          </button>
        </div>
      </div>

      {/* Main content - 3 columns */}
      <div className="flex gap-3 flex-1 min-h-0">

        {/* LEFT COLUMN: Profiles */}
        <div className="w-64 border rounded-lg bg-white overflow-hidden flex flex-col flex-shrink-0">
          {/* Profiles list */}
          <div className="flex-1 overflow-y-auto p-3">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Profiles</h3>
            <div className="space-y-1.5">
              {profiles.map((profile) => {
                const isSelected = selectedProfileObj?.id === profile.id;
                return (
                  <div
                    key={profile.id}
                    onClick={() => handleSelectProfile(profile)}
                    onDoubleClick={() => handleOpenEditProfile(profile)}
                    className={`group relative cursor-pointer p-2.5 rounded-md border transition-colors ${
                      isSelected
                        ? 'bg-blue-50 border-blue-200'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex-1 min-w-0">
                        <div className={`text-xs font-medium truncate ${isSelected ? 'text-blue-700' : 'text-gray-900'}`}>
                          {profile.name}
                        </div>
                        {profile.description && (
                          <div className="text-[10px] text-gray-400 truncate mt-0.5">{profile.description}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {!profile.is_default && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleSetDefault(profile.id); }}
                            title="Definir como padrão"
                            className="p-0.5 text-green-500 hover:text-green-700"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          </button>
                        )}
                        {!profile.is_default && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteProfile(profile.id); }}
                            title="Excluir"
                            className="p-0.5 text-red-400 hover:text-red-600"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                    {profile.is_default && (
                      <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-green-400" title="Padrão" />
                    )}
                  </div>
                );
              })}

              {profiles.length === 0 && (
                <p className="text-xs text-gray-400 italic">Nenhum profile criado</p>
              )}
            </div>

            {/* Create profile */}
            {creatingProfile ? (
              <div className="mt-3 space-y-2 border-t pt-3">
                <input
                  type="text"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  placeholder="Nome do profile"
                  className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateProfile()}
                />
                <input
                  type="text"
                  value={newProfileDescription}
                  onChange={(e) => setNewProfileDescription(e.target.value)}
                  placeholder="Descrição (opcional)"
                  className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <div className="flex gap-1.5">
                  <button
                    onClick={handleCreateProfile}
                    className="flex-1 px-2 py-1 bg-blue-600 text-white text-xs rounded-md hover:bg-blue-700"
                  >
                    Criar
                  </button>
                  <button
                    onClick={() => { setCreatingProfile(false); setNewProfileName(''); setNewProfileDescription(''); }}
                    className="flex-1 px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-md hover:bg-gray-200"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setCreatingProfile(true)}
                className="w-full mt-3 flex items-center justify-center gap-1.5 p-2 rounded-md border border-dashed border-gray-300 text-xs text-gray-500 hover:bg-gray-50 hover:border-gray-400 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Novo Profile
              </button>
            )}
          </div>
        </div>

        {/* CENTER: ReactFlow Canvas */}
        <div className="flex-1 border rounded-lg overflow-hidden bg-gray-50">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={{ type: 'smartEdge' }}
            connectionLineType={ConnectionLineType.SmoothStep}
            connectionLineStyle={{ stroke: '#6b7280', strokeWidth: 2 }}
            onNodeDoubleClick={handleNodeDoubleClick}
            fitView
            fitViewOptions={{ padding: 0.5, minZoom: 0.8, maxZoom: 1.2 }}
            proOptions={{ hideAttribution: true }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={true}
            snapToGrid={true}
            snapGrid={[20, 20]}
            minZoom={0.2}
            maxZoom={2}
            panOnDrag
            zoomOnScroll
          >
            <Background color="#e5e7eb" gap={20} />
            <Controls />
            <MiniMap
              nodeStrokeWidth={3}
              zoomable
              pannable
              style={{ height: 90, width: 140 }}
            />
          </ReactFlow>
        </div>

        {/* RIGHT COLUMN: Phase Configuration */}
        <div className="w-72 border rounded-lg bg-white overflow-hidden flex flex-col flex-shrink-0">
          <div className="border-b p-3">
            <h3 className="text-sm font-semibold text-gray-900">Fases do Pipeline</h3>
          </div>
          <div className="flex-1 overflow-y-auto">
            <div className="p-3 space-y-1">
              {PIPELINE_PHASES.map((phase, index) => {
                const cfg = phaseConfigs[phase.key] || {};
                const model = cfg.model || phase.defaultModel;
                const provider = model ? getProviderFromModel(model) : phase.provider;
                const modelShort = phase.hasAI ? getModelShort(model) : 'Local';
                const score = lastRunScores[phase.key];
                const duration = lastRunDurations[phase.key];
                const isSelected = selectedPhase === phase.key;

                return (
                  <div
                    key={phase.key}
                    onClick={() => setSelectedPhase(phase.key)}
                    className={`flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-purple-50 border-purple-200'
                        : 'border-gray-100 hover:bg-gray-50 hover:border-gray-200'
                    }`}
                  >
                    <span className="text-[10px] font-bold text-gray-400 w-4 text-right">{index + 1}</span>
                    {phase.hasAI ? (
                      <ProviderIcon provider={provider} size="w-4 h-4" />
                    ) : (
                      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-gray-900 truncate">{phase.label}</div>
                      <div className="text-[10px] text-gray-500">{modelShort}</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {score != null && (
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                          score >= 75 ? 'bg-green-100 text-green-700' :
                          score >= 50 ? 'bg-yellow-100 text-yellow-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {score}
                        </span>
                      )}
                      {duration != null && (
                        <span className="text-[10px] text-gray-400">{duration}s</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {/* Global score footer */}
          {lastRunScore != null && (
            <div className="border-t p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-600">Score Global</span>
                <span className={`text-sm font-bold ${
                  lastRunScore >= 75 ? 'text-green-600' :
                  lastRunScore >= 50 ? 'text-yellow-600' :
                  'text-red-600'
                }`}>
                  {lastRunScore}/100
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Profile edit dialog (double-click on profile card) */}
      {editingProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setEditingProfile(null)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between bg-gray-50">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Editar Profile</h3>
                <p className="text-xs text-gray-500 mt-0.5">Altere o nome e a descrição do profile.</p>
              </div>
              <button onClick={() => setEditingProfile(null)} className="text-gray-400 hover:text-gray-600 ml-4 flex-shrink-0 mt-0.5">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nome</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:ring-1 focus:ring-purple-500 focus:border-purple-500"
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveEditProfile()}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Descrição</label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={3}
                  className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:ring-1 focus:ring-purple-500 focus:border-purple-500 resize-none"
                />
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
              <button
                onClick={() => setEditingProfile(null)}
                className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveEditProfile}
                disabled={!editName.trim()}
                className="px-3 py-1.5 text-sm text-white bg-purple-600 rounded-md hover:bg-purple-700 transition-colors disabled:opacity-40"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Phase config dialog (double-click on node or click on right column) */}
      {selectedPhaseConfig && (
        <PhaseConfigDialog
          phaseKey={selectedPhaseConfig.phaseKey}
          label={selectedPhaseConfig.label}
          config={selectedPhaseConfig.config}
          stats={selectedPhaseConfig.stats}
          models={models.map((m) => ({ id: m.id, name: m.name || m.model_name, provider: m.provider }))}
          onSave={handlePhaseChange}
          onClose={() => setSelectedPhase(null)}
        />
      )}

      {/* Run History Section */}
      {projectId && (
        <div className="border-t border-gray-200 bg-white mt-3 rounded-lg">
          <button
            onClick={toggleHistory}
            className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50 rounded-lg"
          >
            <span className="font-medium">
              Histórico de Execuções {runs.length > 0 ? `(${runs.length})` : ''}
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

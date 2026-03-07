/**
 * Settings Page
 * Manage system-wide settings and default AI models
 *
 * PROMPT #246 - Professional redesign with tabbed layout and visual hierarchy
 * PROMPT #266 - Redesign with wiki-style sidebar navigation
 */

'use client';

import React, { Suspense, useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { Layout, Breadcrumbs } from '@/components/layout';
import { Card, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FolderPicker } from '@/components/ui/FolderPicker';
import { FilePicker } from '@/components/ui/FilePicker';
import { settingsApi, aiModelsApi } from '@/lib/api';
import { SystemSettings, AIModel, AIModelUsageType } from '@/lib/types';
import {
  Settings as SettingsIcon,
  Save,
  Plus,
  Trash2,
  RefreshCw,
  Bot,
  ListOrdered,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Cpu,
  MessageSquare,
  GitCommit,
  Zap,
  Search,
  Layers,
  Globe,
  ShieldOff,
  FolderX,
  FileX,
  Check,
  X,
  Lightbulb,
  Folder,
  FileSearch,
  Shield,
} from 'lucide-react';
import { useNotification } from '@/hooks';

const MODEL_CONFIGS = [
  { key: 'interview', label: 'Entrevistas', usageType: AIModelUsageType.INTERVIEW, icon: MessageSquare, color: 'text-blue-600 bg-blue-50', description: 'Perguntas de entrevista de contexto e focadas em cards' },
  { key: 'prompt_generation', label: 'Geração de Prompts', usageType: AIModelUsageType.PROMPT_GENERATION, icon: Zap, color: 'text-purple-600 bg-purple-50', description: 'Gerando prompts e conteúdo de cards' },
  { key: 'commit_generation', label: 'Geração de Commits', usageType: AIModelUsageType.COMMIT_GENERATION, icon: GitCommit, color: 'text-green-600 bg-green-50', description: 'Geração de mensagens de commit Git' },
  { key: 'task_execution', label: 'Execução de Tarefas', usageType: AIModelUsageType.TASK_EXECUTION, icon: Cpu, color: 'text-orange-600 bg-orange-50', description: 'Executando prompts de tarefas e geração de código' },
  { key: 'pattern_discovery', label: 'Descoberta de Padrões', usageType: AIModelUsageType.PATTERN_DISCOVERY, icon: Search, color: 'text-cyan-600 bg-cyan-50', description: 'Descoberta de padrões de código e specs por IA' },
  { key: 'queue_orchestration', label: 'Orquestração de Fila', usageType: AIModelUsageType.QUEUE_ORCHESTRATION, icon: Layers, color: 'text-pink-600 bg-pink-50', description: 'Execução de prompts da fila de orquestração' },
  { key: 'general', label: 'Geral', usageType: AIModelUsageType.GENERAL, icon: Globe, color: 'text-gray-600 bg-gray-100', description: 'Modelo fallback para todas as outras operações' },
];

type SectionId = 'models' | 'queue' | 'blocklist' | 'general';

const SECTIONS: Array<{ id: SectionId; label: string; icon: React.ElementType; description: string }> = [
  { id: 'models', label: 'Modelos IA', icon: Bot, description: 'Modelos padrão por tipo de operação' },
  { id: 'queue', label: 'Fila de Execução', icon: ListOrdered, description: 'Estratégia e concorrência da fila' },
  { id: 'blocklist', label: 'Lista de Bloqueio', icon: ShieldOff, description: 'Pastas e arquivos ignorados' },
  { id: 'general', label: 'Avançado', icon: Sliders, description: 'Segurança e configurações personalizadas' },
];

function SettingsPageContent() {
  const { showError, showWarning, NotificationComponent } = useNotification();
  const searchParams = useSearchParams();
  const validSections: SectionId[] = ['models', 'queue', 'blocklist', 'general'];
  const sectionParam = searchParams.get('section') as SectionId | null;
  const initialSection = sectionParam && validSections.includes(sectionParam) ? sectionParam : 'models';

  const [settings, setSettings] = useState<SystemSettings[]>([]);
  const [models, setModels] = useState<AIModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [settingToDelete, setSettingToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [activeSection, setActiveSectionState] = useState<SectionId>(initialSection);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const setActiveSection = (section: SectionId) => {
    setActiveSectionState(section);
    const url = new URL(window.location.href);
    if (section === 'models') {
      url.searchParams.delete('section');
    } else {
      url.searchParams.set('section', section);
    }
    window.history.replaceState({}, '', url.toString());
  };

  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newDescription, setNewDescription] = useState('');

  const [defaultModels, setDefaultModels] = useState<Record<string, string>>({
    interview: '',
    prompt_generation: '',
    commit_generation: '',
    task_execution: '',
    pattern_discovery: '',
    queue_orchestration: '',
    general: '',
  });

  const [queueSettings, setQueueSettings] = useState({
    queue_auto_sort_strategy: 'balanced',
    queue_max_concurrent: '1',
    queue_auto_populate: 'true',
  });

  const [blocklist, setBlocklist] = useState<{ directories: string[]; file_patterns: string[] }>({ directories: [], file_patterns: [] });
  const [blocklistSuggestions, setBlocklistSuggestions] = useState<Array<{ path: string; type: string; source_project: string; rationale: string }>>([]);
  const [newBlockDir, setNewBlockDir] = useState('');
  const [newBlockPattern, setNewBlockPattern] = useState('');
  const [savingBlocklist, setSavingBlocklist] = useState(false);
  const [showBlocklistFolderPicker, setShowBlocklistFolderPicker] = useState(false);
  const [showBlocklistFilePicker, setShowBlocklistFilePicker] = useState(false);

  const [allowProtectedDeletion, setAllowProtectedDeletion] = useState(false);
  const [savingProtection, setSavingProtection] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (saveSuccess) {
      const timer = setTimeout(() => setSaveSuccess(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [saveSuccess]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const settingsData = await settingsApi.list();
      setSettings(Array.isArray(settingsData) ? settingsData : settingsData.data || []);

      const modelsData = await aiModelsApi.list();
      const modelsList = Array.isArray(modelsData) ? modelsData : modelsData.data || [];
      setModels(modelsList);

      const allSettings = Array.isArray(settingsData) ? settingsData : settingsData.data || [];
      const defaultModelSettings = allSettings.filter((s: SystemSettings) => s.key.startsWith('default_model_'));

      const defaults: Record<string, string> = {};
      defaultModelSettings.forEach((s: SystemSettings) => {
        const usageType = s.key.replace('default_model_', '');
        defaults[usageType] = s.value;
      });
      setDefaultModels(prev => ({ ...prev, ...defaults }));

      const queueKeys = ['queue_auto_sort_strategy', 'queue_max_concurrent', 'queue_auto_populate'];
      const queueDefaults: Record<string, string> = {};
      allSettings
        .filter((s: SystemSettings) => queueKeys.includes(s.key))
        .forEach((s: SystemSettings) => { queueDefaults[s.key] = s.value; });
      setQueueSettings(prev => ({ ...prev, ...queueDefaults }));

      try {
        const bl = await settingsApi.getBlocklist();
        setBlocklist(bl || { directories: [], file_patterns: [] });
        const sug = await settingsApi.getBlocklistSuggestions();
        setBlocklistSuggestions(Array.isArray(sug) ? sug : []);
      } catch {
        // blocklist endpoints may not exist yet
      }

      const protSetting = allSettings.find((s: SystemSettings) => s.key === 'allow_protected_project_deletion');
      setAllowProtectedDeletion(protSetting?.value === 'true');
    } catch (err: unknown) {
      console.error('Failed to load settings:', err);
      setError((err as Error).message || 'Falha ao carregar configurações');
    } finally {
      setLoading(false);
    }
  };

  const handleAddSetting = async () => {
    if (!newKey.trim()) {
      showWarning('Insira uma chave de configuração');
      return;
    }
    try {
      await settingsApi.set(newKey, newValue, newDescription || undefined);
      setNewKey('');
      setNewValue('');
      setNewDescription('');
      await loadData();
      setSaveSuccess('Configuração adicionada');
    } catch (err: any) {
      showError(`Falha ao adicionar configuração: ${err.message}`);
    }
  };

  const handleDeleteSetting = (key: string) => {
    setSettingToDelete(key);
    setShowDeleteDialog(true);
  };

  const confirmDeleteSetting = async () => {
    if (!settingToDelete) return;
    setIsDeleting(true);
    try {
      await settingsApi.delete(settingToDelete);
      setShowDeleteDialog(false);
      setSettingToDelete(null);
      await loadData();
    } catch (err: any) {
      showError(`Falha ao excluir configuração: ${err.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSaveDefaultModels = async () => {
    setSaving(true);
    try {
      const updates: Record<string, any> = {};
      Object.entries(defaultModels).forEach(([usageType, modelId]) => {
        updates[`default_model_${usageType}`] = modelId || '';
      });
      await settingsApi.bulk(updates);
      await loadData();
      setSaveSuccess('Modelos padrão salvos');
    } catch (err: any) {
      showError(`Falha ao salvar modelos padrão: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const getModelsForUsageType = (usageType: AIModelUsageType) => {
    return models.filter(m => m.usage_type === usageType && m.is_active);
  };

  const [savingQueue, setSavingQueue] = useState(false);
  const handleSaveQueueSettings = async () => {
    setSavingQueue(true);
    try {
      await settingsApi.bulk(queueSettings);
      await loadData();
      setSaveSuccess('Configurações da fila salvas');
    } catch (err: any) {
      showError(`Falha ao salvar configurações da fila: ${err.message}`);
    } finally {
      setSavingQueue(false);
    }
  };

  const handleAddBlockDir = async (dirName?: string) => {
    const dir = (dirName || newBlockDir).trim();
    if (!dir) { showWarning('Insira o nome da pasta'); return; }
    if (blocklist.directories.includes(dir)) { showWarning('Pasta ja esta na lista'); return; }
    const updated = { ...blocklist, directories: [...blocklist.directories, dir].sort() };
    setSavingBlocklist(true);
    try {
      const result = await settingsApi.saveBlocklist(updated);
      setBlocklist(result);
      setNewBlockDir('');
      setSaveSuccess('Pasta adicionada a lista de bloqueio');
    } catch (err: any) { showError(`Falha ao salvar: ${err?.message || err?.detail || String(err)}`); }
    finally { setSavingBlocklist(false); }
  };

  const handleFolderPickerSelect = (fullPath: string) => {
    const folderName = fullPath.split('/').pop() || fullPath;
    setShowBlocklistFolderPicker(false);
    handleAddBlockDir(folderName);
  };

  const handleFolderPickerSelectMultiple = async (fullPaths: string[]) => {
    const newDirs = fullPaths
      .map(p => p.split('/').pop() || p)
      .filter(d => d && !blocklist.directories.includes(d));
    if (newDirs.length === 0) { showWarning('Todas as pastas ja estao na lista'); return; }
    const updated = { ...blocklist, directories: [...blocklist.directories, ...newDirs].sort() };
    setSavingBlocklist(true);
    try {
      const result = await settingsApi.saveBlocklist(updated);
      setBlocklist(result);
      setSaveSuccess(`${newDirs.length} ${newDirs.length === 1 ? 'pasta adicionada' : 'pastas adicionadas'} a lista de bloqueio`);
    } catch (err: any) { showError(`Falha ao salvar: ${err?.message || err?.detail || String(err)}`); }
    finally { setSavingBlocklist(false); }
  };

  const handleAddBlockPattern = async (patName?: string) => {
    const pat = (patName || newBlockPattern).trim();
    if (!pat) { showWarning('Insira o padrão de arquivo'); return; }
    if (blocklist.file_patterns.includes(pat)) { showWarning('Padrão ja esta na lista'); return; }
    const updated = { ...blocklist, file_patterns: [...blocklist.file_patterns, pat].sort() };
    setSavingBlocklist(true);
    try {
      const result = await settingsApi.saveBlocklist(updated);
      setBlocklist(result);
      setNewBlockPattern('');
      setSaveSuccess('Padrão adicionado a lista de bloqueio');
    } catch (err: any) { showError(`Falha ao salvar: ${err?.message || err?.detail || String(err)}`); }
    finally { setSavingBlocklist(false); }
  };

  const handleRemoveBlockDir = async (dir: string) => {
    const updated = { ...blocklist, directories: blocklist.directories.filter(d => d !== dir) };
    try {
      const result = await settingsApi.saveBlocklist(updated);
      setBlocklist(result);
      setSaveSuccess('Pasta removida');
    } catch (err: any) { showError(`Falha ao remover: ${err?.message || err?.detail || String(err)}`); }
  };

  const handleRemoveBlockPattern = async (pat: string) => {
    const updated = { ...blocklist, file_patterns: blocklist.file_patterns.filter(p => p !== pat) };
    try {
      const result = await settingsApi.saveBlocklist(updated);
      setBlocklist(result);
      setSaveSuccess('Padrão removido');
    } catch (err: any) { showError(`Falha ao remover: ${err?.message || err?.detail || String(err)}`); }
  };

  const handleFilePickerSelectMultiple = async (fileNames: string[]) => {
    const newPats = fileNames.filter(f => f && !blocklist.file_patterns.includes(f));
    if (newPats.length === 0) { showWarning('Todos os arquivos ja estao na lista'); return; }
    const updated = { ...blocklist, file_patterns: [...blocklist.file_patterns, ...newPats].sort() };
    setSavingBlocklist(true);
    try {
      const result = await settingsApi.saveBlocklist(updated);
      setBlocklist(result);
      setSaveSuccess(`${newPats.length} ${newPats.length === 1 ? 'arquivo adicionado' : 'arquivos adicionados'} a lista de bloqueio`);
    } catch (err: any) { showError(`Falha ao salvar: ${err?.message || err?.detail || String(err)}`); }
    finally { setSavingBlocklist(false); }
  };

  const handleApproveSuggestion = async (suggestion: { path: string; type: string }) => {
    try {
      const result = await settingsApi.approveBlocklistSuggestions([suggestion]);
      setBlocklist(result.blocklist);
      setBlocklistSuggestions(prev => prev.filter(s => s.path !== suggestion.path));
      setSaveSuccess('Sugestão aprovada');
    } catch (err: any) { showError(`Falha ao aprovar: ${err.message}`); }
  };

  const handleRejectSuggestion = async (suggestion: { path: string; type: string }) => {
    try {
      await settingsApi.rejectBlocklistSuggestions([suggestion]);
      setBlocklistSuggestions(prev => prev.filter(s => s.path !== suggestion.path));
      setSaveSuccess('Sugestão rejeitada');
    } catch (err: any) { showError(`Falha ao rejeitar: ${err.message}`); }
  };

  const handleApproveAllSuggestions = async () => {
    if (blocklistSuggestions.length === 0) return;
    try {
      const items = blocklistSuggestions.map(s => ({ path: s.path, type: s.type }));
      const result = await settingsApi.approveBlocklistSuggestions(items);
      setBlocklist(result.blocklist);
      setBlocklistSuggestions([]);
      setSaveSuccess('Todas as sugestões aprovadas');
    } catch (err: any) { showError(`Falha ao aprovar: ${err.message}`); }
  };

  const handleRejectAllSuggestions = async () => {
    if (blocklistSuggestions.length === 0) return;
    try {
      const items = blocklistSuggestions.map(s => ({ path: s.path, type: s.type }));
      await settingsApi.rejectBlocklistSuggestions(items);
      setBlocklistSuggestions([]);
      setSaveSuccess('Todas as sugestões rejeitadas');
    } catch (err: any) { showError(`Falha ao rejeitar: ${err.message}`); }
  };

  const handleToggleProtectedDeletion = async () => {
    setSavingProtection(true);
    const newValue = !allowProtectedDeletion;
    try {
      await settingsApi.set('allow_protected_project_deletion', String(newValue), 'Permitir exclusão de projetos protegidos (true/false)');
      setAllowProtectedDeletion(newValue);
      setSaveSuccess(newValue ? 'Exclusao de projetos protegidos ATIVADA' : 'Exclusao de projetos protegidos DESATIVADA');
    } catch (err: any) {
      showError(`Falha ao salvar: ${err.message}`);
    } finally {
      setSavingProtection(false);
    }
  };

  const generalSettings = settings.filter(s => !s.key.startsWith('default_model_') && !s.key.startsWith('queue_'));
  const configuredModels = Object.values(defaultModels).filter(v => v && v.length > 0).length;
  const blocklistTotal = blocklist.directories.length + blocklist.file_patterns.length;

  const getBadge = (id: SectionId) => {
    if (id === 'models') return `${configuredModels}/7`;
    if (id === 'blocklist' && blocklistTotal > 0) return String(blocklistTotal);
    if (id === 'blocklist' && blocklistSuggestions.length > 0) return `${blocklistSuggestions.length}!`;
    if (id === 'general' && generalSettings.length > 0) return String(generalSettings.length);
    return null;
  };

  if (loading) {
    return (
      <Layout>
        <Breadcrumbs />
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </Layout>
    );
  }

  const activeInfo = SECTIONS.find(s => s.id === activeSection)!;

  return (
    <Layout>
      <Breadcrumbs />
      {NotificationComponent}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

        {/* ── Sidebar ── */}
        <div className="lg:col-span-1">
          <div className="sticky top-4">
            <div className="border-2 border-gray-300 rounded-lg p-4">
              {/* Header */}
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-900">Configurações</h3>
              </div>

              <nav className="space-y-1">
                {SECTIONS.map((section) => {
                  const Icon = section.icon;
                  const isActive = activeSection === section.id;
                  const badge = getBadge(section.id);
                  return (
                    <button
                      key={section.id}
                      onClick={() => setActiveSection(section.id)}
                      className={`w-full text-left p-2 rounded text-sm transition-colors flex items-center justify-between gap-2 ${
                        isActive
                          ? 'bg-blue-50 text-blue-700 font-medium'
                          : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <span className="flex items-center gap-2 truncate">
                        <Icon className="w-4 h-4 flex-shrink-0" />
                        <span className="truncate">{section.label}</span>
                      </span>
                      {badge && (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                          isActive ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>

              {/* Refresh btn */}
              <div className="mt-3 pt-3 border-t border-gray-200">
                <button
                  onClick={loadData}
                  disabled={loading}
                  className="w-full flex items-center gap-2 p-2 rounded text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <RefreshCw className={`w-4 h-4 flex-shrink-0 ${loading ? 'animate-spin' : ''}`} />
                  <span>Atualizar</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Main content ── */}
        <div className="lg:col-span-3">
          {/* Section header */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 className="text-xl font-bold text-gray-900">{activeInfo.label}</h1>
              <p className="text-sm text-gray-500 mt-0.5">{activeInfo.description}</p>
            </div>

            {/* Section-level save button */}
            {activeSection === 'models' && (
              <Button onClick={handleSaveDefaultModels} disabled={saving}>
                <Save className="w-4 h-4 mr-2" />
                {saving ? 'Salvando...' : 'Salvar'}
              </Button>
            )}
            {activeSection === 'queue' && (
              <Button onClick={handleSaveQueueSettings} disabled={savingQueue}>
                <Save className="w-4 h-4 mr-2" />
                {savingQueue ? 'Salvando...' : 'Salvar'}
              </Button>
            )}
          </div>

          {/* Toasts */}
          {saveSuccess && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800 mb-4">
              <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
              {saveSuccess}
            </div>
          )}
          {error && (
            <div className="flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg mb-4">
              <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-900">{error}</p>
              </div>
              <Button variant="outline" size="sm" onClick={loadData}>Tentar Novamente</Button>
            </div>
          )}

          {/* ── Section: AI Models ── */}
          {activeSection === 'models' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">
                Selecione qual modelo IA gerencia cada tipo de operação. Modelos devem estar configurados e ativos na página Modelos IA.
              </p>

              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                {MODEL_CONFIGS.map((config) => {
                  const Icon = config.icon;
                  const [iconColor, iconBg] = config.color.split(' ');
                  const availableModels = getModelsForUsageType(config.usageType);
                  const isConfigured = !!defaultModels[config.key];

                  return (
                    <div
                      key={config.key}
                      className={`p-4 rounded-lg border transition-colors ${
                        isConfigured ? 'border-gray-200 bg-white' : 'border-dashed border-gray-300 bg-gray-50'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`p-2 rounded-lg ${iconBg} flex-shrink-0`}>
                          <Icon className={`w-4 h-4 ${iconColor}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium text-gray-900">{config.label}</span>
                            {isConfigured && <span className="w-1.5 h-1.5 rounded-full bg-green-500" />}
                          </div>
                          <p className="text-xs text-gray-500 mb-3">{config.description}</p>
                          <Select
                            id={`model-${config.key}`}
                            value={defaultModels[config.key] || ''}
                            onChange={(e) => setDefaultModels({ ...defaultModels, [config.key]: e.target.value })}
                            options={[
                              { value: '', label: availableModels.length === 0 ? 'Nenhum modelo disponível' : 'Nenhum modelo padrão' },
                              ...availableModels.map(m => ({ value: m.id, label: m.name })),
                            ]}
                            className="text-sm"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {!defaultModels.general && (
                <div className="flex items-center gap-3 px-4 py-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <AlertTriangle className="w-4 h-4 text-yellow-600 flex-shrink-0" />
                  <p className="text-sm text-yellow-800">
                    O modelo <strong>General</strong> age como fallback para todas as operações. Recomenda-se configura-lo.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Section: Queue ── */}
          {activeSection === 'queue' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">
                Controle como a fila de orquestração de prompts processa e ordena a execução.
              </p>

              <div className="p-4 rounded-lg border border-gray-200 bg-white">
                <div className="flex items-start gap-4">
                  <div className="p-2 bg-blue-50 rounded-lg flex-shrink-0">
                    <ListOrdered className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <Label htmlFor="queue-strategy" className="text-sm font-medium text-gray-900">Estratégia de Ordenação Automática</Label>
                    <p className="text-xs text-gray-500 mt-0.5 mb-2">Determina como os cards são ordenados automaticamente na fila de execução</p>
                    <Select
                      id="queue-strategy"
                      value={queueSettings.queue_auto_sort_strategy}
                      onChange={(e) => setQueueSettings({ ...queueSettings, queue_auto_sort_strategy: e.target.value })}
                      options={[
                        { value: 'balanced', label: 'Balanceado (35% hierarquia, 30% prioridade, 25% dependência, 10% idade)' },
                        { value: 'hierarchy_first', label: 'Hierarquia Primeiro (epics > stories > tasks)' },
                        { value: 'priority_first', label: 'Prioridade Primeiro (critico > alto > medio > baixo)' },
                        { value: 'dependency_first', label: 'Dependência Primeiro (resolver dependências primeiro)' },
                        { value: 'age_first', label: 'Idade Primeiro (cards mais antigos primeiro)' },
                      ]}
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-lg border border-gray-200 bg-white">
                  <div className="flex items-start gap-4">
                    <div className="p-2 bg-orange-50 rounded-lg flex-shrink-0">
                      <Cpu className="w-4 h-4 text-orange-600" />
                    </div>
                    <div className="flex-1">
                      <Label htmlFor="queue-concurrent" className="text-sm font-medium text-gray-900">Max Simultâneos</Label>
                      <p className="text-xs text-gray-500 mt-0.5 mb-2">Execuções de prompts simultâneas</p>
                      <Select
                        id="queue-concurrent"
                        value={queueSettings.queue_max_concurrent}
                        onChange={(e) => setQueueSettings({ ...queueSettings, queue_max_concurrent: e.target.value })}
                        options={[
                          { value: '1', label: '1 (Sequencial)' },
                          { value: '2', label: '2' },
                          { value: '3', label: '3' },
                          { value: '5', label: '5' },
                        ]}
                      />
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-lg border border-gray-200 bg-white">
                  <div className="flex items-start gap-4">
                    <div className="p-2 bg-green-50 rounded-lg flex-shrink-0">
                      <Zap className="w-4 h-4 text-green-600" />
                    </div>
                    <div className="flex-1">
                      <Label htmlFor="queue-auto-populate" className="text-sm font-medium text-gray-900">Auto-Preencher</Label>
                      <p className="text-xs text-gray-500 mt-0.5 mb-2">Adicionar cards a fila ao ativar</p>
                      <Select
                        id="queue-auto-populate"
                        value={queueSettings.queue_auto_populate}
                        onChange={(e) => setQueueSettings({ ...queueSettings, queue_auto_populate: e.target.value })}
                        options={[
                          { value: 'true', label: 'Habilitado' },
                          { value: 'false', label: 'Desabilitado' },
                        ]}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Section: Blocklist ── */}
          {activeSection === 'blocklist' && (
            <div className="space-y-6">
              <p className="text-sm text-gray-500">
                Pastas e padrões de arquivos que serão ignorados em todos os projetos durante análise de código.
              </p>

              {/* Suggestions */}
              {blocklistSuggestions.length > 0 && (
                <div className="p-4 rounded-lg border border-amber-200 bg-amber-50">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Lightbulb className="w-4 h-4 text-amber-600" />
                      <span className="text-sm font-medium text-amber-900">Sugestões Pendentes</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-200 text-amber-800">{blocklistSuggestions.length}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={handleApproveAllSuggestions} className="text-green-700 border-green-300 hover:bg-green-50">
                        <Check className="w-3.5 h-3.5 mr-1" />Aprovar Todas
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleRejectAllSuggestions} className="text-red-700 border-red-300 hover:bg-red-50">
                        <X className="w-3.5 h-3.5 mr-1" />Rejeitar Todas
                      </Button>
                    </div>
                  </div>
                  <div className="border border-amber-200 rounded-lg overflow-hidden max-h-[280px] overflow-y-auto bg-white">
                    <ul className="divide-y divide-gray-100">
                      {blocklistSuggestions.map((sug, idx) => (
                        <li key={idx} className="flex items-center justify-between p-3 hover:bg-gray-50 transition-colors">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className={`flex-shrink-0 ${sug.type === 'directory' ? 'text-yellow-500' : 'text-orange-500'}`}>
                              {sug.type === 'directory' ? <Folder className="w-4 h-4" /> : <FileX className="w-4 h-4" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-gray-900 text-sm truncate">{sug.path}</span>
                                <span className={`px-1.5 py-0.5 text-xs rounded-full flex-shrink-0 ${sug.type === 'directory' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                                  {sug.type === 'directory' ? 'Pasta' : 'Padrão'}
                                </span>
                              </div>
                              {sug.rationale && <p className="text-xs text-gray-500 truncate mt-0.5">{sug.rationale}</p>}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0 ml-3">
                            <button onClick={() => handleApproveSuggestion({ path: sug.path, type: sug.type })} className="p-1.5 text-green-500 hover:text-green-700 hover:bg-green-100 rounded transition-colors" title="Aprovar">
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleRejectSuggestion({ path: sug.path, type: sug.type })} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-100 rounded transition-colors" title="Rejeitar">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* Blocked Directories */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <FolderX className="w-4 h-4 text-red-500" />
                  <span className="text-sm font-semibold text-gray-800">Pastas Bloqueadas</span>
                  {blocklist.directories.length > 0 && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{blocklist.directories.length}</span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mb-3">Pastas com esses nomes serão ignoradas em todos os projetos</p>

                <div className="flex gap-2 mb-3">
                  <input
                    value={newBlockDir}
                    onChange={(e) => setNewBlockDir(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddBlockDir()}
                    placeholder="Nome da pasta (ex: node_modules, .cache, dist)..."
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <Button type="button" variant="outline" onClick={() => setShowBlocklistFolderPicker(true)} title="Navegar pastas">
                    <Folder className="w-4 h-4" />
                  </Button>
                  <Button onClick={() => handleAddBlockDir()} disabled={savingBlocklist || !newBlockDir.trim()}>
                    <Plus className="w-4 h-4 mr-1" />Adicionar
                  </Button>
                </div>

                {blocklist.directories.length === 0 ? (
                  <div className="border border-dashed border-gray-200 rounded-lg p-6 text-center text-gray-400">
                    <FolderX className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                    <p className="text-sm">Nenhuma pasta bloqueada</p>
                  </div>
                ) : (
                  <div className="border border-gray-200 rounded-lg overflow-hidden max-h-[220px] overflow-y-auto">
                    <ul className="divide-y divide-gray-100">
                      {blocklist.directories.map((dir) => (
                        <li key={dir} className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 group transition-colors">
                          <FolderX className="w-4 h-4 text-red-400 flex-shrink-0" />
                          <span className="flex-1 text-sm text-gray-900">{dir}</span>
                          <button onClick={() => handleRemoveBlockDir(dir)} className="p-1.5 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-all" title="Remover">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <FolderPicker
                  open={showBlocklistFolderPicker}
                  onClose={() => setShowBlocklistFolderPicker(false)}
                  onSelect={handleFolderPickerSelect}
                  onSelectMultiple={handleFolderPickerSelectMultiple}
                  multiSelect
                  title="Selecionar Pastas para Bloquear"
                />
              </div>

              {/* Blocked File Patterns */}
              <div className="pt-4 border-t border-gray-200">
                <div className="flex items-center gap-2 mb-3">
                  <FileX className="w-4 h-4 text-orange-500" />
                  <span className="text-sm font-semibold text-gray-800">Padrões de Arquivos Bloqueados</span>
                  {blocklist.file_patterns.length > 0 && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{blocklist.file_patterns.length}</span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mb-3">Arquivos correspondentes a esses padrões serão ignorados</p>

                <div className="mb-3">
                  <p className="text-xs text-gray-500 mb-2">Padrões comuns:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { pattern: '*.log', label: 'Logs' },
                      { pattern: '*.bak', label: 'Backups' },
                      { pattern: '*.tmp', label: 'Temporarios' },
                      { pattern: '*.min.js', label: 'JS min' },
                      { pattern: '*.min.css', label: 'CSS min' },
                      { pattern: '*.map', label: 'Source maps' },
                      { pattern: '*.lock', label: 'Lock files' },
                      { pattern: '.DS_Store', label: 'macOS' },
                      { pattern: 'Thumbs.db', label: 'Windows' },
                      { pattern: '*.pyc', label: 'Python cache' },
                    ].filter(p => !blocklist.file_patterns.includes(p.pattern)).map((preset) => (
                      <button
                        key={preset.pattern}
                        onClick={() => handleAddBlockPattern(preset.pattern)}
                        disabled={savingBlocklist}
                        className="inline-flex items-center gap-1 px-2.5 py-1 border border-dashed border-gray-300 rounded text-xs text-gray-600 hover:border-orange-400 hover:bg-orange-50 hover:text-orange-700 transition-all"
                      >
                        <Plus className="w-3 h-3" />
                        <code>{preset.pattern}</code>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2 mb-3">
                  <input
                    value={newBlockPattern}
                    onChange={(e) => setNewBlockPattern(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddBlockPattern()}
                    placeholder="Padrão personalizado (ex: *.sqlite, *.env.*)..."
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <Button type="button" variant="outline" onClick={() => setShowBlocklistFilePicker(true)} title="Navegar arquivos">
                    <FileSearch className="w-4 h-4" />
                  </Button>
                  <Button onClick={() => handleAddBlockPattern()} disabled={savingBlocklist || !newBlockPattern.trim()}>
                    <Plus className="w-4 h-4 mr-1" />Adicionar
                  </Button>
                </div>

                {blocklist.file_patterns.length === 0 ? (
                  <div className="border border-dashed border-gray-200 rounded-lg p-6 text-center text-gray-400">
                    <FileX className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                    <p className="text-sm">Nenhum padrão bloqueado</p>
                  </div>
                ) : (
                  <div className="border border-gray-200 rounded-lg overflow-hidden max-h-[220px] overflow-y-auto">
                    <ul className="divide-y divide-gray-100">
                      {blocklist.file_patterns.map((pat) => (
                        <li key={pat} className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 group transition-colors">
                          <FileX className="w-4 h-4 text-orange-400 flex-shrink-0" />
                          <code className="flex-1 text-sm text-gray-900">{pat}</code>
                          <button onClick={() => handleRemoveBlockPattern(pat)} className="p-1.5 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-all" title="Remover">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <FilePicker
                  open={showBlocklistFilePicker}
                  onClose={() => setShowBlocklistFilePicker(false)}
                  onSelect={(f) => handleAddBlockPattern(f)}
                  onSelectMultiple={handleFilePickerSelectMultiple}
                  title="Selecionar Arquivos para Bloquear"
                />
              </div>
            </div>
          )}

          {/* ── Section: Advanced ── */}
          {activeSection === 'general' && (
            <div className="space-y-6">
              <p className="text-sm text-gray-500">
                Pares chave-valor personalizados para configuração avancada do sistema.
              </p>

              {/* Security toggle */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Shield className="w-4 h-4 text-amber-500" />
                  <span className="text-sm font-semibold text-gray-800">Segurança</span>
                </div>
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">Permitir exclusão de projetos protegidos</span>
                      {allowProtectedDeletion && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Ativo</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Quando ativo, projetos marcados como protegidos podem ser excluídos normalmente.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={allowProtectedDeletion}
                    disabled={savingProtection}
                    onClick={handleToggleProtectedDeletion}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${allowProtectedDeletion ? 'bg-red-500' : 'bg-gray-300'} ${savingProtection ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${allowProtectedDeletion ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>
              </div>

              {/* Custom settings */}
              <div className="pt-4 border-t border-gray-200">
                <div className="flex items-center gap-2 mb-3">
                  <Sliders className="w-4 h-4 text-gray-500" />
                  <span className="text-sm font-semibold text-gray-800">Configurações Personalizadas</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                  <div>
                    <Label htmlFor="new-key" className="text-xs text-gray-500 mb-1">Key</Label>
                    <Input id="new-key" placeholder="ex: max_upload_size" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="new-value" className="text-xs text-gray-500 mb-1">Valor</Label>
                    <Input id="new-value" placeholder="Valor" value={newValue} onChange={(e) => setNewValue(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="new-desc" className="text-xs text-gray-500 mb-1">Descrição</Label>
                    <Input id="new-desc" placeholder="Descrição opcional" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
                  </div>
                </div>
                <Button onClick={handleAddSetting} size="sm">
                  <Plus className="w-4 h-4 mr-1" />Adicionar
                </Button>

                {generalSettings.length === 0 ? (
                  <div className="text-center py-12 text-gray-400 mt-4">
                    <Sliders className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Nenhuma configuração personalizada</p>
                  </div>
                ) : (
                  <div className="space-y-2 mt-4">
                    {generalSettings.map((setting) => (
                      <div
                        key={setting.id}
                        className="group flex items-center justify-between gap-4 p-3 bg-white border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <code className="text-sm font-semibold text-gray-900">{setting.key}</code>
                            <Badge variant="default" className="text-xs">{typeof setting.value}</Badge>
                          </div>
                          <div className="text-sm text-gray-600 font-mono truncate">
                            {typeof setting.value === 'object' ? JSON.stringify(setting.value) : String(setting.value)}
                          </div>
                          {setting.description && <p className="text-xs text-gray-400 mt-0.5">{setting.description}</p>}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-gray-400 hidden sm:block whitespace-nowrap">
                            {new Date(setting.updated_at).toLocaleDateString()}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteSetting(setting.key)}
                            className="text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={confirmDeleteSetting}
        title="Excluir Configuração"
        message={`Tem certeza que deseja excluir "${settingToDelete}"? Esta ação não pode ser desfeita.`}
        type="danger"
        confirmLabel="Excluir"
        cancelLabel="Cancelar"
        isLoading={isDeleting}
      />
    </Layout>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    }>
      <SettingsPageContent />
    </Suspense>
  );
}

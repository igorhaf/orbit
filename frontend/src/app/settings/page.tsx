/**
 * Settings Page
 * Manage system-wide settings and default AI models
 *
 * PROMPT #246 - Professional redesign with tabbed layout and visual hierarchy
 */

'use client';

import React, { useEffect, useState } from 'react';
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

type TabId = 'models' | 'queue' | 'blocklist' | 'general';

export default function SettingsPage() {
  const { showError, showWarning, NotificationComponent } = useNotification();
  const [settings, setSettings] = useState<SystemSettings[]>([]);
  const [models, setModels] = useState<AIModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [settingToDelete, setSettingToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('models');
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

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

  // PROMPT #250 - Global Blocklist state
  const [blocklist, setBlocklist] = useState<{ directories: string[]; file_patterns: string[] }>({ directories: [], file_patterns: [] });
  const [blocklistSuggestions, setBlocklistSuggestions] = useState<Array<{ path: string; type: string; source_project: string; rationale: string }>>([]);
  const [newBlockDir, setNewBlockDir] = useState('');
  const [newBlockPattern, setNewBlockPattern] = useState('');
  const [savingBlocklist, setSavingBlocklist] = useState(false);
  const [showBlocklistFolderPicker, setShowBlocklistFolderPicker] = useState(false);
  const [showBlocklistFilePicker, setShowBlocklistFilePicker] = useState(false);

  // PROMPT #236 - Protected project deletion toggle
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
      const defaultModelSettings = allSettings
        .filter((s: SystemSettings) => s.key.startsWith('default_model_'));

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

      // PROMPT #250 - Load blocklist data
      try {
        const bl = await settingsApi.getBlocklist();
        setBlocklist(bl || { directories: [], file_patterns: [] });
        const sug = await settingsApi.getBlocklistSuggestions();
        setBlocklistSuggestions(Array.isArray(sug) ? sug : []);
      } catch {
        // blocklist endpoints may not exist yet
      }

      // PROMPT #236 - Load protected deletion setting
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

  // PROMPT #250 - Blocklist handlers
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

  // PROMPT #236 - Toggle protected project deletion
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
  const tabs = [
    { id: 'models' as TabId, label: 'Modelos IA', icon: Bot, count: `${configuredModels}/7` },
    { id: 'queue' as TabId, label: 'Fila', icon: ListOrdered },
    { id: 'blocklist' as TabId, label: 'Bloqueio', icon: ShieldOff, count: blocklistTotal > 0 ? String(blocklistTotal) : (blocklistSuggestions.length > 0 ? `${blocklistSuggestions.length}!` : undefined) },
    { id: 'general' as TabId, label: 'Avancado', icon: Sliders, count: generalSettings.length > 0 ? String(generalSettings.length) : undefined },
  ];

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

  return (
    <Layout>
      <Breadcrumbs />
      <div className="space-y-6 max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-gradient-to-br from-gray-100 to-gray-200 rounded-xl shadow-sm">
              <SettingsIcon className="w-7 h-7 text-gray-700" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Configurações</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Configuração do sistema e preferências padrão
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={loadData}
            disabled={loading}
            className="gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>

        {/* Success Toast */}
        {saveSuccess && (
          <div className="flex items-center gap-2 px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
            <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
            {saveSuccess}
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-900">{error}</p>
            </div>
            <Button variant="outline" size="sm" onClick={loadData}>
              Tentar Novamente
            </Button>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="border-b border-gray-200">
          <nav className="flex gap-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                    flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors
                    ${isActive
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }
                  `}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                  {tab.count && (
                    <span className={`
                      text-xs px-1.5 py-0.5 rounded-full
                      ${isActive ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}
                    `}>
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Tab: AI Models */}
        {activeTab === 'models' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">
                Selecione qual modelo IA gerencia cada tipo de operação. Modelos devem estar configurados e ativos na página Modelos IA.
              </p>
              <Button onClick={handleSaveDefaultModels} disabled={saving}>
                <Save className="w-4 h-4 mr-2" />
                {saving ? 'Salvando...' : 'Salvar Alterações'}
              </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {MODEL_CONFIGS.map((config) => {
                const Icon = config.icon;
                const [iconColor, iconBg] = config.color.split(' ');
                const availableModels = getModelsForUsageType(config.usageType);
                const isConfigured = !!defaultModels[config.key];

                return (
                  <div
                    key={config.key}
                    className={`
                      relative p-4 rounded-lg border transition-colors
                      ${isConfigured ? 'border-gray-200 bg-white' : 'border-dashed border-gray-300 bg-gray-50'}
                    `}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-lg ${iconBg} flex-shrink-0`}>
                        <Icon className={`w-4 h-4 ${iconColor}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-gray-900">{config.label}</span>
                          {isConfigured && (
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500" title="Configurado" />
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mb-3">{config.description}</p>
                        <Select
                          id={`model-${config.key}`}
                          value={defaultModels[config.key] || ''}
                          onChange={(e) => setDefaultModels({ ...defaultModels, [config.key]: e.target.value })}
                          options={[
                            { value: '', label: availableModels.length === 0 ? 'Nenhum modelo disponível' : 'Nenhum modelo padrão' },
                            ...availableModels.map(m => ({
                              value: m.id,
                              label: m.name,
                            })),
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

        {/* Tab: Queue Settings */}
        {activeTab === 'queue' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">
                Controle como a fila de orquestração de prompts processa e ordena a execução.
              </p>
              <Button onClick={handleSaveQueueSettings} disabled={savingQueue}>
                <Save className="w-4 h-4 mr-2" />
                {savingQueue ? 'Salvando...' : 'Salvar Alterações'}
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <Card>
                <CardContent className="pt-6">
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
                          { value: 'hierarchy_first', label: 'Hierarquia Primeiro (epics > stories > tasks > subtasks)' },
                          { value: 'priority_first', label: 'Prioridade Primeiro (critico > alto > medio > baixo)' },
                          { value: 'dependency_first', label: 'Dependência Primeiro (resolver dependências primeiro)' },
                          { value: 'age_first', label: 'Idade Primeiro (cards mais antigos primeiro)' },
                        ]}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardContent className="pt-6">
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
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-6">
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
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        )}

        {/* Tab: Blocklist (PROMPT #250) */}
        {activeTab === 'blocklist' && (
          <div className="space-y-6">
            <p className="text-sm text-gray-500">
              Pastas e padrões de arquivos que serao ignorados em todos os projetos durante análise de código.
            </p>

            {/* Suggestions Section */}
            {blocklistSuggestions.length > 0 && (
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="p-2 bg-amber-50 rounded-lg">
                        <Lightbulb className="w-4 h-4 text-amber-600" />
                      </div>
                      <div>
                        <span className="text-sm font-medium text-gray-900">Sugestões Pendentes</span>
                        <p className="text-xs text-gray-500">Detectadas automaticamente pela IA durante análise de projetos</p>
                      </div>
                      <Badge variant="warning" className="text-xs ml-2">{blocklistSuggestions.length}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={handleApproveAllSuggestions} className="text-green-700 border-green-300 hover:bg-green-50">
                        <Check className="w-3.5 h-3.5 mr-1" />
                        Aprovar Todas
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleRejectAllSuggestions} className="text-red-700 border-red-300 hover:bg-red-50">
                        <X className="w-3.5 h-3.5 mr-1" />
                        Rejeitar Todas
                      </Button>
                    </div>
                  </div>
                  <div className="border border-gray-200 rounded-lg overflow-hidden max-h-[300px] overflow-y-auto">
                    <ul className="divide-y divide-gray-100">
                      {blocklistSuggestions.map((sug, idx) => (
                        <li key={idx} className="flex items-center justify-between p-3 hover:bg-gray-50 transition-colors">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className={`flex-shrink-0 ${sug.type === 'directory' ? 'text-yellow-500' : 'text-orange-500'}`}>
                              {sug.type === 'directory' ? (
                                <Folder className="w-5 h-5" />
                              ) : (
                                <FileX className="w-5 h-5" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-gray-900 truncate">{sug.path}</span>
                                <span className={`px-2 py-0.5 text-xs rounded-full ${
                                  sug.type === 'directory'
                                    ? 'bg-blue-100 text-blue-700'
                                    : 'bg-orange-100 text-orange-700'
                                }`}>
                                  {sug.type === 'directory' ? 'Pasta' : 'Padrão'}
                                </span>
                              </div>
                              {sug.rationale && (
                                <p className="text-xs text-gray-500 truncate font-mono mt-0.5">{sug.rationale}</p>
                              )}
                              {sug.source_project && (
                                <p className="text-xs text-gray-400 mt-0.5">Projeto: {sug.source_project}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0 ml-3">
                            <button
                              onClick={() => handleApproveSuggestion({ path: sug.path, type: sug.type })}
                              className="p-2 text-green-500 hover:text-green-700 hover:bg-green-100 rounded transition-colors"
                              title="Aprovar"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleRejectSuggestion({ path: sug.path, type: sug.type })}
                              className="p-2 text-red-400 hover:text-red-600 hover:bg-red-100 rounded transition-colors"
                              title="Rejeitar"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Blocked Directories */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-red-50 rounded-lg flex-shrink-0">
                    <FolderX className="w-4 h-4 text-red-600" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">Pastas Bloqueadas</span>
                      {blocklist.directories.length > 0 && (
                        <Badge variant="default" className="text-xs">{blocklist.directories.length}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">Pastas com esses nomes serao ignoradas em todos os projetos</p>
                  </div>
                </div>

                {/* Input + Browse (mesmo estilo do novo projeto) */}
                <div className="flex gap-2 mb-4">
                  <input
                    value={newBlockDir}
                    onChange={(e) => setNewBlockDir(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddBlockDir()}
                    placeholder="Nome da pasta (ex: node_modules, .cache, dist)..."
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowBlocklistFolderPicker(true)}
                    title="Navegar pastas"
                  >
                    <Folder className="w-5 h-5" />
                  </Button>
                  <Button onClick={() => handleAddBlockDir()} disabled={savingBlocklist || !newBlockDir.trim()}>
                    <Plus className="w-4 h-4 mr-1" />
                    Adicionar
                  </Button>
                </div>

                {/* Blocked dirs list (estilo FolderPicker) */}
                {blocklist.directories.length === 0 ? (
                  <div className="border border-gray-200 rounded-lg p-8 text-center text-gray-500">
                    <FolderX className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                    <p className="text-sm">Nenhuma pasta bloqueada</p>
                    <p className="text-xs mt-1">Adicione manualmente ou navegue para selecionar pastas</p>
                  </div>
                ) : (
                  <div className="border border-gray-200 rounded-lg overflow-hidden max-h-[250px] overflow-y-auto">
                    <ul className="divide-y divide-gray-100">
                      {blocklist.directories.map((dir) => (
                        <li
                          key={dir}
                          className="flex items-center gap-3 p-3 hover:bg-gray-50 transition-colors group"
                        >
                          <div className="flex-shrink-0 text-red-400">
                            <FolderX className="w-5 h-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="font-medium text-gray-900">{dir}</span>
                          </div>
                          <button
                            onClick={() => handleRemoveBlockDir(dir)}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-all"
                            title="Remover"
                          >
                            <Trash2 className="w-4 h-4" />
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
              </CardContent>
            </Card>

            {/* Blocked File Patterns */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-orange-50 rounded-lg flex-shrink-0">
                    <FileX className="w-4 h-4 text-orange-600" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">Padrões de Arquivos Bloqueados</span>
                      {blocklist.file_patterns.length > 0 && (
                        <Badge variant="default" className="text-xs">{blocklist.file_patterns.length}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">Arquivos correspondentes a esses padrões serao ignorados</p>
                  </div>
                </div>

                {/* Presets (estilo scan depth cards) */}
                <div className="mb-4">
                  <p className="text-xs text-gray-500 mb-2">Padrões comuns:</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { pattern: '*.log', label: 'Logs' },
                      { pattern: '*.bak', label: 'Backups' },
                      { pattern: '*.tmp', label: 'Temporarios' },
                      { pattern: '*.min.js', label: 'JS minificado' },
                      { pattern: '*.min.css', label: 'CSS minificado' },
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
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 border-2 border-dashed border-gray-300 rounded-lg text-xs text-gray-600 hover:border-orange-400 hover:bg-orange-50 hover:text-orange-700 transition-all"
                      >
                        <Plus className="w-3 h-3" />
                        <code>{preset.pattern}</code>
                        <span className="text-gray-400">({preset.label})</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Manual input + Browse */}
                <div className="flex gap-2 mb-4">
                  <input
                    value={newBlockPattern}
                    onChange={(e) => setNewBlockPattern(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddBlockPattern()}
                    placeholder="Padrão personalizado (ex: *.sqlite, *.env.*, *.old)..."
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm font-mono"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowBlocklistFilePicker(true)}
                    title="Navegar e selecionar arquivos"
                  >
                    <FileSearch className="w-5 h-5" />
                  </Button>
                  <Button onClick={() => handleAddBlockPattern()} disabled={savingBlocklist || !newBlockPattern.trim()}>
                    <Plus className="w-4 h-4 mr-1" />
                    Adicionar
                  </Button>
                </div>

                {/* Blocked patterns list */}
                {blocklist.file_patterns.length === 0 ? (
                  <div className="border border-gray-200 rounded-lg p-8 text-center text-gray-500">
                    <FileX className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                    <p className="text-sm">Nenhum padrão bloqueado</p>
                    <p className="text-xs mt-1">Selecione padrões comuns acima ou adicione manualmente</p>
                  </div>
                ) : (
                  <div className="border border-gray-200 rounded-lg overflow-hidden max-h-[250px] overflow-y-auto">
                    <ul className="divide-y divide-gray-100">
                      {blocklist.file_patterns.map((pat) => (
                        <li
                          key={pat}
                          className="flex items-center gap-3 p-3 hover:bg-gray-50 transition-colors group"
                        >
                          <div className="flex-shrink-0 text-orange-400">
                            <FileX className="w-5 h-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <code className="font-medium text-gray-900">{pat}</code>
                          </div>
                          <button
                            onClick={() => handleRemoveBlockPattern(pat)}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-all"
                            title="Remover"
                          >
                            <Trash2 className="w-4 h-4" />
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
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tab: Advanced / General Settings */}
        {activeTab === 'general' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              Pares chave-valor personalizados para configuração avancada do sistema.
            </p>

            {/* PROMPT #236 - Security: Protected project deletion toggle */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-amber-50 rounded-lg flex-shrink-0">
                    <Shield className="w-4 h-4 text-amber-600" />
                  </div>
                  <div>
                    <span className="text-sm font-medium text-gray-900">Segurança</span>
                    <p className="text-xs text-gray-500 mt-0.5">Proteção contra exclusão acidental de projetos</p>
                  </div>
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
                      Quando ativo, projetos marcados como protegidos podem ser excluidos normalmente. Mantenha desativado para proteção máxima.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={allowProtectedDeletion}
                    disabled={savingProtection}
                    onClick={handleToggleProtectedDeletion}
                    className={`
                      relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent
                      transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                      ${allowProtectedDeletion ? 'bg-red-500' : 'bg-gray-300'}
                      ${savingProtection ? 'opacity-50 cursor-not-allowed' : ''}
                    `}
                  >
                    <span
                      className={`
                        pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0
                        transition duration-200 ease-in-out
                        ${allowProtectedDeletion ? 'translate-x-5' : 'translate-x-0'}
                      `}
                    />
                  </button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-4">
                  <Plus className="w-4 h-4 text-gray-500" />
                  <span className="text-sm font-medium text-gray-900">Adicionar Configuração</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <Label htmlFor="new-key" className="text-xs text-gray-500 mb-1">Key</Label>
                    <Input
                      id="new-key"
                      placeholder="e.g., max_upload_size"
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="new-value" className="text-xs text-gray-500 mb-1">Valor</Label>
                    <Input
                      id="new-value"
                      placeholder="Valor"
                      value={newValue}
                      onChange={(e) => setNewValue(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="new-desc" className="text-xs text-gray-500 mb-1">Descrição</Label>
                    <Input
                      id="new-desc"
                      placeholder="Descrição opcional"
                      value={newDescription}
                      onChange={(e) => setNewDescription(e.target.value)}
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <Button onClick={handleAddSetting} size="sm">
                    <Plus className="w-4 h-4 mr-1" />
                    Adicionar
                  </Button>
                </div>
              </CardContent>
            </Card>

            {generalSettings.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <Sliders className="w-10 h-10 mx-auto mb-3 opacity-50" />
                <p className="text-sm">Nenhuma configuração personalizada</p>
                <p className="text-xs mt-1">Adicione uma configuração acima para comecar</p>
              </div>
            ) : (
              <div className="space-y-2">
                {generalSettings.map((setting) => (
                  <div
                    key={setting.id}
                    className="group flex items-center justify-between gap-4 p-4 bg-white border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <code className="text-sm font-semibold text-gray-900">{setting.key}</code>
                        <Badge variant="default" className="text-xs">{typeof setting.value}</Badge>
                      </div>
                      <div className="text-sm text-gray-600 font-mono truncate">{typeof setting.value === 'object' ? JSON.stringify(setting.value) : String(setting.value)}</div>
                      {setting.description && (
                        <p className="text-xs text-gray-400 mt-1">{setting.description}</p>
                      )}
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
        )}
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

      {NotificationComponent}
    </Layout>
  );
}

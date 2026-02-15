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
} from 'lucide-react';
import { useNotification } from '@/hooks';

const MODEL_CONFIGS = [
  { key: 'interview', label: 'Entrevistas', usageType: AIModelUsageType.INTERVIEW, icon: MessageSquare, color: 'text-blue-600 bg-blue-50', description: 'Perguntas de entrevista de contexto e focadas em cards' },
  { key: 'prompt_generation', label: 'Geracao de Prompts', usageType: AIModelUsageType.PROMPT_GENERATION, icon: Zap, color: 'text-purple-600 bg-purple-50', description: 'Gerando prompts e conteudo de cards' },
  { key: 'commit_generation', label: 'Geracao de Commits', usageType: AIModelUsageType.COMMIT_GENERATION, icon: GitCommit, color: 'text-green-600 bg-green-50', description: 'Geracao de mensagens de commit Git' },
  { key: 'task_execution', label: 'Execucao de Tarefas', usageType: AIModelUsageType.TASK_EXECUTION, icon: Cpu, color: 'text-orange-600 bg-orange-50', description: 'Executando prompts de tarefas e geracao de codigo' },
  { key: 'pattern_discovery', label: 'Descoberta de Padroes', usageType: AIModelUsageType.PATTERN_DISCOVERY, icon: Search, color: 'text-cyan-600 bg-cyan-50', description: 'Descoberta de padroes de codigo e specs por IA' },
  { key: 'queue_orchestration', label: 'Orquestracao de Fila', usageType: AIModelUsageType.QUEUE_ORCHESTRATION, icon: Layers, color: 'text-pink-600 bg-pink-50', description: 'Execucao de prompts da fila de orquestracao' },
  { key: 'general', label: 'Geral', usageType: AIModelUsageType.GENERAL, icon: Globe, color: 'text-gray-600 bg-gray-100', description: 'Modelo fallback para todas as outras operacoes' },
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
    } catch (err: unknown) {
      console.error('Failed to load settings:', err);
      setError((err as Error).message || 'Falha ao carregar configuracoes');
    } finally {
      setLoading(false);
    }
  };

  const handleAddSetting = async () => {
    if (!newKey.trim()) {
      showWarning('Insira uma chave de configuracao');
      return;
    }

    try {
      await settingsApi.set(newKey, newValue, newDescription || undefined);
      setNewKey('');
      setNewValue('');
      setNewDescription('');
      await loadData();
      setSaveSuccess('Configuracao adicionada');
    } catch (err: any) {
      showError(`Falha ao adicionar configuracao: ${err.message}`);
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
      showError(`Falha ao excluir configuracao: ${err.message}`);
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
      setSaveSuccess('Modelos padrao salvos');
    } catch (err: any) {
      showError(`Falha ao salvar modelos padrao: ${err.message}`);
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
      setSaveSuccess('Configuracoes da fila salvas');
    } catch (err: any) {
      showError(`Falha ao salvar configuracoes da fila: ${err.message}`);
    } finally {
      setSavingQueue(false);
    }
  };

  // PROMPT #250 - Blocklist handlers
  const handleAddBlockDir = async () => {
    const dir = newBlockDir.trim();
    if (!dir) { showWarning('Insira o nome da pasta'); return; }
    if (blocklist.directories.includes(dir)) { showWarning('Pasta ja esta na lista'); return; }
    const updated = { ...blocklist, directories: [...blocklist.directories, dir].sort() };
    setSavingBlocklist(true);
    try {
      const result = await settingsApi.saveBlocklist(updated);
      setBlocklist(result);
      setNewBlockDir('');
      setSaveSuccess('Pasta adicionada a lista de bloqueio');
    } catch (err: any) { showError(`Falha ao salvar: ${err.message}`); }
    finally { setSavingBlocklist(false); }
  };

  const handleAddBlockPattern = async () => {
    const pat = newBlockPattern.trim();
    if (!pat) { showWarning('Insira o padrao de arquivo'); return; }
    if (blocklist.file_patterns.includes(pat)) { showWarning('Padrao ja esta na lista'); return; }
    const updated = { ...blocklist, file_patterns: [...blocklist.file_patterns, pat].sort() };
    setSavingBlocklist(true);
    try {
      const result = await settingsApi.saveBlocklist(updated);
      setBlocklist(result);
      setNewBlockPattern('');
      setSaveSuccess('Padrao adicionado a lista de bloqueio');
    } catch (err: any) { showError(`Falha ao salvar: ${err.message}`); }
    finally { setSavingBlocklist(false); }
  };

  const handleRemoveBlockDir = async (dir: string) => {
    const updated = { ...blocklist, directories: blocklist.directories.filter(d => d !== dir) };
    try {
      const result = await settingsApi.saveBlocklist(updated);
      setBlocklist(result);
      setSaveSuccess('Pasta removida');
    } catch (err: any) { showError(`Falha ao remover: ${err.message}`); }
  };

  const handleRemoveBlockPattern = async (pat: string) => {
    const updated = { ...blocklist, file_patterns: blocklist.file_patterns.filter(p => p !== pat) };
    try {
      const result = await settingsApi.saveBlocklist(updated);
      setBlocklist(result);
      setSaveSuccess('Padrao removido');
    } catch (err: any) { showError(`Falha ao remover: ${err.message}`); }
  };

  const handleApproveSuggestion = async (suggestion: { path: string; type: string }) => {
    try {
      const result = await settingsApi.approveBlocklistSuggestions([suggestion]);
      setBlocklist(result.blocklist);
      setBlocklistSuggestions(prev => prev.filter(s => s.path !== suggestion.path));
      setSaveSuccess('Sugestao aprovada');
    } catch (err: any) { showError(`Falha ao aprovar: ${err.message}`); }
  };

  const handleRejectSuggestion = async (suggestion: { path: string; type: string }) => {
    try {
      await settingsApi.rejectBlocklistSuggestions([suggestion]);
      setBlocklistSuggestions(prev => prev.filter(s => s.path !== suggestion.path));
      setSaveSuccess('Sugestao rejeitada');
    } catch (err: any) { showError(`Falha ao rejeitar: ${err.message}`); }
  };

  const handleApproveAllSuggestions = async () => {
    if (blocklistSuggestions.length === 0) return;
    try {
      const items = blocklistSuggestions.map(s => ({ path: s.path, type: s.type }));
      const result = await settingsApi.approveBlocklistSuggestions(items);
      setBlocklist(result.blocklist);
      setBlocklistSuggestions([]);
      setSaveSuccess('Todas as sugestoes aprovadas');
    } catch (err: any) { showError(`Falha ao aprovar: ${err.message}`); }
  };

  const handleRejectAllSuggestions = async () => {
    if (blocklistSuggestions.length === 0) return;
    try {
      const items = blocklistSuggestions.map(s => ({ path: s.path, type: s.type }));
      await settingsApi.rejectBlocklistSuggestions(items);
      setBlocklistSuggestions([]);
      setSaveSuccess('Todas as sugestoes rejeitadas');
    } catch (err: any) { showError(`Falha ao rejeitar: ${err.message}`); }
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
              <h1 className="text-2xl font-bold text-gray-900">Configuracoes</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Configuracao do sistema e preferencias padrao
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
                Selecione qual modelo IA gerencia cada tipo de operacao. Modelos devem estar configurados e ativos na pagina Modelos IA.
              </p>
              <Button onClick={handleSaveDefaultModels} disabled={saving}>
                <Save className="w-4 h-4 mr-2" />
                {saving ? 'Salvando...' : 'Salvar Alteracoes'}
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
                            { value: '', label: availableModels.length === 0 ? 'Nenhum modelo disponivel' : 'Nenhum modelo padrao' },
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
                  O modelo <strong>General</strong> age como fallback para todas as operacoes. Recomenda-se configura-lo.
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
                Controle como a fila de orquestracao de prompts processa e ordena a execucao.
              </p>
              <Button onClick={handleSaveQueueSettings} disabled={savingQueue}>
                <Save className="w-4 h-4 mr-2" />
                {savingQueue ? 'Salvando...' : 'Salvar Alteracoes'}
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
                      <Label htmlFor="queue-strategy" className="text-sm font-medium text-gray-900">Estrategia de Ordenacao Automatica</Label>
                      <p className="text-xs text-gray-500 mt-0.5 mb-2">Determina como os cards sao ordenados automaticamente na fila de execucao</p>
                      <Select
                        id="queue-strategy"
                        value={queueSettings.queue_auto_sort_strategy}
                        onChange={(e) => setQueueSettings({ ...queueSettings, queue_auto_sort_strategy: e.target.value })}
                        options={[
                          { value: 'balanced', label: 'Balanceado (35% hierarquia, 30% prioridade, 25% dependencia, 10% idade)' },
                          { value: 'hierarchy_first', label: 'Hierarquia Primeiro (epics > stories > tasks > subtasks)' },
                          { value: 'priority_first', label: 'Prioridade Primeiro (critico > alto > medio > baixo)' },
                          { value: 'dependency_first', label: 'Dependencia Primeiro (resolver dependencias primeiro)' },
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
                        <Label htmlFor="queue-concurrent" className="text-sm font-medium text-gray-900">Max Simultaneos</Label>
                        <p className="text-xs text-gray-500 mt-0.5 mb-2">Execucoes de prompts simultaneas</p>
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
              Pastas e padroes de arquivos que serao ignorados em todos os projetos durante analise de codigo.
            </p>

            {/* Suggestions Section */}
            {blocklistSuggestions.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-amber-500" />
                    <span className="text-sm font-medium text-gray-900">Sugestoes Pendentes</span>
                    <Badge variant="warning" className="text-xs">{blocklistSuggestions.length}</Badge>
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
                <div className="space-y-2">
                  {blocklistSuggestions.map((sug, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {sug.type === 'directory' ? (
                          <FolderX className="w-4 h-4 text-amber-600 flex-shrink-0" />
                        ) : (
                          <FileX className="w-4 h-4 text-amber-600 flex-shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <code className="text-sm font-semibold text-gray-900">{sug.path}</code>
                            <Badge variant="default" className="text-xs">
                              {sug.type === 'directory' ? 'pasta' : 'padrao'}
                            </Badge>
                          </div>
                          {sug.rationale && (
                            <p className="text-xs text-gray-500 mt-0.5 truncate">{sug.rationale}</p>
                          )}
                          {sug.source_project && (
                            <p className="text-xs text-gray-400 mt-0.5">Projeto: {sug.source_project}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleApproveSuggestion({ path: sug.path, type: sug.type })}
                          className="text-green-600 hover:text-green-800 hover:bg-green-100"
                          title="Aprovar"
                        >
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRejectSuggestion({ path: sug.path, type: sug.type })}
                          className="text-red-600 hover:text-red-800 hover:bg-red-100"
                          title="Rejeitar"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Blocked Directories */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <FolderX className="w-4 h-4 text-red-500" />
                <span className="text-sm font-medium text-gray-900">Pastas Bloqueadas</span>
                {blocklist.directories.length > 0 && (
                  <Badge variant="default" className="text-xs">{blocklist.directories.length}</Badge>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Input
                  placeholder="Nome da pasta (ex: node_modules, .cache)..."
                  value={newBlockDir}
                  onChange={(e) => setNewBlockDir(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddBlockDir()}
                  className="flex-1"
                />
                <Button onClick={handleAddBlockDir} size="sm" disabled={savingBlocklist}>
                  <Plus className="w-4 h-4 mr-1" />
                  Adicionar
                </Button>
              </div>

              {blocklist.directories.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <FolderX className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Nenhuma pasta bloqueada</p>
                  <p className="text-xs mt-1">Adicione pastas que devem ser ignoradas em todos os projetos</p>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {blocklist.directories.map((dir) => (
                    <div
                      key={dir}
                      className="group inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-50 border border-red-200 rounded-full text-sm"
                    >
                      <FolderX className="w-3.5 h-3.5 text-red-400" />
                      <span className="text-gray-800">{dir}</span>
                      <button
                        onClick={() => handleRemoveBlockDir(dir)}
                        className="ml-0.5 text-gray-400 hover:text-red-600 transition-colors"
                        title="Remover"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Blocked File Patterns */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <FileX className="w-4 h-4 text-orange-500" />
                <span className="text-sm font-medium text-gray-900">Padroes de Arquivos Bloqueados</span>
                {blocklist.file_patterns.length > 0 && (
                  <Badge variant="default" className="text-xs">{blocklist.file_patterns.length}</Badge>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Input
                  placeholder="Padrao de arquivo (ex: *.log, *.bak, *.min.js)..."
                  value={newBlockPattern}
                  onChange={(e) => setNewBlockPattern(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddBlockPattern()}
                  className="flex-1"
                />
                <Button onClick={handleAddBlockPattern} size="sm" disabled={savingBlocklist}>
                  <Plus className="w-4 h-4 mr-1" />
                  Adicionar
                </Button>
              </div>

              {blocklist.file_patterns.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <FileX className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Nenhum padrao bloqueado</p>
                  <p className="text-xs mt-1">Adicione padroes de arquivos que devem ser ignorados</p>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {blocklist.file_patterns.map((pat) => (
                    <div
                      key={pat}
                      className="group inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-50 border border-orange-200 rounded-full text-sm"
                    >
                      <FileX className="w-3.5 h-3.5 text-orange-400" />
                      <code className="text-gray-800">{pat}</code>
                      <button
                        onClick={() => handleRemoveBlockPattern(pat)}
                        className="ml-0.5 text-gray-400 hover:text-red-600 transition-colors"
                        title="Remover"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab: Advanced / General Settings */}
        {activeTab === 'general' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              Pares chave-valor personalizados para configuracao avancada do sistema.
            </p>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-4">
                  <Plus className="w-4 h-4 text-gray-500" />
                  <span className="text-sm font-medium text-gray-900">Adicionar Configuracao</span>
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
                    <Label htmlFor="new-desc" className="text-xs text-gray-500 mb-1">Descricao</Label>
                    <Input
                      id="new-desc"
                      placeholder="Descricao opcional"
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
                <p className="text-sm">Nenhuma configuracao personalizada</p>
                <p className="text-xs mt-1">Adicione uma configuracao acima para comecar</p>
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
                      <div className="text-sm text-gray-600 font-mono truncate">{String(setting.value)}</div>
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
        title="Excluir Configuracao"
        message={`Tem certeza que deseja excluir "${settingToDelete}"? Esta acao nao pode ser desfeita.`}
        type="danger"
        confirmLabel="Excluir"
        cancelLabel="Cancelar"
        isLoading={isDeleting}
      />

      {NotificationComponent}
    </Layout>
  );
}

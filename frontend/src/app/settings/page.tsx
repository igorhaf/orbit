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
} from 'lucide-react';
import { useNotification } from '@/hooks';

const MODEL_CONFIGS = [
  { key: 'interview', label: 'Entrevistas', usageType: AIModelUsageType.INTERVIEW, icon: MessageSquare, color: 'text-blue-600 bg-blue-50', description: 'Perguntas de entrevista de contexto e focadas em cards' },
  { key: 'prompt_generation', label: 'Geracao de Prompts', usageType: AIModelUsageType.PROMPT_GENERATION, icon: Zap, color: 'text-purple-600 bg-purple-50', description: 'Gerando prompts e conteudo de cards' },
  { key: 'commit_generation', label: 'Geracao de Commits', usageType: AIModelUsageType.COMMIT_GENERATION, icon: GitCommit, color: 'text-green-600 bg-green-50', description: 'Geracao de mensagens de commit Git' },
  { key: 'task_execution', label: 'Execucao de Tarefas', usageType: AIModelUsageType.TASK_EXECUTION, icon: Cpu, color: 'text-orange-600 bg-orange-50', description: 'Executando prompts de tarefas e geracao de codigo' },
  { key: 'pattern_discovery', label: 'Descoberta de Padroes', usageType: AIModelUsageType.PATTERN_DISCOVERY, icon: Search, color: 'text-cyan-600 bg-cyan-50', description: 'Descoberta de padroes de codigo e specs por IA' },
  { key: 'queue_orchestration', label: 'Orquestracao de Fila', usageType: AIModelUsageType.QUEUE_ORCHESTRATION, icon: Layers, color: 'text-pink-600 bg-pink-50', description: 'Execucao de prompts da fila de orquestracao' },
  { key: 'general', label: 'General', usageType: AIModelUsageType.GENERAL, icon: Globe, color: 'text-gray-600 bg-gray-100', description: 'Modelo fallback para todas as outras operacoes' },
];

type TabId = 'models' | 'queue' | 'general';

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
    } catch (err: unknown) {
      console.error('Failed to load settings:', err);
      setError((err as Error).message || 'Failed to load settings');
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
      setSaveSuccess('Default models saved');
    } catch (err: any) {
      showError(`Failed to save default models: ${err.message}`);
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
      setSaveSuccess('Queue settings saved');
    } catch (err: any) {
      showError(`Failed to save queue settings: ${err.message}`);
    } finally {
      setSavingQueue(false);
    }
  };

  const generalSettings = settings.filter(s => !s.key.startsWith('default_model_') && !s.key.startsWith('queue_'));
  const configuredModels = Object.values(defaultModels).filter(v => v && v.length > 0).length;

  const tabs = [
    { id: 'models' as TabId, label: 'Modelos IA', icon: Bot, count: `${configuredModels}/7` },
    { id: 'queue' as TabId, label: 'Fila', icon: ListOrdered },
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
                          { value: 'balanced', label: 'Balanced (35% hierarchy, 30% priority, 25% dependency, 10% age)' },
                          { value: 'hierarchy_first', label: 'Hierarchy First (epics > stories > tasks > subtasks)' },
                          { value: 'priority_first', label: 'Priority First (critical > high > medium > low)' },
                          { value: 'dependency_first', label: 'Dependency First (resolve dependencies first)' },
                          { value: 'age_first', label: 'Age First (oldest cards first)' },
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
                            { value: '1', label: '1 (Sequential)' },
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

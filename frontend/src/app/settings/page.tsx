/**
 * Settings Page
 * Manage system-wide settings and default AI models
 */

'use client';

import React, { useEffect, useState } from 'react';
import { Layout, Breadcrumbs } from '@/components/layout';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { settingsApi, aiModelsApi } from '@/lib/api';
import { SystemSettings, AIModel, AIModelUsageType } from '@/lib/types';
import { Settings as SettingsIcon, Save, Plus, Trash2, RefreshCw } from 'lucide-react';
import { useNotification } from '@/hooks';

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

  // Form state for new setting
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newDescription, setNewDescription] = useState('');

  // Default models state
  const [defaultModels, setDefaultModels] = useState<Record<string, string>>({
    interview: '',
    prompt_generation: '',
    commit_generation: '',
    task_execution: '',
    pattern_discovery: '',
    general: '',
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Load all settings
      const settingsData = await settingsApi.list();
      setSettings(Array.isArray(settingsData) ? settingsData : settingsData.data || []);

      // Load all AI models
      const modelsData = await aiModelsApi.list();
      const modelsList = Array.isArray(modelsData) ? modelsData : modelsData.data || [];
      setModels(modelsList);

      // Extract default models from settings
      const defaultModelSettings = (Array.isArray(settingsData) ? settingsData : settingsData.data || [])
        .filter((s: SystemSettings) => s.key.startsWith('default_model_'));

      const defaults: Record<string, string> = {};
      defaultModelSettings.forEach((s: SystemSettings) => {
        const usageType = s.key.replace('default_model_', '');
        defaults[usageType] = s.value;
      });
      setDefaultModels(prev => ({ ...prev, ...defaults }));
    } catch (err: any) {
      console.error('Failed to load settings:', err);
      setError(err.message || 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const handleAddSetting = async () => {
    if (!newKey.trim()) {
      showWarning('Please enter a setting key');
      return;
    }

    try {
      await settingsApi.set(newKey, newValue, newDescription || undefined);
      setNewKey('');
      setNewValue('');
      setNewDescription('');
      await loadData();
    } catch (err: any) {
      showError(`Failed to add setting: ${err.message}`);
    }
  };

  const handleUpdateSetting = async (key: string, value: string, description?: string) => {
    try {
      await settingsApi.set(key, value, description);
      await loadData();
    } catch (err: any) {
      showError(`Failed to update setting: ${err.message}`);
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
      showError(`Failed to delete setting: ${err.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSaveDefaultModels = async () => {
    setSaving(true);
    try {
      const updates: Record<string, any> = {};
      // Always include all usage types, even empty values (for "No default model")
      Object.entries(defaultModels).forEach(([usageType, modelId]) => {
        updates[`default_model_${usageType}`] = modelId || '';
      });

      await settingsApi.bulk(updates);
      await loadData();
    } catch (err: any) {
      showError(`Failed to save default models: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const getModelsForUsageType = (usageType: AIModelUsageType) => {
    return models.filter(m => m.usage_type === usageType && m.is_active);
  };

  // Filter out default_model_ settings from general settings list
  const generalSettings = settings.filter(s => !s.key.startsWith('default_model_'));

  return (
    <Layout>
      <Breadcrumbs />
      <div className="space-y-6 max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-gray-100 rounded-lg">
              <SettingsIcon className="w-6 h-6 text-gray-600" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
              <p className="text-gray-600 mt-1">
                Configure system-wide preferences and defaults
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={loadData}
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Error State */}
        {error && (
          <Card className="bg-red-50 border-red-200">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <div className="text-red-600">⚠️</div>
                <div>
                  <h3 className="font-semibold text-red-900 mb-1">Error</h3>
                  <p className="text-sm text-red-800">{error}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={loadData}
                    className="mt-3"
                  >
                    Try Again
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Default AI Models */}
        <Card>
          <CardHeader>
            <CardTitle>Default AI Models</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-600 mb-4">
              Configure which AI models to use for each operation type by default.
            </p>

            <div className="space-y-3">
              {/* Interview */}
              <div>
                <Label htmlFor="model-interview">Interviews</Label>
                <Select
                  id="model-interview"
                  value={defaultModels.interview || ''}
                  onChange={(e) => setDefaultModels({ ...defaultModels, interview: e.target.value })}
                  options={[
                    { value: '', label: 'No default model' },
                    ...getModelsForUsageType(AIModelUsageType.INTERVIEW).map(m => ({
                      value: m.id,
                      label: m.name,
                    })),
                  ]}
                  className="mt-1"
                />
              </div>

              {/* Prompt Generation */}
              <div>
                <Label htmlFor="model-prompt">Prompt Generation</Label>
                <Select
                  id="model-prompt"
                  value={defaultModels.prompt_generation || ''}
                  onChange={(e) => setDefaultModels({ ...defaultModels, prompt_generation: e.target.value })}
                  options={[
                    { value: '', label: 'No default model' },
                    ...getModelsForUsageType(AIModelUsageType.PROMPT_GENERATION).map(m => ({
                      value: m.id,
                      label: m.name,
                    })),
                  ]}
                  className="mt-1"
                />
              </div>

              {/* Commit Generation */}
              <div>
                <Label htmlFor="model-commit">Commit Generation</Label>
                <Select
                  id="model-commit"
                  value={defaultModels.commit_generation || ''}
                  onChange={(e) => setDefaultModels({ ...defaultModels, commit_generation: e.target.value })}
                  options={[
                    { value: '', label: 'No default model' },
                    ...getModelsForUsageType(AIModelUsageType.COMMIT_GENERATION).map(m => ({
                      value: m.id,
                      label: m.name,
                    })),
                  ]}
                  className="mt-1"
                />
              </div>

              {/* Task Execution */}
              <div>
                <Label htmlFor="model-task">Task Execution</Label>
                <Select
                  id="model-task"
                  value={defaultModels.task_execution || ''}
                  onChange={(e) => setDefaultModels({ ...defaultModels, task_execution: e.target.value })}
                  options={[
                    { value: '', label: 'No default model' },
                    ...getModelsForUsageType(AIModelUsageType.TASK_EXECUTION).map(m => ({
                      value: m.id,
                      label: m.name,
                    })),
                  ]}
                  className="mt-1"
                />
              </div>

              {/* Pattern Discovery */}
              <div>
                <Label htmlFor="model-pattern">Pattern Discovery</Label>
                <Select
                  id="model-pattern"
                  value={defaultModels.pattern_discovery || ''}
                  onChange={(e) => setDefaultModels({ ...defaultModels, pattern_discovery: e.target.value })}
                  options={[
                    { value: '', label: 'No default model' },
                    ...getModelsForUsageType(AIModelUsageType.PATTERN_DISCOVERY).map(m => ({
                      value: m.id,
                      label: m.name,
                    })),
                  ]}
                  className="mt-1"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Used for AI-powered code pattern discovery (specs generation)
                </p>
              </div>

              {/* General */}
              <div>
                <Label htmlFor="model-general">General</Label>
                <Select
                  id="model-general"
                  value={defaultModels.general || ''}
                  onChange={(e) => setDefaultModels({ ...defaultModels, general: e.target.value })}
                  options={[
                    { value: '', label: 'No default model' },
                    ...getModelsForUsageType(AIModelUsageType.GENERAL).map(m => ({
                      value: m.id,
                      label: m.name,
                    })),
                  ]}
                  className="mt-1"
                />
              </div>
            </div>

            <div className="pt-4 flex justify-end">
              <Button onClick={handleSaveDefaultModels} disabled={saving}>
                <Save className="w-4 h-4 mr-2" />
                {saving ? 'Saving...' : 'Save Default Models'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* General Settings */}
        <Card>
          <CardHeader>
            <CardTitle>General Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-600 mb-4">
              Custom key-value configuration for system-wide settings.
            </p>

            {/* Add New Setting */}
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-3">
              <h4 className="font-semibold text-sm text-gray-900">Add New Setting</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Input
                  placeholder="Key (e.g., max_upload_size)"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                />
                <Input
                  placeholder="Value"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                />
                <Input
                  placeholder="Description (optional)"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                />
              </div>
              <Button onClick={handleAddSetting} size="sm">
                <Plus className="w-4 h-4 mr-2" />
                Add Setting
              </Button>
            </div>

            {/* Settings List */}
            {generalSettings.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p>No custom settings configured</p>
              </div>
            ) : (
              <div className="space-y-2">
                {generalSettings.map((setting) => (
                  <div
                    key={setting.id}
                    className="p-3 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <code className="text-sm font-semibold text-gray-900">
                            {setting.key}
                          </code>
                          <Badge variant="default" className="text-xs">
                            {typeof setting.value}
                          </Badge>
                        </div>
                        <div className="text-sm text-gray-700 font-mono mb-1">
                          {String(setting.value)}
                        </div>
                        {setting.description && (
                          <p className="text-xs text-gray-500">{setting.description}</p>
                        )}
                        <p className="text-xs text-gray-400 mt-1">
                          Updated {new Date(setting.updated_at).toLocaleString()}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteSetting(setting.key)}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Setting?</h3>
            <p className="text-sm text-gray-600 mb-4">Are you sure you want to delete this setting?</p>

            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <div className="flex items-start gap-3">
                <div className="text-red-600 text-2xl">⚠️</div>
                <div>
                  <h4 className="font-semibold text-red-900 mb-1">Warning: This action cannot be undone!</h4>
                  <p className="text-sm text-red-800">
                    Setting "{settingToDelete}" will be permanently deleted.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowDeleteDialog(false)}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={confirmDeleteSetting}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Yes, Delete Setting'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {NotificationComponent}
    </Layout>
  );
}

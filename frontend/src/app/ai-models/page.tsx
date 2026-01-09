/**
 * AI Models Management Page
 * View and manage AI model configurations
 */

'use client';

import React, { useEffect, useState } from 'react';
import { Layout, Breadcrumbs } from '@/components/layout';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Input,
  Dialog,
  DialogFooter,
} from '@/components/ui';
import { aiModelsApi } from '@/lib/api';
import { AIModel, AIModelCreate, AIModelUpdate, AIModelUsageType } from '@/lib/types';

export default function AIModelsPage() {
  const [models, setModels] = useState<AIModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedModel, setSelectedModel] = useState<AIModel | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [createFormData, setCreateFormData] = useState<AIModelCreate>({
    name: '',
    provider: 'anthropic',
    api_key: '',
    usage_type: AIModelUsageType.GENERAL,
    is_active: true,
    config: {
      model: '',
      max_tokens: 4096,
      temperature: 0.7,
    },
  });

  const [editFormData, setEditFormData] = useState<AIModelUpdate>({});

  useEffect(() => {
    fetchModels();
  }, []);

  const fetchModels = async () => {
    setLoading(true);
    try {
      const response = await aiModelsApi.list();
      // Handle both direct array and object with models property
      const data = Array.isArray(response) ? response : (response.models || response.data || []);
      setModels(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching AI models:', error);
      setModels([]);
    } finally {
      setLoading(false);
    }
  };

  const toggleModel = async (id: string) => {
    try {
      await aiModelsApi.toggle(id);
      fetchModels();
    } catch (error) {
      console.error('Error toggling model:', error);
    }
  };

  const handleCreateModel = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      await aiModelsApi.create(createFormData);
      setShowCreateDialog(false);
      setCreateFormData({
        name: '',
        provider: 'anthropic',
        api_key: '',
        usage_type: AIModelUsageType.GENERAL,
        is_active: true,
        config: {
          model: '',
          max_tokens: 4096,
          temperature: 0.7,
        },
      });
      fetchModels();
    } catch (error) {
      console.error('Error creating model:', error);
      alert('Error creating model. Please check the console for details.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenEdit = (model: AIModel) => {
    setSelectedModel(model);
    setEditFormData({
      name: model.name,
      provider: model.provider,
      api_key: model.api_key,  // ✅ FIX: Include API key from model
      usage_type: model.usage_type,
      is_active: model.is_active,
      config: model.config,
    });
    setShowEditDialog(true);
  };

  const handleUpdateModel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedModel) return;

    setIsSubmitting(true);

    try {
      await aiModelsApi.update(selectedModel.id, editFormData);
      setShowEditDialog(false);
      setSelectedModel(null);
      setEditFormData({});
      fetchModels();
    } catch (error) {
      console.error('Error updating model:', error);
      alert('Error updating model. Please check the console for details.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenDelete = (model: AIModel) => {
    setSelectedModel(model);
    setShowDeleteDialog(true);
  };

  const handleDeleteModel = async () => {
    if (!selectedModel) return;

    setIsSubmitting(true);

    try {
      await aiModelsApi.delete(selectedModel.id);
      setShowDeleteDialog(false);
      setSelectedModel(null);
      fetchModels();
    } catch (error) {
      console.error('Error deleting model:', error);
      alert('Error deleting model. Please check the console for details.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Check if there's an active General model (fallback)
  const hasActiveGeneralModel = models.some(
    (model) => model.usage_type === AIModelUsageType.GENERAL && model.is_active
  );

  const getProviderIcon = (provider: string) => {
    switch (provider.toLowerCase()) {
      case 'anthropic':
        return (
          <svg className="w-6 h-6 text-purple-600" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z" />
          </svg>
        );
      case 'openai':
        return (
          <svg className="w-6 h-6 text-green-600" fill="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" />
          </svg>
        );
      case 'google':
        return (
          <svg className="w-6 h-6 text-blue-600" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
          </svg>
        );
      default:
        return (
          <svg className="w-6 h-6 text-gray-600" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z" />
          </svg>
        );
    }
  };

  const formatNumber = (num: number): string => {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    }
    if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toString();
  };

  return (
    <Layout>
      <Breadcrumbs />
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">AI Models</h1>
            <p className="mt-1 text-sm text-gray-500">
              Manage AI model configurations and monitor usage
            </p>
          </div>
          <Button
            variant="primary"
            onClick={() => setShowCreateDialog(true)}
            leftIcon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
            }
          >
            Add Model
          </Button>
        </div>

        {/* Warning: No General Model (Fallback) */}
        {!loading && !hasActiveGeneralModel && (
          <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg
                  className="h-5 w-5 text-yellow-400"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-yellow-800">
                  No General Model Configured
                </h3>
                <div className="mt-2 text-sm text-yellow-700">
                  <p>
                    You don't have an active model with <strong>Usage Type: General</strong>.
                    This type serves as a fallback when no specific model is configured for a task.
                    Without it, the system may fail if a required model is not available.
                  </p>
                  <p className="mt-2">
                    <strong>Recommendation:</strong> Create or activate a General model to ensure system reliability.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Models List */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : models.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <svg
                className="mx-auto h-12 w-12 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
              <h3 className="mt-2 text-sm font-medium text-gray-900">No AI models</h3>
              <p className="mt-1 text-sm text-gray-500">
                Get started by adding an AI model configuration.
              </p>
              <div className="mt-6">
                <Button
                  variant="primary"
                  onClick={() => setShowCreateDialog(true)}
                >
                  Add Model
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {models.map((model) => (
              <Card key={model.id} variant="bordered">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      {getProviderIcon(model.provider)}
                      <div>
                        <CardTitle className="text-lg">{model.name}</CardTitle>
                        <p className="text-xs text-gray-500 mt-1">
                          {model.provider.charAt(0).toUpperCase() + model.provider.slice(1)}
                        </p>
                      </div>
                    </div>
                    <div>
                      {model.is_active ? (
                        <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800 font-medium">
                          Active
                        </span>
                      ) : (
                        <span className="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-800 font-medium">
                          Inactive
                        </span>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {/* Model ID */}
                    {model.config?.model && (
                      <div className="text-xs text-gray-500">
                        <span className="font-medium">Model ID:</span>{' '}
                        <span className="font-mono">{model.config.model}</span>
                      </div>
                    )}

                    {/* Usage Type */}
                    <div className="flex flex-wrap gap-1">
                      <span className={`px-2 py-1 text-xs rounded font-medium ${
                        model.usage_type === 'interview' ? 'bg-blue-50 text-blue-700' :
                        model.usage_type === 'prompt_generation' ? 'bg-purple-50 text-purple-700' :
                        model.usage_type === 'task_execution' ? 'bg-orange-50 text-orange-700' :
                        model.usage_type === 'commit_generation' ? 'bg-green-50 text-green-700' :
                        'bg-gray-50 text-gray-700'
                      }`}>
                        {model.usage_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                      </span>
                    </div>

                    {/* Configuration */}
                    <div className="pt-3 border-t border-gray-200">
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        {model.config?.max_tokens && (
                          <div>
                            <div className="text-gray-500 text-xs">Max Tokens</div>
                            <div className="font-semibold text-gray-900">
                              {formatNumber(model.config.max_tokens)}
                            </div>
                          </div>
                        )}
                        {model.config?.temperature !== undefined && (
                          <div>
                            <div className="text-gray-500 text-xs">Temperature</div>
                            <div className="font-semibold text-gray-900">
                              {model.config.temperature.toFixed(1)}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="pt-3 flex gap-2">
                      <Button
                        variant={model.is_active ? "ghost" : "primary"}
                        size="sm"
                        className="flex-1"
                        onClick={() => toggleModel(model.id)}
                      >
                        {model.is_active ? 'Deactivate' : 'Activate'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleOpenEdit(model)}
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                          />
                        </svg>
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => handleOpenDelete(model)}
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Info Card */}
        <Card>
          <CardHeader>
            <CardTitle>About AI Models</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-gray-600 space-y-2">
              <p>
                AI models are used throughout the application for different purposes:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><strong>Interviews:</strong> Conversational models for technical interviews</li>
                <li><strong>Prompts:</strong> Models for analyzing interviews and generating tasks</li>
                <li><strong>Code:</strong> Models for executing tasks and writing code</li>
              </ul>
              <p className="pt-2">
                Orbit automatically selects the best model for each task based on configuration and availability.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Create Model Dialog */}
        <Dialog
          open={showCreateDialog}
          onClose={() => setShowCreateDialog(false)}
          title="Add AI Model"
          description="Configure a new AI model for the orchestration system"
        >
          <form onSubmit={handleCreateModel}>
            <div className="space-y-4">
              {/* Name */}
              <Input
                label="Model Name"
                placeholder="e.g., Claude Sonnet Interview"
                required
                value={createFormData.name}
                onChange={(e) =>
                  setCreateFormData({ ...createFormData, name: e.target.value })
                }
              />

              {/* Provider */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Provider
                </label>
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={createFormData.provider}
                  onChange={(e) =>
                    setCreateFormData({ ...createFormData, provider: e.target.value })
                  }
                  required
                >
                  <option value="anthropic">Anthropic</option>
                  <option value="openai">OpenAI</option>
                  <option value="google">Google</option>
                  <option value="local">Local</option>
                  <option value="custom">Custom</option>
                </select>
              </div>

              {/* API Key */}
              <Input
                label="API Key"
                type="password"
                placeholder="Enter API key (sk-..., AIza..., etc)"
                required
                value={createFormData.api_key}
                onChange={(e) =>
                  setCreateFormData({ ...createFormData, api_key: e.target.value })
                }
              />

              {/* Usage Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Usage Type
                </label>
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={createFormData.usage_type}
                  onChange={(e) =>
                    setCreateFormData({
                      ...createFormData,
                      usage_type: e.target.value as AIModelUsageType
                    })
                  }
                  required
                >
                  <option value={AIModelUsageType.INTERVIEW}>Interview</option>
                  <option value={AIModelUsageType.PROMPT_GENERATION}>Prompt Generation</option>
                  <option value={AIModelUsageType.TASK_EXECUTION}>Task Execution</option>
                  <option value={AIModelUsageType.COMMIT_GENERATION}>Commit Generation</option>
                  <option value={AIModelUsageType.GENERAL}>General</option>
                </select>
              </div>

              {/* Model ID */}
              <Input
                label="Model ID (optional)"
                placeholder="e.g., claude-sonnet-4-20250514"
                value={createFormData.config?.model || ''}
                onChange={(e) =>
                  setCreateFormData({
                    ...createFormData,
                    config: { ...createFormData.config, model: e.target.value },
                  })
                }
              />

              {/* Max Tokens */}
              <Input
                label="Max Tokens (optional)"
                type="number"
                placeholder="4096"
                value={createFormData.config?.max_tokens || ''}
                onChange={(e) =>
                  setCreateFormData({
                    ...createFormData,
                    config: {
                      ...createFormData.config,
                      max_tokens: parseInt(e.target.value) || 4096,
                    },
                  })
                }
              />

              {/* Temperature */}
              <Input
                label="Temperature (optional)"
                type="number"
                step="0.1"
                min="0"
                max="2"
                placeholder="0.7"
                value={createFormData.config?.temperature || ''}
                onChange={(e) =>
                  setCreateFormData({
                    ...createFormData,
                    config: {
                      ...createFormData.config,
                      temperature: parseFloat(e.target.value) || 0.7,
                    },
                  })
                }
              />

              {/* Is Active */}
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="create-is-active"
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  checked={createFormData.is_active}
                  onChange={(e) =>
                    setCreateFormData({ ...createFormData, is_active: e.target.checked })
                  }
                />
                <label
                  htmlFor="create-is-active"
                  className="ml-2 block text-sm text-gray-900"
                >
                  Active
                </label>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowCreateDialog(false)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" isLoading={isSubmitting}>
                Create Model
              </Button>
            </DialogFooter>
          </form>
        </Dialog>

        {/* Edit Model Dialog */}
        <Dialog
          open={showEditDialog}
          onClose={() => setShowEditDialog(false)}
          title="Edit AI Model"
          description="Update AI model configuration"
        >
          <form onSubmit={handleUpdateModel}>
            <div className="space-y-4">
              {/* Name */}
              <Input
                label="Model Name"
                placeholder="e.g., Claude Sonnet Interview"
                value={editFormData.name || ''}
                onChange={(e) =>
                  setEditFormData({ ...editFormData, name: e.target.value })
                }
              />

              {/* Provider */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Provider
                </label>
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={editFormData.provider || 'anthropic'}
                  onChange={(e) =>
                    setEditFormData({ ...editFormData, provider: e.target.value })
                  }
                >
                  <option value="anthropic">Anthropic</option>
                  <option value="openai">OpenAI</option>
                  <option value="google">Google</option>
                  <option value="local">Local</option>
                  <option value="custom">Custom</option>
                </select>
              </div>

              {/* API Key */}
              <Input
                label="API Key"
                type="text"
                placeholder="Enter API key (sk-..., AIza..., etc)"
                value={editFormData.api_key || ''}
                onChange={(e) =>
                  setEditFormData({ ...editFormData, api_key: e.target.value })
                }
              />

              {/* Usage Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Usage Type
                </label>
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={editFormData.usage_type || AIModelUsageType.GENERAL}
                  onChange={(e) =>
                    setEditFormData({
                      ...editFormData,
                      usage_type: e.target.value as AIModelUsageType
                    })
                  }
                >
                  <option value={AIModelUsageType.INTERVIEW}>Interview</option>
                  <option value={AIModelUsageType.PROMPT_GENERATION}>Prompt Generation</option>
                  <option value={AIModelUsageType.TASK_EXECUTION}>Task Execution</option>
                  <option value={AIModelUsageType.COMMIT_GENERATION}>Commit Generation</option>
                  <option value={AIModelUsageType.GENERAL}>General</option>
                </select>
              </div>

              {/* Model ID */}
              <Input
                label="Model ID"
                placeholder="e.g., claude-sonnet-4-20250514"
                value={editFormData.config?.model || ''}
                onChange={(e) =>
                  setEditFormData({
                    ...editFormData,
                    config: { ...editFormData.config, model: e.target.value },
                  })
                }
              />

              {/* Max Tokens */}
              <Input
                label="Max Tokens"
                type="number"
                placeholder="4096"
                value={editFormData.config?.max_tokens || ''}
                onChange={(e) =>
                  setEditFormData({
                    ...editFormData,
                    config: {
                      ...editFormData.config,
                      max_tokens: parseInt(e.target.value) || 4096,
                    },
                  })
                }
              />

              {/* Temperature */}
              <Input
                label="Temperature"
                type="number"
                step="0.1"
                min="0"
                max="2"
                placeholder="0.7"
                value={editFormData.config?.temperature || ''}
                onChange={(e) =>
                  setEditFormData({
                    ...editFormData,
                    config: {
                      ...editFormData.config,
                      temperature: parseFloat(e.target.value) || 0.7,
                    },
                  })
                }
              />

              {/* Is Active */}
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="edit-is-active"
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  checked={editFormData.is_active || false}
                  onChange={(e) =>
                    setEditFormData({ ...editFormData, is_active: e.target.checked })
                  }
                />
                <label
                  htmlFor="edit-is-active"
                  className="ml-2 block text-sm text-gray-900"
                >
                  Active
                </label>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowEditDialog(false)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" isLoading={isSubmitting}>
                Update Model
              </Button>
            </DialogFooter>
          </form>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog
          open={showDeleteDialog}
          onClose={() => setShowDeleteDialog(false)}
          title="Delete AI Model"
          description="Are you sure you want to delete this model? This action cannot be undone."
        >
          {selectedModel && (
            <div className="space-y-4">
              <div className="bg-gray-50 p-4 rounded-md">
                <p className="text-sm font-medium text-gray-900">{selectedModel.name}</p>
                <p className="text-xs text-gray-500 mt-1">
                  Provider: {selectedModel.provider} | Usage: {selectedModel.usage_type}
                </p>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowDeleteDialog(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  onClick={handleDeleteModel}
                  isLoading={isSubmitting}
                >
                  Delete Model
                </Button>
              </DialogFooter>
            </div>
          )}
        </Dialog>
      </div>
    </Layout>
  );
}

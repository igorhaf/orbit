/**
 * ModelForm Component
 * Form for creating or editing AI models
 */

'use client';

import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Label } from '@/components/ui/Label';
import { ApiKeyInput } from './ApiKeyInput';
import { AIModel, AIModelCreate, AIModelUpdate, AIModelUsageType } from '@/lib/types';
import { Save, X } from 'lucide-react';

interface ModelFormProps {
  model?: AIModel;
  onSubmit: (data: AIModelCreate | AIModelUpdate) => Promise<void>;
  onCancel?: () => void;
}

const PROVIDERS = [
  { value: 'anthropic', label: '🤖 Anthropic (Claude)' },
  { value: 'openai', label: '🧠 OpenAI (GPT)' },
  { value: 'google', label: '🔍 Google (Gemini)' },
  { value: 'ollama', label: '🦙 Ollama (Local)' },
];

const USAGE_TYPES = [
  { value: AIModelUsageType.INTERVIEW, label: 'Interviews' },
  { value: AIModelUsageType.PROMPT_GENERATION, label: 'Prompt Generation' },
  { value: AIModelUsageType.COMMIT_GENERATION, label: 'Commit Generation' },
  { value: AIModelUsageType.TASK_EXECUTION, label: 'Task Execution' },
  { value: AIModelUsageType.GENERAL, label: 'General' },
];

export const ModelForm: React.FC<ModelFormProps> = ({
  model,
  onSubmit,
  onCancel,
}) => {
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: model?.name || '',
    provider: model?.provider || 'anthropic',
    api_key: model?.api_key || '',
    usage_type: model?.usage_type || AIModelUsageType.GENERAL,
    is_active: model?.is_active ?? true,
    config: model?.config || {},
  });

  // Update form data when model prop changes (e.g., when data loads)
  React.useEffect(() => {
    if (model) {
      console.log('🔍 ModelForm: Updating form data with model:', {
        modelId: model.id,
        hasApiKey: !!model.api_key,
        apiKeyLength: model.api_key?.length || 0,
        apiKeyPreview: model.api_key ? `${model.api_key.substring(0, 10)}...` : 'EMPTY'
      });

      setFormData({
        name: model.name,
        provider: model.provider,
        api_key: model.api_key || '',
        usage_type: model.usage_type,
        is_active: model.is_active,
        config: model.config || {},
      });

      console.log('✅ ModelForm: Form data updated');
    } else {
      console.log('⚠️ ModelForm: No model provided');
    }
  }, [model]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      if (model) {
        // Update existing model (only send changed fields)
        const updates: AIModelUpdate = {
          name: formData.name !== model.name ? formData.name : undefined,
          provider: formData.provider !== model.provider ? formData.provider : undefined,
          api_key: formData.api_key || undefined,
          usage_type: formData.usage_type !== model.usage_type ? formData.usage_type : undefined,
          is_active: formData.is_active !== model.is_active ? formData.is_active : undefined,
          config: JSON.stringify(formData.config) !== JSON.stringify(model.config)
            ? formData.config
            : undefined,
        };
        // Remove undefined fields
        Object.keys(updates).forEach(key =>
          updates[key as keyof AIModelUpdate] === undefined && delete updates[key as keyof AIModelUpdate]
        );
        await onSubmit(updates);
      } else {
        // Create new model
        const newModel: AIModelCreate = {
          name: formData.name,
          provider: formData.provider,
          api_key: formData.api_key,
          usage_type: formData.usage_type,
          is_active: formData.is_active,
          config: formData.config,
        };
        await onSubmit(newModel);
      }
    } catch (error) {
      console.error('Form submission failed:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const updateConfigField = (key: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      config: {
        ...prev.config,
        [key]: value,
      },
    }));
  };

  const removeConfigField = (key: string) => {
    setFormData(prev => {
      const newConfig = { ...prev.config };
      delete newConfig[key];
      return { ...prev, config: newConfig };
    });
  };

  const addConfigField = () => {
    const key = prompt('Enter configuration key:');
    if (key && !formData.config[key]) {
      updateConfigField(key, '');
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-6">
        {/* Basic Information */}
        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="name">Model Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Claude Sonnet 4.5"
                required
                className="mt-1"
              />
              <p className="text-xs text-gray-500 mt-1">
                A descriptive name for this model configuration
              </p>
            </div>

            <div>
              <Label htmlFor="provider">Provider *</Label>
              <Select
                id="provider"
                value={formData.provider}
                onChange={(e) => setFormData({ ...formData, provider: e.target.value })}
                options={PROVIDERS}
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="usage_type">Usage Type *</Label>
              <Select
                id="usage_type"
                value={formData.usage_type}
                onChange={(e) => setFormData({ ...formData, usage_type: e.target.value as AIModelUsageType })}
                options={USAGE_TYPES}
                className="mt-1"
              />
              <p className="text-xs text-gray-500 mt-1">
                What this model will be used for
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_active"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
              />
              <Label htmlFor="is_active" className="cursor-pointer">
                Active (model can be used)
              </Label>
            </div>
          </CardContent>
        </Card>

        {/* API Key */}
        <Card>
          <CardHeader>
            <CardTitle>API Key</CardTitle>
          </CardHeader>
          <CardContent>
            <Label htmlFor="api_key">
              API Key {!model && '*'}
            </Label>
            {(() => {
              console.log('🎨 Rendering ApiKeyInput with value:', {
                hasValue: !!formData.api_key,
                valueLength: formData.api_key?.length || 0,
                valuePreview: formData.api_key ? `${formData.api_key.substring(0, 10)}...` : 'EMPTY'
              });
              return null;
            })()}
            <ApiKeyInput
              value={formData.api_key}
              onChange={(value) => setFormData({ ...formData, api_key: value })}
              placeholder={model ? 'API key is filled - edit to change...' : 'Enter API key...'}
            />
            <p className="text-xs text-gray-500 mt-1">
              {model
                ? 'The current API key is shown above. Edit to change it.'
                : 'Your API key will be encrypted and stored securely'}
            </p>
          </CardContent>
        </Card>

        {/* Configuration */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Configuration (Optional)</CardTitle>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addConfigField}
              >
                Add Field
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {Object.keys(formData.config).length === 0 ? (
              <p className="text-sm text-gray-500">
                No configuration fields. Click "Add Field" to add custom settings.
              </p>
            ) : (
              <div className="space-y-3">
                {Object.entries(formData.config).map(([key, value]) => (
                  <div key={key} className="flex gap-2">
                    <div className="flex-1">
                      <Label className="text-xs">{key}</Label>
                      <Input
                        value={String(value)}
                        onChange={(e) => updateConfigField(key, e.target.value)}
                        placeholder="Value"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeConfigField(key)}
                      className="mt-5"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={submitting}
            >
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={submitting}>
            <Save className="w-4 h-4 mr-2" />
            {submitting ? 'Saving...' : model ? 'Update Model' : 'Create Model'}
          </Button>
        </div>
      </div>
    </form>
  );
};

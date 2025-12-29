/**
 * ModelsList Component
 * Display grid of AI models with filtering
 */

'use client';

import React, { useState } from 'react';
import { ModelCard } from './ModelCard';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { AIModel, AIModelUsageType } from '@/lib/types';
import { Search, Filter } from 'lucide-react';

interface ModelsListProps {
  models: AIModel[];
  loading?: boolean;
}

const USAGE_TYPES = [
  { value: 'all', label: 'All Usage Types' },
  { value: AIModelUsageType.INTERVIEW, label: 'Interviews' },
  { value: AIModelUsageType.PROMPT_GENERATION, label: 'Prompt Generation' },
  { value: AIModelUsageType.COMMIT_GENERATION, label: 'Commit Generation' },
  { value: AIModelUsageType.TASK_EXECUTION, label: 'Task Execution' },
  { value: AIModelUsageType.GENERAL, label: 'General' },
];

const PROVIDERS = [
  { value: 'all', label: 'All Providers' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'google', label: 'Google' },
  { value: 'ollama', label: 'Ollama' },
];

export const ModelsList: React.FC<ModelsListProps> = ({ models, loading = false }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterProvider, setFilterProvider] = useState<string>('all');
  const [filterUsageType, setFilterUsageType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  // Filter models
  const filteredModels = models.filter(model => {
    const matchesSearch = model.name
      .toLowerCase()
      .includes(searchTerm.toLowerCase());

    const matchesProvider =
      filterProvider === 'all' || model.provider === filterProvider;

    const matchesUsageType =
      filterUsageType === 'all' || model.usage_type === filterUsageType;

    const matchesStatus =
      filterStatus === 'all' ||
      (filterStatus === 'active' && model.is_active) ||
      (filterStatus === 'inactive' && !model.is_active);

    return matchesSearch && matchesProvider && matchesUsageType && matchesStatus;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Search */}
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Search models..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {/* Filter by Provider */}
          <div className="w-full md:w-48">
            <Select
              value={filterProvider}
              onChange={(e) => setFilterProvider(e.target.value)}
              options={PROVIDERS}
            />
          </div>

          {/* Filter by Usage Type */}
          <div className="w-full md:w-48">
            <Select
              value={filterUsageType}
              onChange={(e) => setFilterUsageType(e.target.value)}
              options={USAGE_TYPES}
            />
          </div>

          {/* Filter by Status */}
          <div className="w-full md:w-40">
            <Select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              options={[
                { value: 'all', label: 'All Status' },
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
            />
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 mt-4 pt-4 border-t border-gray-100">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <span className="text-sm text-gray-600">
              Showing {filteredModels.length} of {models.length} models
            </span>
          </div>
          <div className="flex gap-2">
            <Badge variant="success">
              {models.filter(m => m.is_active).length} Active
            </Badge>
            <Badge variant="default">
              {models.filter(m => !m.is_active).length} Inactive
            </Badge>
          </div>
        </div>
      </div>

      {/* Models Grid */}
      {filteredModels.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <div className="text-gray-400 mb-4">
            <Search className="w-16 h-16 mx-auto" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            No models found
          </h3>
          <p className="text-gray-600">
            {searchTerm || filterProvider !== 'all' || filterUsageType !== 'all' || filterStatus !== 'all'
              ? 'Try adjusting your filters'
              : 'No AI models have been configured yet'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredModels.map((model) => (
            <ModelCard key={model.id} model={model} />
          ))}
        </div>
      )}
    </div>
  );
};

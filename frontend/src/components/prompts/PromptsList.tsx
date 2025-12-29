/**
 * PromptsList Component
 * Displays a grid of prompts with filtering options
 */

'use client';

import React, { useState } from 'react';
import { Prompt } from '@/lib/types';
import { PromptCard } from './PromptCard';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Search, Filter } from 'lucide-react';

interface PromptsListProps {
  prompts: Prompt[];
  loading?: boolean;
}

export const PromptsList: React.FC<PromptsListProps> = ({
  prompts,
  loading = false,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterReusable, setFilterReusable] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');

  // Get unique types
  const uniqueTypes = Array.from(
    new Set(prompts.map(p => p.type).filter(Boolean))
  );

  // Filter prompts
  const filteredPrompts = prompts.filter(prompt => {
    const matchesSearch = prompt.content
      .toLowerCase()
      .includes(searchTerm.toLowerCase()) ||
      (prompt.type || '').toLowerCase().includes(searchTerm.toLowerCase());

    const matchesReusable =
      filterReusable === 'all' ||
      (filterReusable === 'reusable' && prompt.is_reusable) ||
      (filterReusable === 'not-reusable' && !prompt.is_reusable);

    const matchesType =
      filterType === 'all' || prompt.type === filterType;

    return matchesSearch && matchesReusable && matchesType;
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
                placeholder="Search prompts..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {/* Filter by Reusable */}
          <div className="w-full md:w-48">
            <Select
              value={filterReusable}
              onChange={(e) => setFilterReusable(e.target.value)}
              options={[
                { value: 'all', label: 'All Prompts' },
                { value: 'reusable', label: 'Reusable Only' },
                { value: 'not-reusable', label: 'Single-use Only' },
              ]}
            />
          </div>

          {/* Filter by Type */}
          {uniqueTypes.length > 0 && (
            <div className="w-full md:w-48">
              <Select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                options={[
                  { value: 'all', label: 'All Types' },
                  ...uniqueTypes.map(type => ({
                    value: type,
                    label: type,
                  })),
                ]}
              />
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 mt-4 pt-4 border-t border-gray-100">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <span className="text-sm text-gray-600">
              Showing {filteredPrompts.length} of {prompts.length} prompts
            </span>
          </div>
          <div className="flex gap-2">
            <Badge variant="default">
              {prompts.filter(p => p.is_reusable).length} Reusable
            </Badge>
            <Badge variant="info">
              {uniqueTypes.length} Types
            </Badge>
          </div>
        </div>
      </div>

      {/* Prompts Grid */}
      {filteredPrompts.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <div className="text-gray-400 mb-4">
            <Search className="w-16 h-16 mx-auto" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            No prompts found
          </h3>
          <p className="text-gray-600">
            {searchTerm || filterReusable !== 'all' || filterType !== 'all'
              ? 'Try adjusting your filters'
              : 'No prompts have been generated yet'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredPrompts.map((prompt) => (
            <PromptCard key={prompt.id} prompt={prompt} />
          ))}
        </div>
      )}
    </div>
  );
};

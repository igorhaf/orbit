/**
 * Backlog Filters Component
 * Filters for Item Type, Priority, Labels, and Status
 * JIRA Transformation - PROMPT #62 - Phase 3
 * PROMPT #123 - Added Labels filters with dynamic options
 */

'use client';

import React, { useState } from 'react';
import { Card, CardContent, Button } from '@/components/ui';
import { ItemType, PriorityLevel, TaskStatus, BacklogFilters as IBacklogFilters } from '@/lib/types';
import { IconTarget, IconBook, IconCheck, IconCircle, IconBug, IconEye, IconBan, IconPlay, IconDot, IconClock } from '@/components/icons'; // PROMPT #188

interface BacklogFiltersProps {
  filters: IBacklogFilters;
  onFiltersChange: (filters: IBacklogFilters) => void;
  onClearFilters: () => void;
  availableLabels?: string[];  // PROMPT #123 - Available labels from backlog items
}

export default function BacklogFilters({
  filters,
  onFiltersChange,
  onClearFilters,
  availableLabels = [],
}: BacklogFiltersProps) {
  // PROMPT #123 - State for label input
  const [labelInput, setLabelInput] = useState('');
  const [showLabelSuggestions, setShowLabelSuggestions] = useState(false);

  const toggleItemType = (type: ItemType) => {
    const currentTypes = filters.item_type || [];
    const newTypes = currentTypes.includes(type)
      ? currentTypes.filter((t) => t !== type)
      : [...currentTypes, type];
    onFiltersChange({ ...filters, item_type: newTypes });
  };

  const togglePriority = (priority: PriorityLevel) => {
    const currentPriorities = filters.priority || [];
    const newPriorities = currentPriorities.includes(priority)
      ? currentPriorities.filter((p) => p !== priority)
      : [...currentPriorities, priority];
    onFiltersChange({ ...filters, priority: newPriorities });
  };

  const toggleStatus = (status: TaskStatus) => {
    const currentStatuses = filters.status || [];
    const newStatuses = currentStatuses.includes(status)
      ? currentStatuses.filter((s) => s !== status)
      : [...currentStatuses, status];
    onFiltersChange({ ...filters, status: newStatuses });
  };

  // PROMPT #123 - Toggle label filter
  const toggleLabel = (label: string) => {
    const currentLabels = filters.labels || [];
    const newLabels = currentLabels.includes(label)
      ? currentLabels.filter((l) => l !== label)
      : [...currentLabels, label];
    onFiltersChange({ ...filters, labels: newLabels });
  };

  // PROMPT #123 - Add label from input
  const addLabel = (label: string) => {
    const trimmedLabel = label.trim();
    if (trimmedLabel && !(filters.labels || []).includes(trimmedLabel)) {
      onFiltersChange({
        ...filters,
        labels: [...(filters.labels || []), trimmedLabel]
      });
    }
    setLabelInput('');
    setShowLabelSuggestions(false);
  };

  // PROMPT #123 - Remove label
  const removeLabel = (label: string) => {
    const newLabels = (filters.labels || []).filter((l) => l !== label);
    onFiltersChange({ ...filters, labels: newLabels });
  };

  // PROMPT #123 - Filtered label suggestions
  const filteredLabelSuggestions = availableLabels.filter(
    (label) =>
      label.toLowerCase().includes(labelInput.toLowerCase()) &&
      !(filters.labels || []).includes(label)
  );

  const hasActiveFilters = () => {
    return (
      (filters.item_type && filters.item_type.length > 0) ||
      (filters.priority && filters.priority.length > 0) ||
      (filters.status && filters.status.length > 0) ||
      (filters.labels && filters.labels.length > 0) ||
      filters.search
    );
  };

  // PROMPT #123 - Count active filters
  const getActiveFilterCount = () => {
    let count = 0;
    if (filters.item_type?.length) count += filters.item_type.length;
    if (filters.priority?.length) count += filters.priority.length;
    if (filters.status?.length) count += filters.status.length;
    if (filters.labels?.length) count += filters.labels.length;
    if (filters.search) count += 1;
    return count;
  };

  const getItemTypeIcon = (type: ItemType) => {
    switch (type) {
      case ItemType.EPIC:
        return <IconTarget className="w-4 h-4" />;
      case ItemType.STORY:
        return <IconBook className="w-4 h-4" />;
      case ItemType.TASK:
        return <IconCheck className="w-4 h-4" />;
      case ItemType.SUBTASK:
        return <IconCircle className="w-4 h-4" />;
      case ItemType.BUG:
        return <IconBug className="w-4 h-4" />;
    }
  };

  // PROMPT #123 - Get status color and icon
  const getStatusIcon = (status: TaskStatus) => {
    switch (status) {
      case TaskStatus.DONE:
        return { color: 'text-green-700 bg-green-50', icon: <IconCheck className="w-3.5 h-3.5" /> };
      case TaskStatus.IN_PROGRESS:
        return { color: 'text-blue-700 bg-blue-50', icon: <IconPlay className="w-3.5 h-3.5" /> };
      case TaskStatus.REVIEW:
        return { color: 'text-purple-700 bg-purple-50', icon: <IconEye className="w-3.5 h-3.5" /> };
      case TaskStatus.BLOCKED:
        return { color: 'text-red-700 bg-red-50', icon: <IconBan className="w-3.5 h-3.5" /> };
      case TaskStatus.TODO:
        return { color: 'text-yellow-700 bg-yellow-50', icon: <IconClock className="w-3.5 h-3.5" /> };
      default:
        return { color: 'text-gray-700 bg-gray-50', icon: <IconDot className="w-2 h-2" /> };
    }
  };

  return (
    <Card variant="bordered">
      <CardContent className="p-4">
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-900">Filters</h3>
              {hasActiveFilters() && (
                <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">
                  {getActiveFilterCount()}
                </span>
              )}
            </div>
            {hasActiveFilters() && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClearFilters}
                className="text-xs text-blue-600 hover:text-blue-700"
              >
                Clear All
              </Button>
            )}
          </div>

          {/* Search */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Search</label>
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search items..."
                value={filters.search || ''}
                onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
                className="w-full pl-10 pr-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              {filters.search && (
                <button
                  onClick={() => onFiltersChange({ ...filters, search: '' })}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* PROMPT #123 - Labels Filter */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Labels</label>
            {/* Selected Labels */}
            {filters.labels && filters.labels.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {filters.labels.map((label) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700 rounded-full"
                  >
                    {label}
                    <button
                      onClick={() => removeLabel(label)}
                      className="text-indigo-500 hover:text-indigo-700"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            )}
            {/* Label Input with Suggestions */}
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
              <input
                type="text"
                placeholder="Add label..."
                value={labelInput}
                onChange={(e) => {
                  setLabelInput(e.target.value);
                  setShowLabelSuggestions(true);
                }}
                onFocus={() => setShowLabelSuggestions(true)}
                onBlur={() => setTimeout(() => setShowLabelSuggestions(false), 200)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && labelInput.trim()) {
                    e.preventDefault();
                    addLabel(labelInput);
                  }
                }}
                className="w-full pl-10 pr-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              {/* Suggestions Dropdown */}
              {showLabelSuggestions && filteredLabelSuggestions.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-auto">
                  {filteredLabelSuggestions.map((label) => (
                    <button
                      key={label}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        addLabel(label);
                      }}
                    >
                      <span className="px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700 rounded-full">
                        {label}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Quick Label Buttons */}
            {availableLabels.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {availableLabels.slice(0, 5).map((label) => {
                  const isSelected = (filters.labels || []).includes(label);
                  return (
                    <button
                      key={label}
                      onClick={() => toggleLabel(label)}
                      className={`px-2 py-0.5 text-xs font-medium rounded-full border transition-colors ${
                        isSelected
                          ? 'bg-indigo-100 text-indigo-700 border-indigo-300'
                          : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
                {availableLabels.length > 5 && (
                  <span className="px-2 py-0.5 text-xs text-gray-500">
                    +{availableLabels.length - 5} more
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Item Type */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">Item Type</label>
            <div className="space-y-1">
              {Object.values(ItemType).map((type) => {
                const isSelected = filters.item_type?.includes(type) || false;
                return (
                  <label
                    key={type}
                    className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                      isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleItemType(type)}
                      className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                    />
                    <span className="text-gray-600">{getItemTypeIcon(type)}</span>
                    <span className="text-sm text-gray-700 capitalize">{type}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Priority */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">Priority</label>
            <div className="space-y-1">
              {Object.values(PriorityLevel).map((priority) => {
                const isSelected = filters.priority?.includes(priority) || false;
                let colorClass = 'bg-gray-100 text-gray-700';

                if (priority === PriorityLevel.CRITICAL) colorClass = 'bg-red-100 text-red-700';
                else if (priority === PriorityLevel.HIGH) colorClass = 'bg-orange-100 text-orange-700';
                else if (priority === PriorityLevel.MEDIUM) colorClass = 'bg-yellow-100 text-yellow-700';
                else if (priority === PriorityLevel.LOW) colorClass = 'bg-blue-100 text-blue-700';
                else if (priority === PriorityLevel.TRIVIAL) colorClass = 'bg-gray-100 text-gray-700';

                return (
                  <label
                    key={priority}
                    className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                      isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => togglePriority(priority)}
                      className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                    />
                    <span className={`px-2 py-0.5 text-xs font-medium rounded ${colorClass} capitalize`}>
                      {priority}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Status */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">Status</label>
            <div className="space-y-1">
              {Object.values(TaskStatus).map((status) => {
                const isSelected = filters.status?.includes(status) || false;
                const { color, icon } = getStatusIcon(status);
                return (
                  <label
                    key={status}
                    className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                      isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleStatus(status)}
                      className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                    />
                    <span className={`w-5 text-center ${color} rounded`}>{icon}</span>
                    <span className="text-sm text-gray-700 capitalize">
                      {status.replace('_', ' ')}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

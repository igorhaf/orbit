/**
 * Backlog Filters Component
 * Filters for Item Type, Priority, Assignee, Labels, and Status
 * JIRA Transformation - PROMPT #62 - Phase 3
 */

'use client';

import React from 'react';
import { Card, CardContent, Button } from '@/components/ui';
import { ItemType, PriorityLevel, TaskStatus, BacklogFilters as IBacklogFilters } from '@/lib/types';

interface BacklogFiltersProps {
  filters: IBacklogFilters;
  onFiltersChange: (filters: IBacklogFilters) => void;
  onClearFilters: () => void;
}

export default function BacklogFilters({
  filters,
  onFiltersChange,
  onClearFilters,
}: BacklogFiltersProps) {
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

  const hasActiveFilters = () => {
    return (
      (filters.item_type && filters.item_type.length > 0) ||
      (filters.priority && filters.priority.length > 0) ||
      (filters.status && filters.status.length > 0) ||
      filters.assignee ||
      (filters.labels && filters.labels.length > 0) ||
      filters.search
    );
  };

  const getItemTypeIcon = (type: ItemType) => {
    switch (type) {
      case ItemType.EPIC:
        return '🎯';
      case ItemType.STORY:
        return '📖';
      case ItemType.TASK:
        return '✓';
      case ItemType.SUBTASK:
        return '◦';
      case ItemType.BUG:
        return '🐛';
    }
  };

  return (
    <Card variant="bordered">
      <CardContent className="p-4">
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Filters</h3>
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
            <input
              type="text"
              placeholder="Search items..."
              value={filters.search || ''}
              onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
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
                    className="flex items-center gap-2 p-2 rounded hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleItemType(type)}
                      className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                    />
                    <span className="text-lg">{getItemTypeIcon(type)}</span>
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
                    className="flex items-center gap-2 p-2 rounded hover:bg-gray-50 cursor-pointer"
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
                return (
                  <label
                    key={status}
                    className="flex items-center gap-2 p-2 rounded hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleStatus(status)}
                      className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700 capitalize">
                      {status.replace('_', ' ')}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Assignee */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Assignee</label>
            <input
              type="text"
              placeholder="Filter by assignee..."
              value={filters.assignee || ''}
              onChange={(e) => onFiltersChange({ ...filters, assignee: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

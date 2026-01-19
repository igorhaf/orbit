/**
 * Backlog List View Component
 * Hierarchical tree view for Epics, Stories, Tasks, Subtasks, and Bugs
 * JIRA Transformation - PROMPT #62 - Phase 3
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui';
import { tasksApi } from '@/lib/api';
import { BacklogItem, ItemType, PriorityLevel, TaskStatus } from '@/lib/types';
import { TaskCard } from './TaskCard'; // PROMPT #68

interface BacklogListViewProps {
  projectId: string;
  onItemSelect?: (item: BacklogItem) => void;
  selectedIds?: Set<string>;
  onSelectionChange?: (selectedIds: Set<string>) => void;
  filters?: {
    item_type?: ItemType[];
    priority?: PriorityLevel[];
    assignee?: string;
    labels?: string[];
    status?: TaskStatus[];
  };
}

// Helper function to get item type icon
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
    default:
      return '•';
  }
};

// Helper function to get item type label
const getItemTypeLabel = (type: ItemType) => {
  switch (type) {
    case ItemType.EPIC:
      return 'Epic';
    case ItemType.STORY:
      return 'Story';
    case ItemType.TASK:
      return 'Task';
    case ItemType.SUBTASK:
      return 'Subtask';
    case ItemType.BUG:
      return 'Bug';
    default:
      return type;
  }
};

// Helper function to get priority color
const getPriorityColor = (priority: PriorityLevel) => {
  switch (priority) {
    case PriorityLevel.CRITICAL:
      return 'bg-red-100 text-red-800 border-red-200';
    case PriorityLevel.HIGH:
      return 'bg-orange-100 text-orange-800 border-orange-200';
    case PriorityLevel.MEDIUM:
      return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case PriorityLevel.LOW:
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case PriorityLevel.TRIVIAL:
      return 'bg-gray-100 text-gray-800 border-gray-200';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-200';
  }
};

// Helper function to get status badge
const getStatusBadge = (status: string) => {
  const statusLower = status.toLowerCase();

  if (statusLower === 'done' || statusLower === 'completed') {
    return <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-800 border border-green-200">Done</span>;
  }
  if (statusLower === 'in_progress' || statusLower === 'in progress') {
    return <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-800 border border-blue-200">In Progress</span>;
  }
  if (statusLower === 'review') {
    return <span className="px-2 py-0.5 text-xs rounded-full bg-purple-100 text-purple-800 border border-purple-200">Review</span>;
  }
  if (statusLower === 'backlog') {
    return <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-800 border border-gray-200">Backlog</span>;
  }

  return <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-800 border border-gray-200">{status}</span>;
};

export default function BacklogListView({
  projectId,
  onItemSelect,
  selectedIds = new Set(),
  onSelectionChange,
  filters
}: BacklogListViewProps) {
  const [backlog, setBacklog] = useState<BacklogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'tree' | 'card'>('tree'); // PROMPT #68

  useEffect(() => {
    fetchBacklog();
  }, [projectId, filters]);

  const fetchBacklog = async () => {
    setLoading(true);
    try {
      const data = await tasksApi.getBacklog(projectId, filters);
      setBacklog(data || []);

      // Auto-expand all items on load
      if (data && data.length > 0) {
        expandAllItems(data);
      }
    } catch (error) {
      console.error('Error fetching backlog:', error);
      setBacklog([]);
    } finally {
      setLoading(false);
    }
  };

  // Recursively collect all item IDs for expansion
  const collectAllIds = (items: BacklogItem[]): string[] => {
    const ids: string[] = [];

    const traverse = (item: BacklogItem) => {
      if (item.children && item.children.length > 0) {
        ids.push(item.id);
        item.children.forEach(child => traverse(child as BacklogItem));
      }
    };

    items.forEach(traverse);
    return ids;
  };

  // Expand all items in the tree
  const expandAllItems = (items: BacklogItem[]) => {
    const allIds = collectAllIds(items);
    setExpandedIds(new Set(allIds));
  };

  // Collapse all items
  const collapseAll = () => {
    setExpandedIds(new Set());
  };

  // Expand all items (public function for button)
  const expandAll = () => {
    expandAllItems(backlog);
  };

  const toggleExpanded = (id: string) => {
    const newExpanded = new Set(expandedIds);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedIds(newExpanded);
  };

  const toggleSelected = (id: string) => {
    if (!onSelectionChange) return;

    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    onSelectionChange(newSelected);
  };

  const handleItemClick = (item: BacklogItem) => {
    if (onItemSelect) {
      onItemSelect(item);
    }
  };

  // PROMPT #68 - Flatten hierarchy for Card View
  const flattenBacklog = (items: BacklogItem[]): BacklogItem[] => {
    const flattened: BacklogItem[] = [];

    const traverse = (item: BacklogItem) => {
      flattened.push(item);
      if (item.children && item.children.length > 0) {
        item.children.forEach(child => traverse(child as BacklogItem));
      }
    };

    items.forEach(traverse);
    return flattened;
  };

  // Recursive function to render tree items
  const renderTreeItem = (item: BacklogItem, depth: number = 0) => {
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedIds.has(item.id);
    const isSelected = selectedIds.has(item.id);
    const indentClass = `pl-${depth * 6}`;

    return (
      <div key={item.id} className="border-b border-gray-100">
        {/* Item Row */}
        <div
          className={`
            flex items-center gap-3 py-3 px-4 hover:bg-gray-50 cursor-pointer transition-colors
            ${isSelected ? 'bg-blue-50' : ''}
            ${indentClass}
          `}
          style={{ paddingLeft: `${depth * 1.5 + 1}rem` }}
        >
          {/* Checkbox */}
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggleSelected(item.id)}
            className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
            onClick={(e) => e.stopPropagation()}
          />

          {/* Expand/Collapse Icon */}
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleExpanded(item.id);
              }}
              className="text-gray-500 hover:text-gray-700"
            >
              {isExpanded ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
            </button>
          ) : (
            <div className="w-4" />
          )}

          {/* Item Type Icon */}
          <span className="text-lg">{getItemTypeIcon(item.item_type)}</span>

          {/* Item Type Badge */}
          <span className="px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-700 min-w-[60px] text-center">
            {getItemTypeLabel(item.item_type)}
          </span>

          {/* Title */}
          <div
            onClick={() => handleItemClick(item)}
            className="flex-1 font-medium text-gray-900 truncate"
          >
            {item.title}
          </div>

          {/* Priority Badge */}
          <span className={`px-2 py-0.5 text-xs font-medium rounded border ${getPriorityColor(item.priority)}`}>
            {item.priority}
          </span>

          {/* Story Points */}
          {item.story_points && (
            <span className="px-2 py-0.5 text-xs font-medium rounded bg-purple-50 text-purple-700 border border-purple-200">
              {item.story_points} pts
            </span>
          )}

          {/* Assignee */}
          {item.assignee && (
            <div className="flex items-center gap-1">
              <div className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center font-medium">
                {item.assignee.charAt(0).toUpperCase()}
              </div>
            </div>
          )}

          {/* Labels */}
          {item.labels && item.labels.length > 0 && (
            <div className="flex gap-1">
              {item.labels.slice(0, 2).map((label, idx) => (
                <span key={idx} className="px-2 py-0.5 text-xs rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                  {label}
                </span>
              ))}
              {item.labels.length > 2 && (
                <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600 border border-gray-200">
                  +{item.labels.length - 2}
                </span>
              )}
            </div>
          )}

          {/* Status Badge */}
          {getStatusBadge(item.workflow_state)}
        </div>

        {/* Render Children (if expanded) */}
        {hasChildren && isExpanded && (
          <div>
            {item.children!.map((child) => renderTreeItem(child as BacklogItem, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (backlog.length === 0) {
    return (
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
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900">No backlog items</h3>
          <p className="mt-1 text-sm text-gray-500">
            Get started by creating Epics, Stories, or Tasks.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="bordered">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Backlog</CardTitle>
          <div className="flex items-center gap-4">
            <div className="text-sm text-gray-500">
              {backlog.length} item{backlog.length !== 1 ? 's' : ''}
              {selectedIds.size > 0 && (
                <span className="ml-2 text-blue-600 font-medium">
                  ({selectedIds.size} selected)
                </span>
              )}
            </div>
            {backlog.length > 0 && (
              <div className="flex gap-2">
                {/* PROMPT #68 - View Mode Toggle */}
                <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                  <button
                    onClick={() => setViewMode('tree')}
                    className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                      viewMode === 'tree'
                        ? 'bg-white text-blue-600 shadow-sm'
                        : 'text-gray-600 hover:text-gray-800'
                    }`}
                    title="Tree View"
                  >
                    🌲 Tree
                  </button>
                  <button
                    onClick={() => setViewMode('card')}
                    className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                      viewMode === 'card'
                        ? 'bg-white text-blue-600 shadow-sm'
                        : 'text-gray-600 hover:text-gray-800'
                    }`}
                    title="Card View"
                  >
                    🃏 Cards
                  </button>
                </div>

                {/* Tree View Controls */}
                {viewMode === 'tree' && (
                  <>
                    <button
                      onClick={expandAll}
                      className="px-3 py-1 text-xs font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors"
                      title="Expand all items"
                    >
                      Expand All
                    </button>
                    <button
                      onClick={collapseAll}
                      className="px-3 py-1 text-xs font-medium text-gray-600 hover:text-gray-700 hover:bg-gray-50 rounded transition-colors"
                      title="Collapse all items"
                    >
                      Collapse All
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className={viewMode === 'card' ? 'p-6' : 'p-0'}>
        {/* Tree View (Original) */}
        {viewMode === 'tree' && (
          <div className="divide-y divide-gray-100">
            {backlog.map((item) => renderTreeItem(item, 0))}
          </div>
        )}

        {/* Card View (PROMPT #68) */}
        {viewMode === 'card' && (
          <div className="space-y-4">
            {flattenBacklog(backlog).map((item) => (
              <TaskCard
                key={item.id}
                task={item}
                onUpdate={fetchBacklog}
                onClick={() => handleItemClick(item)} // PROMPT #84 - Open detail panel on click
                showInterviewButtons={false} // PROMPT #84 - Hide interview buttons in backlog view
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

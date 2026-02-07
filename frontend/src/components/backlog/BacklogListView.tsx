/**
 * Backlog List View Component
 * Hierarchical tree view for Epics, Stories, Tasks, Subtasks, and Bugs
 * JIRA Transformation - PROMPT #62 - Phase 3
 * PROMPT #128 - Background Job Notifications
 */

'use client';

import React, { useState, useEffect, useRef } from 'react';
// PROMPT #131 - Removed useRouter, now using onInterviewClick callback
import { Card, CardHeader, CardTitle, CardContent, AIModelBadge } from '@/components/ui';
import { useNotification } from '@/hooks';
import { useNotifications } from '@/contexts/NotificationContext';
import { tasksApi, interviewsApi } from '@/lib/api';  // PROMPT #131 - Added interviewsApi
import { BacklogItem, ItemType, PriorityLevel, TaskStatus, Interview } from '@/lib/types';  // PROMPT #131 - Added Interview
import { TaskCard } from './TaskCard'; // PROMPT #68
import InlineCardCreator from './InlineCardCreator'; // PROMPT #187
import { IconTarget, IconBook, IconCheck, IconCircle, IconBug, IconDot, IconTree, IconCards, IconChat } from '@/components/icons'; // PROMPT #188

// PROMPT #94 - Helper to check if item is suggested
const isSuggestedItem = (item: BacklogItem): boolean => {
  return item.labels?.includes('suggested') || item.workflow_state === 'draft';
};

// PROMPT #123 - Interface for available filter options
interface FilterOptions {
  labels: string[];
  assignees: string[];
}

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
    search?: string;  // PROMPT #123 - Local search filter
  };
  // PROMPT #96 - Props for refresh and selected item sync
  refreshKey?: number;  // When this changes, backlog is refreshed
  selectedItemId?: string;  // Currently selected item ID to update after refresh
  // PROMPT #123 - Callback to expose available filter options
  onFilterOptionsChange?: (options: FilterOptions) => void;
  // PROMPT #131 - Callback when interview is clicked (opens card with interview tab)
  onInterviewClick?: (item: BacklogItem, interviewId: string) => void;
}

// Helper function to get item type icon - PROMPT #188 replaced emojis with SVG icons
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
    default:
      return <IconDot className="w-3 h-3" />;
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
  filters,
  refreshKey,  // PROMPT #96
  selectedItemId,  // PROMPT #96
  onFilterOptionsChange,  // PROMPT #123
  onInterviewClick  // PROMPT #131 - Interview click callback
}: BacklogListViewProps) {
  // PROMPT #131 - Removed router, now using onInterviewClick callback
  const [backlog, setBacklog] = useState<BacklogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'tree' | 'card'>('tree'); // PROMPT #68
  const [isAddingEpic, setIsAddingEpic] = useState(false); // PROMPT #187 - Manual epic creation
  const { showError, showSuccess, NotificationComponent } = useNotification();
  const { addJob, notifications, activeJobs } = useNotifications(); // PROMPT #128 - Background notifications

  // PROMPT #94 - State for approve/reject actions
  // PROMPT #173 - activatingId now derived from activeJobs for persistence across navigation
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  // Derive activating state from activeJobs (persists across navigation)
  const activationTypes = ['epic_activation', 'story_activation', 'task_activation', 'subtask_activation'];
  const activatingIds = new Set(
    activeJobs
      .filter(j => activationTypes.includes(j.job_type) && (j.status === 'pending' || j.status === 'running'))
      .map(j => j.task_id)
      .filter(Boolean)
  );
  const isItemActivating = (itemId: string) => activatingIds.has(itemId);

  // PROMPT #131 - Interviews state (map of taskId -> interviews)
  const [interviewsMap, setInterviewsMap] = useState<Map<string, Interview[]>>(new Map());

  // PROMPT #131 - Bulk actions state
  const [bulkActionLoading, setBulkActionLoading] = useState<string | null>(null);
  const [showBulkStatusMenu, setShowBulkStatusMenu] = useState(false);
  const [showBulkPriorityMenu, setShowBulkPriorityMenu] = useState(false);
  const bulkMenuRef = useRef<HTMLDivElement>(null);

  // PROMPT #131 - Close dropdown menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (bulkMenuRef.current && !bulkMenuRef.current.contains(event.target as Node)) {
        setShowBulkStatusMenu(false);
        setShowBulkPriorityMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // PROMPT #123 - Extract labels and assignees from backlog items
  const extractFilterOptions = (items: BacklogItem[]): FilterOptions => {
    const labelsSet = new Set<string>();
    const assigneesSet = new Set<string>();

    const traverse = (item: BacklogItem) => {
      if (item.labels) {
        item.labels.forEach(label => labelsSet.add(label));
      }
      if (item.assignee) {
        assigneesSet.add(item.assignee);
      }
      if (item.children && item.children.length > 0) {
        item.children.forEach(child => traverse(child as BacklogItem));
      }
    };

    items.forEach(traverse);

    return {
      labels: Array.from(labelsSet).sort(),
      assignees: Array.from(assigneesSet).sort()
    };
  };

  // PROMPT #123 - Filter items locally by search text
  const filterBySearch = (items: BacklogItem[], searchText: string): BacklogItem[] => {
    if (!searchText || searchText.trim() === '') {
      return items;
    }

    const lowerSearch = searchText.toLowerCase();

    const itemMatches = (item: BacklogItem): boolean => {
      return (
        item.title.toLowerCase().includes(lowerSearch) ||
        (item.description && item.description.toLowerCase().includes(lowerSearch)) ||
        (item.assignee && item.assignee.toLowerCase().includes(lowerSearch)) ||
        (item.labels && item.labels.some(label => label.toLowerCase().includes(lowerSearch)))
      );
    };

    const filterRecursive = (items: BacklogItem[]): BacklogItem[] => {
      return items.reduce((acc: BacklogItem[], item) => {
        const children = item.children ? filterRecursive(item.children as BacklogItem[]) : [];
        const hasMatchingChildren = children.length > 0;
        const selfMatches = itemMatches(item);

        if (selfMatches || hasMatchingChildren) {
          acc.push({
            ...item,
            children: selfMatches ? item.children : children  // Keep all children if parent matches
          });
        }

        return acc;
      }, []);
    };

    return filterRecursive(items);
  };

  // PROMPT #123 - Get filtered backlog for display
  const getFilteredBacklog = (): BacklogItem[] => {
    return filterBySearch(backlog, filters?.search || '');
  };

  useEffect(() => {
    fetchBacklog();
    fetchInterviews();  // PROMPT #131 - Fetch interviews
  }, [projectId, filters?.item_type, filters?.priority, filters?.assignee, filters?.labels, filters?.status, refreshKey]);  // PROMPT #123 - Don't re-fetch on search change

  // PROMPT #173 - Refresh backlog when activation job completes (via WebSocket notification)
  const prevNotificationsLengthRef = useRef(notifications.length);
  useEffect(() => {
    if (notifications.length > prevNotificationsLengthRef.current) {
      const newNotifications = notifications.slice(prevNotificationsLengthRef.current);
      const hasActivationComplete = newNotifications.some(
        n => activationTypes.includes(n.job_type) && (n.status === 'completed' || n.status === 'failed')
      );
      if (hasActivationComplete) {
        fetchBacklog();
      }
    }
    prevNotificationsLengthRef.current = notifications.length;
  }, [notifications]);

  // PROMPT #131 - Fetch interviews for all items in the project
  const fetchInterviews = async () => {
    try {
      const interviewsRes = await interviewsApi.list();
      const interviews = interviewsRes.data || interviewsRes;

      // Build map of taskId -> interviews
      const map = new Map<string, Interview[]>();
      if (Array.isArray(interviews)) {
        interviews
          .filter((i: Interview) => i.project_id === projectId && i.parent_task_id)
          .forEach((interview: Interview) => {
            const taskId = interview.parent_task_id!;
            const existing = map.get(taskId) || [];
            existing.push(interview);
            map.set(taskId, existing);
          });
      }
      setInterviewsMap(map);
    } catch (error) {
      console.error('Error fetching interviews:', error);
      setInterviewsMap(new Map());
    }
  };

  const fetchBacklog = async () => {
    setLoading(true);
    try {
      // PROMPT #123 - Don't send search to API (not supported), only send other filters
      const apiFilters = filters ? {
        item_type: filters.item_type,
        priority: filters.priority,
        assignee: filters.assignee,
        labels: filters.labels,
        status: filters.status
      } : undefined;

      const data = await tasksApi.getBacklog(projectId, apiFilters);
      setBacklog(data || []);

      // Auto-expand all items on load
      if (data && data.length > 0) {
        expandAllItems(data);

        // PROMPT #123 - Extract and expose filter options
        if (onFilterOptionsChange) {
          const options = extractFilterOptions(data);
          onFilterOptionsChange(options);
        }
      }
    } catch (error) {
      console.error('Error fetching backlog:', error);
      setBacklog([]);
    } finally {
      setLoading(false);
    }
  };

  // PROMPT #96 - Update selected item when backlog changes
  // Helper to find item recursively in tree
  const findItemById = (items: BacklogItem[], id: string): BacklogItem | null => {
    for (const item of items) {
      if (item.id === id) return item;
      if (item.children && item.children.length > 0) {
        const found = findItemById(item.children as BacklogItem[], id);
        if (found) return found;
      }
    }
    return null;
  };

  // PROMPT #96 - Sync selected item with updated backlog data
  useEffect(() => {
    if (selectedItemId && backlog.length > 0 && onItemSelect) {
      const updatedItem = findItemById(backlog, selectedItemId);
      if (updatedItem) {
        onItemSelect(updatedItem);
      }
    }
  }, [backlog, selectedItemId]);

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

  // PROMPT #94 - Activate suggested item
  // PROMPT #128 - Registers job in notification system for background tracking
  // PROMPT #173 - Loading state derived from activeJobs (persists across navigation)
  const handleActivateItem = async (item: BacklogItem) => {
    try {
      const result = await tasksApi.activateSuggestedEpic(item.id);
      console.log('✅ Item activation started:', item.title);

      // PROMPT #128 - Register job in notification system
      if (result.job_id) {
        const jobType = item.item_type === 'epic' ? 'epic_activation' :
                        item.item_type === 'story' ? 'story_activation' :
                        item.item_type === 'task' ? 'task_activation' : 'subtask_activation';
        addJob(
          result.job_id,
          jobType,
          `Ativando ${item.item_type}: ${item.title.substring(0, 30)}...`,
          item.title,
          false,
          item.id // task_id for persistent loading state
        );
        showSuccess('Ativação iniciada! Acompanhe o progresso no sininho de notificações.');
        return;
      }

      fetchBacklog();
    } catch (error: any) {
      console.error('❌ Failed to activate item:', error);
      showError(`Failed to activate item: ${error.message}`);
    }
  };

  // PROMPT #94 - Reject suggested item
  const handleRejectItem = async (item: BacklogItem) => {
    if (!confirm(`Are you sure you want to reject and delete "${item.title}"?`)) {
      return;
    }

    setRejectingId(item.id);
    try {
      await tasksApi.rejectSuggestedEpic(item.id);
      console.log('❌ Item rejected:', item.title);
      fetchBacklog();
    } catch (error: any) {
      console.error('❌ Failed to reject item:', error);
      showError(`Failed to reject item: ${error.message}`);
    } finally {
      setRejectingId(null);
    }
  };

  // PROMPT #131 - Bulk Actions
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;

    const count = selectedIds.size;
    if (!confirm(`Tem certeza que deseja excluir ${count} item(s)? Esta ação não pode ser desfeita.`)) {
      return;
    }

    setBulkActionLoading('delete');
    try {
      const deletePromises = Array.from(selectedIds).map(id => tasksApi.delete(id));
      await Promise.all(deletePromises);
      showSuccess(`${count} item(s) excluído(s) com sucesso`);
      onSelectionChange?.(new Set());
      fetchBacklog();
    } catch (error: any) {
      console.error('Failed to delete items:', error);
      showError(`Erro ao excluir itens: ${error.message}`);
    } finally {
      setBulkActionLoading(null);
    }
  };

  const handleBulkStatusChange = async (newStatus: string) => {
    if (selectedIds.size === 0) return;

    setBulkActionLoading('status');
    setShowBulkStatusMenu(false);
    try {
      const updatePromises = Array.from(selectedIds).map(id =>
        tasksApi.update(id, { workflow_state: newStatus })
      );
      await Promise.all(updatePromises);
      showSuccess(`${selectedIds.size} item(s) atualizado(s) para "${newStatus}"`);
      onSelectionChange?.(new Set());
      fetchBacklog();
    } catch (error: any) {
      console.error('Failed to update status:', error);
      showError(`Erro ao atualizar status: ${error.message}`);
    } finally {
      setBulkActionLoading(null);
    }
  };

  const handleBulkPriorityChange = async (newPriority: PriorityLevel) => {
    if (selectedIds.size === 0) return;

    setBulkActionLoading('priority');
    setShowBulkPriorityMenu(false);
    try {
      const updatePromises = Array.from(selectedIds).map(id =>
        tasksApi.update(id, { priority: newPriority })
      );
      await Promise.all(updatePromises);
      showSuccess(`${selectedIds.size} item(s) atualizado(s) para prioridade "${newPriority}"`);
      onSelectionChange?.(new Set());
      fetchBacklog();
    } catch (error: any) {
      console.error('Failed to update priority:', error);
      showError(`Erro ao atualizar prioridade: ${error.message}`);
    } finally {
      setBulkActionLoading(null);
    }
  };

  const handleSelectAll = () => {
    if (!onSelectionChange) return;
    const allIds = new Set<string>();
    const collectIds = (items: BacklogItem[]) => {
      items.forEach(item => {
        allIds.add(item.id);
        if (item.children) {
          collectIds(item.children as BacklogItem[]);
        }
      });
    };
    collectIds(filteredBacklog);
    onSelectionChange(allIds);
  };

  const handleClearSelection = () => {
    onSelectionChange?.(new Set());
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
    const isSuggested = isSuggestedItem(item);
    const indentClass = `pl-${depth * 6}`;

    return (
      <div key={item.id} className={`border-b ${isSuggested ? 'border-dashed border-gray-300 bg-gray-50/50' : 'border-gray-100'}`}>
        {/* Item Row */}
        <div
          className={`
            flex items-center gap-3 py-3 px-4 hover:bg-gray-50 cursor-pointer transition-colors
            ${isSelected ? 'bg-blue-50' : ''}
            ${isSuggested ? 'opacity-60' : ''}
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
            className="flex-1 font-medium text-gray-900 truncate flex items-center gap-2"
          >
            <span className="truncate">{item.title}</span>
            {/* PROMPT #128 - Show AI model icon if content was generated by AI */}
            {item.created_by_ai_model && (
              <AIModelBadge model={item.created_by_ai_model} usage_type="prompt_generation" />
            )}
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

          {/* PROMPT #94 - Approve/Reject buttons for suggested items */}
          {isSuggestedItem(item) && (
            <div className="flex gap-1 ml-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleActivateItem(item);
                }}
                disabled={isItemActivating(item.id) || rejectingId === item.id}
                className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 hover:bg-green-200 rounded border border-green-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                title="Aprovar sugestão"
              >
                {isItemActivating(item.id) ? (
                  <>
                    <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-green-700"></div>
                    <span>Ativando...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Aprovar</span>
                  </>
                )}
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRejectItem(item);
                }}
                disabled={isItemActivating(item.id) || rejectingId === item.id}
                className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 rounded border border-red-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                title="Rejeitar sugestão"
              >
                {rejectingId === item.id ? (
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-red-700"></div>
                ) : (
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
                <span>Rejeitar</span>
              </button>
            </div>
          )}
        </div>

        {/* PROMPT #131 - Render Interviews for this item (aligned with card title) */}
        {interviewsMap.get(item.id)?.map((interview) => (
          <div
            key={interview.id}
            onClick={() => onInterviewClick?.(item, interview.id)}
            className="flex items-center gap-2 py-1.5 px-4 hover:bg-blue-50 cursor-pointer transition-colors border-t border-gray-100"
            style={{ paddingLeft: `${depth * 1.5 + 10}rem` }}
          >
            <IconChat className="w-4 h-4" />
            <span className="text-sm font-medium text-blue-700">
              {interview.interview_mode === 'context' ? 'Context Interview' :
               interview.interview_mode === 'meta_prompt' ? 'Epic Interview' :
               interview.interview_mode === 'card_inference' ? 'Card Interview' :
               interview.interview_mode === 'task_focused' ? 'Task Interview' :
               'Interview'}
            </span>
            <span className="text-xs text-gray-500">
              {interview.conversation_data?.length || 0} msgs
            </span>
            <span className={`ml-auto px-1.5 py-0.5 text-xs rounded ${
              interview.status === 'completed'
                ? 'bg-green-100 text-green-700'
                : interview.status === 'active'
                ? 'bg-blue-100 text-blue-700'
                : 'bg-gray-100 text-gray-600'
            }`}>
              {interview.status}
            </span>
          </div>
        ))}

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

  // PROMPT #123 - Get filtered items for display
  const filteredBacklog = getFilteredBacklog();

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
          {/* PROMPT #187 - Add Epic in empty state */}
          {isAddingEpic ? (
            <div className="mt-4 max-w-md mx-auto">
              <InlineCardCreator
                itemType={ItemType.EPIC}
                projectId={projectId}
                onCreated={() => {
                  setIsAddingEpic(false);
                  fetchBacklog();
                }}
                onCancel={() => setIsAddingEpic(false)}
                variant="hierarchy-card"
              />
            </div>
          ) : (
            <button
              onClick={() => setIsAddingEpic(true)}
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Epic
            </button>
          )}
        </CardContent>
      </Card>
    );
  }

  // PROMPT #123 - Show "no results" when search doesn't match anything
  if (filteredBacklog.length === 0 && filters?.search) {
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
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900">No matching items</h3>
          <p className="mt-1 text-sm text-gray-500">
            No items match &quot;{filters.search}&quot;. Try adjusting your search.
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
            {/* PROMPT #187 - Add Epic button */}
            <button
              onClick={() => setIsAddingEpic(true)}
              disabled={isAddingEpic}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-md transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Epic
            </button>
            <div className="text-sm text-gray-500">
              {/* PROMPT #123 - Show filtered count vs total */}
              {filters?.search ? (
                <>
                  {filteredBacklog.length} of {backlog.length} item{backlog.length !== 1 ? 's' : ''}
                </>
              ) : (
                <>
                  {backlog.length} item{backlog.length !== 1 ? 's' : ''}
                </>
              )}
              {selectedIds.size > 0 && (
                <span className="ml-2 text-blue-600 font-medium">
                  ({selectedIds.size} selected)
                </span>
              )}
            </div>
            {filteredBacklog.length > 0 && (
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
                    <span className="inline-flex items-center gap-1"><IconTree className="w-3 h-3" /> Tree</span>
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
                    <span className="inline-flex items-center gap-1"><IconCards className="w-3 h-3" /> Cards</span>
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

      {/* PROMPT #131 - Bulk Actions Toolbar */}
      {selectedIds.size > 0 && (
        <div className="px-4 py-3 bg-blue-50 border-b border-blue-200 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-blue-800">
              {selectedIds.size} item(s) selecionado(s)
            </span>
            <div className="flex items-center gap-2">
              {/* Select All / Clear */}
              <button
                onClick={handleSelectAll}
                className="px-2 py-1 text-xs font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-100 rounded transition-colors"
              >
                Selecionar Todos
              </button>
              <button
                onClick={handleClearSelection}
                className="px-2 py-1 text-xs font-medium text-gray-600 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
              >
                Limpar Seleção
              </button>
            </div>
          </div>

          <div ref={bulkMenuRef} className="flex items-center gap-2">
            {/* Change Status Dropdown */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowBulkStatusMenu(!showBulkStatusMenu);
                  setShowBulkPriorityMenu(false);
                }}
                disabled={bulkActionLoading !== null}
                className="px-3 py-1.5 text-xs font-medium bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1"
              >
                {bulkActionLoading === 'status' ? (
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-gray-600"></div>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                )}
                Status
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showBulkStatusMenu && (
                <div className="absolute right-0 mt-1 w-40 bg-white rounded-md shadow-lg border border-gray-200 z-50">
                  {['draft', 'open', 'in_progress', 'review', 'done', 'closed'].map((status) => (
                    <button
                      key={status}
                      onClick={() => handleBulkStatusChange(status)}
                      className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                    >
                      {status.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Change Priority Dropdown */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowBulkPriorityMenu(!showBulkPriorityMenu);
                  setShowBulkStatusMenu(false);
                }}
                disabled={bulkActionLoading !== null}
                className="px-3 py-1.5 text-xs font-medium bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1"
              >
                {bulkActionLoading === 'priority' ? (
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-gray-600"></div>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
                  </svg>
                )}
                Prioridade
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showBulkPriorityMenu && (
                <div className="absolute right-0 mt-1 w-32 bg-white rounded-md shadow-lg border border-gray-200 z-50">
                  {Object.values(PriorityLevel).map((priority) => (
                    <button
                      key={priority}
                      onClick={() => handleBulkPriorityChange(priority)}
                      className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                    >
                      {priority}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Delete Button */}
            <button
              onClick={handleBulkDelete}
              disabled={bulkActionLoading !== null}
              className="px-3 py-1.5 text-xs font-medium bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 flex items-center gap-1"
            >
              {bulkActionLoading === 'delete' ? (
                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              )}
              Excluir
            </button>
          </div>
        </div>
      )}

      <CardContent className={viewMode === 'card' ? 'p-6' : 'p-0'}>
        {/* PROMPT #187 - Inline Epic Creator */}
        {isAddingEpic && (
          <InlineCardCreator
            itemType={ItemType.EPIC}
            projectId={projectId}
            onCreated={() => {
              setIsAddingEpic(false);
              fetchBacklog();
            }}
            onCancel={() => setIsAddingEpic(false)}
            variant={viewMode === 'tree' ? 'backlog-row' : 'hierarchy-card'}
          />
        )}

        {/* Tree View (Original) */}
        {viewMode === 'tree' && (
          <div className="divide-y divide-gray-100">
            {/* PROMPT #123 - Use filtered backlog */}
            {filteredBacklog.map((item) => renderTreeItem(item, 0))}
          </div>
        )}

        {/* Card View (PROMPT #68) */}
        {viewMode === 'card' && (
          <div className="space-y-4">
            {/* PROMPT #123 - Use filtered backlog */}
            {flattenBacklog(filteredBacklog).map((item) => (
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

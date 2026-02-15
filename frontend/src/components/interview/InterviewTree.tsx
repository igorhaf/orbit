/**
 * InterviewTree Component
 * PROMPT #130 - Hierarchical tree view for interviews
 *
 * Structure:
 * - Context Interview (root, opens in modal)
 * - Cards (Epics, Stories, Tasks, Subtasks) with their interviews (opens in card panel)
 */

'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { interviewsApi, tasksApi } from '@/lib/api';
import { Interview, BacklogItem, Project, ItemType } from '@/lib/types';
import { Card, CardContent, Badge, Button, Dialog, DialogFooter } from '@/components/ui';
import { ChatInterface } from './ChatInterface';
import { useNotification } from '@/hooks';
import { IconTarget, IconBook, IconCheck, IconCircle, IconBug, IconDocument, IconGlobe, IconLightbulb, IconChat } from '@/components/icons';

interface InterviewTreeProps {
  projectId: string;
  project?: Project;
  onSelectCard?: (card: BacklogItem, openInterviewTab?: boolean) => void;  // PROMPT #130 - Open card in ItemDetailPanel
}

// Helper: Get item type icon
const getItemTypeIcon = (type?: ItemType | string): React.ReactNode => {
  switch (type) {
    case ItemType.EPIC:
    case 'epic':
      return <IconTarget className="w-5 h-5" />;
    case ItemType.STORY:
    case 'story':
      return <IconBook className="w-5 h-5" />;
    case ItemType.TASK:
    case 'task':
      return <IconCheck className="w-5 h-5" />;
    case ItemType.SUBTASK:
    case 'subtask':
      return <IconCircle className="w-5 h-5" />;
    case ItemType.BUG:
    case 'bug':
      return <IconBug className="w-5 h-5" />;
    default:
      return <IconDocument className="w-5 h-5" />;
  }
};

// Helper: Get interview mode label
const getInterviewModeLabel = (mode?: string) => {
  switch (mode) {
    case 'context':
      return 'Context Interview';
    case 'meta_prompt':
      return 'Epic Interview';
    case 'card_focused':
      return 'Card Interview';
    case 'task_focused':
      return 'Task Interview';
    case 'orchestrator':
      return 'Orchestrated Interview';
    default:
      return 'Interview';
  }
};

// Helper: Get interview mode icon
const getInterviewModeIcon = (mode?: string): React.ReactNode => {
  switch (mode) {
    case 'context':
      return <IconGlobe className="w-5 h-5" />;
    case 'meta_prompt':
      return <IconTarget className="w-5 h-5" />;
    case 'card_focused':
      return <IconLightbulb className="w-5 h-5" />;
    case 'task_focused':
      return <IconCheck className="w-5 h-5" />;
    default:
      return <IconChat className="w-5 h-5" />;
  }
};

// Tree node interface
interface TreeNode {
  id: string;
  type: 'interview' | 'task';
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  status?: string;
  itemType?: ItemType;
  interview?: Interview;
  task?: BacklogItem;
  children: TreeNode[];
  depth: number;
}

export function InterviewTree({ projectId, project, onSelectCard }: InterviewTreeProps) {
  const { showError, showSuccess, NotificationComponent } = useNotification();

  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [backlog, setBacklog] = useState<BacklogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Context Interview Modal state
  const [showContextModal, setShowContextModal] = useState(false);
  const [contextInterviewId, setContextInterviewId] = useState<string | null>(null);
  const [creatingContextInterview, setCreatingContextInterview] = useState(false);

  // Delete modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [interviewToDelete, setInterviewToDelete] = useState<Interview | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [interviewsRes, backlogRes] = await Promise.all([
        interviewsApi.list(),
        tasksApi.getBacklog(projectId)
      ]);

      const interviewsData = interviewsRes.data || interviewsRes;
      const backlogData = backlogRes.data || backlogRes;

      // Filter interviews for this project
      const projectInterviews = Array.isArray(interviewsData)
        ? interviewsData.filter((i: Interview) => i.project_id === projectId)
        : [];

      setInterviews(projectInterviews);
      setBacklog(Array.isArray(backlogData) ? backlogData : []);

      // Auto-expand all epics
      const autoExpand = new Set<string>();
      (Array.isArray(backlogData) ? backlogData : []).forEach((item: BacklogItem) => {
        if (item.item_type === 'epic') {
          autoExpand.add(`task-${item.id}`);
        }
      });
      setExpandedIds(autoExpand);
    } catch (error) {
      console.error('Failed to load data:', error);
      setInterviews([]);
      setBacklog([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Build tree structure
  const treeData = useMemo(() => {
    const nodes: TreeNode[] = [];

    // Find context interview (root)
    const contextInterview = interviews.find(
      i => i.interview_mode === 'context' && !i.parent_task_id
    );

    // Find other root interviews (meta_prompt without parent)
    const rootInterviews = interviews.filter(
      i => !i.parent_task_id && i.interview_mode !== 'context'
    );

    // Create map of task_id -> interviews
    const taskInterviewsMap = new Map<string, Interview[]>();
    interviews.forEach(interview => {
      if (interview.parent_task_id) {
        const existing = taskInterviewsMap.get(interview.parent_task_id) || [];
        existing.push(interview);
        taskInterviewsMap.set(interview.parent_task_id, existing);
      }
    });

    // Helper to build task tree with interviews
    const buildTaskNode = (task: BacklogItem, depth: number): TreeNode => {
      const taskInterviews = taskInterviewsMap.get(task.id) || [];
      const children: TreeNode[] = [];

      // Add interviews for this task
      taskInterviews.forEach(interview => {
        children.push({
          id: `interview-${interview.id}`,
          type: 'interview',
          title: getInterviewModeLabel(interview.interview_mode),
          subtitle: `${interview.conversation_data?.length || 0} messages`,
          icon: getInterviewModeIcon(interview.interview_mode),
          status: interview.status,
          interview,
          children: [],
          depth: depth + 1
        });
      });

      // Add child tasks
      if (task.children && task.children.length > 0) {
        task.children.forEach(child => {
          children.push(buildTaskNode(child as BacklogItem, depth + 1));
        });
      }

      return {
        id: `task-${task.id}`,
        type: 'task',
        title: task.title,
        subtitle: task.item_type,
        icon: getItemTypeIcon(task.item_type),
        itemType: task.item_type as ItemType,
        task,
        children,
        depth
      };
    };

    // Add context interview as root (if exists)
    if (contextInterview) {
      nodes.push({
        id: `interview-${contextInterview.id}`,
        type: 'interview',
        title: 'Context Interview',
        subtitle: project?.context_locked ? 'Locked' : 'Draft',
        icon: <IconGlobe className="w-5 h-5" />,
        status: contextInterview.status,
        interview: contextInterview,
        children: [],
        depth: 0
      });
    }

    // Add other root interviews
    rootInterviews.forEach(interview => {
      nodes.push({
        id: `interview-${interview.id}`,
        type: 'interview',
        title: getInterviewModeLabel(interview.interview_mode),
        subtitle: `${interview.conversation_data?.length || 0} messages`,
        icon: getInterviewModeIcon(interview.interview_mode),
        status: interview.status,
        interview,
        children: [],
        depth: 0
      });
    });

    // Add backlog items (Epics as roots)
    backlog.forEach(item => {
      nodes.push(buildTaskNode(item, 0));
    });

    return nodes;
  }, [interviews, backlog, project?.context_locked]);

  const toggleExpand = (nodeId: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  // Handle click on context interview - opens modal
  const handleContextInterviewClick = (interview: Interview) => {
    setContextInterviewId(interview.id);
    setShowContextModal(true);
  };

  // Handle click on any interview
  const handleInterviewClick = (node: TreeNode) => {
    if (!node.interview) return;

    // Context interview -> open modal
    if (node.interview.interview_mode === 'context') {
      handleContextInterviewClick(node.interview);
      return;
    }

    // Card interview -> find parent task and open in panel
    if (node.interview.parent_task_id) {
      // Find the task in backlog
      const findTask = (items: BacklogItem[], taskId: string): BacklogItem | null => {
        for (const item of items) {
          if (item.id === taskId) return item;
          if (item.children) {
            const found = findTask(item.children as BacklogItem[], taskId);
            if (found) return found;
          }
        }
        return null;
      };
      const task = findTask(backlog, node.interview.parent_task_id);
      if (task && onSelectCard) {
        onSelectCard(task, true);
      }
    }
  };

  // Create context interview
  const handleCreateContextInterview = async () => {
    setCreatingContextInterview(true);
    try {
      const response = await interviewsApi.create({
        project_id: projectId,
        ai_model_used: 'claude-3-sonnet',
        conversation_data: [],
        parent_task_id: null,
      });
      const newInterview = response.data || response;
      setContextInterviewId(newInterview.id);
      setShowContextModal(true);
      await loadData();
    } catch (error) {
      console.error('Failed to create context interview:', error);
      showError('Failed to create interview');
    } finally {
      setCreatingContextInterview(false);
    }
  };

  // Handle card click - opens card in ItemDetailPanel
  const handleCardClick = (task: BacklogItem) => {
    if (onSelectCard) {
      onSelectCard(task, false);  // false = don't force interview tab
    }
  };

  // Handle create interview for card
  const handleCreateCardInterview = (task: BacklogItem) => {
    if (onSelectCard) {
      onSelectCard(task, true);  // true = open interview tab (will create if needed)
    }
  };

  const handleDeleteClick = (e: React.MouseEvent, interview: Interview) => {
    e.preventDefault();
    e.stopPropagation();
    setInterviewToDelete(interview);
    setShowDeleteModal(true);
  };

  const handleDeleteConfirm = async () => {
    if (!interviewToDelete) return;

    setIsDeleting(true);
    try {
      await interviewsApi.delete(interviewToDelete.id);
      setShowDeleteModal(false);
      setInterviewToDelete(null);
      showSuccess('Interview deleted successfully');
      await loadData();
    } catch (error) {
      console.error('Failed to delete interview:', error);
      showError('Failed to delete interview');
    } finally {
      setIsDeleting(false);
    }
  };

  // Handle context interview completion
  const handleContextInterviewComplete = () => {
    setShowContextModal(false);
    loadData();
  };

  // Render tree node recursively
  const renderNode = (node: TreeNode): React.ReactNode => {
    const hasChildren = node.children.length > 0;
    const isExpanded = expandedIds.has(node.id);
    const paddingLeft = node.depth * 24 + 16;

    return (
      <div key={node.id} className="select-none">
        {/* Node row */}
        <div
          className={`flex items-center gap-2 py-2 px-3 hover:bg-gray-50 rounded-lg cursor-pointer transition-colors ${
            node.type === 'interview' ? 'bg-blue-50/50' : ''
          }`}
          style={{ paddingLeft: `${paddingLeft}px` }}
          onClick={() => {
            if (node.type === 'interview' && node.interview) {
              handleInterviewClick(node);
            } else if (node.type === 'task' && node.task) {
              // Click on task title toggles expand
              toggleExpand(node.id);
            }
          }}
        >
          {/* Expand/collapse button for tasks with children */}
          {node.type === 'task' && hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(node.id);
              }}
              className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-600"
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
            <div className="w-5 h-5" />
          )}

          {/* Icon */}
          <span className="flex items-center text-gray-600">{node.icon}</span>

          {/* Title and subtitle */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`font-medium truncate ${
                node.type === 'interview' ? 'text-blue-700' : 'text-gray-900'
              }`}>
                {node.title}
              </span>
              {node.subtitle && (
                <span className="text-xs text-gray-500">{node.subtitle}</span>
              )}
            </div>
          </div>

          {/* Status badge for interviews */}
          {node.type === 'interview' && node.status && (
            <Badge
              variant={
                node.status === 'completed' ? 'success' :
                node.status === 'active' ? 'info' : 'default'
              }
              size="sm"
            >
              {node.status}
            </Badge>
          )}

          {/* Actions */}
          <div className="flex items-center gap-1">
            {/* Open card button for tasks */}
            {node.type === 'task' && node.task && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCardClick(node.task!);
                }}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                title="Open card details"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </button>
            )}

            {/* Add interview button for tasks */}
            {node.type === 'task' && node.task && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCreateCardInterview(node.task!);
                }}
                className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                title="Start interview for this card"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
              </button>
            )}

            {/* Delete button for interviews */}
            {node.type === 'interview' && node.interview && (
              <button
                onClick={(e) => handleDeleteClick(e, node.interview!)}
                className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                title="Delete interview"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Children */}
        {hasChildren && isExpanded && (
          <div className="border-l border-gray-200 ml-6">
            {node.children.map(child => renderNode(child))}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="text-gray-600">Loading interview tree...</p>
        </div>
      </div>
    );
  }

  const hasContextInterview = interviews.some(i => i.interview_mode === 'context');
  const hasAnyData = interviews.length > 0 || backlog.length > 0;

  return (
    <div className="space-y-4">
      {NotificationComponent}

      {/* Header with legend */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 text-sm text-gray-500">
          <span className="flex items-center gap-1">
            <IconGlobe className="w-4 h-4" /> Context
          </span>
          <span className="flex items-center gap-1">
            <IconChat className="w-4 h-4" /> Interview
          </span>
          <span className="flex items-center gap-1">
            <IconTarget className="w-4 h-4" /> Epic
          </span>
          <span className="flex items-center gap-1">
            <IconBook className="w-4 h-4" /> Story
          </span>
          <span className="flex items-center gap-1">
            <IconCheck className="w-4 h-4" /> Task
          </span>
        </div>

        {/* Create context interview button if not exists */}
        {!hasContextInterview && project && !project.context_locked && (
          <Button
            variant="primary"
            size="sm"
            onClick={handleCreateContextInterview}
            disabled={creatingContextInterview}
            leftIcon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            }
          >
            {creatingContextInterview ? 'Creating...' : 'Start Context Interview'}
          </Button>
        )}
      </div>

      {/* Tree view */}
      {hasAnyData ? (
        <Card>
          <CardContent className="p-2">
            {treeData.map(node => renderNode(node))}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
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
                d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
              />
            </svg>
            <h3 className="mt-4 text-lg font-medium text-gray-900">No interviews yet</h3>
            <p className="mt-2 text-sm text-gray-500">
              Start a context interview to define your project foundation.
            </p>
            {!project?.context_locked && (
              <div className="mt-6">
                <Button
                  variant="primary"
                  onClick={handleCreateContextInterview}
                  disabled={creatingContextInterview}
                >
                  {creatingContextInterview ? 'Creating...' : 'Start Context Interview'}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Context Interview Modal - PROMPT #130 - Same size as ItemDetailPanel */}
      {showContextModal && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-[90%] h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div className="flex items-center gap-3">
                <IconGlobe className="w-6 h-6 text-blue-600" />
                <h2 className="text-xl font-semibold text-gray-900">Context Interview</h2>
              </div>
              <button
                onClick={() => setShowContextModal(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* Chat Content - PROMPT #130 - Display only, no interaction */}
            <div className="flex-1 overflow-hidden">
              {contextInterviewId && (
                <ChatInterface
                  interviewId={contextInterviewId}
                  interviewMode="context"
                  onComplete={handleContextInterviewComplete}
                  onStatusChange={() => loadData()}
                  embedded={true}
                  readOnly={true}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <Dialog
        open={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setInterviewToDelete(null);
        }}
        title="Delete Interview"
        size="sm"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">Delete this interview?</p>
              <p className="text-xs text-gray-500 mt-1">
                This will permanently delete the interview and all its messages.
              </p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => {
              setShowDeleteModal(false);
              setInterviewToDelete(null);
            }}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handleDeleteConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

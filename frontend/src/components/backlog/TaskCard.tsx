/**
 * TaskCard Component
 * PROMPT #68 - Dual-Mode Interview System
 * PROMPT #94 - Activate/Reject Suggested Epics
 *
 * Displays task with:
 * - Title, description, status, priority
 * - Acceptance criteria
 * - AI-suggested subtasks (expandable)
 * - "Create Sub-Interview" button
 * - "Accept Subtasks" button
 * - "Approve" / "Reject" buttons for suggested epics (PROMPT #94)
 */

'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '@/components/ui';
import { tasksApi } from '@/lib/api';
import { Task, SubtaskSuggestion, ItemType, PriorityLevel } from '@/lib/types';
import { SimilarityBadge } from '@/components/kanban/SimilarityBadge'; // PROMPT #95

interface TaskCardProps {
  task: Task;
  onUpdate?: () => void;
  onClick?: () => void; // PROMPT #84 - Allow opening detail panel instead of creating interviews
  showInterviewButtons?: boolean; // PROMPT #84 - Control whether to show "Create Sub-Interview" buttons
}

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
const getStatusBadge = (status: string | undefined) => {
  if (!status) {
    return <Badge className="bg-gray-100 text-gray-800 border-gray-200">No Status</Badge>;
  }

  const statusLower = status.toLowerCase();

  // PROMPT #95 - Blocked status
  if (statusLower === 'blocked') {
    return <Badge className="bg-red-100 text-red-800 border-red-300 font-semibold">🚨 BLOCKED</Badge>;
  }
  if (statusLower === 'done' || statusLower === 'completed') {
    return <Badge className="bg-green-100 text-green-800 border-green-200">Done</Badge>;
  }
  if (statusLower === 'in_progress' || statusLower === 'in progress') {
    return <Badge className="bg-blue-100 text-blue-800 border-blue-200">In Progress</Badge>;
  }
  if (statusLower === 'review') {
    return <Badge className="bg-purple-100 text-purple-800 border-purple-200">Review</Badge>;
  }
  if (statusLower === 'backlog' || statusLower === 'todo') {
    return <Badge className="bg-gray-100 text-gray-800 border-gray-200">Backlog</Badge>;
  }

  return <Badge className="bg-gray-100 text-gray-800 border-gray-200">{status}</Badge>;
};

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

export function TaskCard({ task, onUpdate, onClick, showInterviewButtons = true }: TaskCardProps) {
  const router = useRouter();
  const [showSubtasks, setShowSubtasks] = useState(false);
  const [acceptingSubtasks, setAcceptingSubtasks] = useState(false);
  const [creatingInterview, setCreatingInterview] = useState(false);

  // PROMPT #94 - Activate/Reject suggested epic states
  const [activatingEpic, setActivatingEpic] = useState(false);
  const [rejectingEpic, setRejectingEpic] = useState(false);

  const hasSuggestions = task.subtask_suggestions && task.subtask_suggestions.length > 0;

  // Handle both kanban (item_type) and backlog (item_type) - they use the same field
  // Handle both kanban (status) and backlog (workflow_state) - different fields
  const itemType = task.item_type || ItemType.TASK;

  // PROMPT #92 - Check if this is a suggested (inactive) epic
  const isSuggested = task.labels?.includes('suggested') || task.workflow_state === 'draft';

  const handleCreateSubInterview = async () => {
    setCreatingInterview(true);
    try {
      const interview = await tasksApi.createInterview(task.id);
      console.log('✅ Created sub-interview:', interview);

      // Navigate to interview page
      router.push(`/projects/${task.project_id}/interviews/${interview.id}`);
    } catch (error: any) {
      console.error('❌ Failed to create sub-interview:', error);
      alert(`Failed to create sub-interview: ${error.message}`);
    } finally {
      setCreatingInterview(false);
    }
  };

  const handleAcceptSubtasks = async () => {
    if (!task.subtask_suggestions) return;

    setAcceptingSubtasks(true);
    try {
      // Create subtasks
      for (const suggestion of task.subtask_suggestions) {
        await tasksApi.create({
          project_id: task.project_id,
          parent_id: task.id,
          item_type: ItemType.SUBTASK,
          title: suggestion.title,
          description: suggestion.description,
          story_points: suggestion.story_points,
          priority: task.priority || PriorityLevel.MEDIUM, // Inherit from parent or default
          status: 'backlog', // Use status (kanban) instead of workflow_state
          labels: task.labels || [],
        });
      }

      // Clear suggestions from task
      await tasksApi.update(task.id, { subtask_suggestions: [] });

      console.log('✅ Accepted all subtasks');
      if (onUpdate) {
        onUpdate();
      }
    } catch (error: any) {
      console.error('❌ Failed to accept subtasks:', error);
      alert(`Failed to accept subtasks: ${error.message}`);
    } finally {
      setAcceptingSubtasks(false);
    }
  };

  // PROMPT #94 - Activate suggested epic
  const handleActivateEpic = async () => {
    setActivatingEpic(true);
    try {
      const result = await tasksApi.activateSuggestedEpic(task.id);
      console.log('✅ Epic activated:', result);

      if (onUpdate) {
        onUpdate();
      }
    } catch (error: any) {
      console.error('❌ Failed to activate epic:', error);
      alert(`Failed to activate epic: ${error.message}`);
    } finally {
      setActivatingEpic(false);
    }
  };

  // PROMPT #94 - Reject suggested epic
  const handleRejectEpic = async () => {
    if (!confirm(`Are you sure you want to reject and delete the suggested epic "${task.title}"?`)) {
      return;
    }

    setRejectingEpic(true);
    try {
      await tasksApi.rejectSuggestedEpic(task.id);
      console.log('❌ Epic rejected and deleted');

      if (onUpdate) {
        onUpdate();
      }
    } catch (error: any) {
      console.error('❌ Failed to reject epic:', error);
      alert(`Failed to reject epic: ${error.message}`);
    } finally {
      setRejectingEpic(false);
    }
  };

  return (
    <Card
      className={`mb-4 ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''} ${
        isSuggested ? 'opacity-60 bg-gray-50 border-gray-300 border-dashed' : ''
      }`}
      onClick={onClick}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1">
            {/* Item Type Icon */}
            <span className={`text-2xl ${isSuggested ? 'grayscale' : ''}`}>
              {getItemTypeIcon(itemType)}
            </span>

            {/* Title */}
            <div className="flex-1">
              <CardTitle className={`text-lg font-semibold ${isSuggested ? 'text-gray-500' : 'text-gray-900'}`}>
                {isSuggested && <span className="text-xs font-normal text-gray-400 mr-2">[Sugestão]</span>}
                {task.title}
              </CardTitle>
              {task.description && (
                <p className={`text-sm mt-1 ${isSuggested ? 'text-gray-400' : 'text-gray-600'}`}>
                  {task.description}
                </p>
              )}
            </div>
          </div>

          {/* Badges */}
          <div className="flex flex-col gap-2 items-end">
            {getStatusBadge(task.status || task.workflow_state)}
            {/* PROMPT #95 - Show similarity badge for blocked tasks */}
            {task.pending_modification && task.pending_modification.similarity_score && (
              <SimilarityBadge score={task.pending_modification.similarity_score} />
            )}
            <Badge className={`${getPriorityColor(task.priority || 'medium')} border`}>
              {task.priority || 'medium'}
            </Badge>
            {task.story_points && (
              <Badge className="bg-purple-50 text-purple-700 border-purple-200">
                {task.story_points} pts
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {/* Acceptance Criteria */}
        {task.acceptance_criteria && task.acceptance_criteria.length > 0 && (
          <div className="mb-4">
            <h4 className="text-sm font-semibold text-gray-700 mb-2">
              ✅ Acceptance Criteria:
            </h4>
            <ul className="list-disc list-inside space-y-1">
              {task.acceptance_criteria.map((criterion, idx) => (
                <li key={idx} className="text-sm text-gray-600">
                  {criterion}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Labels */}
        {task.labels && task.labels.length > 0 && (
          <div className="flex gap-2 mb-4 flex-wrap">
            {task.labels.map((label, idx) => (
              <Badge key={idx} className="bg-indigo-50 text-indigo-700 border-indigo-200">
                {label}
              </Badge>
            ))}
          </div>
        )}

        {/* AI-Suggested Subtasks - Hide for suggested items */}
        {hasSuggestions && showInterviewButtons && !isSuggested && (
          <div className="border-t pt-4 mt-4">
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={(e) => {
                  e.stopPropagation(); // PROMPT #84 - Prevent card click
                  setShowSubtasks(!showSubtasks);
                }}
                className="flex items-center gap-2 text-sm font-semibold text-gray-700 hover:text-blue-600 transition-colors"
              >
                {showSubtasks ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                )}
                <span>🤖 AI-Suggested Subtasks ({task.subtask_suggestions!.length})</span>
              </button>
            </div>

            {showSubtasks && (
              <div className="space-y-3 mb-4">
                {task.subtask_suggestions!.map((suggestion, idx) => (
                  <div
                    key={idx}
                    className="bg-gray-50 rounded-lg p-3 border border-gray-200"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">
                          {idx + 1}. {suggestion.title}
                        </p>
                        {suggestion.description && (
                          <p className="text-xs text-gray-600 mt-1">
                            {suggestion.description}
                          </p>
                        )}
                      </div>
                      {suggestion.story_points && (
                        <Badge className="bg-purple-50 text-purple-700 border-purple-200 text-xs">
                          {suggestion.story_points} pts
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3">
              <Button
                onClick={(e) => {
                  e.stopPropagation(); // PROMPT #84 - Prevent card click
                  handleAcceptSubtasks();
                }}
                disabled={acceptingSubtasks}
                className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white"
              >
                {acceptingSubtasks ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    <span>Accepting...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Accept All Subtasks</span>
                  </>
                )}
              </Button>

              <Button
                onClick={(e) => {
                  e.stopPropagation(); // PROMPT #84 - Prevent card click
                  handleCreateSubInterview();
                }}
                disabled={creatingInterview}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white"
              >
                {creatingInterview ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    <span>Creating...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <span>Create Sub-Interview</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Create Sub-Interview button (always available) - Hide for suggested items */}
        {!hasSuggestions && showInterviewButtons && !isSuggested && (
          <div className="border-t pt-4 mt-4">
            <Button
              onClick={(e) => {
                e.stopPropagation(); // PROMPT #84 - Prevent card click
                handleCreateSubInterview();
              }}
              disabled={creatingInterview}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white w-full justify-center"
            >
              {creatingInterview ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <span>Creating...</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  <span>Explore this Task</span>
                </>
              )}
            </Button>
          </div>
        )}

        {/* PROMPT #94 - Approve/Reject buttons for suggested items (bottom right) */}
        {isSuggested && (
          <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-dashed border-gray-300">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleActivateEpic();
              }}
              disabled={activatingEpic || rejectingEpic}
              className="px-3 py-1.5 text-xs font-medium bg-green-100 text-green-700 hover:bg-green-200 rounded border border-green-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              title="Aprovar sugestão"
            >
              {activatingEpic ? (
                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-green-700"></div>
              ) : (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
              <span>Aprovar</span>
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                handleRejectEpic();
              }}
              disabled={activatingEpic || rejectingEpic}
              className="px-3 py-1.5 text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 rounded border border-red-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              title="Rejeitar sugestão"
            >
              {rejectingEpic ? (
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
      </CardContent>
    </Card>
  );
}

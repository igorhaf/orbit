/**
 * TaskCard Component
 * PROMPT #68 - Dual-Mode Interview System
 *
 * Displays task with:
 * - Title, description, status, priority
 * - Acceptance criteria
 * - AI-suggested subtasks (expandable)
 * - "Create Sub-Interview" button
 * - "Accept Subtasks" button
 */

'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '@/components/ui';
import { tasksApi } from '@/lib/api';
import { Task, SubtaskSuggestion, ItemType, PriorityLevel } from '@/lib/types';

interface TaskCardProps {
  task: Task;
  onUpdate?: () => void;
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
const getStatusBadge = (status: string) => {
  const statusLower = status.toLowerCase();

  if (statusLower === 'done' || statusLower === 'completed') {
    return <Badge className="bg-green-100 text-green-800 border-green-200">Done</Badge>;
  }
  if (statusLower === 'in_progress' || statusLower === 'in progress') {
    return <Badge className="bg-blue-100 text-blue-800 border-blue-200">In Progress</Badge>;
  }
  if (statusLower === 'review') {
    return <Badge className="bg-purple-100 text-purple-800 border-purple-200">Review</Badge>;
  }
  if (statusLower === 'backlog') {
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

export function TaskCard({ task, onUpdate }: TaskCardProps) {
  const router = useRouter();
  const [showSubtasks, setShowSubtasks] = useState(false);
  const [acceptingSubtasks, setAcceptingSubtasks] = useState(false);
  const [creatingInterview, setCreatingInterview] = useState(false);

  const hasSuggestions = task.subtask_suggestions && task.subtask_suggestions.length > 0;

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
          priority: task.priority, // Inherit from parent
          workflow_state: 'backlog',
          labels: task.labels,
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

  return (
    <Card className="mb-4">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1">
            {/* Item Type Icon */}
            <span className="text-2xl">{getItemTypeIcon(task.item_type)}</span>

            {/* Title */}
            <div className="flex-1">
              <CardTitle className="text-lg font-semibold text-gray-900">
                {task.title}
              </CardTitle>
              {task.description && (
                <p className="text-sm text-gray-600 mt-1">{task.description}</p>
              )}
            </div>
          </div>

          {/* Badges */}
          <div className="flex flex-col gap-2 items-end">
            {getStatusBadge(task.workflow_state)}
            <Badge className={`${getPriorityColor(task.priority)} border`}>
              {task.priority}
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

        {/* AI-Suggested Subtasks */}
        {hasSuggestions && (
          <div className="border-t pt-4 mt-4">
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => setShowSubtasks(!showSubtasks)}
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
                onClick={handleAcceptSubtasks}
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
                onClick={handleCreateSubInterview}
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

        {/* Create Sub-Interview button (always available) */}
        {!hasSuggestions && (
          <div className="border-t pt-4 mt-4">
            <Button
              onClick={handleCreateSubInterview}
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
      </CardContent>
    </Card>
  );
}

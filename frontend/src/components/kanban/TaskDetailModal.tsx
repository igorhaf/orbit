/**
 * TaskDetailModal Component
 * Modal for viewing and editing task details with JIRA-like fields
 * Updated with PROMPT #63 - JIRA integration in Kanban
 */

'use client';

import { useState, useEffect } from 'react';
import { Task, ItemType, PriorityLevel, TaskStatus } from '@/lib/types';
import { tasksApi } from '@/lib/api';
import { Dialog, Input, Textarea, Button } from '@/components/ui';
import { TaskComments, TaskComment } from './TaskComments';

interface Props {
  task: Task;
  isOpen: boolean;
  onClose: () => void;
  onUpdated: () => void;
  onDeleted: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
};

const STATUS_COLORS: Record<string, string> = {
  backlog: 'bg-gray-100 text-gray-800',
  todo: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-yellow-100 text-yellow-800',
  review: 'bg-purple-100 text-purple-800',
  done: 'bg-green-100 text-green-800',
};

const ITEM_TYPE_ICONS: Record<ItemType, string> = {
  [ItemType.EPIC]: '🎯',
  [ItemType.STORY]: '📖',
  [ItemType.TASK]: '✓',
  [ItemType.SUBTASK]: '◦',
  [ItemType.BUG]: '🐛',
};

const PRIORITY_COLORS: Record<PriorityLevel, string> = {
  [PriorityLevel.CRITICAL]: 'bg-red-100 text-red-800 border-red-200',
  [PriorityLevel.HIGH]: 'bg-orange-100 text-orange-800 border-orange-200',
  [PriorityLevel.MEDIUM]: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  [PriorityLevel.LOW]: 'bg-blue-100 text-blue-800 border-blue-200',
  [PriorityLevel.TRIVIAL]: 'bg-gray-100 text-gray-800 border-gray-200',
};

export function TaskDetailModal({ task, isOpen, onClose, onUpdated, onDeleted }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Provide defaults for legacy tasks (backward compatibility)
  const itemType = task.item_type || ItemType.TASK;
  const priority = task.priority || PriorityLevel.MEDIUM;
  const storyPoints = task.story_points || null;
  const assignee = task.assignee || '';
  const labels = task.labels || [];
  const acceptanceCriteria = task.acceptance_criteria || [];

  const [formData, setFormData] = useState({
    title: task.title,
    description: task.description || '',
    item_type: itemType,
    priority: priority,
    story_points: storyPoints,
    assignee: assignee,
    labels: labels,
    acceptance_criteria: acceptanceCriteria,
  });
  const [loading, setLoading] = useState(false);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [newCriteria, setNewCriteria] = useState('');

  // Load comments when task changes
  useEffect(() => {
    const taskComments = (task as any).comments || [];
    setComments(taskComments);
  }, [task]);

  // Update form data when task changes
  useEffect(() => {
    const itemType = task.item_type || ItemType.TASK;
    const priority = task.priority || PriorityLevel.MEDIUM;

    setFormData({
      title: task.title,
      description: task.description || '',
      item_type: itemType,
      priority: priority,
      story_points: task.story_points || null,
      assignee: task.assignee || '',
      labels: task.labels || [],
      acceptance_criteria: task.acceptance_criteria || [],
    });
  }, [task]);

  const handleSave = async () => {
    if (!formData.title.trim()) {
      alert('Title is required');
      return;
    }

    setLoading(true);
    try {
      await tasksApi.update(task.id, {
        title: formData.title,
        description: formData.description || null,
        item_type: formData.item_type,
        priority: formData.priority,
        story_points: formData.story_points,
        assignee: formData.assignee || null,
        labels: formData.labels,
        acceptance_criteria: formData.acceptance_criteria,
      });
      setIsEditing(false);
      onUpdated();
    } catch (error) {
      console.error('Failed to update task:', error);
      alert('Failed to update task');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = () => {
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    setLoading(true);
    try {
      await tasksApi.delete(task.id);
      setShowDeleteConfirm(false);
      onDeleted();
      onClose();
    } catch (error) {
      console.error('Failed to delete task:', error);
      alert('Failed to delete task');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    const itemType = task.item_type || ItemType.TASK;
    const priority = task.priority || PriorityLevel.MEDIUM;

    setFormData({
      title: task.title,
      description: task.description || '',
      item_type: itemType,
      priority: priority,
      story_points: task.story_points || null,
      assignee: task.assignee || '',
      labels: task.labels || [],
      acceptance_criteria: task.acceptance_criteria || [],
    });
  };

  const handleAddLabel = () => {
    if (newLabel.trim() && !formData.labels.includes(newLabel.trim())) {
      setFormData({
        ...formData,
        labels: [...formData.labels, newLabel.trim()],
      });
      setNewLabel('');
    }
  };

  const handleRemoveLabel = (label: string) => {
    setFormData({
      ...formData,
      labels: formData.labels.filter((l) => l !== label),
    });
  };

  const handleAddCriteria = () => {
    if (newCriteria.trim() && !formData.acceptance_criteria.includes(newCriteria.trim())) {
      setFormData({
        ...formData,
        acceptance_criteria: [...formData.acceptance_criteria, newCriteria.trim()],
      });
      setNewCriteria('');
    }
  };

  const handleRemoveCriteria = (criteria: string) => {
    setFormData({
      ...formData,
      acceptance_criteria: formData.acceptance_criteria.filter((c) => c !== criteria),
    });
  };

  const handleAddComment = async (content: string) => {
    const newComment: TaskComment = {
      id: crypto.randomUUID(),
      content,
      created_at: new Date().toISOString(),
      author: 'User',
    };

    const updatedComments = [...comments, newComment];
    setComments(updatedComments);

    try {
      await tasksApi.update(task.id, {
        comments: updatedComments as any,
      });
    } catch (error) {
      console.error('Failed to add comment:', error);
      alert('Failed to add comment');
      setComments(comments);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    const updatedComments = comments.filter((c) => c.id !== commentId);
    setComments(updatedComments);

    try {
      await tasksApi.update(task.id, {
        comments: updatedComments as any,
      });
    } catch (error) {
      console.error('Failed to delete comment:', error);
      alert('Failed to delete comment');
      setComments(comments);
    }
  };

  return (
    <Dialog open={isOpen} onClose={onClose} title="Task Details">
      <div className="space-y-6">
        {/* Header with Item Type and Priority */}
        <div className="flex items-start gap-3 pb-4 border-b border-gray-200">
          <span className="text-3xl">{ITEM_TYPE_ICONS[itemType]}</span>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-700">
                {itemType.toUpperCase()}
              </span>
              <span className={`px-2 py-0.5 text-xs font-medium rounded border ${PRIORITY_COLORS[priority]}`}>
                {priority}
              </span>
              {storyPoints && (
                <span className="px-2 py-0.5 text-xs font-medium rounded bg-purple-50 text-purple-700 border border-purple-200">
                  {storyPoints} pts
                </span>
              )}
            </div>
            {isEditing ? (
              <Input
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Task title"
                autoFocus
                className="text-xl font-semibold"
              />
            ) : (
              <h2 className="text-xl font-semibold text-gray-900">{task.title}</h2>
            )}
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Main Info */}
          <div className="lg:col-span-2 space-y-6">
            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Description
              </label>
              {isEditing ? (
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Add a description..."
                  rows={6}
                />
              ) : (
                <div className="text-gray-700 whitespace-pre-wrap min-h-[120px] p-4 bg-gray-50 rounded-lg border border-gray-200">
                  {task.description || (
                    <span className="text-gray-400 italic">No description provided</span>
                  )}
                </div>
              )}
            </div>

            {/* Acceptance Criteria */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Acceptance Criteria
              </label>
              {isEditing ? (
                <div className="space-y-2">
                  {formData.acceptance_criteria.map((criteria, idx) => (
                    <div key={idx} className="flex items-center gap-2 p-2 bg-gray-50 rounded border border-gray-200">
                      <input type="checkbox" className="rounded text-blue-600" defaultChecked />
                      <span className="flex-1 text-sm">{criteria}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveCriteria(criteria)}
                        className="text-red-600 hover:text-red-700"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <Input
                      value={newCriteria}
                      onChange={(e) => setNewCriteria(e.target.value)}
                      placeholder="Add acceptance criteria..."
                      onKeyPress={(e) => e.key === 'Enter' && handleAddCriteria()}
                    />
                    <Button type="button" variant="outline" onClick={handleAddCriteria}>
                      Add
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {acceptanceCriteria.length > 0 ? (
                    acceptanceCriteria.map((criteria, idx) => (
                      <div key={idx} className="flex items-center gap-2 p-2 bg-gray-50 rounded border border-gray-200">
                        <input type="checkbox" className="rounded text-blue-600" />
                        <span className="text-sm text-gray-700">{criteria}</span>
                      </div>
                    ))
                  ) : (
                    <span className="text-gray-400 italic text-sm">No acceptance criteria defined</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right Column - Metadata */}
          <div className="space-y-6">
            {/* Fields Section */}
            <div className="p-4 bg-gray-50 rounded-lg space-y-4">
              <h3 className="text-sm font-semibold text-gray-700">Details</h3>

              {/* Item Type */}
              {isEditing && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Type
                  </label>
                  <select
                    value={formData.item_type}
                    onChange={(e) => setFormData({ ...formData, item_type: e.target.value as ItemType })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  >
                    {Object.values(ItemType).map((type) => (
                      <option key={type} value={type}>
                        {ITEM_TYPE_ICONS[type]} {type.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Priority */}
              {isEditing && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Priority
                  </label>
                  <select
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: e.target.value as PriorityLevel })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  >
                    {Object.values(PriorityLevel).map((priority) => (
                      <option key={priority} value={priority}>
                        {priority.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Story Points */}
              {isEditing && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Story Points
                  </label>
                  <Input
                    type="number"
                    value={formData.story_points || ''}
                    onChange={(e) => setFormData({ ...formData, story_points: e.target.value ? parseInt(e.target.value) : null })}
                    placeholder="1, 2, 3, 5, 8..."
                    min="0"
                  />
                </div>
              )}

              {/* Assignee */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Assignee
                </label>
                {isEditing ? (
                  <Input
                    value={formData.assignee}
                    onChange={(e) => setFormData({ ...formData, assignee: e.target.value })}
                    placeholder="Enter name..."
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    {assignee ? (
                      <>
                        <div className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center font-medium">
                          {assignee.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm text-gray-900">{assignee}</span>
                      </>
                    ) : (
                      <span className="text-sm text-gray-400 italic">Unassigned</span>
                    )}
                  </div>
                )}
              </div>

              {/* Labels */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Labels
                </label>
                {isEditing ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1">
                      {formData.labels.map((label, idx) => (
                        <span key={idx} className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                          {label}
                          <button
                            type="button"
                            onClick={() => handleRemoveLabel(label)}
                            className="hover:text-indigo-900"
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        value={newLabel}
                        onChange={(e) => setNewLabel(e.target.value)}
                        placeholder="Add label..."
                        onKeyPress={(e) => e.key === 'Enter' && handleAddLabel()}
                      />
                      <Button type="button" variant="outline" onClick={handleAddLabel} size="sm">
                        +
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {labels.length > 0 ? (
                      labels.map((label, idx) => (
                        <span key={idx} className="px-2 py-1 text-xs rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                          {label}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm text-gray-400 italic">No labels</span>
                    )}
                  </div>
                )}
              </div>

              {/* Status */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Status
                </label>
                <span
                  className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                    STATUS_COLORS[task.status]
                  }`}
                >
                  {STATUS_LABELS[task.status]}
                </span>
              </div>

              {/* Timestamps */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Created
                </label>
                <span className="text-sm text-gray-900">
                  {new Date(task.created_at).toLocaleString()}
                </span>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Updated
                </label>
                <span className="text-sm text-gray-900">
                  {new Date(task.updated_at).toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Comments Section */}
        <div className="border-t border-gray-200 pt-6">
          <TaskComments
            comments={comments}
            onAddComment={handleAddComment}
            onDeleteComment={handleDeleteComment}
          />
        </div>

        {/* Actions */}
        <div className="flex justify-between items-center pt-4 border-t border-gray-200">
          <div className="flex gap-2">
            {isEditing ? (
              <>
                <Button
                  variant="primary"
                  onClick={handleSave}
                  isLoading={loading}
                  disabled={loading}
                >
                  Save Changes
                </Button>
                <Button variant="ghost" onClick={handleCancel} disabled={loading}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="primary" onClick={() => setIsEditing(true)}>
                <svg
                  className="w-4 h-4 mr-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                  />
                </svg>
                Edit Task
              </Button>
            )}
          </div>

          <Button
            variant="ghost"
            onClick={handleDelete}
            disabled={loading}
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
          >
            <svg
              className="w-4 h-4 mr-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
            Delete Task
          </Button>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Task?</h3>
            <p className="text-sm text-gray-600 mb-4">Are you sure you want to delete this task?</p>

            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <div className="flex items-start gap-3">
                <div className="text-red-600 text-2xl">⚠️</div>
                <div>
                  <h4 className="font-semibold text-red-900 mb-1">Warning: This action cannot be undone!</h4>
                  <p className="text-sm text-red-800">
                    Task "{task.title}" and all associated data (comments, metadata) will be permanently deleted.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={confirmDelete}
                disabled={loading}
                isLoading={loading}
              >
                Yes, Delete Task
              </Button>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}

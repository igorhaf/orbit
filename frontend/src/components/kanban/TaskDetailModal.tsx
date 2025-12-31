/**
 * TaskDetailModal Component
 * Modal for viewing and editing task details
 */

'use client';

import { useState, useEffect } from 'react';
import { Task } from '@/lib/types';
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

export function TaskDetailModal({ task, isOpen, onClose, onUpdated, onDeleted }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [formData, setFormData] = useState({
    title: task.title,
    description: task.description || '',
  });
  const [loading, setLoading] = useState(false);
  const [comments, setComments] = useState<TaskComment[]>([]);

  // Load comments when task changes
  useEffect(() => {
    // For now, comments are stored as JSON in task metadata
    // In the future, this could be a separate API call
    const taskComments = (task as any).comments || [];
    setComments(taskComments);
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
    setFormData({
      title: task.title,
      description: task.description || '',
    });
  };

  const handleAddComment = async (content: string) => {
    const newComment: TaskComment = {
      id: crypto.randomUUID(),
      content,
      created_at: new Date().toISOString(),
      author: 'User', // TODO: Get from auth context when available
    };

    const updatedComments = [...comments, newComment];
    setComments(updatedComments);

    // Save to backend (but don't close modal)
    try {
      await tasksApi.update(task.id, {
        comments: updatedComments as any,
      });
      // DON'T call onUpdated() here - it might close the modal
      // The comment is already visible in the UI
    } catch (error) {
      console.error('Failed to add comment:', error);
      alert('Failed to add comment');
      // Revert on error
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
      // DON'T call onUpdated() here - keep modal open
    } catch (error) {
      console.error('Failed to delete comment:', error);
      alert('Failed to delete comment');
      // Revert on error
      setComments(comments);
    }
  };

  return (
    <Dialog open={isOpen} onClose={onClose} title="Task Details">
      <div className="space-y-6">
        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Title
          </label>
          {isEditing ? (
            <Input
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Task title"
              autoFocus
            />
          ) : (
            <h2 className="text-xl font-semibold text-gray-900">{task.title}</h2>
          )}
        </div>

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

        {/* Metadata */}
        <div className="grid grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg">
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

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Column
            </label>
            <span className="text-sm text-gray-900 font-medium">
              {STATUS_LABELS[task.column] || task.column}
            </span>
          </div>

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

/**
 * TaskComments Component
 * Comments section for tasks
 */

'use client';

import { useState } from 'react';
import { Button, Textarea } from '@/components/ui';

export interface TaskComment {
  id: string;
  content: string;
  created_at: string;
  author: string;
}

interface Props {
  comments: TaskComment[];
  onAddComment: (content: string) => void;
  onDeleteComment: (commentId: string) => void;
}

export function TaskComments({ comments, onAddComment, onDeleteComment }: Props) {
  const [newComment, setNewComment] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const handleAdd = async (e?: React.MouseEvent | React.FormEvent) => {
    // CRITICAL: Prevent event propagation
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (!newComment.trim()) return;

    setIsAdding(true);
    try {
      await onAddComment(newComment.trim());
      setNewComment('');
    } finally {
      setIsAdding(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">Comments</h3>
        <span className="text-sm text-gray-500 bg-gray-100 px-2 py-1 rounded">
          {comments.length}
        </span>
      </div>

      {/* Comments List */}
      <div className="space-y-3 max-h-[300px] overflow-y-auto">
        {comments.length === 0 ? (
          <div className="text-center py-8 bg-gray-50 rounded-lg">
            <svg
              className="w-12 h-12 mx-auto text-gray-300 mb-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
            <p className="text-sm text-gray-400">No comments yet</p>
            <p className="text-xs text-gray-400 mt-1">Be the first to comment!</p>
          </div>
        ) : (
          comments.map((comment) => (
            <div
              key={comment.id}
              className="bg-gray-50 rounded-lg p-3 relative group hover:bg-gray-100 transition-colors"
            >
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs font-medium">
                    {comment.author[0].toUpperCase()}
                  </div>
                  <span className="font-medium text-sm text-gray-900">
                    {comment.author}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">
                    {new Date(comment.created_at).toLocaleString()}
                  </span>
                  <button
                    onClick={() => onDeleteComment(comment.id)}
                    className="text-red-500 opacity-0 group-hover:opacity-100 transition-opacity text-xs hover:text-red-700"
                    title="Delete comment"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              <p className="text-sm text-gray-700 whitespace-pre-wrap pl-8">
                {comment.content}
              </p>
            </div>
          ))
        )}
      </div>

      {/* New Comment Input */}
      <div className="space-y-2">
        <Textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Write a comment... (Ctrl+Enter to post)"
          rows={3}
          className="resize-none"
        />
        <div className="flex justify-between items-center">
          <p className="text-xs text-gray-500">
            Tip: Press <kbd className="px-1 py-0.5 bg-gray-200 rounded text-xs">Ctrl+Enter</kbd> to post
          </p>
          <Button
            onClick={handleAdd}
            disabled={!newComment.trim() || isAdding}
            isLoading={isAdding}
            size="sm"
            type="button"
          >
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
            Post Comment
          </Button>
        </div>
      </div>
    </div>
  );
}

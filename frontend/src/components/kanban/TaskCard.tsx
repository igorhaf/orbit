/**
 * TaskCard Component
 * Simple task card for Kanban board
 */

'use client';

import { useState } from 'react';
import { Task } from '@/lib/types';
import { Card, CardContent } from '@/components/ui';
import { TaskDetailModal } from './TaskDetailModal';

interface Props {
  task: Task;
  onDeleted: () => void;
  onUpdated: () => void;
}

export function TaskCard({ task, onDeleted, onUpdated }: Props) {
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    // Only open modal on direct click, not on drag
    if (e.defaultPrevented) return;
    setIsDetailOpen(true);
  };

  return (
    <>
      <Card
        className="bg-white hover:shadow-md transition-shadow cursor-pointer select-none"
        onClick={handleClick}
      >
        <CardContent className="p-3">
          {/* Title */}
          <h4 className="font-medium mb-2 line-clamp-2 text-gray-900">{task.title}</h4>

          {/* Description Preview */}
          {task.description && (
            <p className="text-sm text-gray-600 mb-3 line-clamp-2">
              {task.description}
            </p>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
            {/* Timestamp */}
            <div className="text-xs text-gray-400">
              {new Date(task.created_at).toLocaleDateString()}
            </div>

            {/* Status indicator */}
            <div className="text-xs text-gray-400 flex items-center gap-1">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                <circle cx="4" cy="8" r="1.5" />
                <circle cx="8" cy="8" r="1.5" />
                <circle cx="12" cy="8" r="1.5" />
              </svg>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Detail Modal */}
      <TaskDetailModal
        task={task}
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        onUpdated={() => {
          onUpdated();
          setIsDetailOpen(false);
        }}
        onDeleted={onDeleted}
      />
    </>
  );
}

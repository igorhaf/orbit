/**
 * TaskCard Component
 * Task card for Kanban board with JIRA-like badges
 * Updated with PROMPT #63 - JIRA integration in Kanban
 */

'use client';

import { useState } from 'react';
import { Task, ItemType, PriorityLevel } from '@/lib/types';
import { Card, CardContent } from '@/components/ui';
import { TaskDetailModal } from './TaskDetailModal';

interface Props {
  task: Task;
  onDeleted: () => void;
  onUpdated: () => void;
}

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
          {/* Header with Badges */}
          <div className="flex items-start gap-2 mb-2">
            {/* Item Type Icon */}
            <span className="text-lg flex-shrink-0">{ITEM_TYPE_ICONS[task.item_type]}</span>

            <div className="flex-1 min-w-0">
              {/* Item Type and Priority Badges */}
              <div className="flex items-center gap-1 mb-1 flex-wrap">
                <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-gray-100 text-gray-600">
                  {task.item_type.toUpperCase()}
                </span>
                <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded border ${PRIORITY_COLORS[task.priority]}`}>
                  {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
                </span>
                {task.story_points && (
                  <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-purple-50 text-purple-700 border border-purple-200">
                    {task.story_points} pts
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Title */}
          <h4 className="font-medium mb-2 line-clamp-2 text-gray-900 text-sm">
            {task.title}
          </h4>

          {/* Description Preview */}
          {task.description && (
            <p className="text-xs text-gray-600 mb-3 line-clamp-2">
              {task.description}
            </p>
          )}

          {/* Labels */}
          {task.labels && task.labels.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-3">
              {task.labels.slice(0, 2).map((label, idx) => (
                <span key={idx} className="px-2 py-0.5 text-[10px] rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                  {label}
                </span>
              ))}
              {task.labels.length > 2 && (
                <span className="px-2 py-0.5 text-[10px] rounded-full bg-gray-100 text-gray-600 border border-gray-200">
                  +{task.labels.length - 2}
                </span>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
            {/* Assignee */}
            <div className="flex items-center gap-1">
              {task.assignee ? (
                <>
                  <div className="w-5 h-5 rounded-full bg-blue-500 text-white text-[10px] flex items-center justify-center font-medium">
                    {task.assignee.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-xs text-gray-600 truncate max-w-[80px]">
                    {task.assignee}
                  </span>
                </>
              ) : (
                <span className="text-xs text-gray-400">Unassigned</span>
              )}
            </div>

            {/* Date */}
            <div className="text-xs text-gray-400">
              {new Date(task.created_at).toLocaleDateString()}
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

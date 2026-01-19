/**
 * TaskCard Component for Kanban
 * PROMPT #82 - Display item type (Epic, Story, Task, etc.)
 * Simpler version for Kanban board display
 */

'use client';

import { Task, ItemType } from '@/lib/types';
import { Badge } from '@/components/ui';

interface Props {
  task: Task;
  onDeleted: () => void;
  onUpdated: () => void;
  canMoveLeft?: boolean;
  canMoveRight?: boolean;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
}

// Helper function to get item type icon and label
const getItemTypeDisplay = (type: ItemType | undefined) => {
  switch (type) {
    case ItemType.EPIC:
      return { icon: '🎯', label: 'Epic', color: 'bg-purple-100 text-purple-800 border-purple-200' };
    case ItemType.STORY:
      return { icon: '📖', label: 'Story', color: 'bg-blue-100 text-blue-800 border-blue-200' };
    case ItemType.TASK:
      return { icon: '✓', label: 'Task', color: 'bg-gray-100 text-gray-800 border-gray-200' };
    case ItemType.SUBTASK:
      return { icon: '◦', label: 'Subtask', color: 'bg-gray-50 text-gray-700 border-gray-200' };
    case ItemType.BUG:
      return { icon: '🐛', label: 'Bug', color: 'bg-red-100 text-red-800 border-red-200' };
    default:
      return { icon: '•', label: 'Task', color: 'bg-gray-100 text-gray-800 border-gray-200' };
  }
};

export function TaskCard({ 
  task, 
  canMoveLeft, 
  canMoveRight, 
  onMoveLeft, 
  onMoveRight 
}: Props) {
  const itemTypeDisplay = getItemTypeDisplay(task.item_type);

  return (
    <div className="bg-white rounded-lg shadow-sm p-4 hover:shadow-md transition-shadow border border-gray-200">
      {/* Header with Item Type Badge */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">{itemTypeDisplay.icon}</span>
          <Badge className={`${itemTypeDisplay.color} text-xs font-semibold border`}>
            {itemTypeDisplay.label}
          </Badge>
        </div>

        {/* Navigation buttons */}
        <div className="flex gap-1">
          {canMoveLeft && onMoveLeft && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMoveLeft();
              }}
              className="text-gray-400 hover:text-gray-600 p-1"
              title="Move left"
            >
              ←
            </button>
          )}
          {canMoveRight && onMoveRight && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMoveRight();
              }}
              className="text-gray-400 hover:text-gray-600 p-1"
              title="Move right"
            >
              →
            </button>
          )}
        </div>
      </div>

      {/* Title */}
      <h4 className="font-semibold text-gray-900 text-sm line-clamp-2 mb-2">
        {task.title}
      </h4>

      {/* Description */}
      {task.description && (
        <p className="text-xs text-gray-600 line-clamp-3">
          {task.description}
        </p>
      )}
    </div>
  );
}

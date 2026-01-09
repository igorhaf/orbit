/**
 * DraggableTaskCard Component
 * Task card with drag-and-drop functionality using @dnd-kit
 * Uses TaskCard from backlog (more complete with subtasks and interviews)
 */

'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Task } from '@/lib/types';
import { TaskCard } from '@/components/backlog/TaskCard';

interface Props {
  task: Task;
  onDeleted: () => void;
  onUpdated: () => void;
  disabled?: boolean; // PROMPT #95 - Disable drag for blocked tasks
  onTaskClick?: (task: Task) => void; // PROMPT #97 - Click handler for regular tasks (opens ItemDetailPanel)
  onBlockedTaskClick?: (task: Task) => void; // PROMPT #95 - Click handler for blocked tasks (opens ModificationApprovalModal)
}

export function DraggableTaskCard({ task, onDeleted: _onDeleted, onUpdated, disabled, onTaskClick, onBlockedTaskClick }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    disabled: disabled || false, // PROMPT #95 - Disable sorting if task is blocked
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Combine onDeleted and onUpdated into a single onUpdate callback
  const handleUpdate = () => {
    onUpdated();
  };

  // PROMPT #97 - Handle click on task card
  const handleClick = () => {
    if (disabled && onBlockedTaskClick) {
      // PROMPT #95 - Blocked tasks open ModificationApprovalModal
      onBlockedTaskClick(task);
    } else if (!disabled && onTaskClick) {
      // PROMPT #97 - Regular tasks open ItemDetailPanel
      onTaskClick(task);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...(disabled ? {} : listeners)} // PROMPT #95 - Only add drag listeners if not disabled
      onClick={handleClick}
      className={onTaskClick || onBlockedTaskClick ? 'cursor-pointer' : ''} // PROMPT #97 - Show pointer cursor when clickable
    >
      <TaskCard
        task={task}
        onUpdate={handleUpdate}
      />
    </div>
  );
}

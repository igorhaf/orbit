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
}

export function DraggableTaskCard({ task, onDeleted, onUpdated }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Combine onDeleted and onUpdated into a single onUpdate callback
  const handleUpdate = () => {
    onUpdated();
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TaskCard
        task={task}
        onUpdate={handleUpdate}
      />
    </div>
  );
}

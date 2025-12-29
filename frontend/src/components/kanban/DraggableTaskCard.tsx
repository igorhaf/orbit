/**
 * DraggableTaskCard Component
 * Task card with drag-and-drop functionality using @dnd-kit
 */

'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Task } from '@/lib/types';
import { TaskCard } from './TaskCard';

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
    cursor: isDragging ? 'grabbing' : 'grab',
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TaskCard
        task={task}
        onDeleted={onDeleted}
        onUpdated={onUpdated}
      />
    </div>
  );
}

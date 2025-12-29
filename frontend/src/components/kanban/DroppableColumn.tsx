/**
 * DroppableColumn Component
 * Droppable column for Kanban board using @dnd-kit
 */

'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Task, TaskStatus } from '@/lib/types';
import { DraggableTaskCard } from './DraggableTaskCard';

interface Props {
  columnId: TaskStatus;
  title: string;
  color: string;
  tasks: Task[];
  onTaskDeleted: () => void;
  onTaskUpdated: () => void;
}

export function DroppableColumn({
  columnId,
  title,
  color,
  tasks,
  onTaskDeleted,
  onTaskUpdated,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: columnId,
  });

  return (
    <div
      className={`rounded-lg ${color} p-4 min-w-[280px] transition-all ${
        isOver ? 'ring-2 ring-blue-500 ring-offset-2 scale-105' : ''
      }`}
    >
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold text-lg text-gray-800">{title}</h3>
        <span className="text-sm text-gray-600 bg-white px-2.5 py-1 rounded-full font-medium">
          {tasks.length}
        </span>
      </div>

      {/* Droppable Area */}
      <SortableContext
        id={columnId}
        items={tasks.map((task) => task.id)}
        strategy={verticalListSortingStrategy}
      >
        <div
          ref={setNodeRef}
          className="space-y-3 min-h-[500px]"
        >
          {tasks.map((task) => (
            <DraggableTaskCard
              key={task.id}
              task={task}
              onDeleted={onTaskDeleted}
              onUpdated={onTaskUpdated}
            />
          ))}

          {/* Empty state */}
          {tasks.length === 0 && (
            <div className="flex items-center justify-center text-gray-400 py-12 text-sm">
              {isOver ? (
                <span className="text-blue-500 font-medium">Drop here</span>
              ) : (
                <span>No tasks</span>
              )}
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

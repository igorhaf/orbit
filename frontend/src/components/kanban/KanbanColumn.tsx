/**
 * KanbanColumn Component
 * Column for Kanban board with task navigation
 */

'use client';

import { Task, TaskStatus } from '@/lib/types';
import { TaskCard } from './TaskCard';

interface Props {
  columnId: TaskStatus;
  title: string;
  color: string;
  tasks: Task[];
  columnIndex: number;
  totalColumns: number;
  onTaskDeleted: () => void;
  onTaskUpdated: () => void;
  onTaskMoved: (taskId: string, newStatus: TaskStatus) => Promise<void>;
}

const COLUMN_ORDER: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'review', 'done'];

export function KanbanColumn({
  columnId,
  title,
  color,
  tasks,
  columnIndex,
  totalColumns,
  onTaskDeleted,
  onTaskUpdated,
  onTaskMoved
}: Props) {
  const canMoveLeft = columnIndex > 0;
  const canMoveRight = columnIndex < totalColumns - 1;

  const handleMoveLeft = async (taskId: string) => {
    const newStatus = COLUMN_ORDER[columnIndex - 1];
    await onTaskMoved(taskId, newStatus);
  };

  const handleMoveRight = async (taskId: string) => {
    const newStatus = COLUMN_ORDER[columnIndex + 1];
    await onTaskMoved(taskId, newStatus);
  };

  return (
    <div className={`rounded-lg ${color} p-4 min-w-[280px]`}>
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold text-lg text-gray-800">{title}</h3>
        <span className="text-sm text-gray-600 bg-white px-2.5 py-1 rounded-full font-medium">
          {tasks.length}
        </span>
      </div>

      {/* Tasks */}
      <div className="space-y-3 min-h-[500px]">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onDeleted={onTaskDeleted}
            onUpdated={onTaskUpdated}
            canMoveLeft={canMoveLeft}
            canMoveRight={canMoveRight}
            onMoveLeft={() => handleMoveLeft(task.id)}
            onMoveRight={() => handleMoveRight(task.id)}
          />
        ))}

        {/* Empty state */}
        {tasks.length === 0 && (
          <div className="flex items-center justify-center text-gray-400 py-12 text-sm">
            No tasks in {title}
          </div>
        )}
      </div>
    </div>
  );
}

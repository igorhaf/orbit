/**
 * KanbanBoard Component
 * Main Kanban board with drag-and-drop using @dnd-kit
 */

'use client';

import { useEffect, useState } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { tasksApi } from '@/lib/api';
import { Task, TaskStatus } from '@/lib/types';
import { DroppableColumn } from './DroppableColumn';
import { TaskCard } from '@/components/backlog/TaskCard';
import { TaskForm } from './TaskForm';
import { Button, Dialog } from '@/components/ui';
import { ModificationApprovalModal } from './ModificationApprovalModal'; // PROMPT #95
import { ItemDetailPanel } from '@/components/backlog'; // PROMPT #97

interface Props {
  projectId: string;
}

interface BoardData {
  backlog: Task[];
  todo: Task[];
  in_progress: Task[];
  review: Task[];
  done: Task[];
  blocked: Task[]; // PROMPT #95 - Blocked tasks pending approval
}

const COLUMNS = [
  { id: 'blocked' as TaskStatus, title: '🚨 Bloqueados', color: 'bg-red-100' }, // PROMPT #95 - First column
  { id: 'backlog' as TaskStatus, title: 'Backlog', color: 'bg-gray-100' },
  { id: 'todo' as TaskStatus, title: 'To Do', color: 'bg-blue-100' },
  { id: 'in_progress' as TaskStatus, title: 'In Progress', color: 'bg-yellow-100' },
  { id: 'review' as TaskStatus, title: 'Review', color: 'bg-purple-100' },
  { id: 'done' as TaskStatus, title: 'Done', color: 'bg-green-100' },
];

export function KanbanBoard({ projectId }: Props) {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  // PROMPT #95 - Modification approval modal state
  const [selectedBlockedTask, setSelectedBlockedTask] = useState<Task | null>(null);
  const [isApprovalModalOpen, setIsApprovalModalOpen] = useState(false);

  // PROMPT #97 - Item detail panel state (unified modal for all tasks)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  // Configure sensors for drag-and-drop
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px of movement required before drag starts
      },
    })
  );

  useEffect(() => {
    loadBoard();
  }, [projectId]);

  const loadBoard = async () => {
    setLoading(true);
    setError(null);
    try {
      // Load regular kanban data
      const response = await tasksApi.kanban(projectId);
      const data = response.data || response;

      // PROMPT #95 - Load blocked tasks separately
      const blockedResponse = await tasksApi.getBlocked(projectId);
      const blockedTasks = Array.isArray(blockedResponse) ? blockedResponse : blockedResponse.data || [];

      // Merge blocked tasks into board data
      const boardData = data && typeof data === 'object' ? data : null;
      if (boardData) {
        boardData.blocked = blockedTasks;
      }

      setBoard(boardData);
    } catch (err: any) {
      console.error('Failed to load board:', err);
      setError(err.response?.data?.detail || 'Failed to load board');
      setBoard(null); // Reset on error
    } finally {
      setLoading(false);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const taskId = active.id as string;

    // Find the task being dragged
    if (board) {
      for (const column of COLUMNS) {
        const task = board[column.id].find((t) => t.id === taskId);
        if (task) {
          setActiveTask(task);
          break;
        }
      }
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || !board) return;

    const taskId = active.id as string;
    const overId = over.id as string;

    // Find source column
    let sourceColumn: TaskStatus | null = null;
    for (const column of COLUMNS) {
      if (board[column.id].find((t) => t.id === taskId)) {
        sourceColumn = column.id;
        break;
      }
    }

    // Determine target column
    let targetColumn: TaskStatus | null = null;
    if (COLUMNS.some((col) => col.id === overId)) {
      // Dropped on column
      targetColumn = overId as TaskStatus;
    } else {
      // Dropped on task - find its column
      for (const column of COLUMNS) {
        if (board[column.id].find((t) => t.id === overId)) {
          targetColumn = column.id;
          break;
        }
      }
    }

    if (!sourceColumn || !targetColumn || sourceColumn === targetColumn) return;

    // Optimistic update - move task between columns
    setBoard((prev) => {
      if (!prev) return prev;

      const newBoard = { ...prev };
      const sourceList = [...newBoard[sourceColumn]];
      const targetList = [...newBoard[targetColumn]];

      const taskIndex = sourceList.findIndex((t) => t.id === taskId);
      if (taskIndex === -1) return prev;

      const [movedTask] = sourceList.splice(taskIndex, 1);
      targetList.push(movedTask);

      newBoard[sourceColumn] = sourceList;
      newBoard[targetColumn] = targetList;

      return newBoard;
    });
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTask(null);

    if (!over || !board) return;

    const taskId = active.id as string;
    const overId = over.id as string;

    // Find target column
    let targetColumn: TaskStatus | null = null;
    if (COLUMNS.some((col) => col.id === overId)) {
      targetColumn = overId as TaskStatus;
    } else {
      for (const column of COLUMNS) {
        if (board[column.id].find((t) => t.id === overId)) {
          targetColumn = column.id;
          break;
        }
      }
    }

    if (!targetColumn) {
      await loadBoard(); // Revert on invalid drop
      return;
    }

    // Find source column
    let sourceColumn: TaskStatus | null = null;
    for (const column of COLUMNS) {
      if (board[column.id].find((t) => t.id === taskId)) {
        sourceColumn = column.id;
        break;
      }
    }

    if (!sourceColumn || sourceColumn === targetColumn) return;

    // Call API to persist the move
    try {
      await tasksApi.move(taskId, {
        new_status: targetColumn,
        new_order: 0,
      });
    } catch (error) {
      console.error('Failed to move task:', error);
      alert('Failed to move task');
      await loadBoard(); // Reload to revert UI
    }
  };

  const handleTaskCreated = async () => {
    setIsCreateOpen(false);
    await loadBoard();
  };

  const handleTaskDeleted = async () => {
    await loadBoard();
  };

  const handleTaskUpdated = async () => {
    await loadBoard();
  };

  // PROMPT #97 - Regular task click handler (opens unified modal)
  const handleTaskClick = (task: Task) => {
    setSelectedTask(task);
  };

  // PROMPT #95 - Blocked task handlers
  const handleBlockedTaskClick = (task: Task) => {
    setSelectedBlockedTask(task);
    setIsApprovalModalOpen(true);
  };

  const handleApproveModification = async () => {
    if (!selectedBlockedTask) return;

    try {
      await tasksApi.approveModification(selectedBlockedTask.id);
      setIsApprovalModalOpen(false);
      setSelectedBlockedTask(null);
      await loadBoard(); // Reload to show new task
    } catch (error) {
      console.error('Failed to approve modification:', error);
      alert('Failed to approve modification. Please try again.');
    }
  };

  const handleRejectModification = async (reason?: string) => {
    if (!selectedBlockedTask) return;

    try {
      await tasksApi.rejectModification(selectedBlockedTask.id, reason);
      setIsApprovalModalOpen(false);
      setSelectedBlockedTask(null);
      await loadBoard(); // Reload to show unblocked task
    } catch (error) {
      console.error('Failed to reject modification:', error);
      alert('Failed to reject modification. Please try again.');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="text-gray-600">Loading board...</p>
        </div>
      </div>
    );
  }

  if (error && !board) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <div className="text-red-500 text-center">
          <svg className="w-12 h-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
        <Button onClick={loadBoard} variant="primary">
          Retry
        </Button>
      </div>
    );
  }

  if (!board) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-gray-500">No tasks found</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Kanban Board</h2>
          <p className="text-sm text-gray-500 mt-1">
            Drag and drop tasks to move them between columns
          </p>
        </div>

        <Button
          variant="primary"
          onClick={() => setIsCreateOpen(true)}
          leftIcon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          }
        >
          Add Task
        </Button>
      </div>

      {/* Board with Drag-and-Drop */}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4">
          {COLUMNS.map((column) => (
            <DroppableColumn
              key={column.id}
              columnId={column.id}
              title={column.title}
              color={column.color}
              tasks={board[column.id] || []}
              onTaskDeleted={handleTaskDeleted}
              onTaskUpdated={handleTaskUpdated}
              onTaskClick={column.id !== 'blocked' ? handleTaskClick : undefined} // PROMPT #97 - Regular tasks
              onBlockedTaskClick={column.id === 'blocked' ? handleBlockedTaskClick : undefined} // PROMPT #95 - Blocked tasks
            />
          ))}
        </div>

        {/* Drag Overlay - shows dragged task */}
        <DragOverlay>
          {activeTask ? (
            <div className="opacity-90">
              <TaskCard
                task={activeTask}
                onUpdate={() => {}}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Create Task Dialog */}
      <Dialog
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Create New Task"
        description="Add a new task to your Kanban board"
      >
        <TaskForm
          projectId={projectId}
          onSuccess={handleTaskCreated}
          onCancel={() => setIsCreateOpen(false)}
        />
      </Dialog>

      {/* PROMPT #95 - Modification Approval Modal */}
      {selectedBlockedTask && (
        <ModificationApprovalModal
          task={selectedBlockedTask}
          isOpen={isApprovalModalOpen}
          onClose={() => setIsApprovalModalOpen(false)}
          onApprove={handleApproveModification}
          onReject={handleRejectModification}
        />
      )}

      {/* PROMPT #97 - Unified Item Detail Panel */}
      {selectedTask && (
        <ItemDetailPanel
          item={selectedTask}
          onClose={() => setSelectedTask(null)}
          onUpdate={handleTaskUpdated}
          onNavigateToItem={(item) => setSelectedTask(item as Task)}
        />
      )}
    </div>
  );
}

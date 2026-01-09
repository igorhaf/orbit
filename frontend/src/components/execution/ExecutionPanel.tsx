/**
 * ExecutionPanel Component
 * Real-time task execution panel with WebSocket updates
 */

'use client';

import { useState, useEffect } from 'react';
import { Task } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, Button, Badge } from '@/components/ui';
import { ProgressBar } from './ProgressBar';
import { LiveLogs } from './LiveLogs';
import { CostMetrics } from './CostMetrics';
import { useWebSocket } from '@/hooks/useWebSocket';

interface TaskWithStatus extends Task {
  cost?: number;
  execution_time?: number;
}

interface Props {
  projectId: string;
  initialTasks: Task[];
  executing: boolean;
  onExecute: () => void;
}

export function ExecutionPanel({
  projectId,
  initialTasks,
  executing,
  onExecute,
}: Props) {
  const [tasks, setTasks] = useState<TaskWithStatus[]>(initialTasks || []);
  const [logs, setLogs] = useState<string[]>([]);
  const [totalCost, setTotalCost] = useState(0);
  const [completedTasks, setCompletedTasks] = useState(0);
  const [isExecuting, setIsExecuting] = useState(executing || false);

  const { connected, subscribe } = useWebSocket(projectId);

  useEffect(() => {
    // Subscribe to WebSocket events
    if (!connected) return;

    const unsubscribers = [
      subscribe('task_started', handleTaskStarted),
      subscribe('task_completed', handleTaskCompleted),
      subscribe('task_failed', handleTaskFailed),
      subscribe('batch_completed', handleBatchCompleted),
    ];

    return () => {
      unsubscribers.forEach((unsub) => unsub());
    };
  }, [connected]);

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, `[${timestamp}] ${message}`]);
  };

  const handleTaskStarted = (data: any) => {
    addLog(`⚙️  Executing: ${data.task_title} (${data.model})`);

    setTasks((prev) =>
      prev.map((task) =>
        task.id === data.task_id
          ? { ...task, status: 'in_progress' as any }
          : task
      )
    );
  };

  const handleTaskCompleted = (data: any) => {
    addLog(
      `✅ Completed: ${data.task_title} ($${data.cost?.toFixed(4) || '0.0000'}, ${data.execution_time?.toFixed(1) || '0.0'}s)`
    );

    setTasks((prev) =>
      prev.map((task) =>
        task.id === data.task_id
          ? {
              ...task,
              status: 'done' as any,
              cost: data.cost,
              execution_time: data.execution_time,
            }
          : task
      )
    );

    setTotalCost((prev) => prev + (data.cost || 0));
    setCompletedTasks((prev) => prev + 1);
  };

  const handleTaskFailed = (data: any) => {
    addLog(`❌ Failed: ${data.task_title}`);

    setTasks((prev) =>
      prev.map((task) =>
        task.id === data.task_id ? { ...task, status: 'done' as any } : task
      )
    );
  };

  const handleBatchCompleted = (data: any) => {
    addLog(
      `✅ Batch completed! ${data.completed}/${data.total_tasks} tasks succeeded (Total: $${data.total_cost?.toFixed(4) || '0.0000'})`
    );
    setIsExecuting(false);
  };

  const handleExecuteClick = () => {
    setIsExecuting(true);
    addLog('🚀 Starting task execution...');
    onExecute();
  };

  const progress = tasks.length > 0 ? (completedTasks / tasks.length) * 100 : 0;
  const estimatedCost = tasks.length * 0.017;

  return (
    <div className="space-y-6">
      {/* Header with Execute Button */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Task Execution</CardTitle>
            <p className="text-sm text-gray-600 mt-1">
              {isExecuting
                ? 'Executing tasks in real-time...'
                : 'Ready to execute tasks'}
            </p>
          </div>
          <Button
            onClick={handleExecuteClick}
            disabled={isExecuting || tasks.length === 0}
            variant="primary"
            size="lg"
          >
            <svg
              className="w-5 h-5 mr-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d={
                  isExecuting
                    ? 'M21 12a9 9 0 11-18 0 9 9 0 0118 0z M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z'
                    : 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                }
              />
            </svg>
            {isExecuting ? 'Executing...' : 'Start Execution'}
          </Button>
        </CardHeader>
        <CardContent>
          <ProgressBar
            completed={completedTasks}
            total={tasks.length}
            percentage={progress}
          />
        </CardContent>
      </Card>

      {/* Metrics */}
      <CostMetrics
        totalCost={totalCost}
        estimatedCost={estimatedCost}
        completedTasks={completedTasks}
        totalTasks={tasks.length}
      />

      {/* Tasks Status */}
      <Card>
        <CardHeader>
          <CardTitle>Tasks ({tasks.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {tasks.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p>No tasks available for execution</p>
              <p className="text-sm mt-2">Create tasks to get started</p>
            </div>
          ) : (
            <div className="space-y-3">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className={`flex items-center justify-between p-3 rounded border transition-colors ${
                    task.status === 'in_progress'
                      ? 'border-blue-500 bg-blue-50'
                      : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <StatusBadge status={task.status} />
                    <div>
                      <div className="font-medium">{task.title}</div>
                      {task.description && (
                        <div className="text-sm text-gray-600">
                          {task.description}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="text-right text-sm">
                    {task.cost !== undefined && (
                      <div className="font-semibold">
                        ${task.cost.toFixed(4)}
                        {task.execution_time && (
                          <span className="text-gray-600 ml-2">
                            ({task.execution_time.toFixed(1)}s)
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Live Logs */}
      <LiveLogs logs={logs} />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles = {
    backlog: 'bg-gray-200 text-gray-700',
    todo: 'bg-gray-300 text-gray-800',
    in_progress: 'bg-blue-500 text-white animate-pulse',
    review: 'bg-purple-500 text-white',
    done: 'bg-green-500 text-white',
  };

  const icons = {
    backlog: '⏳',
    todo: '📋',
    in_progress: '⚙️',
    review: '👀',
    done: '✅',
  };

  return (
    <Badge
      variant={status === 'done' ? 'success' : status === 'in_progress' ? 'info' : 'default'}
      className="min-w-[100px] justify-center"
    >
      {icons[status as keyof typeof icons]} {status.replace('_', ' ').toUpperCase()}
    </Badge>
  );
}

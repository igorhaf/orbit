/**
 * TaskExecutionPanel Component
 * Real-time visualization of task execution with WebSocket updates
 */

import React, { useState, useEffect, useRef } from 'react';
import { clsx } from 'clsx';
import { Card, Button } from '@/components/ui';
import { TaskStatusBadge, TaskStatus } from './TaskStatusBadge';
import { useWebSocket } from '@/hooks/useWebSocket';
import { WebSocketMessage } from '@/lib/websocket';

interface TaskExecutionPanelProps {
  projectId: string;
  tasks: Array<{
    id: string;
    title: string;
    type: string;
  }>;
  onExecuteAll?: () => void;
  onStop?: () => void;
  className?: string;
}

interface TaskExecutionState {
  id: string;
  title: string;
  type: string;
  status: TaskStatus;
  model?: string;
  cost?: number;
  executionTime?: number;
  attempts?: number;
  issues?: string[];
}

interface ExecutionMetrics {
  totalTasks: number;
  completed: number;
  failed: number;
  totalCost: number;
  totalTime: number;
  progress: number;
}

export const TaskExecutionPanel: React.FC<TaskExecutionPanelProps> = ({
  projectId,
  tasks,
  onExecuteAll,
  onStop,
  className
}) => {
  const { messages, isConnected } = useWebSocket({
    projectId,
    autoConnect: true,
  });

  const [taskStates, setTaskStates] = useState<Map<string, TaskExecutionState>>(
    new Map(tasks.map(task => [
      task.id,
      {
        id: task.id,
        title: task.title,
        type: task.type,
        status: 'pending' as TaskStatus,
      }
    ]))
  );

  const [metrics, setMetrics] = useState<ExecutionMetrics>({
    totalTasks: tasks.length,
    completed: 0,
    failed: 0,
    totalCost: 0,
    totalTime: 0,
    progress: 0,
  });

  const [logs, setLogs] = useState<string[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs to bottom
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Process WebSocket messages
  useEffect(() => {
    if (messages.length === 0) return;

    const lastMessage = messages[messages.length - 1];
    processMessage(lastMessage);
  }, [messages]);

  const processMessage = (message: WebSocketMessage) => {
    const { event, data, timestamp } = message;
    const time = new Date(timestamp).toLocaleTimeString();

    switch (event) {
      case 'batch_started':
        setIsExecuting(true);
        addLog(`[${time}] 🚀 Batch execution started: ${data.total_tasks} tasks`);
        setMetrics(prev => ({
          ...prev,
          totalTasks: data.total_tasks,
          completed: 0,
          failed: 0,
          totalCost: 0,
          totalTime: 0,
          progress: 0,
        }));
        break;

      case 'task_started':
        addLog(`[${time}] ▶️  Task started: ${data.task_title} (${data.model})`);
        setTaskStates(prev => {
          const newMap = new Map(prev);
          const task = newMap.get(data.task_id);
          if (task) {
            newMap.set(data.task_id, {
              ...task,
              status: 'in_progress',
              model: data.model,
            });
          }
          return newMap;
        });
        break;

      case 'task_completed':
        addLog(
          `[${time}] ✅ Task completed: ${data.task_title} ` +
          `($${data.cost.toFixed(4)}, ${data.execution_time.toFixed(2)}s)`
        );
        setTaskStates(prev => {
          const newMap = new Map(prev);
          const task = newMap.get(data.task_id);
          if (task) {
            newMap.set(data.task_id, {
              ...task,
              status: 'completed',
              cost: data.cost,
              executionTime: data.execution_time,
              attempts: data.attempts,
            });
          }
          return newMap;
        });
        break;

      case 'task_failed':
        addLog(
          `[${time}] ❌ Task failed: ${data.task_title} ` +
          `(${data.attempts} attempts, $${data.cost.toFixed(4)})`
        );
        if (data.issues?.length > 0) {
          data.issues.forEach((issue: string) => {
            addLog(`   └─ ${issue}`);
          });
        }
        setTaskStates(prev => {
          const newMap = new Map(prev);
          const task = newMap.get(data.task_id);
          if (task) {
            newMap.set(data.task_id, {
              ...task,
              status: 'failed',
              attempts: data.attempts,
              issues: data.issues,
            });
          }
          return newMap;
        });
        break;

      case 'validation_failed':
        addLog(
          `[${time}] ⚠️  Validation failed for task (attempt ${data.attempt}/${data.max_attempts})`
        );
        if (data.issues?.length > 0) {
          data.issues.forEach((issue: string) => {
            addLog(`   └─ ${issue}`);
          });
        }
        setTaskStates(prev => {
          const newMap = new Map(prev);
          const task = newMap.get(data.task_id);
          if (task) {
            newMap.set(data.task_id, {
              ...task,
              status: 'validating',
            });
          }
          return newMap;
        });
        break;

      case 'batch_progress':
        setMetrics(prev => ({
          ...prev,
          completed: data.completed,
          progress: data.percentage,
          totalCost: data.total_cost,
        }));
        addLog(
          `[${time}] 📊 Progress: ${data.completed}/${data.total} ` +
          `(${data.percentage.toFixed(1)}%) - Total cost: $${data.total_cost.toFixed(4)}`
        );
        break;

      case 'batch_completed':
        setIsExecuting(false);
        addLog(
          `[${time}] 🎉 Batch execution completed!\n` +
          `   ├─ Total: ${data.total_tasks} tasks\n` +
          `   ├─ Completed: ${data.completed}\n` +
          `   ├─ Failed: ${data.failed}\n` +
          `   └─ Total cost: $${data.total_cost.toFixed(4)}`
        );
        setMetrics(prev => ({
          ...prev,
          completed: data.completed,
          failed: data.failed,
          totalCost: data.total_cost,
          progress: 100,
        }));
        break;
    }
  };

  const addLog = (message: string) => {
    setLogs(prev => [...prev, message]);
  };

  const handleExecuteAll = () => {
    if (onExecuteAll) {
      // Clear previous logs
      setLogs([]);
      // Reset task states
      setTaskStates(new Map(tasks.map(task => [
        task.id,
        {
          id: task.id,
          title: task.title,
          type: task.type,
          status: 'pending' as TaskStatus,
        }
      ])));
      onExecuteAll();
    }
  };

  const successRate = metrics.totalTasks > 0
    ? ((metrics.completed / metrics.totalTasks) * 100).toFixed(1)
    : '0.0';

  return (
    <div className={clsx('space-y-4', className)}>
      {/* Connection Status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className={clsx(
              'w-2 h-2 rounded-full',
              isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'
            )}
          />
          <span className="text-sm text-gray-600">
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleExecuteAll}
            disabled={isExecuting || !onExecuteAll}
            variant="primary"
            size="sm"
          >
            {isExecuting ? '⏳ Executing...' : '▶️ Execute All'}
          </Button>
          <Button
            onClick={onStop}
            disabled={!isExecuting || !onStop}
            variant="danger"
            size="sm"
          >
            ⏹️ Stop
          </Button>
        </div>
      </div>

      {/* Progress Bar */}
      <Card>
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">
              Execution Progress
            </span>
            <span className="text-sm font-bold text-gray-900">
              {metrics.progress.toFixed(1)}%
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
            <div
              className={clsx(
                'h-3 rounded-full transition-all duration-500 ease-out',
                metrics.progress === 100
                  ? 'bg-green-500'
                  : 'bg-blue-500',
                isExecuting && 'animate-pulse'
              )}
              style={{ width: `${metrics.progress}%` }}
            />
          </div>
        </div>
      </Card>

      {/* Metrics */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <div className="p-4 text-center">
            <div className="text-2xl font-bold text-gray-900">
              {metrics.totalTasks}
            </div>
            <div className="text-xs text-gray-500 uppercase">Total Tasks</div>
          </div>
        </Card>
        <Card>
          <div className="p-4 text-center">
            <div className="text-2xl font-bold text-green-600">
              {metrics.completed}
            </div>
            <div className="text-xs text-gray-500 uppercase">Completed</div>
          </div>
        </Card>
        <Card>
          <div className="p-4 text-center">
            <div className="text-2xl font-bold text-blue-600">
              ${metrics.totalCost.toFixed(4)}
            </div>
            <div className="text-xs text-gray-500 uppercase">Total Cost</div>
          </div>
        </Card>
        <Card>
          <div className="p-4 text-center">
            <div className="text-2xl font-bold text-purple-600">
              {successRate}%
            </div>
            <div className="text-xs text-gray-500 uppercase">Success Rate</div>
          </div>
        </Card>
      </div>

      {/* Task List */}
      <Card>
        <div className="p-4">
          <h3 className="text-lg font-semibold mb-3">Tasks</h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {Array.from(taskStates.values()).map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="flex-1">
                  <div className="font-medium text-gray-900">{task.title}</div>
                  <div className="text-sm text-gray-500">
                    {task.type}
                    {task.model && ` • ${task.model}`}
                    {task.cost && ` • $${task.cost.toFixed(4)}`}
                    {task.executionTime && ` • ${task.executionTime.toFixed(2)}s`}
                  </div>
                </div>
                <TaskStatusBadge status={task.status} />
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Execution Logs */}
      <Card>
        <div className="p-4">
          <h3 className="text-lg font-semibold mb-3">Execution Logs</h3>
          <div className="bg-gray-900 text-green-400 font-mono text-xs p-4 rounded-lg h-64 overflow-y-auto">
            {logs.length === 0 ? (
              <div className="text-gray-500">No logs yet. Start execution to see live updates.</div>
            ) : (
              <>
                {logs.map((log, index) => (
                  <div key={index} className="whitespace-pre-wrap">
                    {log}
                  </div>
                ))}
                <div ref={logsEndRef} />
              </>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
};

/**
 * Task Execution Page
 * Real-time task execution with WebSocket updates
 */

'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Layout, Breadcrumbs } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { ExecutionPanel } from '@/components/execution/ExecutionPanel';
import { tasksApi } from '@/lib/api';
import { Task } from '@/lib/types';

export default function ExecutePage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);

  useEffect(() => {
    loadTasks();
  }, [projectId]);

  const loadTasks = async () => {
    try {
      const response = await tasksApi.list({ project_id: projectId });
      const data = response.data || response;
      setTasks(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load tasks:', error);
      setTasks([]); // Reset to empty array on error
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async () => {
    setExecuting(true);
    // WebSocket will handle real-time updates
    // The execution is triggered by the ExecutionPanel component
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <Breadcrumbs />
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href={`/projects/${projectId}`}>
            <Button variant="outline" size="sm">
              <svg
                className="w-4 h-4 mr-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 19l-7-7m0 0l7-7m-7 7h18"
                />
              </svg>
              Back to Project
            </Button>
          </Link>
          <h1 className="text-3xl font-bold text-gray-900">Execute Tasks</h1>
        </div>

        <ExecutionPanel
          projectId={projectId}
          initialTasks={tasks}
          executing={executing}
          onExecute={handleExecute}
        />
      </div>
    </Layout>
  );
}

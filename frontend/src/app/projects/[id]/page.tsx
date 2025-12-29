/**
 * Project Details Page
 * Shows project overview, Kanban board, tasks list, and actions
 */

'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Layout, Breadcrumbs } from '@/components/layout';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '@/components/ui';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';
import { projectsApi, tasksApi } from '@/lib/api';
import { Project, Task } from '@/lib/types';

type Tab = 'kanban' | 'list' | 'overview';

export default function ProjectDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('kanban');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProjectData();
  }, [projectId]);

  const loadProjectData = async () => {
    console.log('📋 Loading project data for ID:', projectId);
    try {
      const [projectRes, tasksRes] = await Promise.all([
        projectsApi.get(projectId),
        tasksApi.list({ project_id: projectId }),
      ]);

      console.log('✅ Project response:', projectRes);
      console.log('✅ Tasks response:', tasksRes);

      // Handle both response formats (direct data or wrapped in .data)
      const projectData = projectRes.data || projectRes;
      const tasksData = tasksRes.data || tasksRes;

      setProject(projectData);
      setTasks(Array.isArray(tasksData) ? tasksData : []);
    } catch (error) {
      console.error('❌ Failed to load project:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleTasksUpdate = () => {
    loadProjectData();
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

  if (!project) {
    return (
      <Layout>
        <div className="text-center py-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Project Not Found
          </h2>
          <p className="text-gray-600 mb-4">
            The project you're looking for doesn't exist.
          </p>
          <Link href="/projects">
            <Button variant="primary">Back to Projects</Button>
          </Link>
        </div>
      </Layout>
    );
  }

  const tasksByStatus = {
    backlog: tasks.filter((t) => t.status === 'backlog'),
    todo: tasks.filter((t) => t.status === 'todo'),
    in_progress: tasks.filter((t) => t.status === 'in_progress'),
    review: tasks.filter((t) => t.status === 'review'),
    done: tasks.filter((t) => t.status === 'done'),
  };

  return (
    <Layout>
      <Breadcrumbs />
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Link href="/projects">
                <Button variant="ghost" size="sm">
                  ← Back
                </Button>
              </Link>
            </div>
            <h1 className="text-3xl font-bold text-gray-900">{project.name}</h1>
            {project.description && (
              <p className="mt-2 text-gray-600">{project.description}</p>
            )}
          </div>

          <div className="flex gap-2">
            <Link href={`/projects/${projectId}/analyze`}>
              <Button variant="outline">
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
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                Upload Project
              </Button>
            </Link>

            <Link href={`/projects/${projectId}/consistency`}>
              <Button variant="outline">
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
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Consistency
              </Button>
            </Link>

            <Link href={`/projects/${projectId}/execute`}>
              <Button variant="primary">
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
                    d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Execute All
              </Button>
            </Link>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            {[
              { id: 'kanban', label: 'Kanban Board' },
              { id: 'list', label: 'Tasks List' },
              { id: 'overview', label: 'Overview' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as Tab)}
                className={`
                  pb-4 px-1 border-b-2 font-medium text-sm
                  ${
                    activeTab === tab.id
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }
                `}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        {activeTab === 'kanban' && (
          <div>
            <KanbanBoard projectId={projectId} />
          </div>
        )}

        {activeTab === 'list' && (
          <Card>
            <CardHeader>
              <CardTitle>All Tasks ({tasks.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {tasks.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-gray-500">No tasks yet</p>
                  <p className="text-sm text-gray-400 mt-1">
                    Create an interview or add tasks manually
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {tasks.map((task) => (
                    <div
                      key={task.id}
                      className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h3 className="font-semibold text-gray-900">
                            {task.title}
                          </h3>
                          {task.description && (
                            <p className="mt-1 text-sm text-gray-600">
                              {task.description}
                            </p>
                          )}
                        </div>
                        <Badge
                          variant={
                            task.status === 'done'
                              ? 'success'
                              : task.status === 'in_progress'
                              ? 'info'
                              : 'default'
                          }
                        >
                          {task.status.replace('_', ' ')}
                        </Badge>
                      </div>
                      <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
                        <span>Column: {task.column}</span>
                        <span>Order: {task.order}</span>
                        <span>
                          Created: {new Date(task.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Statistics */}
            <Card>
              <CardHeader>
                <CardTitle>Statistics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm text-gray-500">Total Tasks</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {tasks.length}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Completed</p>
                  <p className="text-2xl font-bold text-green-600">
                    {tasksByStatus.done.length}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">In Progress</p>
                  <p className="text-2xl font-bold text-blue-600">
                    {tasksByStatus.in_progress.length}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Pending</p>
                  <p className="text-2xl font-bold text-gray-600">
                    {tasksByStatus.todo.length + tasksByStatus.backlog.length}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Progress */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Progress by Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {Object.entries(tasksByStatus).map(([status, statusTasks]) => {
                  const percentage = tasks.length
                    ? (statusTasks.length / tasks.length) * 100
                    : 0;

                  return (
                    <div key={status}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium text-gray-700 capitalize">
                          {status.replace('_', ' ')}
                        </span>
                        <span className="text-gray-500">
                          {statusTasks.length} ({percentage.toFixed(0)}%)
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${
                            status === 'done'
                              ? 'bg-green-500'
                              : status === 'in_progress'
                              ? 'bg-blue-500'
                              : status === 'review'
                              ? 'bg-purple-500'
                              : 'bg-gray-400'
                          }`}
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </Layout>
  );
}

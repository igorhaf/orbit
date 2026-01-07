/**
 * Dashboard / Home Page
 * Main landing page with statistics and recent activity
 */

'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Layout } from '@/components/layout';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '@/components/ui';
import { projectsApi, tasksApi, commitsApi } from '@/lib/api';
import { Project, Task, CommitStatistics } from '@/lib/types';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [commitStats, setCommitStats] = useState<CommitStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    try {
      console.log('🔍 Loading dashboard data...');

      const [projectsRes, tasksRes, allTasksRes, commitsRes] = await Promise.all([
        projectsApi.list({ limit: 5 }),
        tasksApi.list({ limit: 5 }),
        tasksApi.list(), // Get all tasks for statistics
        commitsApi.statistics(),
      ]);

      console.log('✅ Dashboard data loaded');
      setProjects(projectsRes.data || projectsRes);
      setTasks(tasksRes.data || tasksRes);
      setAllTasks(Array.isArray(allTasksRes.data || allTasksRes) ? (allTasksRes.data || allTasksRes) : []);
      setCommitStats(commitsRes.data || commitsRes);
    } catch (err: any) {
      console.error('❌ Failed to load dashboard:', err);
      setError(err.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  // Mostrar erro se API falhar
  if (error) {
    return (
      <Layout>
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <svg
                className="w-8 h-8 text-red-600 flex-shrink-0 mt-1"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-red-900 mb-2">
                  Failed to Connect to Backend
                </h3>
                <p className="text-red-700 mb-4">{error}</p>

                <div className="bg-red-100 border border-red-200 rounded p-4 mb-4">
                  <p className="font-semibold text-red-900 mb-2">
                    Quick Fix Checklist:
                  </p>
                  <ol className="list-decimal list-inside space-y-2 text-sm text-red-800">
                    <li>
                      <strong>Backend running?</strong>
                      <code className="block ml-6 mt-1 bg-red-200 px-2 py-1 rounded text-xs">
                        cd backend && uvicorn app.main:app --reload
                      </code>
                    </li>
                    <li>
                      <strong>Correct API URL?</strong>
                      <span className="block ml-6 text-xs">
                        Check <code>frontend/.env.local</code> has{' '}
                        <code>NEXT_PUBLIC_API_URL=http://localhost:8000</code>
                      </span>
                    </li>
                    <li>
                      <strong>CORS configured?</strong>
                      <span className="block ml-6 text-xs">
                        Backend must allow origin <code>http://localhost:3000</code>
                      </span>
                    </li>
                  </ol>
                </div>

                <div className="flex gap-2">
                  <Button onClick={fetchData} variant="outline">
                    Retry Connection
                  </Button>
                  <Link href="/debug">
                    <Button variant="primary">
                      Open Debug Console
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </Layout>
    );
  }

  if (loading) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
          <p className="text-gray-600">Loading dashboard...</p>
        </div>
      </Layout>
    );
  }

  // Calculate task statistics for pie chart
  const taskStats = {
    backlog: allTasks.filter(t => t.status === 'backlog').length,
    todo: allTasks.filter(t => t.status === 'todo').length,
    in_progress: allTasks.filter(t => t.status === 'in_progress').length,
    review: allTasks.filter(t => t.status === 'review').length,
    done: allTasks.filter(t => t.status === 'done').length,
  };

  const pieData = [
    { name: 'Backlog', value: taskStats.backlog, color: '#6B7280' },
    { name: 'To Do', value: taskStats.todo, color: '#3B82F6' },
    { name: 'In Progress', value: taskStats.in_progress, color: '#F59E0B' },
    { name: 'Review', value: taskStats.review, color: '#8B5CF6' },
    { name: 'Done', value: taskStats.done, color: '#10B981' },
  ].filter(item => item.value > 0); // Only show segments with data

  const totalTasks = allTasks.length;

  return (
    <Layout>
      <div className="space-y-6">
        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Link href="/projects">
                <Button variant="outline" className="w-full justify-start">
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
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                  New Project
                </Button>
              </Link>
              <Link href="/ai-models">
                <Button variant="outline" className="w-full justify-start">
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
                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                    />
                  </svg>
                  Configure AI Models
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Task Statistics - Pie Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Task Distribution Across All Projects</CardTitle>
          </CardHeader>
          <CardContent>
            {totalTasks === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-500">No tasks available</p>
                <p className="text-sm text-gray-400 mt-1">
                  Create an interview or add tasks to see statistics
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Pie Chart */}
                <div className="flex items-center justify-center">
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                        outerRadius={100}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                {/* Statistics Summary */}
                <div className="flex flex-col justify-center space-y-4">
                  <div className="space-y-3">
                    {pieData.map((item) => (
                      <div key={item.name} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-4 h-4 rounded-full"
                            style={{ backgroundColor: item.color }}
                          />
                          <span className="font-medium text-gray-700">{item.name}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-2xl font-bold text-gray-900">{item.value}</span>
                          <span className="text-sm text-gray-500">
                            ({((item.value / totalTasks) * 100).toFixed(1)}%)
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="pt-4 border-t border-gray-200">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-semibold text-gray-700">Total Tasks</span>
                      <span className="text-3xl font-bold text-blue-600">{totalTasks}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Projects and Tasks */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Projects */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Recent Projects</CardTitle>
                <Link href="/projects">
                  <Button variant="ghost" size="sm">
                    View All
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {projects.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500">No projects yet</p>
                  <Link href="/projects">
                    <Button variant="primary" size="sm" className="mt-4">
                      Create Project
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  {projects.map((project) => (
                    <Link
                      key={project.id}
                      href={`/projects/${project.id}`}
                      className="block p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <h4 className="font-medium text-gray-900">{project.name}</h4>
                      {project.description && (
                        <p className="mt-1 text-sm text-gray-500 line-clamp-2">
                          {project.description}
                        </p>
                      )}
                      <p className="mt-2 text-xs text-gray-400">
                        {new Date(project.created_at).toLocaleDateString()}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Tasks */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Tasks</CardTitle>
            </CardHeader>
            <CardContent>
              {tasks.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500">No tasks yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {tasks.map((task) => (
                    <div
                      key={task.id}
                      className="p-4 border border-gray-200 rounded-lg"
                    >
                      <div className="flex items-start justify-between">
                        <h4 className="font-medium text-gray-900">{task.title}</h4>
                        <Badge
                          variant={
                            task.status === 'done'
                              ? 'success'
                              : task.status === 'in_progress'
                              ? 'info'
                              : 'default'
                          }
                          size="sm"
                        >
                          {task.status.replace('_', ' ')}
                        </Badge>
                      </div>
                      {task.description && (
                        <p className="mt-1 text-sm text-gray-500 line-clamp-1">
                          {task.description}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}

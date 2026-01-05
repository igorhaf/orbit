/**
 * Project Details Page
 * Shows project overview, Kanban board, tasks list, and actions
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import { Layout, Breadcrumbs } from '@/components/layout';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '@/components/ui';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';
import BacklogListView from '@/components/backlog/BacklogListView';
import { InterviewList } from '@/components/interview';
import { projectsApi, tasksApi, interviewsApi } from '@/lib/api';
import { Project, Task } from '@/lib/types';

type Tab = 'kanban' | 'list' | 'overview' | 'interviews' | 'backlog';

export default function ProjectDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editedDescription, setEditedDescription] = useState('');
  const [isFormattingDescription, setIsFormattingDescription] = useState(false);

  const loadProjectData = useCallback(async () => {
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
  }, [projectId]);

  useEffect(() => {
    loadProjectData();
  }, [loadProjectData]);

  const handleTasksUpdate = () => {
    loadProjectData();
  };

  // Check if text is already in Markdown format
  const checkIfMarkdown = useCallback((text: string): boolean => {
    const markdownPatterns = [
      /^#{1,6}\s/m,           // Headers
      /\*\*.*\*\*/,            // Bold
      /\*.*\*/,                // Italic
      /\[.*\]\(.*\)/,          // Links
      /^[-*+]\s/m,             // Lists
      /^\d+\.\s/m,             // Numbered lists
      /```[\s\S]*```/,         // Code blocks
      /^>\s/m,                 // Blockquotes
    ];

    return markdownPatterns.some(pattern => pattern.test(text));
  }, []);

  // Format plain text to Markdown using AI
  const formatDescriptionToMarkdown = useCallback(async (text: string) => {
    console.log('🚀 Starting markdown formatting...');
    setIsFormattingDescription(true);
    try {
      const response = await fetch('/api/format-markdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (response.ok) {
        const data = await response.json();
        console.log('✅ Formatting successful, saving to database...');
        setEditedDescription(data.markdown);

        // Auto-save formatted description
        await projectsApi.update(projectId, {
          description: data.markdown,
        });

        console.log('✅ Saved to database, reloading project data...');
        // Reload project data
        await loadProjectData();
      } else {
        console.error('❌ Formatting API returned error:', response.status);
        // Fallback: use original text
        setEditedDescription(text);
      }
    } catch (error) {
      console.error('❌ Error formatting to Markdown:', error);
      setEditedDescription(text);
    } finally {
      setIsFormattingDescription(false);
    }
  }, [projectId, loadProjectData]);

  // Format description to Markdown if needed
  useEffect(() => {
    console.log('🔄 Format effect running...', {
      hasDescription: !!project?.description,
      isFormatting: isFormattingDescription,
      hasEdited: !!editedDescription,
      isEditing: isEditingDescription,
    });

    // Don't auto-format while user is manually editing
    if (project?.description && !isFormattingDescription && !editedDescription && !isEditingDescription) {
      const isMarkdown = checkIfMarkdown(project.description);
      console.log('🔍 Checking if description is Markdown:', isMarkdown);

      if (!isMarkdown) {
        console.log('📝 Description is plain text, formatting to Markdown...');
        formatDescriptionToMarkdown(project.description);
      } else {
        console.log('✅ Description is already Markdown');
        setEditedDescription(project.description);
      }
    }
  }, [project?.description, isFormattingDescription, editedDescription, isEditingDescription, checkIfMarkdown, formatDescriptionToMarkdown]);

  const handleEditDescription = () => {
    setEditedDescription(project?.description || '');
    setIsEditingDescription(true);
  };

  const handleSaveDescription = async () => {
    try {
      await projectsApi.update(projectId, {
        description: editedDescription,
      });

      setIsEditingDescription(false);
      // Reset editedDescription to allow auto-formatting to run again
      setEditedDescription('');
      await loadProjectData();
    } catch (error) {
      console.error('Error saving description:', error);
      alert('Failed to save description. Please try again.');
    }
  };

  const handleCancelEdit = () => {
    setEditedDescription(project?.description || '');
    setIsEditingDescription(false);
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
      {/* Breadcrumb */}
      <div className="mb-6">
        <Breadcrumbs />
      </div>

      <div className="space-y-6">
        {/* Header with action buttons on title line */}
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-gray-900">{project.name}</h1>

            {/* Stack Configuration Badges (PROMPT #46 - Phase 1) */}
            {(project.stack_backend || project.stack_database || project.stack_frontend || project.stack_css) && (
              <div className="mt-3 flex flex-wrap gap-2">
              {project.stack_backend && (
                <Badge variant="info">
                  <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
                  </svg>
                  Backend: {project.stack_backend}
                </Badge>
              )}
              {project.stack_database && (
                <Badge variant="info">
                  <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                  </svg>
                  Database: {project.stack_database}
                </Badge>
              )}
              {project.stack_frontend && (
                <Badge variant="info">
                  <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  Frontend: {project.stack_frontend}
                </Badge>
              )}
              {project.stack_css && (
                <Badge variant="info">
                  <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                  </svg>
                  CSS: {project.stack_css}
                </Badge>
              )}
            </div>
          )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-stretch gap-2 ml-6">
            <Link href={`/projects/${projectId}/analyze`}>
              <Button variant="outline" className="h-10">
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
              <Button variant="outline" className="h-10">
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
              <Button variant="primary" className="h-10">
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

            {/* New Interview button - only show on interviews tab */}
            {activeTab === 'interviews' && (
              <Button
                variant="primary"
                className="h-10"
                onClick={async () => {
                  try {
                    const response = await interviewsApi.create({
                      project_id: projectId,
                      ai_model_used: 'claude-3-sonnet',
                      conversation_data: [],
                    });
                    const interviewId = response.data?.id || response.id;
                    router.push(`/interviews/${interviewId}`);
                  } catch (error) {
                    console.error('Failed to create interview:', error);
                    alert('Failed to create interview. Please try again.');
                  }
                }}
              >
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
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                New Interview
              </Button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            {[
              { id: 'overview', label: 'Overview' },
              { id: 'backlog', label: 'Backlog' },
              { id: 'kanban', label: 'Kanban Board' },
              { id: 'list', label: 'Tasks List' },
              { id: 'interviews', label: 'Interviews' },
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
        {activeTab === 'backlog' && (
          <div>
            <BacklogListView projectId={projectId} />
          </div>
        )}

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

        {activeTab === 'interviews' && (
          <div>
            <InterviewList projectId={projectId} showHeader={false} showCreateButton={false} />
          </div>
        )}

        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Project Description - Full Width */}
            {project.description && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>Project Description</CardTitle>
                  <div className="flex gap-2">
                    {isFormattingDescription && (
                      <span className="text-xs text-gray-500 italic">Formatting to Markdown...</span>
                    )}
                    {!isEditingDescription ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleEditDescription}
                      >
                        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        Edit
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleCancelEdit}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={handleSaveDescription}
                        >
                          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Save
                        </Button>
                      </>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {isEditingDescription ? (
                    <textarea
                      value={editedDescription}
                      onChange={(e) => setEditedDescription(e.target.value)}
                      className="w-full min-h-[300px] p-4 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                      placeholder="Enter project description in Markdown format..."
                    />
                  ) : (
                    <div className="prose prose-sm max-w-none">
                      <ReactMarkdown>
                        {editedDescription || project.description}
                      </ReactMarkdown>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Statistics and Progress */}
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
          </div>
        )}
      </div>
    </Layout>
  );
}

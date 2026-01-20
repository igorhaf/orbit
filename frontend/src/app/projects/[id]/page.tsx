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
import { BacklogFilters, ItemDetailPanel } from '@/components/backlog';
import { InterviewList } from '@/components/interview';
import { RagStatsCard, RagUsageTypeTable, RagHitRatePieChart, CodeIndexingPanel } from '@/components/rag';
import { projectsApi, tasksApi, interviewsApi, ragApi } from '@/lib/api';
import { Project, Task, BacklogFilters as IBacklogFilters, BacklogItem, RagStats, CodeIndexingStats, BlockingAnalytics } from '@/lib/types';

type Tab = 'kanban' | 'overview' | 'interviews' | 'backlog' | 'rag' | 'analytics';

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

  // Backlog states
  const [backlogFilters, setBacklogFilters] = useState<IBacklogFilters>({});
  const [showBacklogFilters, setShowBacklogFilters] = useState(true);
  const [selectedBacklogItem, setSelectedBacklogItem] = useState<BacklogItem | null>(null);
  const [backlogRefreshKey, setBacklogRefreshKey] = useState(0);  // PROMPT #96 - Trigger backlog refresh

  // RAG states (PROMPT #90)
  const [ragStats, setRagStats] = useState<RagStats | null>(null);
  const [codeStats, setCodeStats] = useState<CodeIndexingStats | null>(null);
  const [loadingRag, setLoadingRag] = useState(false);

  // Analytics states (PROMPT #97)
  const [analyticsData, setAnalyticsData] = useState<BlockingAnalytics | null>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [analyticsDays, setAnalyticsDays] = useState<number>(30);

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
    // PROMPT #96 - Trigger backlog refresh to update selected item
    setBacklogRefreshKey(prev => prev + 1);
  };

  // Load RAG stats (PROMPT #90)
  const loadRagStats = useCallback(async () => {
    if (activeTab !== 'rag') return;

    setLoadingRag(true);
    try {
      const [rag, code] = await Promise.all([
        ragApi.stats(),
        ragApi.codeStats(projectId)
      ]);
      setRagStats(rag);
      setCodeStats(code);
    } catch (error) {
      console.error('Failed to load RAG stats:', error);
    } finally {
      setLoadingRag(false);
    }
  }, [projectId, activeTab]);

  // Load RAG stats when tab becomes active
  useEffect(() => {
    if (activeTab === 'rag') {
      loadRagStats();
    }
  }, [activeTab, loadRagStats]);

  // PROMPT #96 - Removed direct sync here, now handled by BacklogListView
  // via refreshKey and selectedItemId props

  // Load Analytics data (PROMPT #97)
  const loadAnalyticsData = useCallback(async () => {
    if (activeTab !== 'analytics') return;

    setLoadingAnalytics(true);
    try {
      const analytics = await tasksApi.getBlockingAnalytics(projectId, analyticsDays);
      setAnalyticsData(analytics.data || analytics);
    } catch (error) {
      console.error('Failed to load blocking analytics:', error);
    } finally {
      setLoadingAnalytics(false);
    }
  }, [projectId, activeTab, analyticsDays]);

  // Load Analytics when tab becomes active or days filter changes
  useEffect(() => {
    if (activeTab === 'analytics') {
      loadAnalyticsData();
    }
  }, [activeTab, loadAnalyticsData]);

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
            {/* PROMPT #90 - Show correct button based on context state */}
            {activeTab === 'interviews' && (
              <Button
                variant="primary"
                className="h-10"
                onClick={async () => {
                  try {
                    // PROMPT #90 - Backend auto-detects context vs meta_prompt based on context_locked
                    const response = await interviewsApi.create({
                      project_id: projectId,
                      ai_model_used: 'claude-3-sonnet',
                      conversation_data: [],
                      parent_task_id: null,  // PROMPT #97 - Null = context (if not locked) or meta_prompt (if locked)
                    });
                    const interviewId = response.data?.id || response.id;
                    router.push(`/projects/${projectId}/interviews/${interviewId}`);
                  } catch (error) {
                    console.error('Failed to create interview:', error);
                    alert('Failed to create interview. Please try again.');
                  }
                }}
                title={!project?.context_locked ? 'Start Context Interview to establish project foundation' : 'Start Epic Interview'}
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
                {!project?.context_locked ? 'Context Interview' : 'New Epic Interview'}
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
              { id: 'interviews', label: 'Interviews' },
              { id: 'rag', label: '📊 RAG Analytics' },
              { id: 'analytics', label: '🚨 Blocking Analytics' },
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
          <div className="space-y-6">
            {/* Backlog Header */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">
                  Hierarchical view of Epics, Stories, Tasks, and Bugs
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowBacklogFilters(!showBacklogFilters)}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
                {showBacklogFilters ? 'Hide Filters' : 'Show Filters'}
              </Button>
            </div>

            {/* Backlog Content */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              {/* Filters Sidebar */}
              {showBacklogFilters && (
                <div className="lg:col-span-1">
                  <BacklogFilters
                    filters={backlogFilters}
                    onFiltersChange={setBacklogFilters}
                    onClearFilters={() => setBacklogFilters({})}
                  />
                </div>
              )}

              {/* Backlog List */}
              <div className={showBacklogFilters ? 'lg:col-span-3' : 'lg:col-span-4'}>
                <BacklogListView
                  projectId={projectId}
                  filters={backlogFilters}
                  onItemSelect={setSelectedBacklogItem}
                  refreshKey={backlogRefreshKey}
                  selectedItemId={selectedBacklogItem?.id}
                />
              </div>
            </div>

            {/* Item Detail Panel */}
            {selectedBacklogItem && (
              <ItemDetailPanel
                item={selectedBacklogItem}
                onClose={() => setSelectedBacklogItem(null)}
                onUpdate={handleTasksUpdate}
                onNavigateToItem={(item) => setSelectedBacklogItem(item)}
              />
            )}
          </div>
        )}

        {activeTab === 'kanban' && (
          <div>
            <KanbanBoard projectId={projectId} />
          </div>
        )}

        {activeTab === 'interviews' && (
          <div>
            {/* PROMPT #90 - Pass project to detect context state for interview type */}
            <InterviewList projectId={projectId} showHeader={false} showCreateButton={false} project={project} />
          </div>
        )}

        {/* RAG Analytics Tab (PROMPT #90) */}
        {activeTab === 'rag' && (
          <div className="space-y-6">
            {loadingRag ? (
              <div className="flex items-center justify-center py-12">
                <svg className="animate-spin h-8 w-8 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
            ) : ragStats ? (
              <>
                {/* Stats Cards */}
                <RagStatsCard stats={ragStats} />

                {/* Charts and Table */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <RagHitRatePieChart usageTypes={ragStats.by_usage_type} />
                  <RagUsageTypeTable usageTypes={ragStats.by_usage_type} />
                </div>

                {/* Code Indexing Panel */}
                <CodeIndexingPanel
                  projectId={projectId}
                  stats={codeStats}
                  onIndexComplete={loadRagStats}
                />
              </>
            ) : (
              <Card>
                <CardContent className="py-12 text-center text-gray-500">
                  <p>No RAG data available yet</p>
                  <p className="text-sm mt-2">RAG analytics will appear after AI operations are executed</p>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Blocking Analytics Tab (PROMPT #97) */}
        {activeTab === 'analytics' && (
          <div className="space-y-6">
            {/* Time Period Selector */}
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold text-gray-900">Blocking System Analytics</h3>
              <div className="flex gap-2">
                {[7, 30, 90, 365].map((days) => (
                  <Button
                    key={days}
                    variant={analyticsDays === days ? 'primary' : 'outline'}
                    size="sm"
                    onClick={() => setAnalyticsDays(days)}
                  >
                    {days === 365 ? 'All Time' : `${days}d`}
                  </Button>
                ))}
              </div>
            </div>

            {loadingAnalytics ? (
              <div className="flex items-center justify-center py-12">
                <svg className="animate-spin h-8 w-8 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
            ) : analyticsData ? (
              <>
                {/* Key Metrics Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm font-medium text-gray-500">Currently Blocked</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-baseline">
                        <span className="text-3xl font-bold text-red-600">{analyticsData.total_blocked}</span>
                        <span className="ml-2 text-sm text-gray-500">tasks</span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">Pending user approval</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm font-medium text-gray-500">Approved</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-baseline">
                        <span className="text-3xl font-bold text-green-600">{analyticsData.total_approved}</span>
                        <span className="ml-2 text-sm text-gray-500">modifications</span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">{(analyticsData.approval_rate * 100).toFixed(1)}% approval rate</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm font-medium text-gray-500">Rejected</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-baseline">
                        <span className="text-3xl font-bold text-orange-600">{analyticsData.total_rejected}</span>
                        <span className="ml-2 text-sm text-gray-500">modifications</span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">{(analyticsData.rejection_rate * 100).toFixed(1)}% rejection rate</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm font-medium text-gray-500">Avg Similarity</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-baseline">
                        <span className="text-3xl font-bold text-blue-600">{(analyticsData.avg_similarity_score * 100).toFixed(1)}%</span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">AI detection accuracy</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Charts Row */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Similarity Distribution */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Similarity Score Distribution</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {Object.entries(analyticsData.similarity_distribution).map(([range, count]) => {
                          const total = Object.values(analyticsData.similarity_distribution).reduce((a, b) => a + b, 0);
                          const percentage = total > 0 ? (count / total) * 100 : 0;

                          const getColor = (range: string) => {
                            if (range === '90+') return 'bg-red-500';
                            if (range === '80-90') return 'bg-orange-500';
                            if (range === '70-80') return 'bg-yellow-500';
                            return 'bg-green-500';
                          };

                          return (
                            <div key={range}>
                              <div className="flex justify-between text-sm mb-1">
                                <span className="font-medium text-gray-700">{range}% Similar</span>
                                <span className="text-gray-500">{count} ({percentage.toFixed(0)}%)</span>
                              </div>
                              <div className="w-full bg-gray-200 rounded-full h-3">
                                <div
                                  className={`h-3 rounded-full ${getColor(range)}`}
                                  style={{ width: `${percentage}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Approval vs Rejection Rate */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Resolution Rate</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        <div>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="font-medium text-green-700">✅ Approved</span>
                            <span className="text-gray-500">{analyticsData.total_approved} ({(analyticsData.approval_rate * 100).toFixed(1)}%)</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-6">
                            <div
                              className="h-6 rounded-full bg-green-500 flex items-center justify-center text-white text-xs font-semibold"
                              style={{ width: `${analyticsData.approval_rate * 100}%` }}
                            >
                              {analyticsData.approval_rate > 0.15 && `${(analyticsData.approval_rate * 100).toFixed(0)}%`}
                            </div>
                          </div>
                        </div>

                        <div>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="font-medium text-orange-700">❌ Rejected</span>
                            <span className="text-gray-500">{analyticsData.total_rejected} ({(analyticsData.rejection_rate * 100).toFixed(1)}%)</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-6">
                            <div
                              className="h-6 rounded-full bg-orange-500 flex items-center justify-center text-white text-xs font-semibold"
                              style={{ width: `${analyticsData.rejection_rate * 100}%` }}
                            >
                              {analyticsData.rejection_rate > 0.15 && `${(analyticsData.rejection_rate * 100).toFixed(0)}%`}
                            </div>
                          </div>
                        </div>

                        <div className="pt-4 border-t">
                          <div className="text-sm text-gray-600">
                            <strong>Total Resolved:</strong> {analyticsData.total_approved + analyticsData.total_rejected} modifications
                          </div>
                          <div className="text-sm text-gray-600 mt-1">
                            <strong>Blocking Rate:</strong> {(analyticsData.blocking_rate * 100).toFixed(1)}% of all tasks
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Timeline */}
                {analyticsData.blocked_by_date && analyticsData.blocked_by_date.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Blocking Timeline</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {analyticsData.blocked_by_date.slice(0, 10).map((item) => (
                          <div key={item.date} className="flex justify-between items-center py-2 border-b last:border-0">
                            <span className="text-sm font-medium text-gray-700">{new Date(item.date).toLocaleDateString()}</span>
                            <Badge variant="outline">{item.count} blocked</Badge>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            ) : (
              <Card>
                <CardContent className="py-12 text-center text-gray-500">
                  <p>No blocking analytics available yet</p>
                  <p className="text-sm mt-2">Analytics will appear after AI suggests modifications to tasks</p>
                </CardContent>
              </Card>
            )}
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

            {/* Project Context (PROMPT #89 - Context Interview) */}
            {(project.context_human || project.context_semantic) && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CardTitle>Project Context</CardTitle>
                    {project.context_locked && (
                      <Badge variant="secondary" className="bg-amber-100 text-amber-800 border-amber-200">
                        <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                        Locked
                      </Badge>
                    )}
                  </div>
                  {project.context_locked_at && (
                    <span className="text-xs text-gray-500">
                      Locked on {new Date(project.context_locked_at).toLocaleDateString()}
                    </span>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Human-readable context */}
                  {project.context_human && (
                    <div className="prose prose-sm max-w-none">
                      <ReactMarkdown>
                        {project.context_human}
                      </ReactMarkdown>
                    </div>
                  )}

                  {/* Semantic context (collapsible) */}
                  {project.context_semantic && (
                    <details className="group mt-4">
                      <summary className="cursor-pointer text-sm text-blue-600 hover:text-blue-800 flex items-center gap-2">
                        <svg className="w-4 h-4 transform group-open:rotate-90 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        View Semantic Context (for AI)
                      </summary>
                      <div className="mt-3 bg-gray-900 rounded-lg p-4 border border-gray-700">
                        <pre className="text-xs text-gray-300 whitespace-pre-wrap overflow-x-auto">
                          {project.context_semantic}
                        </pre>
                      </div>
                    </details>
                  )}

                  {/* Context Lock Info */}
                  {!project.context_locked && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-4">
                      <div className="flex items-start gap-2">
                        <svg className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div>
                          <p className="text-sm text-blue-800">
                            This context will be <strong>locked</strong> when you create your first Epic.
                            After that, it cannot be modified to ensure consistency across all project cards.
                          </p>
                        </div>
                      </div>
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

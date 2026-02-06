/**
 * RAG Analytics Dashboard Page
 *
 * PROMPT #117 - Project-specific RAG
 *
 * Dedicated page for RAG (Retrieval-Augmented Generation) analytics:
 * - Project filter dropdown (same pattern as commits page)
 * - Documents indexed per project
 * - Hit rate by usage type
 */

'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Layout, Breadcrumbs } from '@/components/layout';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Select,
  Input,
} from '@/components/ui';
import { RagStatsCard, StatCard } from '@/components/rag/RagStatsCard';
import { RagUsageTypeTable } from '@/components/rag/RagUsageTypeTable';
import { RagHitRatePieChart } from '@/components/rag/RagCharts';
import { RagStats, Project, GlobalRagStats } from '@/lib/types';
import { projectsApi, knowledgeApi } from '@/lib/api';
import { Database, RefreshCw, FileText, FolderOpen, Search, Filter, AlertCircle, Package, MessageSquare, Layers, BookOpen, Code, Tags } from 'lucide-react';

interface RagStatus {
  project_id: string | null;
  total_specs: number;
  discovered_specs: number;
  total_in_rag: number;
}

export default function RagPage() {
  const [ragStats, setRagStats] = useState<RagStats | null>(null);
  const [ragStatus, setRagStatus] = useState<RagStatus | null>(null);
  const [globalStats, setGlobalStats] = useState<GlobalRagStats | null>(null);
  const [loadingGlobalStats, setLoadingGlobalStats] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  // PROMPT #172 - Load global RAG stats on mount
  const fetchGlobalStats = useCallback(async () => {
    setLoadingGlobalStats(true);
    try {
      const response = await knowledgeApi.getGlobalStats();
      if (response.success) {
        setGlobalStats(response.stats);
      }
    } catch (error) {
      console.error('Error fetching global RAG stats:', error);
    } finally {
      setLoadingGlobalStats(false);
    }
  }, []);

  useEffect(() => {
    fetchGlobalStats();
  }, [fetchGlobalStats]);

  // Load projects on mount
  useEffect(() => {
    const loadProjects = async () => {
      setLoadingProjects(true);
      try {
        const data = await projectsApi.list();
        const projectsList = Array.isArray(data) ? data : data.data || [];
        setProjects(projectsList);
      } catch (error) {
        console.error('Error fetching projects:', error);
      } finally {
        setLoadingProjects(false);
      }
    };
    loadProjects();
  }, []);

  // Auto-select first project when projects load
  useEffect(() => {
    if (!selectedProject && projects.length > 0) {
      setSelectedProject(projects[0].id);
    }
  }, [projects, selectedProject]);

  const fetchRagStats = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/v1/cost/rag-stats`);
      if (response.ok) {
        const data = await response.json();
        setRagStats(data);
      }
    } catch (error) {
      console.error('Error fetching RAG stats:', error);
    }
  }, [API_BASE]);

  const fetchRagStatus = useCallback(async () => {
    if (!selectedProject) return;

    try {
      const response = await fetch(
        `${API_BASE}/api/v1/specs/sync-rag/full-status?project_id=${selectedProject}`
      );
      if (response.ok) {
        const data = await response.json();
        setRagStatus(data);
      }
    } catch (error) {
      console.error('Error fetching RAG status:', error);
    }
  }, [API_BASE, selectedProject]);

  // Load data when project changes
  useEffect(() => {
    if (selectedProject) {
      const loadData = async () => {
        setLoading(true);
        await Promise.all([fetchRagStats(), fetchRagStatus()]);
        setLoading(false);
      };
      loadData();
    }
  }, [selectedProject, fetchRagStats, fetchRagStatus]);

  const syncProjectToRag = async () => {
    if (!selectedProject) return;

    setSyncing(true);
    try {
      const response = await fetch(`${API_BASE}/api/v1/specs/project/${selectedProject}/sync-rag`, {
        method: 'POST',
      });
      if (response.ok) {
        // Refresh stats after sync
        await fetchRagStats();
        await fetchRagStatus();
      }
    } catch (error) {
      console.error('Error syncing project to RAG:', error);
    } finally {
      setSyncing(false);
    }
  };

  const selectedProjectData = projects.find(p => p.id === selectedProject);

  if (loadingProjects) {
    return (
      <Layout>
        <Breadcrumbs />
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading projects...</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <Breadcrumbs />
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-100 rounded-lg">
              <Database className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">RAG Analytics</h1>
              <p className="text-gray-600 mt-1">
                Retrieval-Augmented Generation performance and knowledge base status
              </p>
            </div>
          </div>
          {/* Refresh Global Stats Button */}
          <Button
            variant="outline"
            onClick={fetchGlobalStats}
            disabled={loadingGlobalStats}
          >
            <RefreshCw className={`w-4 h-4 ${loadingGlobalStats ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* PROMPT #172 - Global Document Storage Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="w-5 h-5 text-purple-600" />
              Global Document Storage
              <span className="text-sm font-normal text-gray-500 ml-2">(All Projects)</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingGlobalStats ? (
              <div className="flex items-center justify-center h-24">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
              </div>
            ) : globalStats ? (
              <div className="space-y-4">
                {/* Main Stats Grid */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                  <div className="bg-purple-50 rounded-lg p-4 text-center">
                    <Package className="w-6 h-6 text-purple-600 mx-auto mb-2" />
                    <div className="text-2xl font-bold text-purple-700">{globalStats.total_documents}</div>
                    <div className="text-xs text-purple-600">Total Documents</div>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-4 text-center">
                    <Code className="w-6 h-6 text-blue-600 mx-auto mb-2" />
                    <div className="text-2xl font-bold text-blue-700">{globalStats.by_type?.code_file || 0}</div>
                    <div className="text-xs text-blue-600">Code Files</div>
                  </div>
                  <div className="bg-green-50 rounded-lg p-4 text-center">
                    <Tags className="w-6 h-6 text-green-600 mx-auto mb-2" />
                    <div className="text-2xl font-bold text-green-700">{globalStats.by_type?.card || 0}</div>
                    <div className="text-xs text-green-600">Cards</div>
                  </div>
                  <div className="bg-yellow-50 rounded-lg p-4 text-center">
                    <MessageSquare className="w-6 h-6 text-yellow-600 mx-auto mb-2" />
                    <div className="text-2xl font-bold text-yellow-700">{globalStats.by_type?.interview_answer || 0}</div>
                    <div className="text-xs text-yellow-600">Interview Answers</div>
                  </div>
                  <div className="bg-indigo-50 rounded-lg p-4 text-center">
                    <Layers className="w-6 h-6 text-indigo-600 mx-auto mb-2" />
                    <div className="text-2xl font-bold text-indigo-700">{globalStats.by_type?.project_context || 0}</div>
                    <div className="text-xs text-indigo-600">Project Context</div>
                  </div>
                  <div className="bg-orange-50 rounded-lg p-4 text-center">
                    <BookOpen className="w-6 h-6 text-orange-600 mx-auto mb-2" />
                    <div className="text-2xl font-bold text-orange-700">{globalStats.by_type?.business_rule || 0}</div>
                    <div className="text-xs text-orange-600">Business Rules</div>
                  </div>
                </div>

                {/* Cards Breakdown */}
                {globalStats.cards_breakdown && Object.keys(globalStats.cards_breakdown).length > 0 && (
                  <div className="border-t pt-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                      <Tags className="w-4 h-4" />
                      Cards Breakdown
                    </h4>
                    <div className="flex flex-wrap gap-4">
                      {globalStats.cards_breakdown.epic !== undefined && (
                        <div className="flex items-center gap-2 bg-gray-100 rounded-full px-3 py-1">
                          <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                          <span className="text-sm text-gray-700">Epic: <strong>{globalStats.cards_breakdown.epic}</strong></span>
                        </div>
                      )}
                      {globalStats.cards_breakdown.story !== undefined && (
                        <div className="flex items-center gap-2 bg-gray-100 rounded-full px-3 py-1">
                          <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                          <span className="text-sm text-gray-700">Story: <strong>{globalStats.cards_breakdown.story}</strong></span>
                        </div>
                      )}
                      {globalStats.cards_breakdown.task !== undefined && (
                        <div className="flex items-center gap-2 bg-gray-100 rounded-full px-3 py-1">
                          <span className="w-2 h-2 rounded-full bg-green-500"></span>
                          <span className="text-sm text-gray-700">Task: <strong>{globalStats.cards_breakdown.task}</strong></span>
                        </div>
                      )}
                      {globalStats.cards_breakdown.subtask !== undefined && (
                        <div className="flex items-center gap-2 bg-gray-100 rounded-full px-3 py-1">
                          <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
                          <span className="text-sm text-gray-700">Subtask: <strong>{globalStats.cards_breakdown.subtask}</strong></span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Additional Document Types (if any) */}
                {globalStats.by_type && Object.keys(globalStats.by_type).filter(key =>
                  !['code_file', 'card', 'interview_answer', 'project_context', 'business_rule'].includes(key)
                ).length > 0 && (
                  <div className="border-t pt-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-3">Other Document Types</h4>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(globalStats.by_type)
                        .filter(([key]) => !['code_file', 'card', 'interview_answer', 'project_context', 'business_rule'].includes(key))
                        .map(([key, value]) => (
                          <span key={key} className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 text-sm px-3 py-1 rounded-full">
                            {key.replace(/_/g, ' ')}: <strong>{value}</strong>
                          </span>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center text-gray-500 py-8">
                <Database className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                <p>No RAG data available</p>
              </div>
            )}
          </CardContent>
        </Card>

        {projects.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <AlertCircle className="w-16 h-16 mx-auto text-gray-300 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Projects Found</h3>
              <p className="text-gray-600 mb-4">
                Create a project to start using RAG analytics.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {/* Filters */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-col md:flex-row gap-4">
                  {/* Project Filter */}
                  <div className="w-full md:w-64">
                    <Select
                      value={selectedProject}
                      onChange={(e) => setSelectedProject(e.target.value)}
                      options={projects.map(project => ({
                        value: project.id,
                        label: project.name,
                      }))}
                    />
                  </div>

                  {/* Sync Button */}
                  <Button
                    onClick={syncProjectToRag}
                    disabled={syncing || !selectedProject}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {syncing ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        Syncing...
                      </>
                    ) : (
                      <>
                        <Database className="w-4 h-4 mr-2" />
                        Sync to RAG
                      </>
                    )}
                  </Button>

                  {/* Refresh */}
                  <Button
                    variant="outline"
                    onClick={() => {
                      fetchRagStats();
                      fetchRagStatus();
                    }}
                    disabled={loading}
                  >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                  </Button>
                </div>

                {/* Stats */}
                <div className="flex items-center gap-4 mt-4 pt-4 border-t border-gray-100">
                  <div className="flex items-center gap-2">
                    <FolderOpen className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-gray-600">
                      Project: <strong>{selectedProjectData?.name || 'None'}</strong>
                    </span>
                  </div>
                  {ragStatus && (
                    <>
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-gray-400" />
                        <span className="text-sm text-gray-600">
                          {ragStatus.total_specs} specs
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Database className="w-4 h-4 text-gray-400" />
                        <span className="text-sm text-gray-600">
                          {ragStatus.total_in_rag} in RAG
                        </span>
                      </div>
                    </>
                  )}
                  {selectedProjectData?.code_path && (
                    <div className="text-sm text-gray-400 truncate max-w-xs" title={selectedProjectData.code_path}>
                      {selectedProjectData.code_path}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Loading */}
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                  <p className="text-gray-600">Loading RAG data...</p>
                </div>
              </div>
            ) : (
              <>
                {/* Project Stats Cards */}
                {ragStatus && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <StatCard
                      title="Total Specs"
                      value={ragStatus.total_specs}
                      icon={<FileText className="w-6 h-6 text-blue-600" />}
                      color="blue"
                    />
                    <StatCard
                      title="Discovered Specs"
                      value={ragStatus.discovered_specs}
                      icon={<Database className="w-6 h-6 text-purple-600" />}
                      color="purple"
                    />
                    <StatCard
                      title="In RAG Index"
                      value={ragStatus.total_in_rag}
                      icon={<Database className="w-6 h-6 text-green-600" />}
                      color="green"
                    />
                  </div>
                )}

                {/* Global RAG Stats */}
                {ragStats && (
                  <RagStatsCard stats={ragStats} />
                )}

                {/* Charts and Table Row */}
                {ragStats && ragStats.by_usage_type && ragStats.by_usage_type.length > 0 && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <RagHitRatePieChart usageTypes={ragStats.by_usage_type} />
                    <RagUsageTypeTable usageTypes={ragStats.by_usage_type} />
                  </div>
                )}

                {/* Empty State */}
                {ragStatus && ragStatus.total_specs === 0 && (
                  <Card>
                    <CardContent className="p-12 text-center">
                      <Database className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                      <h3 className="text-lg font-medium text-gray-900 mb-2">No Specs Found</h3>
                      <p className="text-gray-500 mb-4">
                        This project has no specs yet. Run Pattern Discovery to discover code patterns.
                      </p>
                      <p className="text-sm text-gray-400">
                        Once specs are discovered, click &quot;Sync to RAG&quot; to index them.
                      </p>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}

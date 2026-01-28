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
import { RagStats, Project } from '@/lib/types';
import { projectsApi } from '@/lib/api';
import { Database, RefreshCw, FileText, FolderOpen, Search, Filter, AlertCircle } from 'lucide-react';

interface RagStatus {
  project_id: string | null;
  total_specs: number;
  discovered_specs: number;
  total_in_rag: number;
}

export default function RagPage() {
  const [ragStats, setRagStats] = useState<RagStats | null>(null);
  const [ragStatus, setRagStatus] = useState<RagStatus | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

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
        </div>

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

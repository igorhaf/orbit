/**
 * RAG Analytics Dashboard Page
 *
 * PROMPT #117 - Project-specific RAG
 *
 * Dedicated page for RAG (Retrieval-Augmented Generation) analytics:
 * - Overall RAG performance metrics
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
} from '@/components/ui';
import { RagStatsCard, StatCard } from '@/components/rag/RagStatsCard';
import { RagUsageTypeTable } from '@/components/rag/RagUsageTypeTable';
import { RagHitRatePieChart } from '@/components/rag/RagCharts';
import { RagStats, Project } from '@/lib/types';
import { projectsApi } from '@/lib/api';
import { Database, RefreshCw, FileText, FolderOpen } from 'lucide-react';

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
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  const fetchProjects = useCallback(async () => {
    try {
      const data = await projectsApi.list();
      const projectsList = Array.isArray(data) ? data : data.data || [];
      setProjects(projectsList);
      if (projectsList.length > 0 && !selectedProject) {
        setSelectedProject(projectsList[0].id);
      }
    } catch (error) {
      console.error('Error fetching projects:', error);
    }
  }, [selectedProject]);

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
    try {
      const url = selectedProject
        ? `${API_BASE}/api/v1/specs/sync-rag/full-status?project_id=${selectedProject}`
        : `${API_BASE}/api/v1/specs/sync-rag/full-status`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setRagStatus(data);
      }
    } catch (error) {
      console.error('Error fetching RAG status:', error);
    }
  }, [API_BASE, selectedProject]);

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

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([fetchRagStats(), fetchRagStatus()]);
      setLoading(false);
    };
    loadData();
  }, [fetchRagStats, fetchRagStatus]);

  const breadcrumbs = [
    { label: 'RAG Analytics', href: '/rag' },
  ];

  if (loading) {
    return (
      <Layout>
        <Breadcrumbs items={breadcrumbs} />
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </Layout>
    );
  }

  const selectedProjectData = projects.find(p => p.id === selectedProject);

  return (
    <Layout>
      <Breadcrumbs items={breadcrumbs} />

      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">RAG Analytics</h1>
            <p className="text-gray-500 mt-1">
              Retrieval-Augmented Generation performance and knowledge base status
            </p>
          </div>
          <Button
            onClick={() => {
              fetchRagStats();
              fetchRagStatus();
            }}
            variant="outline"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* RAG Stats Cards */}
        {ragStats && (
          <RagStatsCard stats={ragStats} />
        )}

        {/* Project RAG Status */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <FolderOpen className="w-5 h-5 mr-2" />
              Project RAG Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Project Selector */}
              <div className="flex items-center gap-4">
                <div className="w-64">
                  <Select
                    value={selectedProject}
                    onChange={(e) => setSelectedProject(e.target.value)}
                    options={projects.map(p => ({
                      value: p.id,
                      label: p.name
                    }))}
                  />
                </div>
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
              </div>

              {selectedProjectData && (
                <p className="text-sm text-gray-500">
                  {selectedProjectData.code_path || 'No code path configured'}
                </p>
              )}

              {/* Stats Grid */}
              {ragStatus && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
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
            </div>
          </CardContent>
        </Card>

        {/* Charts and Table Row */}
        {ragStats && ragStats.by_usage_type && ragStats.by_usage_type.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <RagHitRatePieChart usageTypes={ragStats.by_usage_type} />
            <RagUsageTypeTable usageTypes={ragStats.by_usage_type} />
          </div>
        )}

        {/* Empty State */}
        {(!ragStats || !ragStats.by_usage_type || ragStats.by_usage_type.length === 0) && (
          <Card>
            <CardContent className="p-12 text-center">
              <Database className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No RAG Data Yet</h3>
              <p className="text-gray-500 mb-4">
                RAG statistics will appear here once AI executions with RAG are performed.
              </p>
              <p className="text-sm text-gray-400">
                Select a project and click &quot;Sync to RAG&quot; to index specs.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}

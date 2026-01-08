/**
 * Commits Page
 * View all auto-generated commits across projects with filtering
 */

'use client';

import React, { useEffect, useState } from 'react';
import { Layout, Breadcrumbs } from '@/components/layout';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { commitsApi, projectsApi } from '@/lib/api';
import { Commit, Project } from '@/lib/types';
import { GitCommit, RefreshCw, Search, Filter, TrendingUp } from 'lucide-react';
import Link from 'next/link';

const COMMIT_ICONS: Record<string, string> = {
  feat: '✨',
  fix: '🐛',
  docs: '📝',
  style: '💄',
  refactor: '♻️',
  test: '✅',
  chore: '🔧',
  perf: '⚡'
};

const COMMIT_COLORS: Record<string, string> = {
  feat: 'bg-green-100 text-green-800 border-green-200',
  fix: 'bg-red-100 text-red-800 border-red-200',
  docs: 'bg-blue-100 text-blue-800 border-blue-200',
  style: 'bg-purple-100 text-purple-800 border-purple-200',
  refactor: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  test: 'bg-teal-100 text-teal-800 border-teal-200',
  chore: 'bg-gray-100 text-gray-800 border-gray-200',
  perf: 'bg-orange-100 text-orange-800 border-orange-200'
};

const COMMIT_TYPES = [
  { value: 'all', label: 'All Types' },
  { value: 'feat', label: '✨ Features' },
  { value: 'fix', label: '🐛 Bug Fixes' },
  { value: 'docs', label: '📝 Documentation' },
  { value: 'style', label: '💄 Styles' },
  { value: 'refactor', label: '♻️ Refactoring' },
  { value: 'test', label: '✅ Tests' },
  { value: 'chore', label: '🔧 Chores' },
  { value: 'perf', label: '⚡ Performance' },
];

export default function CommitsPage() {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProject, setSelectedProject] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<string>('all');

  // Statistics
  const [statistics, setStatistics] = useState<Record<string, number>>({});

  useEffect(() => {
    loadData();
  }, [selectedProject]);

  const loadData = async () => {
    setLoading(true);
    setError(null);

    try {
      // Load commits
      let commitsData;
      if (selectedProject === 'all') {
        commitsData = await commitsApi.list();
      } else {
        commitsData = await commitsApi.byProject(selectedProject);
      }
      setCommits(Array.isArray(commitsData) ? commitsData : commitsData.data || []);

      // Load projects for filter
      const projectsData = await projectsApi.list();
      setProjects(Array.isArray(projectsData) ? projectsData : projectsData.data || []);

      // Load statistics
      const statsData = await commitsApi.statistics(
        selectedProject === 'all' ? undefined : selectedProject
      );
      setStatistics(statsData || {});
    } catch (err: any) {
      console.error('Failed to load commits:', err);
      setError(err.message || 'Failed to load commits');
    } finally {
      setLoading(false);
    }
  };

  // Filter commits
  const filteredCommits = commits.filter(commit => {
    const matchesSearch = commit.message
      .toLowerCase()
      .includes(searchTerm.toLowerCase());

    const matchesType = selectedType === 'all' || commit.type === selectedType;

    return matchesSearch && matchesType;
  });

  return (
    <Layout>
      <Breadcrumbs />
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-purple-100 rounded-lg">
              <GitCommit className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Commits</h1>
              <p className="text-gray-600 mt-1">
                Auto-generated commit history across all projects
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={loadData}
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Info Card */}
        <Card className="bg-purple-50 border-purple-200">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-purple-100 rounded">
                <GitCommit className="w-5 h-5 text-purple-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-purple-900 mb-1">
                  About Commits
                </h3>
                <p className="text-sm text-purple-800">
                  Commits are automatically generated by AI when tasks are completed.
                  They follow the Conventional Commits specification and include
                  detailed change descriptions.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Statistics */}
        {Object.keys(statistics).length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            {Object.entries(statistics).map(([type, count]) => (
              <Card key={type} className="text-center">
                <CardContent className="pt-6 pb-4">
                  <div className="text-2xl mb-1">{COMMIT_ICONS[type] || '📦'}</div>
                  <div className="text-2xl font-bold text-gray-900">{count}</div>
                  <div className="text-xs text-gray-600 capitalize">{type}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row gap-4">
              {/* Search */}
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <Input
                    placeholder="Search commits..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>

              {/* Project Filter */}
              <div className="w-full md:w-64">
                <Select
                  value={selectedProject}
                  onChange={(e) => setSelectedProject(e.target.value)}
                  options={[
                    { value: 'all', label: 'All Projects' },
                    ...projects.map(project => ({
                      value: project.id,
                      label: project.name,
                    })),
                  ]}
                />
              </div>

              {/* Type Filter */}
              <div className="w-full md:w-48">
                <Select
                  value={selectedType}
                  onChange={(e) => setSelectedType(e.target.value)}
                  options={COMMIT_TYPES}
                />
              </div>
            </div>

            {/* Filter Stats */}
            <div className="flex items-center gap-4 mt-4 pt-4 border-t border-gray-100">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-600">
                  Showing {filteredCommits.length} of {commits.length} commits
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Error State */}
        {error && (
          <Card className="bg-red-50 border-red-200">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <div className="text-red-600">⚠️</div>
                <div>
                  <h3 className="font-semibold text-red-900 mb-1">Error</h3>
                  <p className="text-sm text-red-800">{error}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={loadData}
                    className="mt-3"
                  >
                    Try Again
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Commits List */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
              <p className="text-gray-600">Loading commits...</p>
            </div>
          </div>
        ) : filteredCommits.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-12">
                <GitCommit className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  No commits found
                </h3>
                <p className="text-gray-600">
                  {searchTerm || selectedType !== 'all' || selectedProject !== 'all'
                    ? 'Try adjusting your filters'
                    : 'Complete a task to generate your first commit!'}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredCommits.map((commit) => (
              <Card
                key={commit.id}
                className={`border-l-4 transition-all hover:shadow-md ${
                  COMMIT_COLORS[commit.type] || COMMIT_COLORS.chore
                }`}
              >
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl flex-shrink-0">
                      {COMMIT_ICONS[commit.type] || '📦'}
                    </span>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <span className="font-mono text-sm font-semibold text-gray-900 break-words">
                          {commit.message}
                        </span>
                        <Badge variant="default" className="flex-shrink-0">
                          {commit.type}
                        </Badge>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
                        <span className="flex items-center gap-1">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {new Date(commit.timestamp).toLocaleDateString()} {new Date(commit.timestamp).toLocaleTimeString()}
                        </span>

                        <span className="text-gray-400">•</span>

                        <span className="flex items-center gap-1">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                          {commit.created_by_ai_model}
                        </span>

                        {commit.task_id && (
                          <>
                            <span className="text-gray-400">•</span>
                            <Link
                              href={`/projects/${commit.project_id}`}
                              className="text-blue-600 hover:text-blue-800 hover:underline"
                            >
                              View Project
                            </Link>
                          </>
                        )}
                      </div>

                      {commit.changes?.description && (
                        <div className="mt-2 pt-2 border-t border-gray-200">
                          <p className="text-xs text-gray-600">
                            {commit.changes.description}
                          </p>
                        </div>
                      )}

                      {commit.changes?.files && commit.changes.files.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {commit.changes.files.slice(0, 5).map((file: string, idx: number) => (
                            <span
                              key={idx}
                              className="px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded font-mono"
                            >
                              {file}
                            </span>
                          ))}
                          {commit.changes.files.length > 5 && (
                            <span className="px-2 py-0.5 bg-gray-200 text-gray-600 text-xs rounded">
                              +{commit.changes.files.length - 5} more
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

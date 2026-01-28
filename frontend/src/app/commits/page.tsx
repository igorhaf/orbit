/**
 * Commits Page
 * View all commits across projects - both ORBIT-generated and Git commits
 * PROMPT #113 - Added Git commits tab
 */

'use client';

import React, { useEffect, useState } from 'react';
import { Layout, Breadcrumbs } from '@/components/layout';
import { Card, CardContent, Button, Badge, Input, Select } from '@/components/ui';
import { commitsApi, projectsApi } from '@/lib/api';
import { Commit, Project } from '@/lib/types';
import { GitCommit, GitBranch, RefreshCw, Search, Filter, ChevronDown, ChevronUp, Copy, Check, AlertCircle, Plus, Minus, FileCode } from 'lucide-react';
import Link from 'next/link';

// ============================================================================
// TYPES
// ============================================================================

interface GitCommitData {
  hash: string;
  short_hash: string;
  author_name: string;
  author_email: string;
  date: string;
  relative_date: string;
  subject: string;
  body?: string;
}

interface GitFileChange {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  diff?: string;
}

interface GitCommitDiff {
  hash: string;
  short_hash: string;
  subject: string;
  author_name: string;
  author_email: string;
  date: string;
  body?: string;
  files: GitFileChange[];
  stats: {
    files_changed: number;
    insertions: number;
    deletions: number;
  };
}

interface GitCommitsResponse {
  commits: GitCommitData[];
  total: number;
  branch: string;
  has_more: boolean;
}

interface ProjectWithGit extends Project {
  is_git_repo?: boolean;
  current_branch?: string;
}

type TabType = 'orbit' | 'git';

// ============================================================================
// CONSTANTS
// ============================================================================

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

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function CommitsPage() {
  const [activeTab, setActiveTab] = useState<TabType>('git');
  const [projects, setProjects] = useState<ProjectWithGit[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);

  // Load projects on mount
  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    setLoadingProjects(true);
    try {
      const projectsData = await projectsApi.list();
      const projectsList = Array.isArray(projectsData) ? projectsData : projectsData.data || [];

      // Check which projects are git repos
      const projectsWithGitInfo = await Promise.all(
        projectsList.map(async (project: Project) => {
          try {
            const response = await fetch(`http://localhost:8000/api/v1/projects/${project.id}/git/info`);
            if (response.ok) {
              const info = await response.json();
              return { ...project, is_git_repo: info.is_git_repo, current_branch: info.current_branch };
            }
          } catch {
            // Ignore errors
          }
          return { ...project, is_git_repo: false };
        })
      );

      setProjects(projectsWithGitInfo);
    } catch (err) {
      console.error('Failed to load projects:', err);
    } finally {
      setLoadingProjects(false);
    }
  };

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
                View commit history across all projects
              </p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('git')}
              className={`pb-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'git'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <GitBranch className="w-4 h-4 inline mr-2" />
              Git Commits
            </button>
            <button
              onClick={() => setActiveTab('orbit')}
              className={`pb-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'orbit'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <GitCommit className="w-4 h-4 inline mr-2" />
              ORBIT Commits
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        {activeTab === 'git' ? (
          <GitCommitsTab projects={projects} loadingProjects={loadingProjects} onRefresh={loadProjects} />
        ) : (
          <OrbitCommitsTab projects={projects} />
        )}
      </div>
    </Layout>
  );
}

// ============================================================================
// GIT COMMITS TAB
// ============================================================================

interface GitCommitsTabProps {
  projects: ProjectWithGit[];
  loadingProjects: boolean;
  onRefresh: () => void;
}

function GitCommitsTab({ projects, loadingProjects, onRefresh }: GitCommitsTabProps) {
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [commits, setCommits] = useState<GitCommitData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentBranch, setCurrentBranch] = useState('');
  const [totalCommits, setTotalCommits] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  // Inline diff viewer state
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null);
  const [inlineDiffData, setInlineDiffData] = useState<Record<string, GitCommitDiff>>({});
  const [loadingDiffFor, setLoadingDiffFor] = useState<string | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const gitProjects = projects.filter(p => p.is_git_repo);

  // Auto-select first git project
  useEffect(() => {
    if (!selectedProject && gitProjects.length > 0) {
      setSelectedProject(gitProjects[0].id);
    }
  }, [gitProjects, selectedProject]);

  // Load commits when project changes
  useEffect(() => {
    if (selectedProject) {
      loadCommits(true);
    }
  }, [selectedProject]);

  // Search with debounce
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (selectedProject) {
        loadCommits(true);
      }
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [searchTerm]);

  const loadCommits = async (reset: boolean = false) => {
    if (!selectedProject) return;

    if (reset) {
      setLoading(true);
      setPage(0);
    }

    setError(null);

    try {
      const skip = reset ? 0 : page * 50;
      const params = new URLSearchParams({
        skip: skip.toString(),
        limit: '51', // +1 to check has_more
      });

      if (searchTerm) {
        params.append('search', searchTerm);
      }

      const response = await fetch(
        `http://localhost:8000/api/v1/projects/${selectedProject}/git/commits?${params}`
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to load commits');
      }

      const data: GitCommitsResponse = await response.json();

      const newCommits = data.commits.slice(0, 50);
      if (reset) {
        setCommits(newCommits);
      } else {
        setCommits(prev => [...prev, ...newCommits]);
      }

      setCurrentBranch(data.branch);
      setTotalCommits(data.total);
      setHasMore(data.commits.length > 50);
    } catch (err: any) {
      setError(err.message || 'Failed to load commits');
    } finally {
      setLoading(false);
    }
  };

  const handleLoadMore = () => {
    setPage(prev => prev + 1);
    loadCommits(false);
  };

  const handleCopyHash = async (hash: string) => {
    try {
      await navigator.clipboard.writeText(hash);
      setCopiedHash(hash);
      setTimeout(() => setCopiedHash(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Load commit diff inline
  const loadInlineDiff = async (commitHash: string) => {
    // If already loaded, just toggle expansion
    if (inlineDiffData[commitHash]) {
      if (expandedCommit === commitHash) {
        setExpandedCommit(null);
      } else {
        setExpandedCommit(commitHash);
        // Expand first 3 files by default
        const initialExpanded = new Set(inlineDiffData[commitHash].files.slice(0, 3).map(f => `${commitHash}-${f.filename}`));
        setExpandedFiles(initialExpanded);
      }
      return;
    }

    setLoadingDiffFor(commitHash);
    setExpandedCommit(commitHash);
    try {
      const response = await fetch(
        `http://localhost:8000/api/v1/projects/${selectedProject}/git/commits/${commitHash}/diff`
      );
      if (!response.ok) throw new Error('Failed to load diff');
      const data: GitCommitDiff = await response.json();
      setInlineDiffData(prev => ({ ...prev, [commitHash]: data }));
      // Expand first 3 files by default
      const initialExpanded = new Set(data.files.slice(0, 3).map(f => `${commitHash}-${f.filename}`));
      setExpandedFiles(initialExpanded);
    } catch (err) {
      console.error('Failed to load diff:', err);
      setExpandedCommit(null);
    } finally {
      setLoadingDiffFor(null);
    }
  };

  // Helper functions for diff display
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'A': return <Plus className="w-4 h-4 text-green-600" />;
      case 'D': return <Minus className="w-4 h-4 text-red-600" />;
      case 'M': return <FileCode className="w-4 h-4 text-yellow-600" />;
      default: return <FileCode className="w-4 h-4 text-gray-600" />;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'A': return 'Added';
      case 'D': return 'Deleted';
      case 'M': return 'Modified';
      case 'R': return 'Renamed';
      default: return status;
    }
  };

  const selectedProjectData = projects.find(p => p.id === selectedProject);

  if (loadingProjects) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading projects...</p>
        </div>
      </div>
    );
  }

  if (gitProjects.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <AlertCircle className="w-16 h-16 mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Git Repositories Found</h3>
          <p className="text-gray-600 mb-4">
            None of your projects are linked to Git repositories.
          </p>
          <p className="text-sm text-gray-500">
            Create a project with a valid code_path pointing to a Git repository.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
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
                options={gitProjects.map(project => ({
                  value: project.id,
                  label: `${project.name} (${project.current_branch || 'git'})`,
                }))}
              />
            </div>

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

            {/* Refresh */}
            <Button variant="outline" onClick={() => loadCommits(true)} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-4 mt-4 pt-4 border-t border-gray-100">
            <div className="flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-600">
                Branch: <strong>{currentBranch}</strong>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-600">
                {totalCommits.toLocaleString()} total commits
              </span>
            </div>
            {selectedProjectData?.code_path && (
              <div className="text-sm text-gray-400 truncate max-w-xs" title={selectedProjectData.code_path}>
                {selectedProjectData.code_path}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <Card className="bg-red-50 border-red-200">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-red-900 mb-1">Error</h3>
                <p className="text-sm text-red-800">{error}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {loading && commits.length === 0 ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading commits...</p>
          </div>
        </div>
      ) : commits.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <GitCommit className="w-16 h-16 mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No commits found</h3>
            <p className="text-gray-600">
              {searchTerm ? 'Try a different search term' : 'This repository has no commits yet'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {commits.map((commit) => (
            <Card key={commit.hash} className="hover:shadow-md transition-shadow">
              <CardContent className="py-3 px-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-1">
                    <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                      <GitCommit className="w-4 h-4 text-gray-600" />
                    </div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <button
                        onClick={() => loadInlineDiff(commit.hash)}
                        className="text-left flex-1"
                      >
                        <p className="font-medium text-gray-900 hover:text-blue-600 transition-colors">
                          {commit.subject}
                        </p>
                      </button>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <code className="text-xs text-gray-500 font-mono bg-gray-100 px-2 py-0.5 rounded">
                          {commit.short_hash}
                        </code>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopyHash(commit.hash);
                          }}
                          className="p-1 text-gray-400 hover:text-gray-600"
                          title="Copy full hash"
                        >
                          {copiedHash === commit.hash ? (
                            <Check className="w-3.5 h-3.5 text-green-500" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                        {/* Expand/collapse indicator */}
                        <span className="p-1 text-gray-400">
                          {expandedCommit === commit.hash ? (
                            <ChevronUp className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                          )}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-gray-500">
                      <span className="font-medium">{commit.author_name}</span>
                      <span>{commit.relative_date}</span>
                      <Link
                        href={`/projects/${selectedProject}`}
                        className="text-blue-600 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {selectedProjectData?.name}
                      </Link>
                    </div>

                    {/* Expanded inline diff */}
                    {expandedCommit === commit.hash && (
                      <div className="mt-3 pt-3 border-t">
                        {/* Commit body if exists */}
                        {commit.body && (
                          <pre className="text-sm text-gray-600 whitespace-pre-wrap font-sans mb-4">
                            {commit.body}
                          </pre>
                        )}

                        {/* Loading state */}
                        {loadingDiffFor === commit.hash && (
                          <div className="flex items-center justify-center py-8">
                            <RefreshCw className="w-6 h-6 text-blue-600 animate-spin" />
                            <span className="ml-2 text-gray-600">Loading diff...</span>
                          </div>
                        )}

                        {/* Diff content */}
                        {inlineDiffData[commit.hash] && (
                          <div className="space-y-3">
                            {/* Stats summary */}
                            <div className="flex items-center gap-4 text-sm text-gray-600 pb-2 border-b">
                              <span>{inlineDiffData[commit.hash].stats.files_changed} files changed</span>
                              <span className="text-green-600">+{inlineDiffData[commit.hash].stats.insertions}</span>
                              <span className="text-red-600">-{inlineDiffData[commit.hash].stats.deletions}</span>
                            </div>

                            {/* File list with diffs */}
                            {inlineDiffData[commit.hash].files.map((file) => {
                              const fileKey = `${commit.hash}-${file.filename}`;
                              return (
                                <div key={fileKey} className="border rounded-lg overflow-hidden">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const newExpanded = new Set(expandedFiles);
                                      if (newExpanded.has(fileKey)) {
                                        newExpanded.delete(fileKey);
                                      } else {
                                        newExpanded.add(fileKey);
                                      }
                                      setExpandedFiles(newExpanded);
                                    }}
                                    className="w-full px-4 py-2 bg-gray-50 flex items-center justify-between hover:bg-gray-100"
                                  >
                                    <div className="flex items-center gap-2">
                                      {getStatusIcon(file.status)}
                                      <span className="font-mono text-sm">{file.filename}</span>
                                      <Badge variant="default" className="text-xs">
                                        {getStatusLabel(file.status)}
                                      </Badge>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs">
                                      <span className="text-green-600">+{file.additions}</span>
                                      <span className="text-red-600">-{file.deletions}</span>
                                      {expandedFiles.has(fileKey) ? (
                                        <ChevronUp className="w-4 h-4" />
                                      ) : (
                                        <ChevronDown className="w-4 h-4" />
                                      )}
                                    </div>
                                  </button>

                                  {expandedFiles.has(fileKey) && file.diff && (
                                    <pre className="p-4 text-xs font-mono overflow-x-auto bg-gray-900 text-gray-100 max-h-96">
                                      {file.diff.split('\n').map((line, i) => (
                                        <div
                                          key={i}
                                          className={`${
                                            line.startsWith('+') && !line.startsWith('+++')
                                              ? 'bg-green-900/30 text-green-300'
                                              : line.startsWith('-') && !line.startsWith('---')
                                              ? 'bg-red-900/30 text-red-300'
                                              : line.startsWith('@@')
                                              ? 'text-blue-300'
                                              : ''
                                          }`}
                                        >
                                          {line}
                                        </div>
                                      ))}
                                    </pre>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {/* Load More */}
          {hasMore && (
            <div className="text-center pt-4">
              <Button variant="outline" onClick={handleLoadMore} disabled={loading}>
                {loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Loading...
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4 mr-2" />
                    Load More
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// ORBIT COMMITS TAB
// ============================================================================

interface OrbitCommitsTabProps {
  projects: ProjectWithGit[];
}

function OrbitCommitsTab({ projects }: OrbitCommitsTabProps) {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProject, setSelectedProject] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [statistics, setStatistics] = useState<Record<string, number>>({});

  useEffect(() => {
    loadData();
  }, [selectedProject]);

  const loadData = async () => {
    setLoading(true);
    setError(null);

    try {
      let commitsData;
      if (selectedProject === 'all') {
        commitsData = await commitsApi.list();
      } else {
        commitsData = await commitsApi.byProject(selectedProject);
      }
      setCommits(Array.isArray(commitsData) ? commitsData : commitsData.data || []);

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

  const filteredCommits = commits.filter(commit => {
    const matchesSearch = commit.message
      .toLowerCase()
      .includes(searchTerm.toLowerCase());
    const matchesType = selectedType === 'all' || commit.type === selectedType;
    return matchesSearch && matchesType;
  });

  return (
    <div className="space-y-6">
      {/* Info Card */}
      <Card className="bg-purple-50 border-purple-200">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-purple-100 rounded">
              <GitCommit className="w-5 h-5 text-purple-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-purple-900 mb-1">About ORBIT Commits</h3>
              <p className="text-sm text-purple-800">
                These commits are automatically generated by AI when tasks are completed.
                They follow the Conventional Commits specification and include detailed change descriptions.
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

            <div className="w-full md:w-48">
              <Select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                options={COMMIT_TYPES}
              />
            </div>

            <Button variant="outline" onClick={loadData} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>

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

      {/* Error */}
      {error && (
        <Card className="bg-red-50 border-red-200">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <div className="text-red-600">⚠️</div>
              <div>
                <h3 className="font-semibold text-red-900 mb-1">Error</h3>
                <p className="text-sm text-red-800">{error}</p>
                <Button variant="outline" size="sm" onClick={loadData} className="mt-3">
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
              <h3 className="text-lg font-medium text-gray-900 mb-2">No commits found</h3>
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
                        <p className="text-xs text-gray-600">{commit.changes.description}</p>
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
  );
}

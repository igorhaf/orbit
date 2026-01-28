/**
 * Commits Page
 * View Git commit history across all projects
 */

'use client';

import React, { useEffect, useState } from 'react';
import { Layout, Breadcrumbs } from '@/components/layout';
import { Card, CardContent, Button, Badge, Input, Select } from '@/components/ui';
import { projectsApi } from '@/lib/api';
import { Project } from '@/lib/types';
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

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function CommitsPage() {
  const [projects, setProjects] = useState<ProjectWithGit[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
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

  // Load projects on mount
  useEffect(() => {
    loadProjects();
  }, []);

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
      <Layout>
        <Breadcrumbs />
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
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

        {gitProjects.length === 0 ? (
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
        )}
      </div>
    </Layout>
  );
}

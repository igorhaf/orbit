/**
 * GitCommitsList Component
 * PROMPT #113 - Git Integration: Display Git commits from project code_path
 *
 * Shows real Git commit history from the project's repository
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, Button, Badge, Input } from '@/components/ui';
import { GitBranch, GitCommit, RefreshCw, Search, ChevronDown, ChevronUp, ExternalLink, Copy, Check, AlertCircle } from 'lucide-react';

interface GitCommitData {
  hash: string;
  short_hash: string;
  author_name: string;
  author_email: string;
  date: string;
  relative_date: string;
  subject: string;
  body?: string;
  files_changed?: number;
  insertions?: number;
  deletions?: number;
}

interface GitCommitsResponse {
  commits: GitCommitData[];
  total: number;
  branch: string;
  has_more: boolean;
}

interface GitBranchData {
  name: string;
  is_current: boolean;
  last_commit_hash?: string;
  last_commit_date?: string;
}

interface GitBranchesResponse {
  branches: GitBranchData[];
  current: string;
}

interface GitRepoInfo {
  is_git_repo: boolean;
  path: string;
  current_branch?: string;
  total_commits?: number;
  remote_url?: string;
  has_uncommitted_changes?: boolean;
}

interface Props {
  projectId: string;
}

export function GitCommitsList({ projectId }: Props) {
  const [commits, setCommits] = useState<GitCommitData[]>([]);
  const [branches, setBranches] = useState<GitBranchData[]>([]);
  const [repoInfo, setRepoInfo] = useState<GitRepoInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters and pagination
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [totalCommits, setTotalCommits] = useState(0);
  const [showBranches, setShowBranches] = useState(false);

  // Expanded commit details
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const COMMITS_PER_PAGE = 50;

  // Load repository info
  const loadRepoInfo = useCallback(async () => {
    try {
      const response = await fetch(`http://localhost:8000/api/v1/projects/${projectId}/git/info`);
      if (!response.ok) throw new Error('Failed to load repository info');
      const data: GitRepoInfo = await response.json();
      setRepoInfo(data);
      return data;
    } catch (err) {
      console.error('Failed to load repo info:', err);
      return null;
    }
  }, [projectId]);

  // Load branches
  const loadBranches = useCallback(async () => {
    try {
      const response = await fetch(`http://localhost:8000/api/v1/projects/${projectId}/git/branches`);
      if (!response.ok) throw new Error('Failed to load branches');
      const data: GitBranchesResponse = await response.json();
      setBranches(data.branches);
      if (!selectedBranch) {
        setSelectedBranch(data.current);
      }
    } catch (err) {
      console.error('Failed to load branches:', err);
    }
  }, [projectId, selectedBranch]);

  // Load commits
  const loadCommits = useCallback(async (reset: boolean = false) => {
    if (reset) {
      setLoading(true);
      setCurrentPage(0);
    } else {
      setLoadingMore(true);
    }
    setError(null);

    try {
      const skip = reset ? 0 : currentPage * COMMITS_PER_PAGE;
      const params = new URLSearchParams({
        skip: skip.toString(),
        limit: COMMITS_PER_PAGE.toString(),
      });

      if (selectedBranch) {
        params.append('branch', selectedBranch);
      }
      if (searchQuery) {
        params.append('search', searchQuery);
      }

      const response = await fetch(
        `http://localhost:8000/api/v1/projects/${projectId}/git/commits?${params}`
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to load commits');
      }

      const data: GitCommitsResponse = await response.json();

      if (reset) {
        setCommits(data.commits);
      } else {
        setCommits(prev => [...prev, ...data.commits]);
      }

      setTotalCommits(data.total);
      setHasMore(data.has_more);
      if (!selectedBranch) {
        setSelectedBranch(data.branch);
      }
    } catch (err: any) {
      console.error('Failed to load commits:', err);
      setError(err.message || 'Failed to load commits');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [projectId, selectedBranch, searchQuery, currentPage]);

  // Initial load
  useEffect(() => {
    const init = async () => {
      const info = await loadRepoInfo();
      if (info?.is_git_repo) {
        await loadBranches();
        await loadCommits(true);
      } else {
        setLoading(false);
      }
    };
    init();
  }, [projectId]);

  // Reload when branch changes
  useEffect(() => {
    if (selectedBranch && !loading) {
      loadCommits(true);
    }
  }, [selectedBranch]);

  // Handle search with debounce
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (!loading) {
        loadCommits(true);
      }
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  const handleLoadMore = () => {
    setCurrentPage(prev => prev + 1);
    loadCommits(false);
  };

  const handleRefresh = () => {
    loadRepoInfo();
    loadBranches();
    loadCommits(true);
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

  const handleBranchSelect = (branch: string) => {
    setSelectedBranch(branch);
    setShowBranches(false);
  };

  // Not a git repository
  if (!loading && repoInfo && !repoInfo.is_git_repo) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <AlertCircle className="w-16 h-16 mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Not a Git Repository</h3>
          <p className="text-gray-500 mb-4">
            The project folder is not initialized as a Git repository.
          </p>
          {repoInfo.path && (
            <p className="text-sm text-gray-400 font-mono">{repoInfo.path}</p>
          )}
        </CardContent>
      </Card>
    );
  }

  // Loading state
  if (loading) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="flex items-center justify-center">
            <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
            <span className="ml-3 text-gray-600">Loading commits...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="py-8 text-center">
          <AlertCircle className="w-12 h-12 mx-auto text-red-500 mb-4" />
          <h3 className="text-lg font-medium text-red-900 mb-2">Failed to Load Commits</h3>
          <p className="text-red-700 mb-4">{error}</p>
          <Button variant="outline" onClick={handleRefresh}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with repo info */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-gray-500" />
            <div className="relative">
              <button
                onClick={() => setShowBranches(!showBranches)}
                className="flex items-center gap-2 px-3 py-1.5 bg-white border rounded-md hover:bg-gray-50 transition-colors"
              >
                <span className="font-medium text-sm">{selectedBranch || 'Select branch'}</span>
                {showBranches ? (
                  <ChevronUp className="w-4 h-4 text-gray-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                )}
              </button>

              {showBranches && branches.length > 0 && (
                <div className="absolute top-full left-0 mt-1 w-64 bg-white border rounded-md shadow-lg z-10 max-h-64 overflow-y-auto">
                  {branches.map((branch) => (
                    <button
                      key={branch.name}
                      onClick={() => handleBranchSelect(branch.name)}
                      className={`w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between ${
                        branch.is_current ? 'bg-blue-50' : ''
                      }`}
                    >
                      <span className="text-sm truncate">{branch.name}</span>
                      {branch.is_current && (
                        <Badge variant="info" className="text-xs">current</Badge>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <span className="text-sm text-gray-500">
            {totalCommits.toLocaleString()} commits
          </span>

          {repoInfo?.has_uncommitted_changes && (
            <Badge variant="warning" className="text-xs">
              Uncommitted changes
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input
              type="text"
              placeholder="Search commits..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-64"
            />
          </div>

          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Commits list */}
      {commits.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-gray-500">
            <GitCommit className="w-16 h-16 mx-auto text-gray-300 mb-4" />
            <p className="text-lg font-medium">No commits found</p>
            <p className="text-sm mt-2">
              {searchQuery
                ? 'Try a different search term'
                : 'This branch has no commits yet'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {commits.map((commit) => (
            <Card
              key={commit.hash}
              className={`transition-all hover:shadow-md ${
                expandedCommit === commit.hash ? 'ring-2 ring-blue-500' : ''
              }`}
            >
              <CardContent className="py-3 px-4">
                <div className="flex items-start gap-3">
                  {/* Commit icon */}
                  <div className="flex-shrink-0 mt-1">
                    <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                      <GitCommit className="w-4 h-4 text-gray-600" />
                    </div>
                  </div>

                  {/* Commit details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <button
                        onClick={() => setExpandedCommit(
                          expandedCommit === commit.hash ? null : commit.hash
                        )}
                        className="text-left flex-1"
                      >
                        <p className="font-medium text-gray-900 hover:text-blue-600 transition-colors">
                          {commit.subject}
                        </p>
                      </button>

                      {/* Hash and copy button */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <code className="text-xs text-gray-500 font-mono bg-gray-100 px-2 py-0.5 rounded">
                          {commit.short_hash}
                        </code>
                        <button
                          onClick={() => handleCopyHash(commit.hash)}
                          className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                          title="Copy full hash"
                        >
                          {copiedHash === commit.hash ? (
                            <Check className="w-3.5 h-3.5 text-green-500" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Meta info */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <span className="font-medium">{commit.author_name}</span>
                      </span>
                      <span>{commit.relative_date}</span>
                      {commit.files_changed !== undefined && commit.files_changed !== null && (
                        <span className="flex items-center gap-1">
                          <span>{commit.files_changed} files</span>
                          {commit.insertions !== undefined && commit.insertions !== null && (
                            <span className="text-green-600">+{commit.insertions}</span>
                          )}
                          {commit.deletions !== undefined && commit.deletions !== null && (
                            <span className="text-red-600">-{commit.deletions}</span>
                          )}
                        </span>
                      )}
                    </div>

                    {/* Expanded body */}
                    {expandedCommit === commit.hash && commit.body && (
                      <div className="mt-3 pt-3 border-t">
                        <pre className="text-sm text-gray-600 whitespace-pre-wrap font-sans">
                          {commit.body}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {/* Load more button */}
          {hasMore && (
            <div className="text-center pt-4">
              <Button
                variant="outline"
                onClick={handleLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? (
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

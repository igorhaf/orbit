/**
 * GitCommitsList Component
 * PROMPT #113 - Git Integration: Display Git commits from project code_path
 * PROMPT #114 - Git Operations: Interactive Git history with operations
 *
 * Shows real Git commit history with PhpStorm-like operations
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, Button, Badge, Input } from '@/components/ui';
import {
  GitBranch, GitCommit, RefreshCw, Search, ChevronDown, ChevronUp,
  Copy, Check, AlertCircle, MoreVertical, Eye, GitBranchPlus,
  Undo2, Cherry, RotateCcw, FileCode, Plus, Minus, X,
  Archive, ArchiveRestore
} from 'lucide-react';

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

  // Action menu
  const [actionMenuCommit, setActionMenuCommit] = useState<string | null>(null);

  // Diff viewer
  const [diffData, setDiffData] = useState<GitCommitDiff | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  // Operation dialogs
  const [showBranchDialog, setShowBranchDialog] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [selectedCommitForAction, setSelectedCommitForAction] = useState<GitCommitData | null>(null);
  const [newBranchName, setNewBranchName] = useState('');
  const [resetMode, setResetMode] = useState<'soft' | 'mixed' | 'hard'>('mixed');
  const [operationLoading, setOperationLoading] = useState(false);
  const [operationResult, setOperationResult] = useState<{ success: boolean; message: string } | null>(null);

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

  // Load commit diff
  const loadDiff = async (commitHash: string) => {
    setLoadingDiff(true);
    try {
      const response = await fetch(
        `http://localhost:8000/api/v1/projects/${projectId}/git/commits/${commitHash}/diff`
      );
      if (!response.ok) throw new Error('Failed to load diff');
      const data: GitCommitDiff = await response.json();
      setDiffData(data);
      setShowDiff(true);
      // Expand first 3 files by default
      const initialExpanded = new Set(data.files.slice(0, 3).map(f => f.filename));
      setExpandedFiles(initialExpanded);
    } catch (err) {
      console.error('Failed to load diff:', err);
      setOperationResult({ success: false, message: 'Failed to load commit diff' });
    } finally {
      setLoadingDiff(false);
    }
  };

  // Git operations
  const executeGitOperation = async (
    operation: 'checkout' | 'branch' | 'revert' | 'cherry-pick' | 'reset' | 'stash' | 'stash/pop',
    commitHash?: string,
    extraData?: any
  ) => {
    setOperationLoading(true);
    try {
      const body: any = {};
      if (commitHash) body.commit_hash = commitHash;
      if (extraData?.branch_name) body.branch_name = extraData.branch_name;
      if (extraData?.reset_mode) body.reset_mode = extraData.reset_mode;

      const response = await fetch(
        `http://localhost:8000/api/v1/projects/${projectId}/git/${operation}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Operation failed');
      }

      setOperationResult({ success: true, message: data.message });

      // Refresh data after successful operation
      await loadRepoInfo();
      await loadBranches();
      await loadCommits(true);

      return true;
    } catch (err: any) {
      setOperationResult({ success: false, message: err.message || 'Operation failed' });
      return false;
    } finally {
      setOperationLoading(false);
      setShowBranchDialog(false);
      setShowResetDialog(false);
      setActionMenuCommit(null);
    }
  };

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

  // Auto-hide operation result
  useEffect(() => {
    if (operationResult) {
      const timeout = setTimeout(() => setOperationResult(null), 5000);
      return () => clearTimeout(timeout);
    }
  }, [operationResult]);

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

  const openActionMenu = (commit: GitCommitData, e: React.MouseEvent) => {
    e.stopPropagation();
    setActionMenuCommit(actionMenuCommit === commit.hash ? null : commit.hash);
  };

  const openBranchDialog = (commit: GitCommitData) => {
    setSelectedCommitForAction(commit);
    setNewBranchName(`branch-from-${commit.short_hash}`);
    setShowBranchDialog(true);
    setActionMenuCommit(null);
  };

  const openResetDialog = (commit: GitCommitData) => {
    setSelectedCommitForAction(commit);
    setResetMode('mixed');
    setShowResetDialog(true);
    setActionMenuCommit(null);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'A': return <Plus className="w-3 h-3 text-green-600" />;
      case 'D': return <Minus className="w-3 h-3 text-red-600" />;
      case 'M': return <FileCode className="w-3 h-3 text-yellow-600" />;
      default: return <FileCode className="w-3 h-3 text-gray-600" />;
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
      {/* Operation result notification */}
      {operationResult && (
        <div className={`p-4 rounded-lg flex items-center justify-between ${
          operationResult.success
            ? 'bg-green-50 border border-green-200'
            : 'bg-red-50 border border-red-200'
        }`}>
          <div className="flex items-center gap-2">
            {operationResult.success ? (
              <Check className="w-5 h-5 text-green-600" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-600" />
            )}
            <span className={operationResult.success ? 'text-green-800' : 'text-red-800'}>
              {operationResult.message}
            </span>
          </div>
          <button onClick={() => setOperationResult(null)}>
            <X className="w-4 h-4 text-gray-500 hover:text-gray-700" />
          </button>
        </div>
      )}

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
            <div className="flex items-center gap-2">
              <Badge variant="warning" className="text-xs">
                Uncommitted changes
              </Badge>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => executeGitOperation('stash')}
                title="Stash changes"
              >
                <Archive className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => executeGitOperation('stash/pop')}
            title="Pop stash"
          >
            <ArchiveRestore className="w-4 h-4" />
          </Button>

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

                      {/* Hash, copy button, and actions menu */}
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

                        {/* Actions menu */}
                        <div className="relative">
                          <button
                            onClick={(e) => openActionMenu(commit, e)}
                            className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                            title="Actions"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>

                          {actionMenuCommit === commit.hash && (
                            <div className="absolute right-0 top-full mt-1 w-48 bg-white border rounded-lg shadow-lg z-20 py-1">
                              <button
                                onClick={() => {
                                  loadDiff(commit.hash);
                                  setActionMenuCommit(null);
                                }}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                              >
                                <Eye className="w-4 h-4 text-blue-600" />
                                View Diff
                              </button>
                              <button
                                onClick={() => {
                                  executeGitOperation('checkout', commit.hash);
                                }}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                              >
                                <GitCommit className="w-4 h-4 text-purple-600" />
                                Checkout
                              </button>
                              <button
                                onClick={() => openBranchDialog(commit)}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                              >
                                <GitBranchPlus className="w-4 h-4 text-green-600" />
                                Create Branch
                              </button>
                              <button
                                onClick={() => {
                                  executeGitOperation('cherry-pick', commit.hash);
                                }}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                              >
                                <Cherry className="w-4 h-4 text-pink-600" />
                                Cherry-pick
                              </button>
                              <button
                                onClick={() => {
                                  executeGitOperation('revert', commit.hash);
                                }}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                              >
                                <Undo2 className="w-4 h-4 text-orange-600" />
                                Revert
                              </button>
                              <hr className="my-1" />
                              <button
                                onClick={() => openResetDialog(commit)}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-red-50 flex items-center gap-2 text-red-600"
                              >
                                <RotateCcw className="w-4 h-4" />
                                Reset to Here...
                              </button>
                            </div>
                          )}
                        </div>
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

      {/* Diff Viewer Modal */}
      {showDiff && diffData && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="p-4 border-b flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">{diffData.subject}</h2>
                <p className="text-sm text-gray-500">
                  {diffData.author_name} • {diffData.short_hash} • {diffData.stats.files_changed} files
                  <span className="text-green-600 ml-2">+{diffData.stats.insertions}</span>
                  <span className="text-red-600 ml-1">-{diffData.stats.deletions}</span>
                </p>
              </div>
              <button
                onClick={() => setShowDiff(false)}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* File list */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-3">
                {diffData.files.map((file) => (
                  <div key={file.filename} className="border rounded-lg overflow-hidden">
                    <button
                      onClick={() => {
                        const newExpanded = new Set(expandedFiles);
                        if (newExpanded.has(file.filename)) {
                          newExpanded.delete(file.filename);
                        } else {
                          newExpanded.add(file.filename);
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
                        {expandedFiles.has(file.filename) ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </div>
                    </button>

                    {expandedFiles.has(file.filename) && file.diff && (
                      <pre className="p-4 text-xs font-mono overflow-x-auto bg-gray-900 text-gray-100">
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
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Branch Dialog */}
      {showBranchDialog && selectedCommitForAction && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold mb-4">Create Branch</h3>
            <p className="text-sm text-gray-600 mb-4">
              Create a new branch from commit <code className="bg-gray-100 px-1 rounded">{selectedCommitForAction.short_hash}</code>
            </p>
            <Input
              placeholder="Branch name"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              className="mb-4"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowBranchDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => executeGitOperation('branch', selectedCommitForAction.hash, { branch_name: newBranchName })}
                disabled={!newBranchName || operationLoading}
              >
                {operationLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Create Branch'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Dialog */}
      {showResetDialog && selectedCommitForAction && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold mb-2 text-red-600">Reset to Commit</h3>
            <p className="text-sm text-gray-600 mb-4">
              Reset current branch to <code className="bg-gray-100 px-1 rounded">{selectedCommitForAction.short_hash}</code>
            </p>

            <div className="space-y-2 mb-4">
              <label className="flex items-center gap-2 p-2 border rounded hover:bg-gray-50 cursor-pointer">
                <input
                  type="radio"
                  name="resetMode"
                  value="soft"
                  checked={resetMode === 'soft'}
                  onChange={() => setResetMode('soft')}
                />
                <div>
                  <span className="font-medium">Soft</span>
                  <p className="text-xs text-gray-500">Keep changes staged</p>
                </div>
              </label>
              <label className="flex items-center gap-2 p-2 border rounded hover:bg-gray-50 cursor-pointer">
                <input
                  type="radio"
                  name="resetMode"
                  value="mixed"
                  checked={resetMode === 'mixed'}
                  onChange={() => setResetMode('mixed')}
                />
                <div>
                  <span className="font-medium">Mixed</span>
                  <p className="text-xs text-gray-500">Keep changes unstaged (default)</p>
                </div>
              </label>
              <label className="flex items-center gap-2 p-2 border border-red-200 rounded hover:bg-red-50 cursor-pointer">
                <input
                  type="radio"
                  name="resetMode"
                  value="hard"
                  checked={resetMode === 'hard'}
                  onChange={() => setResetMode('hard')}
                />
                <div>
                  <span className="font-medium text-red-600">Hard</span>
                  <p className="text-xs text-red-500">Discard ALL changes (dangerous!)</p>
                </div>
              </label>
            </div>

            {resetMode === 'hard' && (
              <div className="p-3 bg-red-50 border border-red-200 rounded mb-4">
                <p className="text-sm text-red-700">
                  ⚠️ Hard reset will permanently discard all uncommitted changes. This cannot be undone!
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowResetDialog(false)}>
                Cancel
              </Button>
              <Button
                variant={resetMode === 'hard' ? 'danger' : 'default'}
                onClick={() => executeGitOperation('reset', selectedCommitForAction.hash, { reset_mode: resetMode })}
                disabled={operationLoading}
              >
                {operationLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Reset'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Loading diff overlay */}
      {loadingDiff && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center">
          <div className="bg-white rounded-lg p-6 flex items-center gap-3">
            <RefreshCw className="w-6 h-6 text-blue-600 animate-spin" />
            <span>Loading diff...</span>
          </div>
        </div>
      )}

      {/* Click outside to close action menu */}
      {actionMenuCommit && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => setActionMenuCommit(null)}
        />
      )}
    </div>
  );
}

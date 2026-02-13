/**
 * Job Queue Manager Page
 *
 * PROMPT #135 - Complete job queue visualization with real-time updates
 *
 * Features:
 * - Real-time job status via WebSocket
 * - Filter by status, type, project
 * - Job statistics dashboard
 * - Cancel/delete actions
 * - Bulk cleanup operations
 */

'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
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
import { jobsApi, projectsApi, JobResponse } from '@/lib/api';
import {
  Activity,
  RefreshCw,
  Trash2,
  XCircle,
  CheckCircle,
  Clock,
  AlertCircle,
  PlayCircle,
  PauseCircle,
  Filter,
  BarChart3,
  List,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Wifi,
  WifiOff,
} from 'lucide-react';
import Link from 'next/link';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

// Status badge colors
const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  running: 'bg-blue-100 text-blue-800 border-blue-200',
  completed: 'bg-green-100 text-green-800 border-green-200',
  failed: 'bg-red-100 text-red-800 border-red-200',
  cancelled: 'bg-gray-100 text-gray-800 border-gray-200',
};

// Status icons
const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending: <Clock className="w-4 h-4" />,
  running: <PlayCircle className="w-4 h-4 animate-pulse" />,
  completed: <CheckCircle className="w-4 h-4" />,
  failed: <AlertCircle className="w-4 h-4" />,
  cancelled: <XCircle className="w-4 h-4" />,
};

interface JobStats {
  total_jobs: number;
  by_status: Record<string, number>;
  by_type: Record<string, number>;
  avg_duration_seconds: number;
  jobs_per_hour: Array<{ hour: string; count: number }>;
  error_rate: number;
  recent_errors: Array<{
    id: string;
    job_type: string;
    error: string;
    notification_title: string | null;
    completed_at: string | null;
  }>;
  time_range_hours: number;
}

interface Project {
  id: string;
  name: string;
}

export default function JobsPage() {
  // State
  const [jobs, setJobs] = useState<JobResponse[]>([]);
  const [stats, setStats] = useState<JobStats | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [jobTypes, setJobTypes] = useState<Array<{ value: string; label: string }>>([]);
  const [jobStatuses, setJobStatuses] = useState<Array<{ value: string; label: string }>>([]);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [projectFilter, setProjectFilter] = useState<string>('');

  // Pagination
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [limit] = useState(20);

  // Loading states
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingProjects, setLoadingProjects] = useState(true);

  // WebSocket for real-time updates
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // View mode
  const [viewMode, setViewMode] = useState<'list' | 'stats'>('list');

  // PROMPT #243 - Executor pause/resume state
  const [isPaused, setIsPaused] = useState(false);
  const [togglingPause, setTogglingPause] = useState(false);

  // PROMPT #145 - Confirm dialog state for cleanup
  const [cleanupConfirm, setCleanupConfirm] = useState<{
    open: boolean;
    days: number;
  }>({ open: false, days: 0 });

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
  const WS_URL = API_BASE.replace('http', 'ws');

  // Fetch jobs
  const fetchJobs = useCallback(async () => {
    setLoadingJobs(true);
    try {
      const response = await jobsApi.list({
        status: statusFilter || undefined,
        job_type: typeFilter || undefined,
        project_id: projectFilter || undefined,
        limit,
        offset,
        sort_by: 'created_at',
        sort_order: 'desc',
      });
      setJobs(response.jobs);
      setTotal(response.total);
    } catch (error) {
      console.error('Error fetching jobs:', error);
    } finally {
      setLoadingJobs(false);
    }
  }, [statusFilter, typeFilter, projectFilter, limit, offset]);

  // Fetch stats
  const fetchStats = useCallback(async () => {
    setLoadingStats(true);
    try {
      const response = await jobsApi.stats({
        project_id: projectFilter || undefined,
        hours: 24,
      });
      setStats(response);
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setLoadingStats(false);
    }
  }, [projectFilter]);

  // Fetch filter options
  useEffect(() => {
    const loadFilterOptions = async () => {
      try {
        const [typesRes, statusesRes] = await Promise.all([
          jobsApi.types(),
          jobsApi.statuses(),
        ]);
        setJobTypes(typesRes);
        setJobStatuses(statusesRes);
      } catch (error) {
        console.error('Error loading filter options:', error);
      }
    };
    loadFilterOptions();
  }, []);

  // PROMPT #243 - Fetch executor status on mount
  useEffect(() => {
    const loadExecutorStatus = async () => {
      try {
        const status = await jobsApi.executorStatus();
        setIsPaused(status.paused);
      } catch (error) {
        console.error('Error fetching executor status:', error);
      }
    };
    loadExecutorStatus();
  }, []);

  // PROMPT #243 - Toggle pause/resume
  const handleTogglePause = async () => {
    setTogglingPause(true);
    try {
      if (isPaused) {
        await jobsApi.resumeExecutor();
        setIsPaused(false);
      } else {
        await jobsApi.pauseExecutor();
        setIsPaused(true);
      }
    } catch (error) {
      console.error('Error toggling executor pause:', error);
    } finally {
      setTogglingPause(false);
    }
  };

  // Fetch projects
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

  // Fetch jobs when filters change
  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Fetch stats when project filter changes
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // PROMPT #135 FIX - Real WebSocket connection for job events (no polling!)
  useEffect(() => {
    const connect = () => {
      // Don't connect if already connected or connecting
      if (wsRef.current?.readyState === WebSocket.OPEN ||
          wsRef.current?.readyState === WebSocket.CONNECTING) {
        return;
      }

      try {
        const ws = new WebSocket(`${WS_URL}/api/v1/ws/notifications`);

        ws.onopen = () => {
          setIsConnected(true);
          console.log('🔔 Job Queue WebSocket connected');
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            handleWebSocketEvent(message);
          } catch (e) {
            console.error('Failed to parse WebSocket message:', e);
          }
        };

        ws.onclose = () => {
          setIsConnected(false);
          wsRef.current = null;

          // Reconnect with exponential backoff
          reconnectTimeoutRef.current = setTimeout(connect, 3000);
        };

        ws.onerror = (error) => {
          console.error('Job Queue WebSocket error:', error);
        };

        wsRef.current = ws;
      } catch (error) {
        console.error('Failed to create WebSocket:', error);
      }
    };

    // Handle incoming WebSocket events - update jobs in place
    const handleWebSocketEvent = (message: any) => {
      const { event, data } = message;

      if (!data?.job_id) return;

      // Update the jobs list in place (no re-fetch needed!)
      setJobs((prevJobs) => {
        const jobIndex = prevJobs.findIndex((j) => j.id === data.job_id);

        if (event === 'job_started') {
          if (jobIndex === -1) {
            // New job - add to beginning of list
            const newJob: JobResponse = {
              id: data.job_id,
              job_type: data.job_type,
              status: 'running',
              progress_percent: null,
              progress_message: null,
              result: null,
              error: null,
              created_at: new Date().toISOString(),
              started_at: new Date().toISOString(),
              completed_at: null,
              notification_title: data.notification_title,
            };
            return [newJob, ...prevJobs];
          }
          // Existing job - update status
          const updated = [...prevJobs];
          updated[jobIndex] = {
            ...updated[jobIndex],
            status: 'running',
            started_at: new Date().toISOString(),
          };
          return updated;
        }

        if (event === 'job_progress' && jobIndex !== -1) {
          const updated = [...prevJobs];
          updated[jobIndex] = {
            ...updated[jobIndex],
            progress_percent: data.progress_percent,
            progress_message: data.progress_message,
          };
          return updated;
        }

        if (event === 'job_completed' && jobIndex !== -1) {
          const updated = [...prevJobs];
          updated[jobIndex] = {
            ...updated[jobIndex],
            status: 'completed',
            progress_percent: 100,
            result: data.result,
            completed_at: new Date().toISOString(),
            deep_link: data.deep_link,
            notification_title: data.notification_title || updated[jobIndex].notification_title,
          };
          // Update stats when job completes
          fetchStats();
          return updated;
        }

        if (event === 'job_failed' && jobIndex !== -1) {
          const updated = [...prevJobs];
          updated[jobIndex] = {
            ...updated[jobIndex],
            status: 'failed',
            error: data.error,
            completed_at: new Date().toISOString(),
            deep_link: data.deep_link,
            notification_title: data.notification_title || updated[jobIndex].notification_title,
          };
          // Update stats when job fails
          fetchStats();
          return updated;
        }

        if (event === 'job_cancelled' && jobIndex !== -1) {
          const updated = [...prevJobs];
          updated[jobIndex] = {
            ...updated[jobIndex],
            status: 'cancelled',
            completed_at: new Date().toISOString(),
          };
          // Update stats when job is cancelled
          fetchStats();
          return updated;
        }

        return prevJobs;
      });

      // Also update stats count immediately for status changes
      if (['job_started', 'job_completed', 'job_failed', 'job_cancelled'].includes(event)) {
        setStats((prevStats) => {
          if (!prevStats) return prevStats;

          const newStats = { ...prevStats };
          const byStatus = { ...newStats.by_status };

          if (event === 'job_started') {
            byStatus.pending = Math.max(0, (byStatus.pending || 0) - 1);
            byStatus.running = (byStatus.running || 0) + 1;
          } else if (event === 'job_completed') {
            byStatus.running = Math.max(0, (byStatus.running || 0) - 1);
            byStatus.completed = (byStatus.completed || 0) + 1;
          } else if (event === 'job_failed') {
            byStatus.running = Math.max(0, (byStatus.running || 0) - 1);
            byStatus.failed = (byStatus.failed || 0) + 1;
          } else if (event === 'job_cancelled') {
            byStatus.running = Math.max(0, (byStatus.running || 0) - 1);
            byStatus.pending = Math.max(0, (byStatus.pending || 0) - 1);
            byStatus.cancelled = (byStatus.cancelled || 0) + 1;
          }

          newStats.by_status = byStatus;
          return newStats;
        });
      }
    };

    connect();

    // Ping every 30s to keep connection alive
    const pingInterval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ command: 'ping' }));
      }
    }, 30000);

    // Cleanup on unmount
    return () => {
      clearInterval(pingInterval);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [WS_URL, fetchStats]);

  // Actions
  const handleCancelJob = async (jobId: string) => {
    try {
      await jobsApi.cancel(jobId);
      fetchJobs();
      fetchStats();
    } catch (error) {
      console.error('Error cancelling job:', error);
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    try {
      await jobsApi.delete(jobId);
      fetchJobs();
      fetchStats();
    } catch (error) {
      console.error('Error deleting job:', error);
    }
  };

  // PROMPT #145 - Show confirmation dialog before cleanup
  const handleCleanupClick = (days: number) => {
    setCleanupConfirm({ open: true, days });
  };

  // PROMPT #145 - Execute cleanup after confirmation
  const handleCleanupConfirm = async () => {
    const { days } = cleanupConfirm;
    setCleanupConfirm({ open: false, days: 0 });

    try {
      const result = await jobsApi.cleanup(days);
      // Show success in a toast-like notification instead of crude alert
      console.log('Cleanup result:', result.message);
      fetchJobs();
      fetchStats();
    } catch (error) {
      console.error('Error cleaning up jobs:', error);
    }
  };

  // Format duration
  const formatDuration = (seconds: number): string => {
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  // Format date
  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  // Calculate pages
  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <Layout>
      <Breadcrumbs />
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-purple-100 rounded-lg">
              <Activity className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Job Queue</h1>
              <p className="text-gray-600 mt-1">
                Monitor and manage background jobs in real-time
                {isConnected && (
                  <span className="ml-2 inline-flex items-center gap-1 text-green-600">
                    <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                    Live
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* View Mode Toggle */}
            <div className="flex items-center bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 rounded ${viewMode === 'list' ? 'bg-white shadow' : ''}`}
              >
                <List className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('stats')}
                className={`p-2 rounded ${viewMode === 'stats' ? 'bg-white shadow' : ''}`}
              >
                <BarChart3 className="w-4 h-4" />
              </button>
            </div>

            {/* PROMPT #243 - Pause/Resume Queue */}
            <Button
              variant={isPaused ? 'default' : 'outline'}
              onClick={handleTogglePause}
              disabled={togglingPause}
              className={isPaused ? 'bg-red-600 hover:bg-red-700 text-white' : ''}
            >
              {isPaused ? (
                <>
                  <PlayCircle className="w-4 h-4 mr-2" />
                  Resume Queue
                </>
              ) : (
                <>
                  <PauseCircle className="w-4 h-4 mr-2" />
                  Pause Queue
                </>
              )}
            </Button>

            {/* Refresh */}
            <Button
              variant="outline"
              onClick={() => {
                fetchJobs();
                fetchStats();
              }}
              disabled={loadingJobs}
            >
              <RefreshCw className={`w-4 h-4 ${loadingJobs ? 'animate-spin' : ''}`} />
            </Button>

            {/* Cleanup Dropdown - PROMPT #145: uses ConfirmDialog */}
            <div className="relative group">
              <Button variant="outline">
                <Trash2 className="w-4 h-4 mr-2" />
                Cleanup
              </Button>
              <div className="absolute right-0 mt-1 w-48 bg-white border rounded-lg shadow-lg hidden group-hover:block z-10">
                <button
                  onClick={() => handleCleanupClick(0)}
                  className="w-full text-left px-4 py-2 hover:bg-gray-50 text-sm font-medium text-red-600"
                >
                  Delete all finished
                </button>
                <div className="border-t my-1"></div>
                <button
                  onClick={() => handleCleanupClick(1)}
                  className="w-full text-left px-4 py-2 hover:bg-gray-50 text-sm"
                >
                  Older than 1 day
                </button>
                <button
                  onClick={() => handleCleanupClick(7)}
                  className="w-full text-left px-4 py-2 hover:bg-gray-50 text-sm"
                >
                  Older than 7 days
                </button>
                <button
                  onClick={() => handleCleanupClick(30)}
                  className="w-full text-left px-4 py-2 hover:bg-gray-50 text-sm"
                >
                  Older than 30 days
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Stats Overview */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Total (24h)</p>
                    <p className="text-2xl font-bold">{stats.total_jobs}</p>
                  </div>
                  <Activity className="w-8 h-8 text-gray-400" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Running</p>
                    <p className="text-2xl font-bold text-blue-600">
                      {stats.by_status.running || 0}
                    </p>
                  </div>
                  <PlayCircle className="w-8 h-8 text-blue-400" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Pending</p>
                    <p className="text-2xl font-bold text-yellow-600">
                      {stats.by_status.pending || 0}
                    </p>
                  </div>
                  <Clock className="w-8 h-8 text-yellow-400" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Completed</p>
                    <p className="text-2xl font-bold text-green-600">
                      {stats.by_status.completed || 0}
                    </p>
                  </div>
                  <CheckCircle className="w-8 h-8 text-green-400" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Failed</p>
                    <p className="text-2xl font-bold text-red-600">
                      {stats.by_status.failed || 0}
                    </p>
                  </div>
                  <AlertCircle className="w-8 h-8 text-red-400" />
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Filters */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-col md:flex-row gap-4">
              {/* Status Filter */}
              <div className="w-full md:w-48">
                <Select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setOffset(0);
                  }}
                  options={[
                    { value: '', label: 'All Statuses' },
                    ...jobStatuses,
                  ]}
                />
              </div>

              {/* Type Filter */}
              <div className="w-full md:w-48">
                <Select
                  value={typeFilter}
                  onChange={(e) => {
                    setTypeFilter(e.target.value);
                    setOffset(0);
                  }}
                  options={[
                    { value: '', label: 'All Types' },
                    ...jobTypes,
                  ]}
                />
              </div>

              {/* Project Filter */}
              <div className="w-full md:w-64">
                <Select
                  value={projectFilter}
                  onChange={(e) => {
                    setProjectFilter(e.target.value);
                    setOffset(0);
                  }}
                  options={[
                    { value: '', label: 'All Projects' },
                    ...projects.map((p) => ({ value: p.id, label: p.name })),
                  ]}
                />
              </div>

              {/* Clear Filters */}
              {(statusFilter || typeFilter || projectFilter) && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setStatusFilter('');
                    setTypeFilter('');
                    setProjectFilter('');
                    setOffset(0);
                  }}
                >
                  Clear Filters
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Stats View */}
        {viewMode === 'stats' && stats && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Jobs by Type */}
            <Card>
              <CardHeader>
                <CardTitle>Jobs by Type (24h)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {Object.entries(stats.by_type)
                    .sort((a, b) => b[1] - a[1])
                    .map(([type, count]) => (
                      <div key={type} className="flex items-center justify-between">
                        <span className="text-sm text-gray-600">
                          {type.replace(/_/g, ' ')}
                        </span>
                        <div className="flex items-center gap-2">
                          <div
                            className="h-2 bg-purple-500 rounded"
                            style={{
                              width: `${(count / stats.total_jobs) * 200}px`,
                            }}
                          />
                          <span className="text-sm font-medium w-8 text-right">
                            {count}
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>

            {/* Performance Metrics */}
            <Card>
              <CardHeader>
                <CardTitle>Performance Metrics</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <span className="text-sm text-gray-600">Avg Duration</span>
                    <span className="font-medium">
                      {formatDuration(stats.avg_duration_seconds)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <span className="text-sm text-gray-600">Error Rate</span>
                    <span className={`font-medium ${stats.error_rate > 0.1 ? 'text-red-600' : 'text-green-600'}`}>
                      {(stats.error_rate * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <span className="text-sm text-gray-600">Success Rate</span>
                    <span className="font-medium text-green-600">
                      {((1 - stats.error_rate) * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Recent Errors */}
            {stats.recent_errors.length > 0 && (
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-red-600">Recent Errors</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {stats.recent_errors.map((error) => (
                      <div
                        key={error.id}
                        className="flex items-start justify-between p-3 bg-red-50 rounded-lg border border-red-100"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">
                            {error.notification_title || error.job_type.replace(/_/g, ' ')}
                          </p>
                          <p className="text-sm text-red-600 truncate">
                            {error.error}
                          </p>
                        </div>
                        <span className="text-xs text-gray-500 ml-4 whitespace-nowrap">
                          {formatDate(error.completed_at)}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Jobs List View */}
        {viewMode === 'list' && (
          <Card>
            <CardContent className="p-0">
              {loadingJobs ? (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
                    <p className="text-gray-600">Loading jobs...</p>
                  </div>
                </div>
              ) : jobs.length === 0 ? (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center">
                    <Activity className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">
                      No Jobs Found
                    </h3>
                    <p className="text-gray-600">
                      {statusFilter || typeFilter || projectFilter
                        ? 'Try adjusting your filters'
                        : 'No background jobs have been created yet'}
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Jobs Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
                            Status
                          </th>
                          <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
                            Priority
                          </th>
                          <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
                            Type
                          </th>
                          <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
                            Title
                          </th>
                          <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
                            Progress
                          </th>
                          <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
                            Created
                          </th>
                          <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
                            Duration
                          </th>
                          <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {jobs.map((job) => {
                          const duration =
                            job.started_at && job.completed_at
                              ? (new Date(job.completed_at).getTime() -
                                  new Date(job.started_at).getTime()) /
                                1000
                              : job.started_at
                              ? (Date.now() - new Date(job.started_at).getTime()) /
                                1000
                              : null;

                          return (
                            <tr key={job.id} className="hover:bg-gray-50">
                              <td className="px-4 py-3">
                                <span
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                                    STATUS_COLORS[job.status]
                                  }`}
                                >
                                  {STATUS_ICONS[job.status]}
                                  {job.status}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                {(() => {
                                  const p = (job as any).priority ?? 5;
                                  const label = p >= 10 ? 'Critical' : p >= 7 ? 'High' : p >= 5 ? 'Normal' : 'Low';
                                  const colors = p >= 10 ? 'bg-red-100 text-red-700 border-red-200' : p >= 7 ? 'bg-orange-100 text-orange-700 border-orange-200' : p >= 5 ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-gray-100 text-gray-600 border-gray-200';
                                  return (
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${colors}`}>
                                      {label}
                                    </span>
                                  );
                                })()}
                              </td>
                              <td className="px-4 py-3">
                                <span className="text-sm text-gray-600">
                                  {job.job_type.replace(/_/g, ' ')}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <div className="max-w-xs">
                                  <p className="text-sm font-medium text-gray-900 truncate">
                                    {job.notification_title || '-'}
                                  </p>
                                  {job.error && (
                                    <p className="text-xs text-red-500 truncate">
                                      {job.error}
                                    </p>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                {job.progress_percent !== null ? (
                                  <div className="w-32">
                                    <div className="flex items-center gap-2">
                                      <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                                        <div
                                          className="h-full bg-purple-500 rounded-full transition-all"
                                          style={{
                                            width: `${job.progress_percent}%`,
                                          }}
                                        />
                                      </div>
                                      <span className="text-xs text-gray-500 w-8">
                                        {Math.round(job.progress_percent)}%
                                      </span>
                                    </div>
                                    {job.progress_message && (
                                      <p className="text-xs text-gray-500 truncate mt-1">
                                        {job.progress_message}
                                      </p>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-sm text-gray-400">-</span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <span className="text-sm text-gray-600">
                                  {formatDate(job.created_at)}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <span className="text-sm text-gray-600">
                                  {duration !== null
                                    ? formatDuration(duration)
                                    : '-'}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-end gap-2">
                                  {/* Deep Link */}
                                  {job.deep_link && (
                                    <Link
                                      href={job.deep_link}
                                      className="p-1.5 text-gray-400 hover:text-purple-600 rounded"
                                      title="Go to result"
                                    >
                                      <ExternalLink className="w-4 h-4" />
                                    </Link>
                                  )}

                                  {/* Cancel (only for pending/running) */}
                                  {(job.status === 'pending' ||
                                    job.status === 'running') && (
                                    <button
                                      onClick={() => handleCancelJob(job.id)}
                                      className="p-1.5 text-gray-400 hover:text-yellow-600 rounded"
                                      title="Cancel job"
                                    >
                                      <PauseCircle className="w-4 h-4" />
                                    </button>
                                  )}

                                  {/* Delete (only for finished jobs) */}
                                  {(job.status === 'completed' ||
                                    job.status === 'failed' ||
                                    job.status === 'cancelled') && (
                                    <button
                                      onClick={() => handleDeleteJob(job.id)}
                                      className="p-1.5 text-gray-400 hover:text-red-600 rounded"
                                      title="Delete job"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
                    <div className="text-sm text-gray-500">
                      Showing {offset + 1} to {Math.min(offset + limit, total)} of{' '}
                      {total} jobs
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={offset === 0}
                        onClick={() => setOffset(Math.max(0, offset - limit))}
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                      <span className="text-sm text-gray-600">
                        Page {currentPage} of {totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={offset + limit >= total}
                        onClick={() => setOffset(offset + limit)}
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* PROMPT #145 - Styled Confirm Dialog for Cleanup */}
      <ConfirmDialog
        open={cleanupConfirm.open}
        onClose={() => setCleanupConfirm({ open: false, days: 0 })}
        onConfirm={handleCleanupConfirm}
        title="Cleanup Jobs"
        message={
          cleanupConfirm.days === 0
            ? 'Are you sure you want to delete ALL completed, failed and cancelled jobs? This action cannot be undone.'
            : `Are you sure you want to delete all completed and failed jobs older than ${cleanupConfirm.days} day${cleanupConfirm.days > 1 ? 's' : ''}? This action cannot be undone.`
        }
        confirmLabel="Delete Jobs"
        cancelLabel="Cancel"
        type="danger"
      />
    </Layout>
  );
}

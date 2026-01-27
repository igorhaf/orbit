/**
 * Consistency Report Page
 * Display and manage code consistency issues
 */

'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Layout, Breadcrumbs } from '@/components/layout';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { IssuesList } from '@/components/consistency/IssuesList';
import { consistencyApi } from '@/lib/api';
import { useNotification } from '@/hooks';

interface ConsistencyIssue {
  id: string;
  project_id: string;
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  file_path?: string;
  line_number?: number;
  suggested_fix?: string;
  status: 'open' | 'resolved' | 'ignored';
  created_at: string;
  resolved_at?: string;
}

export default function ConsistencyPage() {
  const params = useParams();
  const projectId = params.id as string;
  const { showError, NotificationComponent } = useNotification();

  const [issues, setIssues] = useState<ConsistencyIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('open');

  useEffect(() => {
    loadIssues();
  }, [projectId]);

  const loadIssues = async () => {
    try {
      setLoading(true);
      const response = await consistencyApi.list({ project_id: projectId });
      const data = response.data || response;
      setIssues(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load consistency issues:', error);
      setIssues([]); // Reset to empty array on error
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      await consistencyApi.analyze(projectId);
      await loadIssues();
    } catch (error) {
      console.error('Analysis failed:', error);
      showError('Failed to analyze consistency. Please try again.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleUpdateIssue = async (issueId: string, status: 'resolved' | 'ignored') => {
    try {
      await consistencyApi.update(issueId, { status });
      setIssues((prev) =>
        prev.map((issue) =>
          issue.id === issueId
            ? { ...issue, status, resolved_at: new Date().toISOString() }
            : issue
        )
      );
    } catch (error) {
      console.error('Failed to update issue:', error);
    }
  };

  // Filter issues
  const filteredIssues = (issues || []).filter((issue) => {
    if (filterStatus !== 'all' && issue.status !== filterStatus) return false;
    if (filterSeverity !== 'all' && issue.severity !== filterSeverity) return false;
    return true;
  });

  // Calculate statistics
  const stats = {
    total: issues?.length || 0,
    open: issues?.filter((i) => i.status === 'open').length || 0,
    resolved: issues?.filter((i) => i.status === 'resolved').length || 0,
    ignored: issues?.filter((i) => i.status === 'ignored').length || 0,
    critical: issues?.filter((i) => i.severity === 'critical' && i.status === 'open').length || 0,
    high: issues?.filter((i) => i.severity === 'high' && i.status === 'open').length || 0,
    medium: issues?.filter((i) => i.severity === 'medium' && i.status === 'open').length || 0,
    low: issues?.filter((i) => i.severity === 'low' && i.status === 'open').length || 0,
  };

  return (
    <Layout>
      <Breadcrumbs />
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Consistency Report</h1>
              <p className="text-gray-600 mt-2">
                Code quality and consistency issues detected in your project
              </p>
            </div>
            <Button
              variant="primary"
              onClick={handleAnalyze}
              disabled={analyzing}
            >
              {analyzing ? 'Analyzing...' : 'Run Analysis'}
            </Button>
          </div>
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total Issues</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
                </div>
                <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center">
                  <svg
                    className="w-6 h-6 text-gray-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Open</p>
                  <p className="text-2xl font-bold text-orange-600">{stats.open}</p>
                </div>
                <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center">
                  <svg
                    className="w-6 h-6 text-orange-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Resolved</p>
                  <p className="text-2xl font-bold text-green-600">{stats.resolved}</p>
                </div>
                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                  <svg
                    className="w-6 h-6 text-green-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Critical</p>
                  <p className="text-2xl font-bold text-red-600">{stats.critical}</p>
                </div>
                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                  <svg
                    className="w-6 h-6 text-red-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">Status:</label>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="rounded border-gray-300 text-sm focus:border-blue-500 focus:ring-blue-500"
                >
                  <option value="all">All</option>
                  <option value="open">Open</option>
                  <option value="resolved">Resolved</option>
                  <option value="ignored">Ignored</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">Severity:</label>
                <select
                  value={filterSeverity}
                  onChange={(e) => setFilterSeverity(e.target.value)}
                  className="rounded border-gray-300 text-sm focus:border-blue-500 focus:ring-blue-500"
                >
                  <option value="all">All</option>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>

              <div className="ml-auto flex items-center gap-2">
                <span className="text-sm text-gray-600">
                  Showing {filteredIssues.length} of {issues.length} issues
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Issues List */}
        {loading ? (
          <Card>
            <CardContent className="py-12 text-center text-gray-500">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p>Loading issues...</p>
            </CardContent>
          </Card>
        ) : (
          <IssuesList issues={filteredIssues} onUpdateIssue={handleUpdateIssue} />
        )}
        {NotificationComponent}
      </div>
    </Layout>
  );
}

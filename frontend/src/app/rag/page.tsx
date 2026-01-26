/**
 * RAG Analytics Dashboard Page
 *
 * PROMPT #110 - RAG Evolution Phase 3
 *
 * Dedicated page for RAG (Retrieval-Augmented Generation) analytics:
 * - Overall RAG performance metrics
 * - Documents indexed (including specs)
 * - Hit rate by usage type
 * - Sync status between specs and RAG
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
} from '@/components/ui';
import { RagStatsCard, StatCard } from '@/components/rag/RagStatsCard';
import { RagUsageTypeTable } from '@/components/rag/RagUsageTypeTable';
import { RagHitRatePieChart } from '@/components/rag/RagCharts';
import { RagStats } from '@/lib/types';
import { Database, RefreshCw, CheckCircle, AlertCircle, FileText } from 'lucide-react';

interface SpecSyncStatus {
  total_framework_specs: number;
  indexed_specs: number;
  pending_specs: number;
  sync_percentage: number;
}

interface SyncResult {
  message: string;
  results: {
    total: number;
    synced: number;
    skipped: number;
    errors: number;
    error_details: Array<{ spec_id: string; name: string; error: string }>;
  };
}

export default function RagPage() {
  const [ragStats, setRagStats] = useState<RagStats | null>(null);
  const [syncStatus, setSyncStatus] = useState<SpecSyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

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

  const fetchSyncStatus = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/v1/specs/sync-rag/status`);
      if (response.ok) {
        const data = await response.json();
        setSyncStatus(data);
      }
    } catch (error) {
      console.error('Error fetching sync status:', error);
    }
  }, [API_BASE]);

  const syncSpecsToRag = async () => {
    setSyncing(true);
    setLastSyncResult(null);
    try {
      const response = await fetch(`${API_BASE}/api/v1/specs/sync-rag`, {
        method: 'POST',
      });
      if (response.ok) {
        const data: SyncResult = await response.json();
        setLastSyncResult(data);
        // Refresh stats after sync
        await fetchRagStats();
        await fetchSyncStatus();
      }
    } catch (error) {
      console.error('Error syncing specs to RAG:', error);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([fetchRagStats(), fetchSyncStatus()]);
      setLoading(false);
    };
    loadData();
  }, [fetchRagStats, fetchSyncStatus]);

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
              fetchSyncStatus();
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

        {/* Specs Sync Status */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Database className="w-5 h-5 mr-2" />
              Specs RAG Sync Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Sync Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <StatCard
                  title="Total Framework Specs"
                  value={syncStatus?.total_framework_specs || 0}
                  icon={<FileText className="w-6 h-6 text-blue-600" />}
                  color="blue"
                />
                <StatCard
                  title="Indexed in RAG"
                  value={syncStatus?.indexed_specs || 0}
                  icon={<CheckCircle className="w-6 h-6 text-green-600" />}
                  color="green"
                />
                <StatCard
                  title="Pending Sync"
                  value={syncStatus?.pending_specs || 0}
                  icon={<AlertCircle className="w-6 h-6 text-yellow-600" />}
                  color="yellow"
                />
                <StatCard
                  title="Sync Percentage"
                  value={`${syncStatus?.sync_percentage || 0}%`}
                  icon={<Database className="w-6 h-6 text-purple-600" />}
                  color="purple"
                />
              </div>

              {/* Sync Button */}
              <div className="flex items-center space-x-4">
                <Button
                  onClick={syncSpecsToRag}
                  disabled={syncing}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {syncing ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Sync Specs to RAG
                    </>
                  )}
                </Button>

                {syncStatus?.pending_specs === 0 && (
                  <span className="text-green-600 flex items-center">
                    <CheckCircle className="w-4 h-4 mr-1" />
                    All specs synced
                  </span>
                )}
              </div>

              {/* Last Sync Result */}
              {lastSyncResult && (
                <div className="p-4 bg-gray-50 rounded-lg">
                  <h4 className="font-medium text-gray-700 mb-2">Last Sync Result</h4>
                  <div className="grid grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Total:</span>{' '}
                      <span className="font-medium">{lastSyncResult.results.total}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Synced:</span>{' '}
                      <span className="font-medium text-green-600">{lastSyncResult.results.synced}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Skipped:</span>{' '}
                      <span className="font-medium text-blue-600">{lastSyncResult.results.skipped}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Errors:</span>{' '}
                      <span className={`font-medium ${lastSyncResult.results.errors > 0 ? 'text-red-600' : 'text-gray-600'}`}>
                        {lastSyncResult.results.errors}
                      </span>
                    </div>
                  </div>
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
              <Button
                onClick={syncSpecsToRag}
                disabled={syncing}
                variant="outline"
              >
                {syncing ? 'Syncing...' : 'Sync Specs to RAG'}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}

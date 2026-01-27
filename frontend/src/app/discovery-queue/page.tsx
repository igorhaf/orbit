/**
 * Discovery Queue Page
 * Projects awaiting pattern discovery via RAG
 * PROMPT #77 - Project-Specific Specs Discovery Queue
 */

'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Layout, Breadcrumbs } from '@/components/layout';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '@/components/ui';
import {
  Search,
  Clock,
  CheckCircle,
  XCircle,
  Trash2,
  Play,
  AlertCircle,
  FolderSearch,
  RefreshCw
} from 'lucide-react';
import { useNotification } from '@/hooks';

interface DiscoveryQueueItem {
  id: string;
  project_id: string;
  task_id: string | null;
  reason: string | null;
  status: 'pending' | 'processing' | 'completed' | 'dismissed' | 'failed';
  created_at: string;
  processed_at: string | null;
  project?: {
    id: string;
    name: string;
    code_path: string;
  };
  task?: {
    id: string;
    title: string;
  };
}

const STATUS_CONFIG = {
  pending: { label: 'Pending', color: 'yellow', icon: Clock },
  processing: { label: 'Processing', color: 'blue', icon: RefreshCw },
  completed: { label: 'Completed', color: 'green', icon: CheckCircle },
  dismissed: { label: 'Dismissed', color: 'gray', icon: XCircle },
  failed: { label: 'Failed', color: 'red', icon: AlertCircle },
};

export default function DiscoveryQueuePage() {
  const router = useRouter();
  const { showError, NotificationComponent } = useNotification();
  const [items, setItems] = useState<DiscoveryQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<DiscoveryQueueItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    loadQueue();
  }, []);

  const loadQueue = async () => {
    setLoading(true);
    try {
      const response = await fetch('http://localhost:8000/api/v1/discovery-queue/');
      const data = await response.json();
      setItems(data);
    } catch (error) {
      console.error('Failed to load discovery queue:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleProcess = async (item: DiscoveryQueueItem) => {
    setProcessingId(item.id);
    try {
      await fetch(`http://localhost:8000/api/v1/discovery-queue/${item.id}/process`, {
        method: 'POST',
      });
      loadQueue();
    } catch (error) {
      console.error('Failed to process item:', error);
      showError('Failed to process item. Please try again.');
    } finally {
      setProcessingId(null);
    }
  };

  const handleDismiss = async (item: DiscoveryQueueItem) => {
    try {
      await fetch(`http://localhost:8000/api/v1/discovery-queue/${item.id}/dismiss`, {
        method: 'POST',
      });
      loadQueue();
    } catch (error) {
      console.error('Failed to dismiss item:', error);
    }
  };

  const handleDelete = (item: DiscoveryQueueItem) => {
    setItemToDelete(item);
    setShowDeleteDialog(true);
  };

  const confirmDelete = async () => {
    if (!itemToDelete) return;

    setIsDeleting(true);
    try {
      await fetch(`http://localhost:8000/api/v1/discovery-queue/${itemToDelete.id}`, {
        method: 'DELETE',
      });
      setShowDeleteDialog(false);
      setItemToDelete(null);
      loadQueue();
    } catch (error) {
      console.error('Failed to delete item:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleClearCompleted = async () => {
    try {
      await fetch('http://localhost:8000/api/v1/discovery-queue/?status=completed', {
        method: 'DELETE',
      });
      loadQueue();
    } catch (error) {
      console.error('Failed to clear completed items:', error);
    }
  };

  const filteredItems = items.filter(item => {
    if (filterStatus === 'all') return true;
    return item.status === filterStatus;
  });

  const stats = {
    total: items.length,
    pending: items.filter(i => i.status === 'pending').length,
    processing: items.filter(i => i.status === 'processing').length,
    completed: items.filter(i => i.status === 'completed').length,
    failed: items.filter(i => i.status === 'failed').length,
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  return (
    <Layout>
      {/* Breadcrumb and action button */}
      <div className="flex justify-between items-center mb-6">
        <Breadcrumbs />
        <div className="flex gap-3">
          <Button variant="secondary" onClick={loadQueue}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          {stats.completed > 0 && (
            <Button variant="ghost" onClick={handleClearCompleted}>
              <Trash2 className="w-4 h-4 mr-2" />
              Clear Completed
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Discovery Queue</h1>
          <p className="mt-2 text-gray-600">
            Projects awaiting pattern discovery. When task execution happens without specs,
            projects are queued here for manual validation and pattern discovery.
          </p>
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-5 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-sm text-gray-500">Total</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{stats.total}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <Clock className="w-5 h-5 mx-auto text-yellow-600 mb-1" />
                <p className="text-sm text-gray-500">Pending</p>
                <p className="text-3xl font-bold text-yellow-600 mt-1">{stats.pending}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <RefreshCw className="w-5 h-5 mx-auto text-blue-600 mb-1" />
                <p className="text-sm text-gray-500">Processing</p>
                <p className="text-3xl font-bold text-blue-600 mt-1">{stats.processing}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <CheckCircle className="w-5 h-5 mx-auto text-green-600 mb-1" />
                <p className="text-sm text-gray-500">Completed</p>
                <p className="text-3xl font-bold text-green-600 mt-1">{stats.completed}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <AlertCircle className="w-5 h-5 mx-auto text-red-600 mb-1" />
                <p className="text-sm text-gray-500">Failed</p>
                <p className="text-3xl font-bold text-red-600 mt-1">{stats.failed}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex gap-4">
              <select
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="all">All Status</option>
                <option value="pending">Pending</option>
                <option value="processing">Processing</option>
                <option value="completed">Completed</option>
                <option value="dismissed">Dismissed</option>
                <option value="failed">Failed</option>
              </select>
            </div>
          </CardContent>
        </Card>

        {/* Queue Table */}
        <Card>
          <CardHeader>
            <CardTitle>
              Queue Items ({filteredItems.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="text-center py-12">
                <FolderSearch className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">No items in queue</p>
                <p className="text-sm text-gray-400 mt-1">
                  Projects without specs will appear here during task execution
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Project
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Reason
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Related Task
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Created
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredItems.map((item) => {
                      const statusConfig = STATUS_CONFIG[item.status];
                      const StatusIcon = statusConfig.icon;

                      return (
                        <tr key={item.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div>
                              <div className="text-sm font-medium text-gray-900">
                                {item.project?.name || 'Unknown Project'}
                              </div>
                              <div className="text-xs text-gray-500">
                                {item.project?.code_path || 'No path configured'}
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="text-sm text-gray-600 max-w-xs truncate">
                              {item.reason || 'No specs found during task execution'}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {item.task ? (
                              <div className="text-sm text-gray-900">
                                {item.task.title}
                              </div>
                            ) : (
                              <span className="text-sm text-gray-400">-</span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <Badge
                              variant={
                                item.status === 'completed' ? 'success' :
                                item.status === 'failed' ? 'destructive' :
                                item.status === 'processing' ? 'default' :
                                'secondary'
                              }
                            >
                              <StatusIcon className="w-3 h-3 mr-1" />
                              {statusConfig.label}
                            </Badge>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-600">
                              {formatDate(item.created_at)}
                            </div>
                            {item.processed_at && (
                              <div className="text-xs text-gray-400">
                                Processed: {formatDate(item.processed_at)}
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <div className="flex justify-end gap-2">
                              {item.status === 'pending' && (
                                <>
                                  <Button
                                    variant="primary"
                                    size="sm"
                                    onClick={() => handleProcess(item)}
                                    disabled={processingId === item.id}
                                  >
                                    {processingId === item.id ? (
                                      <RefreshCw className="w-4 h-4 animate-spin" />
                                    ) : (
                                      <>
                                        <Play className="w-4 h-4 mr-1" />
                                        Discover
                                      </>
                                    )}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleDismiss(item)}
                                  >
                                    <XCircle className="w-4 h-4" />
                                  </Button>
                                </>
                              )}
                              {item.status === 'failed' && (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => handleProcess(item)}
                                  disabled={processingId === item.id}
                                >
                                  <RefreshCw className="w-4 h-4 mr-1" />
                                  Retry
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDelete(item)}
                                className="text-red-600 hover:text-red-700"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Info Card */}
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <Search className="w-6 h-6 text-blue-600 flex-shrink-0" />
              <div className="flex-1">
                <h3 className="font-semibold text-blue-900 mb-1">
                  How Pattern Discovery Works
                </h3>
                <p className="text-sm text-blue-800">
                  When a task is executed for a project without discovered specs, the project is added to this queue.
                  Click "Discover" to analyze the project's codebase using RAG and extract code patterns.
                  Discovered patterns are saved as project-specific specs and used for future task execution.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Queue Item?</h3>
            <p className="text-sm text-gray-600 mb-4">
              Are you sure you want to remove this item from the discovery queue?
            </p>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowDeleteDialog(false)}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={confirmDelete}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Yes, Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {NotificationComponent}
    </Layout>
  );
}

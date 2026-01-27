/**
 * Edit AI Model Page
 * View and edit an AI model configuration
 */

'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Layout, Breadcrumbs } from '@/components/layout';
import { ModelForm } from '@/components/models';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { aiModelsApi } from '@/lib/api';
import { AIModel, AIModelUpdate } from '@/lib/types';
import { ArrowLeft, Cpu, Trash2, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useNotification } from '@/hooks';

export default function EditModelPage() {
  const params = useParams();
  const router = useRouter();
  const modelId = params.id as string;
  const { showError, showWarning, NotificationComponent } = useNotification();

  const [model, setModel] = useState<AIModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadModel();
  }, [modelId]);

  const loadModel = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await aiModelsApi.get(modelId);
      setModel(data);
    } catch (err: any) {
      console.error('Failed to load model:', err);
      setError(err.message || 'Failed to load model');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (updates: AIModelUpdate) => {
    if (!model) return;

    try {
      const updated = await aiModelsApi.update(modelId, updates);
      setModel(updated);
    } catch (error: any) {
      console.error('Failed to update model:', error);
      throw error; // Re-throw to let the form handle the error
    }
  };

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = async () => {
    if (!model) return;

    setShowDeleteConfirm(false);
    setDeleting(true);
    try {
      await aiModelsApi.delete(modelId);
      router.push('/models');
    } catch (error: any) {
      console.error('Failed to delete model:', error);
      showError(`Failed to delete model: ${error.message}`);
      setDeleting(false);
    }
  };

  const handleCancel = () => {
    router.push('/models');
  };

  if (loading) {
    return (
      <Layout>
        <Breadcrumbs />
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <Loader2 className="w-12 h-12 mx-auto mb-4 text-indigo-600 animate-spin" />
            <p className="text-gray-600">Loading model...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (error || !model) {
    return (
      <Layout>
        <Breadcrumbs />
        <Card className="bg-red-50 border-red-200">
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <div className="text-red-600 text-4xl mb-4">⚠️</div>
              <h3 className="text-lg font-semibold text-red-900 mb-2">
                Failed to Load Model
              </h3>
              <p className="text-red-800 mb-4">
                {error || 'Model not found'}
              </p>
              <Link href="/models">
                <Button variant="outline">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Models
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </Layout>
    );
  }

  return (
    <Layout>
      <Breadcrumbs />
      <div className="space-y-6 max-w-4xl">
        {/* Back Button */}
        <Link href="/models">
          <Button variant="outline" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Models
          </Button>
        </Link>

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-indigo-100 rounded-lg">
              <Cpu className="w-6 h-6 text-indigo-600" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-3xl font-bold text-gray-900">{model.name}</h1>
                {model.is_active ? (
                  <Badge variant="success">Active</Badge>
                ) : (
                  <Badge variant="default">Inactive</Badge>
                )}
              </div>
              <p className="text-gray-600 mt-1">
                Edit AI model configuration
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={handleDeleteClick}
            disabled={deleting}
            className="text-red-600 hover:text-red-700 hover:border-red-300"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </div>

        {/* Info Card */}
        <Card className="bg-yellow-50 border-yellow-200">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <div className="text-yellow-600 text-xl">⚠️</div>
              <div className="flex-1">
                <h3 className="font-semibold text-yellow-900 mb-1">
                  Important Notes
                </h3>
                <ul className="text-sm text-yellow-800 space-y-1 list-disc list-inside">
                  <li>Changing the usage type may affect existing workflows</li>
                  <li>Deactivating this model will prevent it from being used</li>
                  <li>API key changes take effect immediately</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Form */}
        <ModelForm
          model={model}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      </div>

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Delete Model
            </h3>
            <p className="text-gray-600 mb-4">
              Are you sure you want to delete "{model?.name}"? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={handleDeleteConfirm}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}

      {NotificationComponent}
    </Layout>
  );
}

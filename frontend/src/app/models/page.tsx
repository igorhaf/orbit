/**
 * AI Models List Page
 * View and manage AI model configurations
 */

'use client';

import React, { useEffect, useState } from 'react';
import { Layout, Breadcrumbs } from '@/components/layout';
import { ModelsList } from '@/components/models';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { aiModelsApi } from '@/lib/api';
import { AIModel } from '@/lib/types';
import { Cpu, Plus, RefreshCw, Settings } from 'lucide-react';
import Link from 'next/link';

export default function ModelsPage() {
  const [models, setModels] = useState<AIModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadModels = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await aiModelsApi.list();
      setModels(Array.isArray(data) ? data : data.data || []);
    } catch (err: any) {
      console.error('Failed to load models:', err);
      setError(err.message || 'Failed to load AI models');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadModels();
  }, []);

  return (
    <Layout>
      <Breadcrumbs />
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-indigo-100 rounded-lg">
              <Cpu className="w-6 h-6 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">AI Models</h1>
              <p className="text-gray-600 mt-1">
                Configure and manage AI model integrations
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={loadModels}
              disabled={loading}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Link href="/models/new">
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Add Model
              </Button>
            </Link>
          </div>
        </div>

        {/* Info Card */}
        <Card className="bg-indigo-50 border-indigo-200">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-indigo-100 rounded">
                <Settings className="w-5 h-5 text-indigo-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-indigo-900 mb-1">
                  About AI Models
                </h3>
                <p className="text-sm text-indigo-800">
                  AI models are configured per usage type (interviews, prompt generation,
                  task execution, etc.). Make sure to set different models for different
                  purposes to optimize for cost and performance.
                </p>
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
                    onClick={loadModels}
                    className="mt-3"
                  >
                    Try Again
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Models List */}
        {!error && <ModelsList models={models} loading={loading} />}

        {/* Help Section */}
        {!loading && models.length === 0 && !error && (
          <Card className="bg-gray-50 border-gray-200">
            <CardContent className="pt-6">
              <div className="text-center py-8">
                <Cpu className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  Get Started with AI Models
                </h3>
                <p className="text-gray-600 mb-4 max-w-md mx-auto">
                  Add your first AI model to start using ORBIT's intelligent features.
                  You can configure models from Anthropic, OpenAI, Google, or local Ollama.
                </p>
                <Link href="/models/new">
                  <Button>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Your First Model
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}

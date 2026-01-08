/**
 * Prompt Detail Page
 * View and edit individual prompt with version history
 */

'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Layout, Breadcrumbs } from '@/components/layout';
import { PromptEditor, PromptVersionHistory } from '@/components/prompts';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { promptsApi } from '@/lib/api';
import { Prompt } from '@/lib/types';
import { ArrowLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';

export default function PromptDetailPage() {
  const params = useParams();
  const router = useRouter();
  const promptId = params.id as string;

  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [versions, setVersions] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showVersionHistory, setShowVersionHistory] = useState(false);

  useEffect(() => {
    loadPrompt();
    loadVersions();
  }, [promptId]);

  const loadPrompt = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await promptsApi.get(promptId);
      setPrompt(data);
    } catch (err: any) {
      console.error('Failed to load prompt:', err);
      setError(err.message || 'Failed to load prompt');
    } finally {
      setLoading(false);
    }
  };

  const loadVersions = async () => {
    try {
      const data = await promptsApi.versions(promptId);
      setVersions(data);
    } catch (err: any) {
      console.error('Failed to load versions:', err);
      // Don't show error for versions, just log it
    }
  };

  const handleSave = async (updates: Partial<Prompt>) => {
    if (!prompt) return;

    try {
      const updated = await promptsApi.update(promptId, updates);
      setPrompt(updated);
      // Reload versions to show the new version
      await loadVersions();
    } catch (err: any) {
      console.error('Failed to update prompt:', err);
      throw err; // Re-throw to let PromptEditor handle the error
    }
  };

  const handleVersionSelect = (version: Prompt) => {
    // Navigate to the selected version
    router.push(`/prompts/${version.id}`);
  };

  if (loading) {
    return (
      <Layout>
        <Breadcrumbs />
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <Loader2 className="w-12 h-12 mx-auto mb-4 text-blue-600 animate-spin" />
            <p className="text-gray-600">Loading prompt...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (error || !prompt) {
    return (
      <Layout>
        <Breadcrumbs />
        <Card className="bg-red-50 border-red-200">
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <div className="text-red-600 text-4xl mb-4">⚠️</div>
              <h3 className="text-lg font-semibold text-red-900 mb-2">
                Failed to Load Prompt
              </h3>
              <p className="text-red-800 mb-4">
                {error || 'Prompt not found'}
              </p>
              <Link href="/prompts">
                <Button variant="outline">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Prompts
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
      <div className="space-y-6">
        {/* Back Button */}
        <Link href="/prompts">
          <Button variant="outline" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Prompts
          </Button>
        </Link>

        {/* Version History Toggle */}
        {versions.length > 1 && (
          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={() => setShowVersionHistory(!showVersionHistory)}
            >
              {showVersionHistory ? 'Hide' : 'Show'} Version History ({versions.length})
            </Button>
          </div>
        )}

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Prompt Editor */}
          <div className={showVersionHistory ? 'lg:col-span-2' : 'lg:col-span-3'}>
            <PromptEditor
              prompt={prompt}
              onSave={handleSave}
            />
          </div>

          {/* Version History Sidebar */}
          {showVersionHistory && versions.length > 1 && (
            <div className="lg:col-span-1">
              <PromptVersionHistory
                versions={versions}
                currentVersionId={prompt.id}
                onVersionSelect={handleVersionSelect}
              />
            </div>
          )}
        </div>

        {/* Related Information */}
        {prompt.created_from_interview_id && (
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <div className="text-blue-600 text-xl">💬</div>
                <div>
                  <h3 className="font-semibold text-blue-900 mb-1">
                    Generated from Interview
                  </h3>
                  <p className="text-sm text-blue-800 mb-3">
                    This prompt was automatically generated from an interview session.
                  </p>
                  <Link href={`/projects/${prompt.project_id}/interviews/${prompt.created_from_interview_id}`}>
                    <Button variant="outline" size="sm">
                      View Interview
                    </Button>
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}

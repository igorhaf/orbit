/**
 * New AI Model Page
 * Create a new AI model configuration
 */

'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Layout, Breadcrumbs } from '@/components/layout';
import { ModelForm } from '@/components/models';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { aiModelsApi } from '@/lib/api';
import { AIModelCreate } from '@/lib/types';
import { ArrowLeft, Cpu } from 'lucide-react';
import Link from 'next/link';

export default function NewModelPage() {
  const router = useRouter();

  const handleSubmit = async (data: AIModelCreate) => {
    try {
      const created = await aiModelsApi.create(data);
      // Navigate to the created model's page
      router.push(`/models/${created.id}`);
    } catch (error: any) {
      console.error('Failed to create model:', error);
      throw error; // Re-throw to let the form handle the error
    }
  };

  const handleCancel = () => {
    router.push('/models');
  };

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
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-100 rounded-lg">
            <Cpu className="w-6 h-6 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Add AI Model</h1>
            <p className="text-gray-600 mt-1">
              Configure a new AI model for use in ORBIT
            </p>
          </div>
        </div>

        {/* Info Card */}
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <div className="text-blue-600 text-xl">💡</div>
              <div className="flex-1">
                <h3 className="font-semibold text-blue-900 mb-1">
                  Configuration Tips
                </h3>
                <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
                  <li>Choose the right usage type for optimal performance</li>
                  <li>Use Claude for interviews and complex reasoning</li>
                  <li>Use GPT-4 Turbo for fast task execution</li>
                  <li>Keep sensitive API keys secure - they're encrypted at rest</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Form */}
        <ModelForm onSubmit={handleSubmit} onCancel={handleCancel} />
      </div>
    </Layout>
  );
}

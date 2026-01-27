/**
 * Project Analyzer Page
 * Upload and analyze existing codebases
 */

'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Layout, Breadcrumbs } from '@/components/layout';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FileUploader } from '@/components/analyzer/FileUploader';
import { AnalysisResults } from '@/components/analyzer/AnalysisResults';
import { analyzersApi } from '@/lib/api';
import { useNotification } from '@/hooks';

interface Analysis {
  id: string;
  status: 'uploaded' | 'analyzing' | 'completed' | 'failed';
  original_filename: string;
  file_size_bytes: number;
  detected_stack?: string;
  confidence_score?: number;
  file_structure?: any;
  conventions?: any;
  patterns?: any;
  dependencies?: any;
  orchestrator_generated?: boolean;
  orchestrator_key?: string;
  created_at: string;
  completed_at?: string;
}

export default function AnalyzePage() {
  const params = useParams();
  const projectId = params.id as string;
  const { showError, showSuccess, NotificationComponent } = useNotification();

  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [selectedAnalysis, setSelectedAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    loadAnalyses();
  }, [projectId]);

  const loadAnalyses = async () => {
    try {
      setLoading(true);
      const response = await analyzersApi.list({ project_id: projectId });
      const data = response.data || response;
      const analyses = Array.isArray(data) ? data : [];
      setAnalyses(analyses);

      // Auto-select the most recent analysis
      if (analyses.length > 0) {
        setSelectedAnalysis(analyses[0]);
      }
    } catch (error) {
      console.error('Failed to load analyses:', error);
      setAnalyses([]); // Reset to empty array on error
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('project_id', projectId);

      const response = await analyzersApi.upload(formData);
      const newAnalysis = response.data;

      setAnalyses((prev) => [newAnalysis, ...prev]);
      setSelectedAnalysis(newAnalysis);

      // Poll for analysis completion
      pollAnalysisStatus(newAnalysis.id);
    } catch (error) {
      console.error('Upload failed:', error);
      showError('Failed to upload file. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const pollAnalysisStatus = async (analysisId: string) => {
    const interval = setInterval(async () => {
      try {
        const response = await analyzersApi.get(analysisId);
        const updatedAnalysis = response.data;

        setAnalyses((prev) =>
          prev.map((a) => (a.id === analysisId ? updatedAnalysis : a))
        );

        if (selectedAnalysis?.id === analysisId) {
          setSelectedAnalysis(updatedAnalysis);
        }

        if (updatedAnalysis.status === 'completed' || updatedAnalysis.status === 'failed') {
          clearInterval(interval);
        }
      } catch (error) {
        console.error('Failed to poll analysis status:', error);
        clearInterval(interval);
      }
    }, 3000); // Poll every 3 seconds
  };

  const handleGenerateOrchestrator = async () => {
    if (!selectedAnalysis) return;

    try {
      await analyzersApi.generateOrchestrator(selectedAnalysis.id);
      showSuccess('Orchestrator generated successfully!');
      loadAnalyses();
    } catch (error) {
      console.error('Failed to generate orchestrator:', error);
      showError('Failed to generate orchestrator. Please try again.');
    }
  };

  return (
    <Layout>
      <Breadcrumbs />
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Project Analyzer</h1>
          <p className="text-gray-600 mt-2">
            Upload an existing project to analyze its structure, conventions, and patterns
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Upload & History */}
          <div className="lg:col-span-1 space-y-6">
            {/* File Uploader */}
            <Card>
              <CardHeader>
                <CardTitle>Upload Project</CardTitle>
              </CardHeader>
              <CardContent>
                <FileUploader
                  onUpload={handleFileUpload}
                  uploading={uploading}
                  accept=".zip,.tar.gz"
                  maxSize={100 * 1024 * 1024} // 100MB
                />
              </CardContent>
            </Card>

            {/* Analysis History */}
            <Card>
              <CardHeader>
                <CardTitle>Analysis History</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="text-center py-4 text-gray-500">Loading...</div>
                ) : analyses.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <p>No analyses yet</p>
                    <p className="text-sm mt-1">Upload a project to get started</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {analyses.map((analysis) => (
                      <button
                        key={analysis.id}
                        onClick={() => setSelectedAnalysis(analysis)}
                        className={`w-full text-left p-3 rounded border transition-colors ${
                          selectedAnalysis?.id === analysis.id
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">
                              {analysis.original_filename}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              {new Date(analysis.created_at).toLocaleString()}
                            </div>
                          </div>
                          <StatusBadge status={analysis.status} />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right: Analysis Results */}
          <div className="lg:col-span-2">
            {selectedAnalysis ? (
              <AnalysisResults
                analysis={selectedAnalysis}
                onGenerateOrchestrator={handleGenerateOrchestrator}
              />
            ) : (
              <Card>
                <CardContent className="py-16">
                  <div className="text-center text-gray-500">
                    <svg
                      className="w-16 h-16 mx-auto mb-4 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    <p className="text-lg font-medium">No analysis selected</p>
                    <p className="text-sm mt-2">
                      Upload a project or select from history to view results
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
      {NotificationComponent}
    </Layout>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles = {
    uploaded: 'bg-gray-200 text-gray-700',
    analyzing: 'bg-blue-500 text-white animate-pulse',
    completed: 'bg-green-500 text-white',
    failed: 'bg-red-500 text-white',
  };

  const icons = {
    uploaded: '📤',
    analyzing: '🔍',
    completed: '✅',
    failed: '❌',
  };

  return (
    <span
      className={`px-2 py-1 rounded text-xs font-semibold ${
        styles[status as keyof typeof styles] || 'bg-gray-200 text-gray-700'
      }`}
    >
      {icons[status as keyof typeof icons]} {status.toUpperCase()}
    </span>
  );
}

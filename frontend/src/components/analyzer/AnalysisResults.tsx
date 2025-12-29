/**
 * AnalysisResults Component
 * Display analysis results with detected patterns and conventions
 */

import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

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

interface Props {
  analysis: Analysis;
  onGenerateOrchestrator: () => void;
}

export function AnalysisResults({ analysis, onGenerateOrchestrator }: Props) {
  const [activeTab, setActiveTab] = useState<'overview' | 'structure' | 'conventions' | 'patterns'>('overview');

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const renderStatusMessage = () => {
    switch (analysis.status) {
      case 'uploaded':
        return (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <p className="text-gray-700">File uploaded successfully. Waiting to start analysis...</p>
          </div>
        );
      case 'analyzing':
        return (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-blue-700 font-medium">Analyzing your project...</p>
            </div>
            <p className="text-sm text-blue-600 mt-2">
              This may take a few minutes depending on project size.
            </p>
          </div>
        );
      case 'failed':
        return (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-700 font-medium">Analysis failed</p>
            <p className="text-sm text-red-600 mt-1">
              Please try uploading again or contact support if the issue persists.
            </p>
          </div>
        );
      default:
        return null;
    }
  };

  if (analysis.status !== 'completed') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Analysis Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <p className="text-sm text-gray-600">File:</p>
              <p className="font-medium">{analysis.original_filename}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Size:</p>
              <p className="font-medium">{formatBytes(analysis.file_size_bytes)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Uploaded:</p>
              <p className="font-medium">{new Date(analysis.created_at).toLocaleString()}</p>
            </div>
            {renderStatusMessage()}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-xl">{analysis.original_filename}</CardTitle>
              <p className="text-sm text-gray-600 mt-1">
                Analyzed on {analysis.completed_at && new Date(analysis.completed_at).toLocaleString()}
              </p>
            </div>
            {!analysis.orchestrator_generated && (
              <Button variant="primary" onClick={onGenerateOrchestrator}>
                Generate Orchestrator
              </Button>
            )}
            {analysis.orchestrator_generated && (
              <Badge variant="success">Orchestrator Generated</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-gray-600">Detected Stack</p>
              <p className="font-semibold text-lg mt-1">{analysis.detected_stack || 'Unknown'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Confidence</p>
              <p className="font-semibold text-lg mt-1">
                {analysis.confidence_score ? `${analysis.confidence_score}%` : 'N/A'}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">File Size</p>
              <p className="font-semibold text-lg mt-1">{formatBytes(analysis.file_size_bytes)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-4">
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'structure', label: 'File Structure' },
            { id: 'conventions', label: 'Conventions' },
            { id: 'patterns', label: 'Patterns' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`py-2 px-4 border-b-2 font-medium text-sm transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <Card>
        <CardContent className="p-6">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div>
                <h3 className="font-semibold text-gray-900 mb-3">Analysis Summary</h3>
                <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Stack:</span>
                    <span className="font-medium">{analysis.detected_stack || 'Unknown'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Confidence:</span>
                    <span className="font-medium">{analysis.confidence_score || 0}%</span>
                  </div>
                  {analysis.orchestrator_key && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Orchestrator Key:</span>
                      <span className="font-mono text-sm">{analysis.orchestrator_key}</span>
                    </div>
                  )}
                </div>
              </div>

              {analysis.dependencies && (
                <div>
                  <h3 className="font-semibold text-gray-900 mb-3">Dependencies</h3>
                  <div className="bg-gray-900 rounded-lg p-4 font-mono text-sm text-gray-100 overflow-auto max-h-64">
                    <pre>{JSON.stringify(analysis.dependencies, null, 2)}</pre>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'structure' && (
            <div>
              <h3 className="font-semibold text-gray-900 mb-3">File Structure</h3>
              {analysis.file_structure ? (
                <div className="bg-gray-900 rounded-lg p-4 font-mono text-sm text-gray-100 overflow-auto max-h-96">
                  <pre>{JSON.stringify(analysis.file_structure, null, 2)}</pre>
                </div>
              ) : (
                <p className="text-gray-500">No file structure data available</p>
              )}
            </div>
          )}

          {activeTab === 'conventions' && (
            <div>
              <h3 className="font-semibold text-gray-900 mb-3">Code Conventions</h3>
              {analysis.conventions ? (
                <div className="space-y-4">
                  {Object.entries(analysis.conventions).map(([key, value]) => (
                    <div key={key} className="bg-gray-50 rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-2 capitalize">
                        {key.replace(/_/g, ' ')}
                      </h4>
                      <div className="bg-white rounded border border-gray-200 p-3 font-mono text-sm">
                        <pre>{JSON.stringify(value, null, 2)}</pre>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500">No conventions data available</p>
              )}
            </div>
          )}

          {activeTab === 'patterns' && (
            <div>
              <h3 className="font-semibold text-gray-900 mb-3">Code Patterns</h3>
              {analysis.patterns ? (
                <div className="space-y-4">
                  {Object.entries(analysis.patterns).map(([key, value]) => (
                    <div key={key} className="bg-gray-50 rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-2 capitalize">
                        {key.replace(/_/g, ' ')}
                      </h4>
                      <div className="bg-gray-900 rounded border border-gray-700 p-3 font-mono text-sm text-gray-100 overflow-auto">
                        <pre>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500">No patterns data available</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

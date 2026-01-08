/**
 * Code Indexing Panel Component
 *
 * PROMPT #90 - RAG Monitoring & Code Indexing Frontend
 *
 * Provides interface to manage project code indexing:
 * - Index Code: Index new/changed files (incremental)
 * - Force Re-index: Re-index all files from scratch
 * - Display indexing statistics (total documents, languages breakdown)
 * - Show last indexing job results
 *
 * Uses async job system with real-time progress updates.
 */

'use client';

import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '@/components/ui';
import { Code, RefreshCw, FileCode, Clock } from 'lucide-react';
import { CodeIndexingStats, IndexCodeJob } from '@/lib/types';
import { ragApi } from '@/lib/api';

interface Props {
  projectId: string;
  stats: CodeIndexingStats | null;
  onIndexComplete: () => void;
}

export function CodeIndexingPanel({ projectId, stats, onIndexComplete }: Props) {
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexJob, setIndexJob] = useState<IndexCodeJob | null>(null);

  const handleIndexCode = async (force: boolean = false) => {
    setIsIndexing(true);
    try {
      const job = await ragApi.indexCode(projectId, force);
      setIndexJob(job);

      if (job.status === 'completed') {
        const result = job.result;
        const message = [
          '✅ Code indexed successfully!',
          '',
          `Files scanned: ${result?.files_scanned || 0}`,
          `Files indexed: ${result?.files_indexed || 0}`,
          `Files skipped: ${result?.files_skipped || 0}`,
          `Total lines: ${result?.total_lines?.toLocaleString() || 0}`,
          '',
          'Languages:',
          ...Object.entries(result?.languages || {}).map(([lang, count]) => `  - ${lang}: ${count}`)
        ].join('\n');

        alert(message);
        onIndexComplete();
      } else if (job.status === 'failed') {
        alert(`❌ Failed to index code: ${job.message}`);
      }
    } catch (error: any) {
      console.error('Failed to index code:', error);
      alert('❌ Failed to index code: ' + (error.message || 'Unknown error'));
    } finally {
      setIsIndexing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Code className="w-5 h-5 text-purple-600" />
            </div>
            <CardTitle>Code Indexing</CardTitle>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => handleIndexCode(false)}
              disabled={isIndexing}
              variant="outline"
              size="sm"
            >
              {isIndexing ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Indexing...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Index Code
                </>
              )}
            </Button>
            <Button
              onClick={() => handleIndexCode(true)}
              disabled={isIndexing}
              variant="secondary"
              size="sm"
            >
              Force Re-index
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {stats ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-center gap-3">
                <FileCode className="w-5 h-5 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-500">Total Documents</p>
                  <p className="text-xl font-semibold">{stats.total_documents}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Code className="w-5 h-5 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-500">Avg Content Length</p>
                  <p className="text-xl font-semibold">
                    {Math.round(stats.avg_content_length)} chars
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Clock className="w-5 h-5 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-500">Document Types</p>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {stats.document_types.slice(0, 3).map(type => (
                      <Badge key={type} variant="outline" className="text-xs">
                        {type}
                      </Badge>
                    ))}
                    {stats.document_types.length > 3 && (
                      <Badge variant="outline" className="text-xs">
                        +{stats.document_types.length - 3} more
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {indexJob?.result && (
              <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm font-medium text-green-800">
                  Last Indexing Results:
                </p>
                <div className="mt-2 text-sm text-green-700 space-y-1">
                  <p>📁 Files scanned: {indexJob.result.files_scanned}</p>
                  <p>✅ Files indexed: {indexJob.result.files_indexed}</p>
                  <p>⏭️  Files skipped: {indexJob.result.files_skipped}</p>
                  <p>📊 Total lines: {indexJob.result.total_lines?.toLocaleString()}</p>
                  <div>
                    <p className="font-medium mt-2">Languages:</p>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {Object.entries(indexJob.result.languages).map(([lang, count]) => (
                        <Badge key={lang} className="bg-purple-100 text-purple-700">
                          {lang}: {count}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <FileCode className="w-12 h-12 mx-auto mb-2 text-gray-300" />
            <p>No code indexed yet</p>
            <p className="text-sm">Click "Index Code" to start</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

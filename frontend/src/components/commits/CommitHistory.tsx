/**
 * CommitHistory Component
 * Displays commit history with Conventional Commits icons and colors
 */

'use client';

import { useEffect, useState } from 'react';
import { commitsApi } from '@/lib/api';
import { Commit } from '@/lib/types';
import { Card } from '@/components/ui/card';

interface Props {
  projectId: string;
}

const COMMIT_ICONS: Record<string, string> = {
  feat: '✨',
  fix: '🐛',
  docs: '📝',
  style: '💄',
  refactor: '♻️',
  test: '✅',
  chore: '🔧',
  perf: '⚡'
};

const COMMIT_COLORS: Record<string, string> = {
  feat: 'bg-green-100 text-green-800 border-green-200',
  fix: 'bg-red-100 text-red-800 border-red-200',
  docs: 'bg-blue-100 text-blue-800 border-blue-200',
  style: 'bg-purple-100 text-purple-800 border-purple-200',
  refactor: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  test: 'bg-teal-100 text-teal-800 border-teal-200',
  chore: 'bg-gray-100 text-gray-800 border-gray-200',
  perf: 'bg-orange-100 text-orange-800 border-orange-200'
};

export function CommitHistory({ projectId }: Props) {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadCommits();
  }, [projectId]);

  const loadCommits = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await commitsApi.byProject(projectId);
      setCommits(response.data);
    } catch (err: any) {
      console.error('Failed to load commits:', err);
      setError('Failed to load commits');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-3 text-gray-600">Loading commits...</span>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-6 bg-red-50 border-red-200">
        <p className="text-red-700 text-sm">{error}</p>
      </Card>
    );
  }

  if (commits.length === 0) {
    return (
      <Card className="p-8 text-center text-gray-500">
        <div className="flex flex-col items-center gap-3">
          <svg
            className="w-16 h-16 text-gray-300"
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
          <p className="text-lg font-medium">No commits yet</p>
          <p className="text-sm">Complete a task to generate your first commit!</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Commit History</h3>
        <span className="text-sm text-gray-500">{commits.length} commits</span>
      </div>

      <div className="space-y-3">
        {commits.map((commit) => (
          <Card
            key={commit.id}
            className={`p-4 border-l-4 transition-all hover:shadow-md ${
              COMMIT_COLORS[commit.type] || COMMIT_COLORS.chore
            }`}
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl flex-shrink-0">
                {COMMIT_ICONS[commit.type] || '📦'}
              </span>

              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="font-mono text-sm font-semibold text-gray-900 break-words">
                    {commit.message}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
                  <span className="flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {new Date(commit.timestamp).toLocaleDateString()} {new Date(commit.timestamp).toLocaleTimeString()}
                  </span>

                  <span className="text-gray-400">•</span>

                  <span className="flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    {commit.created_by_ai_model}
                  </span>
                </div>

                {commit.changes?.description && (
                  <div className="mt-2 pt-2 border-t border-gray-200">
                    <p className="text-xs text-gray-600 line-clamp-2">
                      {commit.changes.description}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/**
 * PromptCard Component
 * Displays a prompt in a card format with key information
 */

'use client';

import React from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Prompt } from '@/lib/types';
import { FileText, Tag, History } from 'lucide-react';

interface PromptCardProps {
  prompt: Prompt;
}

export const PromptCard: React.FC<PromptCardProps> = ({ prompt }) => {
  const previewLength = 150;
  const preview = prompt.content.length > previewLength
    ? prompt.content.substring(0, previewLength) + '...'
    : prompt.content;

  return (
    <Link href={`/prompts/${prompt.id}`}>
      <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
        <CardHeader>
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <FileText className="w-5 h-5 text-blue-600 flex-shrink-0" />
              <CardTitle className="text-sm font-medium text-gray-900 truncate">
                {prompt.type || 'General Prompt'}
              </CardTitle>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {prompt.is_reusable && (
                <Badge variant="success" className="text-xs">
                  <Tag className="w-3 h-3 mr-1" />
                  Reusable
                </Badge>
              )}
              <Badge variant="default" className="text-xs">
                v{prompt.version}
              </Badge>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <p className="text-sm text-gray-600 line-clamp-3 mb-4">
            {preview}
          </p>

          {prompt.components && prompt.components.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-3">
              {prompt.components.slice(0, 3).map((component, idx) => (
                <span
                  key={idx}
                  className="px-2 py-0.5 bg-purple-100 text-purple-800 text-xs rounded"
                >
                  {component}
                </span>
              ))}
              {prompt.components.length > 3 && (
                <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">
                  +{prompt.components.length - 3} more
                </span>
              )}
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-gray-400 pt-3 border-t border-gray-100">
            <span className="flex items-center gap-1">
              <History className="w-3 h-3" />
              {new Date(prompt.created_at).toLocaleDateString()}
            </span>
            {prompt.created_from_interview_id && (
              <span className="text-blue-600">From Interview</span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
};

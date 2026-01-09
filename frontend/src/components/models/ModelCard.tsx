/**
 * ModelCard Component
 * Display card for an AI model with key information
 */

'use client';

import React from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { AIModel, AIModelUsageType } from '@/lib/types';
import { Cpu, Check, X, Settings } from 'lucide-react';

interface ModelCardProps {
  model: AIModel;
}

const USAGE_TYPE_LABELS: Record<AIModelUsageType, string> = {
  [AIModelUsageType.INTERVIEW]: 'Interviews',
  [AIModelUsageType.PROMPT_GENERATION]: 'Prompt Generation',
  [AIModelUsageType.COMMIT_GENERATION]: 'Commit Generation',
  [AIModelUsageType.TASK_EXECUTION]: 'Task Execution',
  [AIModelUsageType.GENERAL]: 'General',
};

const USAGE_TYPE_COLORS: Record<AIModelUsageType, string> = {
  [AIModelUsageType.INTERVIEW]: 'bg-blue-100 text-blue-800',
  [AIModelUsageType.PROMPT_GENERATION]: 'bg-purple-100 text-purple-800',
  [AIModelUsageType.COMMIT_GENERATION]: 'bg-green-100 text-green-800',
  [AIModelUsageType.TASK_EXECUTION]: 'bg-orange-100 text-orange-800',
  [AIModelUsageType.GENERAL]: 'bg-gray-100 text-gray-800',
};

const PROVIDER_ICONS: Record<string, string> = {
  anthropic: '🤖',
  openai: '🧠',
  google: '🔍',
  ollama: '🦙',
};

export const ModelCard: React.FC<ModelCardProps> = ({ model }) => {
  return (
    <Link href={`/models/${model.id}`}>
      <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
        <CardHeader>
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-2xl flex-shrink-0">
                {PROVIDER_ICONS[model.provider.toLowerCase()] || '🤖'}
              </span>
              <CardTitle className="text-base font-semibold text-gray-900 truncate">
                {model.name}
              </CardTitle>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {model.is_active ? (
                <Badge variant="success" className="text-xs">
                  <Check className="w-3 h-3 mr-1" />
                  Active
                </Badge>
              ) : (
                <Badge variant="default" className="text-xs bg-gray-200">
                  <X className="w-3 h-3 mr-1" />
                  Inactive
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {/* Provider */}
          <div className="mb-3">
            <div className="text-xs text-gray-500 mb-1">Provider</div>
            <div className="text-sm font-medium text-gray-900 capitalize">
              {model.provider}
            </div>
          </div>

          {/* Usage Type */}
          <div className="mb-3">
            <div className="text-xs text-gray-500 mb-1">Usage Type</div>
            <span
              className={`inline-block px-2 py-1 text-xs rounded-full ${
                USAGE_TYPE_COLORS[model.usage_type]
              }`}
            >
              {USAGE_TYPE_LABELS[model.usage_type]}
            </span>
          </div>

          {/* Configuration Info */}
          {model.config && Object.keys(model.config).length > 0 && (
            <div className="mb-3">
              <div className="text-xs text-gray-500 mb-1">Configuration</div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(model.config).slice(0, 3).map(([key, value]) => (
                  <span
                    key={key}
                    className="px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded"
                  >
                    {key}: {String(value).substring(0, 20)}
                  </span>
                ))}
                {Object.keys(model.config).length > 3 && (
                  <span className="px-2 py-0.5 bg-gray-200 text-gray-600 text-xs rounded">
                    +{Object.keys(model.config).length - 3} more
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className="pt-3 border-t border-gray-100 text-xs text-gray-400">
            <div className="flex items-center justify-between">
              <span>
                Created {new Date(model.created_at).toLocaleDateString()}
              </span>
              <Settings className="w-3 h-3" />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
};

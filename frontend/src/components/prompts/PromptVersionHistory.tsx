/**
 * PromptVersionHistory Component
 * Displays version history for a prompt
 */

'use client';

import React from 'react';
import { Prompt } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { GitBranch, Clock, Eye, Tag } from 'lucide-react';

interface PromptVersionHistoryProps {
  versions: Prompt[];
  currentVersionId: string;
  onVersionSelect?: (version: Prompt) => void;
}

export const PromptVersionHistory: React.FC<PromptVersionHistoryProps> = ({
  versions,
  currentVersionId,
  onVersionSelect,
}) => {
  // Sort versions by version number descending
  const sortedVersions = [...versions].sort((a, b) => b.version - a.version);

  const isCurrentVersion = (versionId: string) => versionId === currentVersionId;

  const getVersionChangeSummary = (version: Prompt, previousVersion?: Prompt) => {
    if (!previousVersion) return 'Initial version';

    const changes: string[] = [];

    if (version.content !== previousVersion.content) {
      changes.push('content');
    }
    if (version.type !== previousVersion.type) {
      changes.push('type');
    }
    if (version.is_reusable !== previousVersion.is_reusable) {
      changes.push('reusability');
    }
    if (JSON.stringify(version.components) !== JSON.stringify(previousVersion.components)) {
      changes.push('components');
    }

    return changes.length > 0
      ? `Updated ${changes.join(', ')}`
      : 'No changes detected';
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-gray-600" />
            <CardTitle>Version History</CardTitle>
          </div>
          <Badge variant="default">{sortedVersions.length} versions</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {sortedVersions.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <GitBranch className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No version history available</p>
          </div>
        ) : (
          <div className="space-y-3">
            {sortedVersions.map((version, index) => {
              const previousVersion = sortedVersions[index + 1];
              const changeSummary = getVersionChangeSummary(version, previousVersion);
              const isCurrent = isCurrentVersion(version.id);

              return (
                <div
                  key={version.id}
                  className={`p-4 border rounded-lg transition-colors ${
                    isCurrent
                      ? 'bg-blue-50 border-blue-300'
                      : 'bg-white border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Version Header */}
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-semibold text-gray-900">
                          Version {version.version}
                        </span>
                        {isCurrent && (
                          <Badge variant="success">Current</Badge>
                        )}
                        {version.is_reusable && (
                          <Badge variant="info" className="text-xs">
                            <Tag className="w-3 h-3 mr-1" />
                            Reusable
                          </Badge>
                        )}
                      </div>

                      {/* Change Summary */}
                      <p className="text-sm text-gray-600 mb-2">
                        {changeSummary}
                      </p>

                      {/* Metadata */}
                      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(version.created_at).toLocaleString()}
                        </span>
                        {version.type && (
                          <span className="px-2 py-0.5 bg-gray-100 rounded">
                            {version.type}
                          </span>
                        )}
                        {version.components && version.components.length > 0 && (
                          <span className="text-purple-600">
                            {version.components.length} component{version.components.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>

                      {/* Content Preview */}
                      <div className="mt-3 p-2 bg-gray-50 border border-gray-200 rounded text-xs">
                        <pre className="whitespace-pre-wrap font-mono text-gray-700 line-clamp-2">
                          {version.content}
                        </pre>
                      </div>
                    </div>

                    {/* Actions */}
                    {!isCurrent && onVersionSelect && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onVersionSelect(version)}
                      >
                        <Eye className="w-4 h-4 mr-1" />
                        View
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

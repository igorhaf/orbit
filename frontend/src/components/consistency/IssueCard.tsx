/**
 * IssueCard Component
 * Display individual consistency issue with actions
 */

import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

interface ConsistencyIssue {
  id: string;
  project_id: string;
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  file_path?: string;
  line_number?: number;
  suggested_fix?: string;
  status: 'open' | 'resolved' | 'ignored';
  created_at: string;
  resolved_at?: string;
}

interface Props {
  issue: ConsistencyIssue;
  onUpdateIssue: (issueId: string, status: 'resolved' | 'ignored') => void;
}

export function IssueCard({ issue, onUpdateIssue }: Props) {
  const [expanded, setExpanded] = useState(false);

  const severityColors = {
    critical: 'bg-red-100 text-red-800 border-red-200',
    high: 'bg-orange-100 text-orange-800 border-orange-200',
    medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    low: 'bg-blue-100 text-blue-800 border-blue-200',
  };

  const severityIconColors = {
    critical: 'text-red-500',
    high: 'text-orange-500',
    medium: 'text-yellow-500',
    low: 'text-blue-500',
  };

  const statusColors = {
    open: 'bg-orange-100 text-orange-800',
    resolved: 'bg-green-100 text-green-800',
    ignored: 'bg-gray-100 text-gray-800',
  };

  return (
    <Card
      className={`border-l-4 ${
        issue.status === 'open' ? severityColors[issue.severity] : 'border-gray-300'
      }`}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {/* Header */}
            <div className="flex items-start gap-3 mb-2">
              <span className={`flex-shrink-0 ${severityIconColors[issue.severity]}`}>
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8" /></svg>
              </span>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h3 className="font-semibold text-gray-900">{issue.title}</h3>
                  <Badge
                    variant={
                      issue.severity === 'critical' || issue.severity === 'high'
                        ? 'error'
                        : issue.severity === 'medium'
                        ? 'warning'
                        : 'default'
                    }
                    className="uppercase text-xs"
                  >
                    {issue.severity === 'critical' ? 'Critico' : issue.severity === 'high' ? 'Alto' : issue.severity === 'medium' ? 'Medio' : 'Baixo'}
                  </Badge>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${
                      statusColors[issue.status]
                    }`}
                  >
                    {issue.status === 'open' ? 'Aberto' : issue.status === 'resolved' ? 'Resolvido' : 'Ignorado'}
                  </span>
                </div>

                {/* File location */}
                {issue.file_path && (
                  <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
                    <svg
                      className="w-4 h-4"
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
                    <span className="font-mono text-xs">
                      {issue.file_path}
                      {issue.line_number && `:${issue.line_number}`}
                    </span>
                  </div>
                )}

                {/* Description */}
                <p className="text-sm text-gray-700 mb-3">{issue.description}</p>

                {/* Suggested Fix */}
                {expanded && issue.suggested_fix && (
                  <div className="mt-3">
                    <p className="text-sm font-medium text-gray-900 mb-2">
                      Sugestão de Correção:
                    </p>
                    <div className="bg-gray-900 rounded-lg p-3 font-mono text-sm text-gray-100 overflow-auto">
                      <pre className="whitespace-pre-wrap">{issue.suggested_fix}</pre>
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 mt-3">
                  {issue.suggested_fix && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setExpanded(!expanded)}
                    >
                      {expanded ? 'Ocultar' : 'Ver'} Sugestão de Correção
                    </Button>
                  )}

                  {issue.status === 'open' && (
                    <>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => onUpdateIssue(issue.id, 'resolved')}
                      >
                        Marcar como Resolvido
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onUpdateIssue(issue.id, 'ignored')}
                      >
                        Ignorar
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Metadata */}
            <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
              <span>Categoria: {issue.category}</span>
              <span>•</span>
              <span>Criado em: {new Date(issue.created_at).toLocaleDateString('pt-BR')}</span>
              {issue.resolved_at && (
                <>
                  <span>•</span>
                  <span>
                    Resolvido em: {new Date(issue.resolved_at).toLocaleDateString('pt-BR')}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

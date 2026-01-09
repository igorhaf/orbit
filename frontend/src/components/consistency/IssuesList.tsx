/**
 * IssuesList Component
 * Display list of consistency issues
 */

import React from 'react';
import { IssueCard } from './IssueCard';

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
  issues: ConsistencyIssue[];
  onUpdateIssue: (issueId: string, status: 'resolved' | 'ignored') => void;
}

export function IssuesList({ issues, onUpdateIssue }: Props) {
  if (issues.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
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
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <p className="text-lg font-medium text-gray-700">No issues found</p>
        <p className="text-sm text-gray-500 mt-2">
          Your code is looking good! Run a new analysis to check for updates.
        </p>
      </div>
    );
  }

  // Group issues by severity
  const groupedIssues = {
    critical: issues.filter((i) => i.severity === 'critical'),
    high: issues.filter((i) => i.severity === 'high'),
    medium: issues.filter((i) => i.severity === 'medium'),
    low: issues.filter((i) => i.severity === 'low'),
  };

  return (
    <div className="space-y-6">
      {Object.entries(groupedIssues).map(([severity, severityIssues]) => {
        if (severityIssues.length === 0) return null;

        return (
          <div key={severity}>
            <h2 className="text-lg font-semibold text-gray-900 mb-3 capitalize">
              {severity} Severity ({severityIssues.length})
            </h2>
            <div className="space-y-3">
              {severityIssues.map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  onUpdateIssue={onUpdateIssue}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

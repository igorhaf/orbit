/**
 * JobProgressBar Component
 * PROMPT #65 - Async Job System
 *
 * Visual progress indicator for async background jobs.
 * Shows percentage and optional human-readable status message.
 */

import React from 'react';

interface Props {
  /** Progress percentage (0-100) */
  percent: number | null;
  /** Optional human-readable status message */
  message?: string | null;
  /** Job status */
  status?: 'pending' | 'running' | 'completed' | 'failed';
}

export function JobProgressBar({ percent, message, status }: Props) {
  const percentage = percent ?? 0;
  const isIndeterminate = percent === null || percent === 0;

  // Determine color based on status
  const getColorClass = () => {
    switch (status) {
      case 'completed':
        return 'bg-green-600';
      case 'failed':
        return 'bg-red-600';
      case 'running':
      case 'pending':
      default:
        return 'bg-blue-600';
    }
  };

  return (
    <div className="w-full space-y-2">
      {/* Progress bar */}
      <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
        {isIndeterminate ? (
          // Indeterminate progress (animated pulse)
          <div className={`h-2.5 rounded-full ${getColorClass()} animate-pulse w-1/3 transition-all duration-300`} />
        ) : (
          // Determinate progress
          <div
            className={`h-2.5 rounded-full ${getColorClass()} transition-all duration-300 ease-out`}
            style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
          />
        )}
      </div>

      {/* Status message and percentage */}
      <div className="flex items-center justify-between">
        {message ? (
          <p className="text-sm text-gray-700 font-medium flex-1">{message}</p>
        ) : (
          <p className="text-sm text-gray-500 italic">Processing...</p>
        )}
        {!isIndeterminate && (
          <span className="text-sm font-semibold text-gray-900 ml-2">
            {percentage.toFixed(0)}%
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * ProgressBar Component
 * Visual progress indicator for task execution
 */

import React from 'react';

interface Props {
  completed: number;
  total: number;
  percentage: number;
}

export function ProgressBar({ completed, total, percentage }: Props) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700">
          Progress: {completed}/{total} tasks
        </span>
        <span className="text-sm font-semibold text-blue-600">
          {percentage.toFixed(1)}%
        </span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
        <div
          className="bg-gradient-to-r from-blue-500 to-blue-600 h-3 rounded-full transition-all duration-500 ease-out"
          style={{ width: `${percentage}%` }}
        >
          {percentage > 10 && (
            <div className="h-full flex items-center justify-end pr-2">
              <span className="text-xs font-bold text-white">
                {percentage.toFixed(0)}%
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

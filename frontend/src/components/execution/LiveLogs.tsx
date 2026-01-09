/**
 * LiveLogs Component
 * Terminal-style live log viewer
 */

import React, { useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';

interface Props {
  logs: string[];
}

export function LiveLogs({ logs }: Props) {
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <svg
            className="w-5 h-5 text-gray-600"
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
          Live Logs
          {logs.length > 0 && (
            <span className="ml-auto text-sm font-normal text-gray-500">
              {logs.length} entries
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No logs yet</p>
            <p className="text-sm mt-1">Logs will appear here during execution</p>
          </div>
        ) : (
          <div className="bg-gray-900 rounded-lg p-4 font-mono text-sm overflow-auto max-h-96">
            {logs.map((log, index) => (
              <div
                key={index}
                className="text-gray-100 py-1 hover:bg-gray-800 px-2 rounded transition-colors"
              >
                {log}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

'use client';

/**
 * Console Page - PROMPT #168
 * Real-time system logs viewer
 *
 * Displays live logs from the ORBIT system including:
 * - AI prompts and responses
 * - Specs loaded
 * - RAG operations
 * - Job events
 * - Memory scan progress
 * - Errors
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Layout } from '@/components/layout/Layout';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

// Log entry type matching backend ConsoleLogEntry
interface LogEntry {
  id: string;
  timestamp: string;
  level: 'debug' | 'info' | 'warning' | 'error' | 'success';
  category: string;
  title: string;
  message: string;
  details?: Record<string, unknown>;
  project_id?: number;
  job_id?: number;
  duration_ms?: number;
  tokens_used?: number;
}

// Category colors
const CATEGORY_COLORS: Record<string, string> = {
  ai_prompt: 'bg-blue-500',
  ai_response: 'bg-green-500',
  spec_loaded: 'bg-purple-500',
  rag_operation: 'bg-yellow-500',
  job_event: 'bg-cyan-500',
  memory_scan: 'bg-indigo-500',
  cache_event: 'bg-pink-500',
  system: 'bg-gray-500',
  error: 'bg-red-500',
};

// Level colors
const LEVEL_COLORS: Record<string, string> = {
  debug: 'text-gray-400',
  info: 'text-blue-400',
  warning: 'text-yellow-400',
  error: 'text-red-400',
  success: 'text-green-400',
};

// Level icons
const LEVEL_ICONS: Record<string, string> = {
  debug: '🔍',
  info: 'ℹ️',
  warning: '⚠️',
  error: '❌',
  success: '✅',
};

export default function ConsolePage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedLevel, setSelectedLevel] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Connect to SSE stream
  const connectToStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    const eventSource = new EventSource(`${apiUrl}/api/v1/console/stream`);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setIsConnected(true);
      console.log('🔌 Console stream connected');
    };

    eventSource.onmessage = (event) => {
      if (isPaused) return;

      try {
        const data = JSON.parse(event.data);

        // Skip connection messages
        if (data.type === 'connected') {
          return;
        }

        // Add log entry
        setLogs((prev) => {
          // Prevent duplicates
          if (prev.some((log) => log.id === data.id)) {
            return prev;
          }

          // Keep max 500 logs for performance
          const newLogs = [...prev, data];
          if (newLogs.length > 500) {
            return newLogs.slice(-500);
          }
          return newLogs;
        });
      } catch (e) {
        // Ignore parse errors (keepalive messages)
      }
    };

    eventSource.onerror = () => {
      setIsConnected(false);
      console.log('🔌 Console stream disconnected, reconnecting...');

      // Reconnect after delay
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = setTimeout(connectToStream, 3000);
    };
  }, [isPaused]);

  // Connect on mount
  useEffect(() => {
    connectToStream();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connectToStream]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  // Filter logs
  const filteredLogs = logs.filter((log) => {
    if (selectedCategory !== 'all' && log.category !== selectedCategory) {
      return false;
    }
    if (selectedLevel !== 'all' && log.level !== selectedLevel) {
      return false;
    }
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      return (
        log.title.toLowerCase().includes(searchLower) ||
        log.message.toLowerCase().includes(searchLower)
      );
    }
    return true;
  });

  // Clear logs
  const clearLogs = async () => {
    setLogs([]);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
      await fetch(`${apiUrl}/api/v1/console/logs`, { method: 'DELETE' });
    } catch (e) {
      console.error('Failed to clear server logs:', e);
    }
  };

  // Format timestamp
  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });
  };

  // Toggle log expansion
  const toggleExpand = (logId: string) => {
    setExpandedLogId(expandedLogId === logId ? null : logId);
  };

  // Unique categories from logs
  const categories = ['all', ...new Set(logs.map((log) => log.category))];
  const levels = ['all', 'debug', 'info', 'warning', 'error', 'success'];

  return (
    <Layout>
      <div className="min-h-screen bg-gray-900 text-gray-100 p-4">
        <Breadcrumbs
          items={[{ label: 'Console', href: '/console' }]}
        />

        <div className="space-y-4 mt-4">
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-white">System Console</h1>
              <span
                className={`px-2 py-0.5 text-xs rounded-full ${
                  isConnected
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-red-500/20 text-red-400'
                }`}
              >
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant={isPaused ? 'primary' : 'secondary'}
                onClick={() => setIsPaused(!isPaused)}
                className="text-sm"
              >
                {isPaused ? '▶ Resume' : '⏸ Pause'}
              </Button>
              <Button
                variant={autoScroll ? 'primary' : 'secondary'}
                onClick={() => setAutoScroll(!autoScroll)}
                className="text-sm"
              >
                {autoScroll ? '⬇ Auto-scroll ON' : '⬇ Auto-scroll OFF'}
              </Button>
              <Button variant="danger" onClick={clearLogs} className="text-sm">
                🗑 Clear
              </Button>
            </div>
          </div>

          {/* Filters */}
          <Card className="bg-gray-800 border-gray-700 p-3">
            <div className="flex flex-wrap items-center gap-4">
              {/* Search */}
              <div className="flex-1 min-w-[200px]">
                <input
                  type="text"
                  placeholder="Search logs..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Category filter */}
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat === 'all' ? 'All Categories' : cat.replace('_', ' ')}
                  </option>
                ))}
              </select>

              {/* Level filter */}
              <select
                value={selectedLevel}
                onChange={(e) => setSelectedLevel(e.target.value)}
                className="px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {levels.map((level) => (
                  <option key={level} value={level}>
                    {level === 'all' ? 'All Levels' : level.toUpperCase()}
                  </option>
                ))}
              </select>

              {/* Log count */}
              <span className="text-sm text-gray-400">
                {filteredLogs.length} / {logs.length} logs
              </span>
            </div>
          </Card>

          {/* Logs container */}
          <Card className="bg-gray-950 border-gray-700 p-0 overflow-hidden">
            <div
              className="h-[calc(100vh-280px)] overflow-y-auto font-mono text-sm"
              style={{ scrollbarGutter: 'stable' }}
            >
              {filteredLogs.length === 0 ? (
                <div className="flex items-center justify-center h-full text-gray-500">
                  <div className="text-center">
                    <p className="text-lg mb-2">No logs yet</p>
                    <p className="text-sm">
                      Waiting for system activity...
                    </p>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-gray-800">
                  {filteredLogs.map((log) => (
                    <div
                      key={log.id}
                      className={`hover:bg-gray-900 cursor-pointer transition-colors ${
                        expandedLogId === log.id ? 'bg-gray-900' : ''
                      }`}
                      onClick={() => toggleExpand(log.id)}
                    >
                      {/* Log line */}
                      <div className="flex items-start gap-2 px-3 py-2">
                        {/* Timestamp */}
                        <span className="text-gray-500 whitespace-nowrap">
                          {formatTimestamp(log.timestamp)}
                        </span>

                        {/* Level icon */}
                        <span>{LEVEL_ICONS[log.level] || '•'}</span>

                        {/* Category badge */}
                        <span
                          className={`px-1.5 py-0.5 text-xs rounded whitespace-nowrap ${
                            CATEGORY_COLORS[log.category] || 'bg-gray-600'
                          } text-white`}
                        >
                          {log.category.replace('_', ' ')}
                        </span>

                        {/* Title */}
                        <span className={`font-medium ${LEVEL_COLORS[log.level]}`}>
                          {log.title}
                        </span>

                        {/* Message preview */}
                        <span className="text-gray-300 truncate flex-1">
                          {log.message}
                        </span>

                        {/* Duration / Tokens */}
                        {(log.duration_ms || log.tokens_used) && (
                          <span className="text-gray-500 whitespace-nowrap text-xs">
                            {log.duration_ms && `${log.duration_ms}ms`}
                            {log.duration_ms && log.tokens_used && ' | '}
                            {log.tokens_used && `${log.tokens_used} tokens`}
                          </span>
                        )}

                        {/* Expand indicator */}
                        {log.details && (
                          <span className="text-gray-500">
                            {expandedLogId === log.id ? '▼' : '▶'}
                          </span>
                        )}
                      </div>

                      {/* Expanded details */}
                      {expandedLogId === log.id && log.details && (
                        <div className="px-3 py-2 bg-gray-950 border-t border-gray-800">
                          <pre className="text-xs text-gray-400 overflow-x-auto whitespace-pre-wrap">
                            {JSON.stringify(log.details, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </Layout>
  );
}

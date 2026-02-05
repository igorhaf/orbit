'use client';

/**
 * Console Page - PROMPT #168
 * Real-time system logs viewer - Linux terminal style
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

// Level colors for terminal output
const LEVEL_COLORS: Record<string, string> = {
  debug: 'text-gray-500',
  info: 'text-cyan-400',
  warning: 'text-yellow-400',
  error: 'text-red-400',
  success: 'text-green-400',
};

// Format log entry as raw terminal text
const formatLogLine = (log: LogEntry): string => {
  const date = new Date(log.timestamp);
  const ts = date.toISOString().replace('T', ' ').substring(0, 23);

  let line = `[${ts}] [${log.level.toUpperCase().padEnd(7)}] [${log.category}] ${log.title}`;

  if (log.message) {
    line += ` - ${log.message}`;
  }

  if (log.duration_ms) {
    line += ` (${log.duration_ms}ms)`;
  }

  if (log.tokens_used) {
    line += ` [${log.tokens_used} tokens]`;
  }

  if (log.project_id) {
    line += ` project=${log.project_id}`;
  }

  if (log.job_id) {
    line += ` job=${log.job_id}`;
  }

  return line;
};

// Format details as indented JSON
const formatDetails = (details: Record<string, unknown>): string => {
  return JSON.stringify(details, null, 2)
    .split('\n')
    .map(line => '    ' + line)
    .join('\n');
};

export default function ConsolePage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedLevel, setSelectedLevel] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [showDetails, setShowDetails] = useState(true);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const consoleRef = useRef<HTMLDivElement>(null);
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

          // Keep max 1000 logs for performance
          const newLogs = [...prev, data];
          if (newLogs.length > 1000) {
            return newLogs.slice(-1000);
          }
          return newLogs;
        });
      } catch {
        // Ignore parse errors (keepalive messages)
      }
    };

    eventSource.onerror = () => {
      setIsConnected(false);

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
        log.message.toLowerCase().includes(searchLower) ||
        log.category.toLowerCase().includes(searchLower)
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
    } catch {
      // Ignore errors
    }
  };

  // Copy all visible logs to clipboard
  const copyLogs = async () => {
    const text = filteredLogs
      .map((log) => {
        let output = formatLogLine(log);
        if (showDetails && log.details) {
          output += '\n' + formatDetails(log.details);
        }
        return output;
      })
      .join('\n');

    await navigator.clipboard.writeText(text);
  };

  // Unique categories from logs
  const categories = ['all', ...new Set(logs.map((log) => log.category))];
  const levels = ['all', 'debug', 'info', 'warning', 'error', 'success'];

  return (
    <div className="fixed inset-0 bg-black text-gray-100 flex flex-col font-mono text-sm">
      {/* Header bar */}
      <div className="flex-shrink-0 bg-gray-900 border-b border-gray-800 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-green-400 font-bold">ORBIT Console</span>
          <span
            className={`text-xs ${
              isConnected ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {isConnected ? '● connected' : '○ disconnected'}
          </span>
          <span className="text-gray-500 text-xs">
            {filteredLogs.length}/{logs.length} logs
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Search */}
          <input
            type="text"
            placeholder="grep..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-40 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white placeholder-gray-500 focus:outline-none focus:border-gray-600"
          />

          {/* Category filter */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white focus:outline-none"
          >
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat === 'all' ? 'all categories' : cat}
              </option>
            ))}
          </select>

          {/* Level filter */}
          <select
            value={selectedLevel}
            onChange={(e) => setSelectedLevel(e.target.value)}
            className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white focus:outline-none"
          >
            {levels.map((level) => (
              <option key={level} value={level}>
                {level === 'all' ? 'all levels' : level}
              </option>
            ))}
          </select>

          {/* Toggle buttons */}
          <button
            onClick={() => setShowDetails(!showDetails)}
            className={`px-2 py-1 text-xs rounded ${
              showDetails
                ? 'bg-gray-700 text-white'
                : 'bg-gray-800 text-gray-500'
            }`}
            title="Toggle details"
          >
            details
          </button>

          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`px-2 py-1 text-xs rounded ${
              autoScroll
                ? 'bg-gray-700 text-white'
                : 'bg-gray-800 text-gray-500'
            }`}
            title="Toggle auto-scroll"
          >
            scroll
          </button>

          <button
            onClick={() => setIsPaused(!isPaused)}
            className={`px-2 py-1 text-xs rounded ${
              isPaused
                ? 'bg-yellow-600 text-white'
                : 'bg-gray-800 text-gray-500'
            }`}
            title="Pause/Resume"
          >
            {isPaused ? 'paused' : 'live'}
          </button>

          <button
            onClick={copyLogs}
            className="px-2 py-1 text-xs rounded bg-gray-800 text-gray-400 hover:text-white"
            title="Copy to clipboard"
          >
            copy
          </button>

          <button
            onClick={clearLogs}
            className="px-2 py-1 text-xs rounded bg-gray-800 text-red-400 hover:text-red-300"
            title="Clear logs"
          >
            clear
          </button>
        </div>
      </div>

      {/* Console output */}
      <div
        ref={consoleRef}
        className="flex-1 overflow-auto p-2 select-text cursor-text"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#374151 #111827' }}
      >
        {filteredLogs.length === 0 ? (
          <div className="text-gray-600">
            <p>$ waiting for logs...</p>
            <p className="animate-pulse">_</p>
          </div>
        ) : (
          <pre className="whitespace-pre-wrap break-all">
            {filteredLogs.map((log) => (
              <div key={log.id} className="hover:bg-gray-900/50">
                <span className={LEVEL_COLORS[log.level]}>
                  {formatLogLine(log)}
                </span>
                {showDetails && log.details && (
                  <span className="text-gray-600">
                    {'\n' + formatDetails(log.details)}
                  </span>
                )}
                {'\n'}
              </div>
            ))}
            <div ref={logsEndRef} />
          </pre>
        )}
      </div>

      {/* Status bar */}
      <div className="flex-shrink-0 bg-gray-900 border-t border-gray-800 px-4 py-1 flex items-center justify-between text-xs text-gray-500">
        <span>
          {isPaused && <span className="text-yellow-400 mr-2">PAUSED</span>}
          Press Ctrl+C to copy selected text
        </span>
        <span>
          {autoScroll ? 'auto-scroll enabled' : 'auto-scroll disabled'} |
          buffer: {logs.length}/1000
        </span>
      </div>
    </div>
  );
}

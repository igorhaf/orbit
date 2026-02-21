'use client';

/**
 * Console Page - PROMPT #168
 * Real-time system logs viewer - Linux terminal style
 *
 * Displays live logs from the ORBIT system including:
 * - AI prompts and responses
 * - AI streaming (real-time token generation) - PROMPT #217
 * - Specs loaded
 * - RAG operations
 * - Job events
 * - Memory scan progress
 * - Errors
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import TimelineView from '@/components/console/TimelineView';

// Log entry type matching backend ConsoleLogEntry
interface LogEntry {
  id: string;
  timestamp: string;
  level: 'debug' | 'info' | 'warning' | 'error' | 'success';
  category: string;
  title: string;
  message: string;
  details?: Record<string, unknown>;
  project_id?: string;
  job_id?: string;
  duration_ms?: number;
  tokens_used?: number;
  // PROMPT #296 - Observability fields
  trace_id?: string;
  operation_name?: string;
  phase_name?: string;
  cost_usd?: number;
  model_name?: string;
  input_tokens?: number;
  output_tokens?: number;
}

type ViewMode = 'terminal' | 'timeline';

// PROMPT #217 - Active streaming response tracker
interface ActiveStream {
  streamId: string;
  model: string;
  fullText: string;
  startTime: number;
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
    // Show short UUID (first 8 chars)
    const shortId = log.project_id.toString().substring(0, 8);
    line += ` project=${shortId}`;
  }

  if (log.job_id) {
    // Show short UUID (first 8 chars)
    const shortId = log.job_id.toString().substring(0, 8);
    line += ` job=${shortId}`;
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
  const [activeStreams, setActiveStreams] = useState<Map<string, ActiveStream>>(new Map());
  const [viewMode, setViewMode] = useState<ViewMode>('terminal');

  const logsEndRef = useRef<HTMLDivElement>(null);
  const consoleRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;

  // PROMPT #247 - Connect via WebSocket (replaces SSE EventSource)
  const connectToStream = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN ||
        wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    const wsUrl = apiUrl.replace(/^http/, 'ws');
    const ws = new WebSocket(`${wsUrl}/api/v1/ws/console`);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      // Ping every 30s to keep alive
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ command: 'ping' }));
        }
      }, 30000);
    };

    ws.onmessage = (event) => {
      if (isPausedRef.current) return;

      try {
        const message = JSON.parse(event.data);

        // Skip pong responses
        if (message.event === 'pong') return;

        // Extract log data from WebSocket message
        const data = message.event === 'console_log' ? message.data : message;
        if (!data || !data.id) return;

        // PROMPT #217 - Handle streaming chunks separately
        if (data.category === 'ai_streaming') {
          const details = data.details as Record<string, unknown> | undefined;
          const streamId = details?.stream_id as string;
          const chunkText = details?.chunk_text as string || '';
          const isComplete = details?.is_complete as boolean || false;

          if (streamId) {
            if (isComplete) {
              setActiveStreams(prev => {
                const completed = prev.get(streamId);
                if (completed && completed.fullText.trim()) {
                  const elapsed = ((Date.now() - completed.startTime) / 1000).toFixed(1);
                  setLogs(prevLogs => {
                    const logEntry: LogEntry = {
                      id: `stream-${streamId}`,
                      timestamp: new Date().toISOString(),
                      level: 'success',
                      category: 'ai_response',
                      title: `AI Response <- ${completed.model}`,
                      message: completed.fullText,
                      details: { model: completed.model, duration: `${elapsed}s`, stream_id: streamId },
                    };
                    const newLogs = [...prevLogs, logEntry];
                    return newLogs.length > 1000 ? newLogs.slice(-1000) : newLogs;
                  });
                }
                const next = new Map(prev);
                next.delete(streamId);
                return next;
              });
            } else {
              setActiveStreams(prev => {
                const next = new Map(prev);
                const existing = next.get(streamId);
                if (existing) {
                  next.set(streamId, { ...existing, fullText: existing.fullText + chunkText });
                } else {
                  next.set(streamId, {
                    streamId,
                    model: (details?.model as string) || 'unknown',
                    fullText: chunkText,
                    startTime: Date.now(),
                  });
                }
                return next;
              });
            }
          }
          return;
        }

        // Add regular log entry
        setLogs((prev) => {
          if (prev.some((log) => log.id === data.id)) return prev;
          const newLogs = [...prev, data];
          return newLogs.length > 1000 ? newLogs.slice(-1000) : newLogs;
        });
      } catch {
        // Ignore parse errors
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      wsRef.current = null;
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      // Reconnect after delay
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = setTimeout(connectToStream, 3000);
    };

    ws.onerror = () => {
      // onclose will fire after onerror, handling reconnect
    };
  }, []);

  // Connect on mount
  useEffect(() => {
    connectToStream();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
    };
  }, [connectToStream]);

  // Smart auto-scroll: only update ref, no state changes (avoids re-render loops)
  const handleConsoleScroll = useCallback(() => {
    const el = consoleRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom < 80;
  }, []);

  // Auto-scroll to bottom when new logs arrive (only if user is near bottom)
  useEffect(() => {
    if (isNearBottomRef.current && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, activeStreams]);

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

  // Clear logs - clear backend buffer and local state
  const clearLogs = async () => {
    // 1. Clear backend buffer
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
      await fetch(`${apiUrl}/api/v1/console/logs`, { method: 'DELETE' });
    } catch {
      // Ignore errors
    }

    // 2. Clear local state (WebSocket stays connected)
    setLogs([]);
    setActiveStreams(new Map());
  };

  // Copy all visible logs to clipboard
  const copyLogs = async () => {
    const text = filteredLogs
      .map((log) => {
        let output = formatLogLine(log);
        if (log.details) {
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

          {/* PROMPT #296 - View mode toggle */}
          <div className="flex bg-gray-800 rounded overflow-hidden border border-gray-700">
            <button
              onClick={() => setViewMode('terminal')}
              className={`px-2 py-0.5 text-xs transition-colors ${
                viewMode === 'terminal'
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Terminal
            </button>
            <button
              onClick={() => setViewMode('timeline')}
              className={`px-2 py-0.5 text-xs transition-colors ${
                viewMode === 'timeline'
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Timeline
            </button>
          </div>
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

          {/* Scroll to bottom button */}
          <button
            onClick={() => {
              isNearBottomRef.current = true;
              logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="px-2 py-1 text-xs rounded bg-gray-800 text-gray-400 hover:text-white"
            title="Rolar para o final"
          >
            bottom
          </button>

          <button
            onClick={() => setIsPaused(!isPaused)}
            className={`px-2 py-1 text-xs rounded ${
              isPaused
                ? 'bg-yellow-600 text-white'
                : 'bg-gray-800 text-gray-500'
            }`}
            title="Pausar/Retomar"
          >
            {isPaused ? 'paused' : 'live'}
          </button>

          <button
            onClick={copyLogs}
            className="px-2 py-1 text-xs rounded bg-gray-800 text-gray-400 hover:text-white"
            title="Copiar para área de transferencia"
          >
            copy
          </button>

          <button
            onClick={clearLogs}
            className="px-2 py-1 text-xs rounded bg-gray-800 text-red-400 hover:text-red-300"
            title="Limpar logs"
          >
            clear
          </button>
        </div>
      </div>

      {/* Console output - PROMPT #296: Terminal or Timeline view */}
      {viewMode === 'timeline' ? (
        <div className="flex-1 overflow-hidden">
          <TimelineView logs={logs} />
        </div>
      ) : (
        <div
          ref={consoleRef}
          className="flex-1 overflow-auto p-2 select-text cursor-text"
          style={{ scrollbarWidth: 'thin', scrollbarColor: '#374151 #111827' }}
          onScroll={handleConsoleScroll}
        >
          {filteredLogs.length === 0 && activeStreams.size === 0 ? (
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
                  {log.details && (
                    <span className="text-gray-600">
                      {'\n' + formatDetails(log.details)}
                    </span>
                  )}
                  {'\n'}
                </div>
              ))}
              {/* PROMPT #217 - Active streaming responses */}
              {Array.from(activeStreams.values()).map((stream) => (
                <div key={stream.streamId} className="border-l-2 border-cyan-500 pl-2 my-1 py-1">
                  <span className="text-cyan-400">
                    {'[STREAMING] '}AI Response {'<-'} {stream.model}
                  </span>
                  <span className="text-gray-500 text-xs ml-2">
                    ({((Date.now() - stream.startTime) / 1000).toFixed(1)}s)
                  </span>
                  {'\n'}
                  <span className="text-green-300">
                    {stream.fullText}
                  </span>
                  <span className="animate-pulse text-green-400">{'\u2588'}</span>
                  {'\n'}
                </div>
              ))}
              <div ref={logsEndRef} />
            </pre>
          )}
        </div>
      )}

      {/* Status bar */}
      <div className="flex-shrink-0 bg-gray-900 border-t border-gray-800 px-4 py-1 flex items-center justify-between text-xs text-gray-500">
        <span>
          {isPaused && <span className="text-yellow-400 mr-2">PAUSED</span>}
          Press Ctrl+C to copy selected text
        </span>
        <span>
          {activeStreams.size > 0 && (
            <span className="text-cyan-400 mr-2">
              {activeStreams.size} stream{activeStreams.size > 1 ? 's' : ''} active
            </span>
          )}
          buffer: {logs.length}/1000
        </span>
      </div>
    </div>
  );
}

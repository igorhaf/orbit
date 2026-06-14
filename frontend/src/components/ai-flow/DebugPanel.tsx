/**
 * DebugPanel — bottom collapsible drawer showing the last canvas run's
 * per-node telemetry, similar to node-red's debug pane.
 *
 * v3.0
 */
'use client';

import React from 'react';
import { Bug, X, CheckCircle2, XCircle, Clock } from 'lucide-react';

export interface DebugEvent {
  id: string;
  node_id: string;
  node_label?: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  duration_ms?: number;
  message?: string;
  output_keys?: string[];
  output_preview?: Record<string, string | null>;
  ts: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  events: DebugEvent[];
  lastRunAt?: string | null;
}

export function DebugPanel({ open, onClose, events, lastRunAt }: Props) {
  if (!open) return null;
  return (
    <div className="border-t border-gray-200 bg-white" style={{ maxHeight: 240 }}>
      <header className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center gap-2 text-xs text-gray-700">
          <Bug className="w-3.5 h-3.5" />
          <span className="font-semibold">Debug</span>
          {lastRunAt && (
            <span className="text-gray-500">— última execução {new Date(lastRunAt).toLocaleTimeString()}</span>
          )}
          <span className="text-gray-400">· {events.length} eventos</span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded">
          <X className="w-3.5 h-3.5 text-gray-500" />
        </button>
      </header>
      <div className="overflow-y-auto" style={{ maxHeight: 200 }}>
        {events.length === 0 ? (
          <p className="px-3 py-4 text-xs text-gray-400">
            Nenhum evento ainda. Clique ▶ Run pra disparar.
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead className="border-b border-gray-100">
              <tr className="text-left text-gray-500">
                <th className="px-3 py-1.5 font-medium w-8"></th>
                <th className="px-3 py-1.5 font-medium">Node</th>
                <th className="px-3 py-1.5 font-medium">Mensagem</th>
                <th className="px-3 py-1.5 font-medium text-right">Duração</th>
                <th className="px-3 py-1.5 font-medium text-right">Quando</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {events.map((e) => {
                const previewText = e.output_preview
                  ? Object.entries(e.output_preview)
                      .map(([k, v]) => `${k}: ${v ?? 'null'}`)
                      .join('\n')
                  : undefined;
                const msg = e.message
                  || (e.output_keys && e.output_keys.length ? e.output_keys.join(', ') : '—');
                return (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-3 py-1.5">
                      {e.status === 'success' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
                      {e.status === 'failed' && <XCircle className="w-3.5 h-3.5 text-red-500" />}
                      {e.status === 'running' && <Clock className="w-3.5 h-3.5 text-blue-500 animate-spin" />}
                      {e.status === 'pending' && <Clock className="w-3.5 h-3.5 text-gray-300" />}
                      {e.status === 'skipped' && <span className="text-gray-400 text-[11px]">↳</span>}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[11px] text-gray-700">{e.node_label || e.node_id}</td>
                    <td
                      className="px-3 py-1.5 text-gray-600 max-w-[280px] truncate"
                      title={previewText || undefined}
                    >
                      {msg}
                      {previewText && <span className="ml-1 text-gray-300">⊕</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">
                      {e.duration_ms != null ? `${(e.duration_ms / 1000).toFixed(2)}s` : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right text-gray-400 tabular-nums">
                      {new Date(e.ts).toLocaleTimeString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

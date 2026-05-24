/**
 * QuotaWindowChip — compact pill in the navbar (left of the bell) showing
 * the Claude subscription window timing.
 *
 * Display: "🕐 reseta 19:25"  or  "🕐 exhausted · 19:25"
 * Click: dropdown with time progress + token bars + jsonl source badge.
 *
 * v2.4.0
 */
'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { Clock, AlertTriangle } from 'lucide-react';
import { useNotifications } from '@/contexts/NotificationContext';

function formatLocalTime(iso?: string | null): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return null;
  }
}

function chipColor(snapshot: any): { ring: string; text: string; dot: string } {
  if (!snapshot) return { ring: 'ring-gray-200', text: 'text-gray-600', dot: 'bg-gray-300' };
  if (snapshot.exhausted) return { ring: 'ring-red-200', text: 'text-red-700', dot: 'bg-red-500' };
  const worstPct = Math.max(
    snapshot.tokens_pct?.input ?? 0,
    snapshot.tokens_pct?.output ?? 0,
    snapshot.prompts_pct ?? 0,
  );
  if (worstPct >= 80) return { ring: 'ring-orange-200', text: 'text-orange-700', dot: 'bg-orange-500' };
  if (worstPct >= 50) return { ring: 'ring-yellow-200', text: 'text-yellow-700', dot: 'bg-yellow-500' };
  return { ring: 'ring-emerald-200', text: 'text-emerald-700', dot: 'bg-emerald-500' };
}

function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

export function QuotaWindowChip() {
  const { quotaSnapshot, refreshQuota } = useNotifications();
  const [open, setOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  if (!quotaSnapshot) return null;

  const color = chipColor(quotaSnapshot);
  const resetsAt = quotaSnapshot.cycle_resets_at || quotaSnapshot.resets_at;
  const resetsAtLabel = formatLocalTime(resetsAt);
  const isExhausted = !!quotaSnapshot.exhausted;
  const chipText = isExhausted
    ? `cota esgotada${resetsAtLabel ? ` · ${resetsAtLabel}` : ''}`
    : resetsAtLabel
      ? `reseta ${resetsAtLabel}`
      : 'janela 5h';

  const inputPct = quotaSnapshot.tokens_pct?.input ?? 0;
  const outputPct = quotaSnapshot.tokens_pct?.output ?? 0;
  const timePct = quotaSnapshot.time_elapsed_pct ?? 0;
  const tokensIn = quotaSnapshot.tokens?.input ?? quotaSnapshot.tokens_input ?? 0;
  const tokensOut = quotaSnapshot.tokens?.output ?? quotaSnapshot.tokens_output ?? 0;
  const inLimit = quotaSnapshot.tokens_limits?.input_5h ?? quotaSnapshot.limits?.tokens_in_5h ?? 0;
  const outLimit = quotaSnapshot.tokens_limits?.output_5h ?? quotaSnapshot.limits?.tokens_out_5h ?? 0;
  const cacheRead = quotaSnapshot.tokens?.cache_read ?? 0;

  return (
    <div className="relative" ref={dropRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ring-1 ${color.ring} ${color.text} bg-white hover:bg-gray-50 transition-colors`}
        title={isExhausted ? `Cota esgotada (reseta ${resetsAtLabel || '?'})` : `Janela 5h reseta às ${resetsAtLabel || '?'}`}
      >
        {isExhausted ? (
          <AlertTriangle className="w-3.5 h-3.5" />
        ) : (
          <Clock className="w-3.5 h-3.5" />
        )}
        <span className="hidden sm:inline">{chipText}</span>
        <span className={`w-1.5 h-1.5 rounded-full ${color.dot}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-96 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
          <div className="p-3 border-b border-gray-100 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">Janela Claude 5h</p>
              <p className="text-xs text-gray-500">
                Fonte: <span className="font-mono">{quotaSnapshot.source || '—'}</span>
                {' · '}
                Tier: <span className="font-mono">{(quotaSnapshot.tier || '').toUpperCase()}</span>
              </p>
            </div>
            <button
              onClick={() => refreshQuota()}
              className="text-xs text-blue-600 hover:underline"
            >
              Atualizar
            </button>
          </div>

          <div className="p-3 space-y-3">
            {/* Time progress */}
            <div>
              <div className="flex justify-between text-xs text-gray-600 mb-1">
                <span>Tempo decorrido</span>
                <span className="tabular-nums">
                  {timePct.toFixed(0)}% · reseta {resetsAtLabel || '?'}
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                <div className="h-full bg-blue-500" style={{ width: `${Math.min(100, timePct)}%` }} />
              </div>
            </div>

            {/* Input tokens */}
            <div>
              <div className="flex justify-between text-xs text-gray-600 mb-1">
                <span>Tokens input</span>
                <span className="tabular-nums">
                  {compactNumber(tokensIn)} / {compactNumber(inLimit)} ({inputPct.toFixed(1)}%)
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                <div
                  className={inputPct >= 80 ? 'h-full bg-red-500' : inputPct >= 50 ? 'h-full bg-yellow-500' : 'h-full bg-emerald-500'}
                  style={{ width: `${Math.min(100, inputPct)}%` }}
                />
              </div>
            </div>

            {/* Output tokens */}
            <div>
              <div className="flex justify-between text-xs text-gray-600 mb-1">
                <span>Tokens output</span>
                <span className="tabular-nums">
                  {compactNumber(tokensOut)} / {compactNumber(outLimit)} ({outputPct.toFixed(1)}%)
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                <div
                  className={outputPct >= 80 ? 'h-full bg-red-500' : outputPct >= 50 ? 'h-full bg-yellow-500' : 'h-full bg-emerald-500'}
                  style={{ width: `${Math.min(100, outputPct)}%` }}
                />
              </div>
            </div>

            {cacheRead > 0 && (
              <p className="text-[11px] text-gray-400">
                Cache reads: {compactNumber(cacheRead)} (não conta no cap)
              </p>
            )}
          </div>

          <div className="p-2 border-t border-gray-100 flex justify-end">
            <Link
              href="/settings?section=quota"
              onClick={() => setOpen(false)}
              className="text-xs text-blue-600 hover:underline"
            >
              Gerenciar →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

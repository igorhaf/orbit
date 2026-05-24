/**
 * NavbarQuotaBadge — small Claudius quota indicator next to NotificationBell.
 *
 * - Color: green (<50%), yellow (50-80%), orange (80-99%), red (exhausted).
 * - Click opens a dropdown with details + link to Settings.
 * - Data source: NotificationContext.quotaSnapshot (WS-driven + 5min heartbeat).
 *
 * v2.3.0
 */
'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { Gauge } from 'lucide-react';
import { useNotifications } from '@/contexts/NotificationContext';

function badgeColor(snapshot: any): { bg: string; ring: string; label: string } {
  if (!snapshot) return { bg: 'bg-gray-300', ring: 'ring-gray-200', label: 'Cota: carregando' };
  if (snapshot.exhausted) return { bg: 'bg-red-500', ring: 'ring-red-200', label: 'Cota esgotada' };
  const pct = snapshot.prompts_pct ?? 0;
  if (pct >= 80) return { bg: 'bg-orange-500', ring: 'ring-orange-200', label: `Cota ${pct.toFixed(0)}%` };
  if (pct >= 50) return { bg: 'bg-yellow-500', ring: 'ring-yellow-200', label: `Cota ${pct.toFixed(0)}%` };
  return { bg: 'bg-emerald-500', ring: 'ring-emerald-200', label: `Cota ${pct.toFixed(0)}%` };
}

export function NavbarQuotaBadge() {
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

  const color = badgeColor(quotaSnapshot);
  const tooltip = quotaSnapshot
    ? `${color.label}${quotaSnapshot.resets_at ? ` — reseta ${quotaSnapshot.resets_at}` : ''}`
    : 'Cota Claude — carregando';

  return (
    <div className="relative" ref={dropRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-md transition-colors"
        title={tooltip}
        aria-label={tooltip}
      >
        <Gauge className="w-4 h-4" />
        <span
          className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ${color.bg} ring-2 ${color.ring}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
          <div className="p-3 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-900">Cota Claude (Claudius)</span>
              <span className="text-xs text-gray-500">
                {quotaSnapshot?.tier ? quotaSnapshot.tier.replace('_', ' ').toUpperCase() : '—'}
              </span>
            </div>
          </div>
          <div className="p-3 space-y-2">
            {!quotaSnapshot ? (
              <p className="text-xs text-gray-500">Carregando…</p>
            ) : quotaSnapshot.exhausted ? (
              <>
                <p className="text-sm text-red-700 font-medium">⏸ Cota esgotada</p>
                {quotaSnapshot.resets_at && (
                  <p className="text-xs text-gray-600">Reseta {quotaSnapshot.resets_at}</p>
                )}
                {quotaSnapshot.exhausted_message && (
                  <p className="text-xs text-gray-500 italic truncate">
                    {quotaSnapshot.exhausted_message}
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-gray-600">
                    <span>Prompts (janela 5h)</span>
                    <span className="font-medium">
                      {quotaSnapshot.prompts_used}/{quotaSnapshot.prompts_max}
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full ${badgeColor(quotaSnapshot).bg} transition-all`}
                      style={{ width: `${Math.min(100, quotaSnapshot.prompts_pct ?? 0)}%` }}
                    />
                  </div>
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Tokens consumidos</span>
                  <span>{(quotaSnapshot.tokens_total ?? 0).toLocaleString()}</span>
                </div>
              </>
            )}
          </div>
          <div className="p-2 border-t border-gray-100 flex items-center justify-between">
            <button
              onClick={async () => {
                await refreshQuota();
              }}
              className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
            >
              Atualizar
            </button>
            <Link
              href="/settings?section=quota"
              onClick={() => setOpen(false)}
              className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
            >
              Configurar →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

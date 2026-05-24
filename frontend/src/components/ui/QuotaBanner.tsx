/**
 * QuotaBanner — yellow dismissable banner shown when Claude quota is low/exhausted.
 *
 * Appears below the navbar when:
 *  - quotaSnapshot.exhausted === true, OR
 *  - quotaSnapshot.prompts_pct >= 80
 *
 * Dismissal is persisted in localStorage and re-fires when state changes.
 *
 * v2.3.0
 */
'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, X } from 'lucide-react';
import { useNotifications } from '@/contexts/NotificationContext';

const DISMISS_KEY = 'quota_banner_dismissed_state';

function stateSignature(snapshot: any): string {
  if (!snapshot) return 'none';
  if (snapshot.exhausted) return `exhausted:${snapshot.resets_at || ''}`;
  const pct = Math.floor((snapshot.prompts_pct ?? 0) / 10) * 10;
  return `pct:${pct}`;
}

export function QuotaBanner() {
  const { quotaSnapshot } = useNotifications();
  const [dismissedSig, setDismissedSig] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setDismissedSig(localStorage.getItem(DISMISS_KEY));
    }
  }, []);

  if (!quotaSnapshot) return null;
  const sig = stateSignature(quotaSnapshot);
  const isExhausted = !!quotaSnapshot.exhausted;
  const isLow = (quotaSnapshot.prompts_pct ?? 0) >= 80;
  const shouldShow = isExhausted || isLow;
  if (!shouldShow) return null;
  if (dismissedSig === sig) return null;

  const message = isExhausted
    ? `Cota Claude esgotada${quotaSnapshot.resets_at ? ` — reseta ${quotaSnapshot.resets_at}` : ''}. Pipelines em execução serão pausados.`
    : `Cota Claude em ${(quotaSnapshot.prompts_pct ?? 0).toFixed(0)}% (${quotaSnapshot.prompts_used}/${quotaSnapshot.prompts_max} prompts na janela 5h).`;

  const color = isExhausted ? 'bg-red-50 border-red-200 text-red-900' : 'bg-yellow-50 border-yellow-200 text-yellow-900';

  return (
    <div className={`border-b ${color} px-4 py-2`}>
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{message}</span>
          <Link
            href="/settings?section=quota"
            className="ml-2 underline font-medium hover:opacity-80"
          >
            Ver detalhes
          </Link>
        </div>
        <button
          onClick={() => {
            if (typeof window !== 'undefined') {
              localStorage.setItem(DISMISS_KEY, sig);
            }
            setDismissedSig(sig);
          }}
          className="p-1 hover:bg-black/5 rounded transition-colors"
          aria-label="Fechar"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

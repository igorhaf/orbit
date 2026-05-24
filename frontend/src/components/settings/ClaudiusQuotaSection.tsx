/**
 * ClaudiusQuotaSection — Settings page card for Claude subscription quota.
 *
 * Shows:
 *  - Current window usage (prompts + tokens, progress bars)
 *  - Plan tier selector (Pro / Max 5x / Max 20x) — persists via /api/v1/claudius/quota/tier
 *  - "Verify now" button (probes Claudius for live state)
 *  - Recent quota events table (last 50)
 *  - Per-claudius-model behavior placeholders (auto-resume, notify, pause >N%)
 *
 * Source of truth: NotificationContext.quotaSnapshot (WS push) + claudiusApi.
 *
 * v2.3.0
 */
'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Gauge, RefreshCw, Zap } from 'lucide-react';
import { useNotifications } from '@/contexts/NotificationContext';
import { claudiusApi, type QuotaSnapshot, type QuotaEvent, type QuotaTier } from '@/lib/api/claudius';

const TIER_OPTIONS: Array<{ id: QuotaTier; label: string; hint: string }> = [
  { id: 'pro',      label: 'Claude Pro',        hint: '~40 prompts/5h • 80h Sonnet/semana' },
  { id: 'max_5x',   label: 'Claude Max 5×',    hint: '~200 prompts/5h • 280h Sonnet • 35h Opus/semana' },
  { id: 'max_20x',  label: 'Claude Max 20×',   hint: '~800 prompts/5h • 480h Sonnet • 40h Opus/semana' },
];

const PREFS_KEY = 'claudius_quota_prefs_v1';

interface QuotaPrefs {
  autoResumeOnQuotaBack: boolean;
  notifyOnQuotaBack: boolean;
  pauseWhenPctOver: number; // 0 = disabled
}

function loadPrefs(): QuotaPrefs {
  if (typeof window === 'undefined') {
    return { autoResumeOnQuotaBack: false, notifyOnQuotaBack: true, pauseWhenPctOver: 0 };
  }
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { autoResumeOnQuotaBack: false, notifyOnQuotaBack: true, pauseWhenPctOver: 0 };
}

function savePrefs(p: QuotaPrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch {}
}

export function ClaudiusQuotaSection() {
  const { quotaSnapshot, refreshQuota } = useNotifications();
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<string | null>(null);
  const [tierSaving, setTierSaving] = useState(false);
  const [events, setEvents] = useState<QuotaEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [prefs, setPrefs] = useState<QuotaPrefs>(() => loadPrefs());

  const snap: QuotaSnapshot | null = quotaSnapshot;

  useEffect(() => {
    let mounted = true;
    setLoadingEvents(true);
    claudiusApi
      .quotaHistory(50)
      .then((r) => mounted && setEvents(r.events || []))
      .catch(() => {})
      .finally(() => mounted && setLoadingEvents(false));
    return () => { mounted = false; };
  }, [quotaSnapshot?.prompts_used, quotaSnapshot?.exhausted]);

  const handleProbe = async () => {
    setProbing(true);
    setProbeResult(null);
    try {
      const r = await claudiusApi.quotaProbe();
      setProbeResult(
        r.available
          ? '✓ Cota disponível — Claudius respondeu OK.'
          : r.reason === 'quota_exhausted'
            ? `⏸ Cota esgotada${r.resets_at ? ` — reseta ${r.resets_at}` : ''}.`
            : `⚠ ${r.reason}: ${r.raw}`
      );
      await refreshQuota();
    } catch (e: any) {
      setProbeResult(`Erro: ${e?.message || 'falha ao consultar Claudius'}`);
    } finally {
      setProbing(false);
    }
  };

  const handleSetTier = async (tier: QuotaTier) => {
    setTierSaving(true);
    try {
      await claudiusApi.quotaSetTier(tier);
      await refreshQuota();
    } catch (e) {
      // best-effort
    } finally {
      setTierSaving(false);
    }
  };

  const handlePrefChange = (patch: Partial<QuotaPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePrefs(next);
  };

  const pct = snap?.prompts_pct ?? 0;
  const barColor = snap?.exhausted ? 'bg-red-500'
    : pct >= 80 ? 'bg-orange-500'
    : pct >= 50 ? 'bg-yellow-500'
    : 'bg-emerald-500';

  return (
    <div className="space-y-6">
      {/* Card 1: status */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Gauge className="w-5 h-5 text-blue-600" />
            <h3 className="text-base font-semibold text-gray-900">Status atual</h3>
          </div>
          <button
            onClick={handleProbe}
            disabled={probing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${probing ? 'animate-spin' : ''}`} />
            {probing ? 'Verificando…' : 'Verificar agora'}
          </button>
        </div>

        {!snap ? (
          <p className="text-sm text-gray-500">Carregando snapshot…</p>
        ) : (
          <div className="space-y-4">
            {snap.exhausted ? (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-md text-sm">
                <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-red-900">Cota esgotada</p>
                  {snap.resets_at && (
                    <p className="text-red-700">Reseta em {snap.resets_at}</p>
                  )}
                  {snap.exhausted_message && (
                    <p className="text-xs text-red-600 italic mt-1">{snap.exhausted_message}</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-md text-sm">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-emerald-900">Cota disponível</p>
                  <p className="text-emerald-700 text-xs">Janela rolante 5h em curso.</p>
                </div>
              </div>
            )}

            {/* Time window progress (v2.4) */}
            {snap.time_elapsed_pct != null && (
              <div>
                <div className="flex justify-between text-xs text-gray-600 mb-1">
                  <span>Tempo decorrido (janela 5h)</span>
                  <span className="font-medium tabular-nums">
                    {snap.time_elapsed_pct.toFixed(0)}% · reseta {snap.cycle_resets_at ? new Date(snap.cycle_resets_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '?'}
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                  <div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.min(100, snap.time_elapsed_pct)}%` }} />
                </div>
              </div>
            )}

            {/* Input tokens (v2.4) */}
            {snap.tokens_pct?.input != null && (
              <div>
                <div className="flex justify-between text-xs text-gray-600 mb-1">
                  <span>Tokens input</span>
                  <span className="font-medium tabular-nums">
                    {(snap.tokens?.input ?? snap.tokens_input).toLocaleString()} / {(snap.tokens_limits?.input_5h ?? 0).toLocaleString()} ({snap.tokens_pct.input.toFixed(1)}%)
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                  <div
                    className={
                      snap.tokens_pct.input >= 80 ? 'h-full bg-red-500'
                        : snap.tokens_pct.input >= 50 ? 'h-full bg-yellow-500'
                        : 'h-full bg-emerald-500'
                    }
                    style={{ width: `${Math.min(100, snap.tokens_pct.input)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Output tokens (v2.4) */}
            {snap.tokens_pct?.output != null && (
              <div>
                <div className="flex justify-between text-xs text-gray-600 mb-1">
                  <span>Tokens output</span>
                  <span className="font-medium tabular-nums">
                    {(snap.tokens?.output ?? snap.tokens_output).toLocaleString()} / {(snap.tokens_limits?.output_5h ?? 0).toLocaleString()} ({snap.tokens_pct.output.toFixed(1)}%)
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                  <div
                    className={
                      snap.tokens_pct.output >= 80 ? 'h-full bg-red-500'
                        : snap.tokens_pct.output >= 50 ? 'h-full bg-yellow-500'
                        : 'h-full bg-emerald-500'
                    }
                    style={{ width: `${Math.min(100, snap.tokens_pct.output)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Prompts (legacy) */}
            <div>
              <div className="flex justify-between text-xs text-gray-600 mb-1">
                <span>Prompts (janela)</span>
                <span className="font-medium tabular-nums">{snap.prompts_used} / {snap.prompts_max} ({pct.toFixed(1)}%)</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                <div className={`h-full ${barColor} transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
            </div>

            {/* Cache reads (info-only, doesn't count) */}
            {(snap.tokens?.cache_read ?? 0) > 0 && (
              <p className="text-[11px] text-gray-400">
                Cache reads: {(snap.tokens?.cache_read ?? 0).toLocaleString()} tokens (não contam contra o cap)
              </p>
            )}

            {/* Source badge */}
            <p className="text-[11px] text-gray-400">
              Fonte: <span className="font-mono">{snap.source || 'desconhecida'}</span>
              {snap.source === 'jsonl' && ' (compartilhado — vê outras sessões CLI)'}
            </p>

            {probeResult && (
              <p className="text-xs px-3 py-2 bg-blue-50 border border-blue-200 rounded text-blue-900">{probeResult}</p>
            )}
          </div>
        )}
      </div>

      {/* Card 2: Plan tier */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-5 h-5 text-purple-600" />
          <h3 className="text-base font-semibold text-gray-900">Plano detectado</h3>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          A Anthropic não expõe os limites via API. Selecione manualmente seu tier para uma estimativa
          mais precisa. Tier atual: <span className="font-mono font-medium">{snap?.tier || '—'}</span>
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {TIER_OPTIONS.map((t) => {
            const isActive = snap?.tier === t.id;
            return (
              <button
                key={t.id}
                onClick={() => handleSetTier(t.id)}
                disabled={tierSaving || isActive}
                className={`text-left p-3 rounded-md border transition-all ${
                  isActive
                    ? 'border-purple-400 bg-purple-50 ring-1 ring-purple-200'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                } disabled:opacity-60`}
              >
                <p className="text-sm font-medium text-gray-900">{t.label}</p>
                <p className="text-xs text-gray-500 mt-1">{t.hint}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Card 3: Per-claudius behavior */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-base font-semibold text-gray-900">Comportamento quando cota volta</h3>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Aplica-se aos modelos com <span className="font-mono">provider=claudius</span>. Preferências salvas localmente.
        </p>
        <div className="space-y-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={prefs.notifyOnQuotaBack}
              onChange={(e) => handlePrefChange({ notifyOnQuotaBack: e.target.checked })}
              className="mt-1"
            />
            <div>
              <p className="text-sm font-medium text-gray-900">Notificar via sino quando cota voltar</p>
              <p className="text-xs text-gray-500">Aparece no NotificationBell + toast 4s.</p>
            </div>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={prefs.autoResumeOnQuotaBack}
              onChange={(e) => handlePrefChange({ autoResumeOnQuotaBack: e.target.checked })}
              className="mt-1"
            />
            <div>
              <p className="text-sm font-medium text-gray-900">Auto-retomar pipelines pendentes quando cota voltar</p>
              <p className="text-xs text-gray-500">
                Dispara <code className="font-mono">deep-pipeline</code> automaticamente em pipelines com
                <code className="font-mono"> interruption_reason=quota_exhausted</code>. Serializado entre execuções
                pra evitar burst.
              </p>
            </div>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={prefs.pauseWhenPctOver > 0}
              onChange={(e) => handlePrefChange({ pauseWhenPctOver: e.target.checked ? 90 : 0 })}
              className="mt-1"
            />
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900">Pausar novas requests quando uso passar de</p>
              {prefs.pauseWhenPctOver > 0 && (
                <input
                  type="number"
                  min={50}
                  max={99}
                  value={prefs.pauseWhenPctOver}
                  onChange={(e) => handlePrefChange({ pauseWhenPctOver: Number(e.target.value) })}
                  className="mt-1 text-sm border border-gray-200 rounded px-2 py-1 w-20"
                />
              )}
              <p className="text-xs text-gray-500 mt-1">
                Reserva margem pra evitar bater o limite no meio de pipelines longos. Reservado pra v2.4.
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* Card 4: history */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-gray-900">Eventos recentes</h3>
          <span className="text-xs text-gray-500">{events.length} eventos</span>
        </div>
        {loadingEvents ? (
          <p className="text-xs text-gray-500">Carregando…</p>
        ) : events.length === 0 ? (
          <p className="text-xs text-gray-500">Sem eventos registrados.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-gray-100">
                <tr className="text-left text-gray-500">
                  <th className="py-2 pr-4 font-medium">Quando</th>
                  <th className="py-2 pr-4 font-medium">Tipo</th>
                  <th className="py-2 pr-4 font-medium">Modelo</th>
                  <th className="py-2 pr-4 font-medium text-right">Tokens</th>
                  <th className="py-2 font-medium">Reset</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {events.slice(0, 30).map((e) => (
                  <tr key={e.id} className="text-gray-700">
                    <td className="py-1.5 pr-4 tabular-nums">{new Date(e.timestamp).toLocaleString('pt-BR')}</td>
                    <td className="py-1.5 pr-4">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        e.event_type === 'exhausted' ? 'bg-red-100 text-red-700'
                          : e.event_type === 'available' ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-blue-100 text-blue-700'
                      }`}>
                        {e.event_type}
                      </span>
                    </td>
                    <td className="py-1.5 pr-4 font-mono text-[11px]">{e.model || '—'}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">
                      {(e.input_tokens || e.output_tokens) ? `${e.input_tokens}↑ ${e.output_tokens}↓` : '—'}
                    </td>
                    <td className="py-1.5 text-gray-500">{e.resets_at || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

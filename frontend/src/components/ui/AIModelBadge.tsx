/**
 * AIModelBadge Component
 * PROMPT #127 - Displays AI model name with tooltip showing details
 *
 * Shows a small red badge with the model name, and on hover displays
 * a tooltip with detailed information about the model.
 */

'use client';

import { useState } from 'react';

interface AIModelInfo {
  model: string;
  provider?: string;
  usage_type?: string;
  tokens_used?: number;
  cost?: number;
  latency_ms?: number;
  cached?: boolean;
}

interface Props {
  model: string;
  provider?: string;
  usage_type?: string;
  tokens_used?: number;
  cost?: number;
  latency_ms?: number;
  cached?: boolean;
  className?: string;
}

// Map model IDs to friendly names
const MODEL_NAMES: Record<string, string> = {
  'claude-3-5-sonnet-20241022': 'Claude Sonnet 3.5',
  'claude-3-5-haiku-20241022': 'Claude Haiku 3.5',
  'claude-3-opus-20240229': 'Claude Opus 3',
  'claude-sonnet-4-20250514': 'Claude Sonnet 4',
  'claude-opus-4-20250514': 'Claude Opus 4',
  'gpt-4o': 'GPT-4o',
  'gpt-4-turbo': 'GPT-4 Turbo',
  'gpt-3.5-turbo': 'GPT-3.5 Turbo',
  'gemini-1.5-pro': 'Gemini 1.5 Pro',
  'gemini-2.0-flash': 'Gemini 2.0 Flash',
  'gemini-1.5-flash': 'Gemini 1.5 Flash',
  'system/fixed-question': 'Sistema (Fixa)',
  'system/fallback': 'Sistema (Fallback)',
};

// Map providers to colors for tooltip
const PROVIDER_COLORS: Record<string, string> = {
  'anthropic': 'text-orange-600',
  'openai': 'text-green-600',
  'google': 'text-blue-600',
  'system': 'text-gray-600',
};

export function AIModelBadge({
  model,
  provider,
  usage_type,
  tokens_used,
  cost,
  latency_ms,
  cached,
  className = '',
}: Props) {
  const [showTooltip, setShowTooltip] = useState(false);

  // Get friendly model name
  const displayName = MODEL_NAMES[model] || model;

  // Detect provider from model name if not provided
  const detectedProvider = provider ||
    (model.includes('claude') ? 'anthropic' :
     model.includes('gpt') ? 'openai' :
     model.includes('gemini') ? 'google' :
     model.includes('system') ? 'system' : 'unknown');

  // Format cost
  const formatCost = (cost: number) => {
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    return `$${cost.toFixed(3)}`;
  };

  return (
    <div className={`relative inline-block ${className}`}>
      <span
        className="text-[11px] text-red-500 font-medium cursor-help hover:text-red-600 transition-colors"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {displayName}
        {cached && <span className="ml-1 text-green-500">●</span>}
      </span>

      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute z-50 bottom-full left-0 mb-2 w-64 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-xl">
          {/* Arrow */}
          <div className="absolute top-full left-4 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-gray-900"></div>

          <div className="space-y-1.5">
            {/* Model */}
            <div className="flex justify-between">
              <span className="text-gray-400">Modelo:</span>
              <span className="text-yellow-400 font-medium">{displayName}</span>
            </div>

            {/* Model ID */}
            <div className="flex justify-between">
              <span className="text-gray-400">ID:</span>
              <span className="text-cyan-400 font-mono text-[10px]">{model}</span>
            </div>

            {/* Provider */}
            <div className="flex justify-between">
              <span className="text-gray-400">Provider:</span>
              <span className={`font-medium ${
                detectedProvider === 'anthropic' ? 'text-orange-400' :
                detectedProvider === 'openai' ? 'text-green-400' :
                detectedProvider === 'google' ? 'text-blue-400' :
                'text-gray-400'
              }`}>
                {detectedProvider.charAt(0).toUpperCase() + detectedProvider.slice(1)}
              </span>
            </div>

            {/* Usage Type */}
            {usage_type && (
              <div className="flex justify-between">
                <span className="text-gray-400">Uso:</span>
                <span className="text-purple-400">{usage_type}</span>
              </div>
            )}

            {/* Tokens */}
            {tokens_used !== undefined && (
              <div className="flex justify-between">
                <span className="text-gray-400">Tokens:</span>
                <span className="text-pink-400">{tokens_used.toLocaleString()}</span>
              </div>
            )}

            {/* Cost */}
            {cost !== undefined && (
              <div className="flex justify-between">
                <span className="text-gray-400">Custo:</span>
                <span className="text-emerald-400">{formatCost(cost)}</span>
              </div>
            )}

            {/* Latency */}
            {latency_ms !== undefined && (
              <div className="flex justify-between">
                <span className="text-gray-400">Latência:</span>
                <span className="text-amber-400">{latency_ms}ms</span>
              </div>
            )}

            {/* Cached */}
            {cached && (
              <div className="flex justify-between">
                <span className="text-gray-400">Cache:</span>
                <span className="text-green-400">✓ Resposta em cache</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

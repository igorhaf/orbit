/**
 * AIModelBadge Component
 * PROMPT #127 - Displays AI model icon with tooltip showing details
 *
 * Shows an icon representing the AI type, and on hover displays
 * a tooltip with detailed information about the model.
 */

'use client';

import { useState } from 'react';

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

// Icon mapping by usage_type
const USAGE_TYPE_ICONS: Record<string, string> = {
  'interview': '🧠🔍',        // IA investigativa / RAG
  'task_execution': '🛠️🤖',   // IA construtora / geradora
  'prompt_generation': '🧠🧩', // raciocínio complexo, arquitetura
  'commit_generation': '🧩⚙️', // engine inteligente
  'memory': '🧠🔍',           // IA investigativa / RAG
  'rag': '🧠📊',              // IA analítica / dados
  'general': '🧠',            // inteligência, cognição
  'context': '🧠🏗️',         // inteligência arquitetada
  'backlog': '🧠🧩',          // raciocínio complexo
  'discovery': '🔮',          // predição / visão de futuro
};

// Icon mapping by provider (fallback)
const PROVIDER_ICONS: Record<string, string> = {
  'anthropic': '🧠',     // inteligência, cognição
  'openai': '⚡🤖',      // poder computacional
  'google': '🌐🧠',      // inteligência distribuída
  'cohere': '🧬🧠',      // inteligência emergente
  'ollama': '🏗️🤖',     // arquitetura + IA
  'system': '⚙️',        // processamento, engine, lógica
};

// Icon descriptions for tooltip
const ICON_DESCRIPTIONS: Record<string, string> = {
  '🧠': 'Inteligência / Cognição',
  '🧠🔍': 'IA Investigativa / RAG',
  '🛠️🤖': 'IA Construtora / Geradora',
  '🧠🧩': 'Raciocínio Complexo',
  '🧩⚙️': 'Engine Inteligente',
  '🧠📊': 'IA Analítica',
  '🧠🏗️': 'Inteligência Arquitetada',
  '⚡🤖': 'Poder Computacional',
  '🌐🧠': 'Inteligência Distribuída',
  '🧬🧠': 'Inteligência Emergente',
  '🏗️🤖': 'Arquitetura + IA',
  '⚙️': 'Processamento / Engine',
  '🔮': 'Predição / Visão de Futuro',
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

  // Get icon based on usage_type first, then provider
  const getIcon = () => {
    if (usage_type && USAGE_TYPE_ICONS[usage_type]) {
      return USAGE_TYPE_ICONS[usage_type];
    }
    if (detectedProvider && PROVIDER_ICONS[detectedProvider]) {
      return PROVIDER_ICONS[detectedProvider];
    }
    return '🧠'; // Default: intelligence
  };

  const icon = getIcon();
  const iconDescription = ICON_DESCRIPTIONS[icon] || 'IA';

  // Format cost
  const formatCost = (cost: number) => {
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    return `$${cost.toFixed(3)}`;
  };

  return (
    <div className={`relative inline-block ${className}`}>
      <span
        className="cursor-help text-base hover:scale-110 transition-transform inline-block"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        title={displayName}
      >
        {icon}
        {cached && <span className="ml-0.5 text-[8px] text-green-500 align-top">●</span>}
      </span>

      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-xl">
          {/* Arrow */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-gray-900"></div>

          <div className="space-y-1.5">
            {/* Icon Type */}
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Tipo:</span>
              <span className="text-white">
                <span className="mr-1">{icon}</span>
                <span className="text-gray-300 text-[10px]">{iconDescription}</span>
              </span>
            </div>

            {/* Model */}
            <div className="flex justify-between">
              <span className="text-gray-400">Modelo:</span>
              <span className="text-yellow-400 font-medium">{displayName}</span>
            </div>

            {/* Model ID */}
            <div className="flex justify-between">
              <span className="text-gray-400">ID:</span>
              <span className="text-cyan-400 font-mono text-[10px] truncate max-w-[140px]">{model}</span>
            </div>

            {/* Provider */}
            <div className="flex justify-between">
              <span className="text-gray-400">Provider:</span>
              <span className={`font-medium ${
                detectedProvider === 'anthropic' ? 'text-orange-400' :
                detectedProvider === 'openai' ? 'text-green-400' :
                detectedProvider === 'google' ? 'text-blue-400' :
                detectedProvider === 'cohere' ? 'text-purple-400' :
                detectedProvider === 'ollama' ? 'text-teal-400' :
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

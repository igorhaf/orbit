/**
 * AIModelBadge Component
 * PROMPT #127 - Displays AI model icon with tooltip showing details
 * PROMPT #150 - Tooltip positioned above icon with smart positioning to avoid cutoff
 *
 * Shows an icon representing the AI type, and on hover displays
 * a tooltip with detailed information about the model.
 */

'use client';

import { useState, useRef, useEffect } from 'react';

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

const TOOLTIP_WIDTH = 256; // 16rem = 256px

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
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0, arrowLeft: '50%' });
  const iconRef = useRef<HTMLSpanElement>(null);

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

  // Calculate tooltip position when showing
  useEffect(() => {
    if (showTooltip && iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const padding = 8; // Minimum padding from viewport edge

      // Calculate ideal center position
      let left = rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2;
      let arrowLeft = '50%';

      // Adjust if tooltip would go off-screen to the right
      if (left + TOOLTIP_WIDTH + padding > viewportWidth) {
        const overflow = (left + TOOLTIP_WIDTH + padding) - viewportWidth;
        left = left - overflow;
        // Adjust arrow position to point to icon
        const arrowOffset = TOOLTIP_WIDTH / 2 + overflow;
        arrowLeft = `${arrowOffset}px`;
      }

      // Adjust if tooltip would go off-screen to the left
      if (left < padding) {
        const offset = padding - left;
        left = padding;
        // Adjust arrow position to point to icon
        const arrowOffset = TOOLTIP_WIDTH / 2 - offset;
        arrowLeft = `${arrowOffset}px`;
      }

      // Position above the icon with some margin
      const top = rect.top - 8; // 8px gap above icon

      setTooltipPosition({ top, left, arrowLeft });
    }
  }, [showTooltip]);

  return (
    <div className={`relative inline-block ${className}`}>
      <span
        ref={iconRef}
        className="cursor-help text-base hover:scale-110 transition-transform inline-block"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        title={displayName}
      >
        {icon}
        {cached && <span className="ml-0.5 text-[8px] text-green-500 align-top">●</span>}
      </span>

      {/* Tooltip - PROMPT #150: positioned above icon with smart positioning to avoid cutoff */}
      {showTooltip && (
        <div
          className="fixed z-[9999] w-64 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-xl pointer-events-none"
          style={{
            top: tooltipPosition.top,
            left: tooltipPosition.left,
            transform: 'translateY(-100%)',
          }}
        >
          {/* Arrow pointing down - position adjusted based on tooltip shift */}
          <div
            className="absolute top-full w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-gray-900"
            style={{
              left: tooltipPosition.arrowLeft,
              transform: 'translateX(-50%)',
            }}
          />

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

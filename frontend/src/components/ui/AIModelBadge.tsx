/**
 * AIModelBadge Component
 * PROMPT #127 - Displays AI model icon with tooltip showing details
 * PROMPT #150 - Tooltip positioned above icon with smart positioning to avoid cutoff
 *
 * Shows an icon representing the AI type, and on hover displays
 * a tooltip with detailed information about the model.
 */

'use client';

import React, { useState, useRef, useEffect } from 'react';
import { IconBrain, IconSearch, IconWrench, IconCpu, IconPuzzle, IconCog, IconChart, IconBlocks, IconSparkle, IconBolt, IconBeaker, IconGlobe, IconDot, IconCheckCircle } from '@/components/icons'; // PROMPT #188

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

// Icon mapping by usage_type - returns React components
const USAGE_TYPE_ICON_KEYS: Record<string, string> = {
  'interview': 'brain-search',
  'task_execution': 'wrench-cpu',
  'prompt_generation': 'brain-puzzle',
  'commit_generation': 'puzzle-cog',
  'memory': 'brain-search',
  'rag': 'brain-chart',
  'general': 'brain',
  'context': 'brain-blocks',
  'backlog': 'brain-puzzle',
  'discovery': 'sparkle',
};

// Icon mapping by provider (fallback)
const PROVIDER_ICON_KEYS: Record<string, string> = {
  'anthropic': 'brain',
  'openai': 'bolt-cpu',
  'google': 'globe-brain',
  'cohere': 'beaker-brain',
  'ollama': 'blocks-cpu',
  'system': 'cog',
};

// Render icon component by key
const renderIconByKey = (key: string, className: string = 'w-4 h-4'): React.ReactNode => {
  switch (key) {
    case 'brain': return <IconBrain className={className} />;
    case 'brain-search': return <span className="inline-flex gap-0.5"><IconBrain className={className} /><IconSearch className={className} /></span>;
    case 'wrench-cpu': return <span className="inline-flex gap-0.5"><IconWrench className={className} /><IconCpu className={className} /></span>;
    case 'brain-puzzle': return <span className="inline-flex gap-0.5"><IconBrain className={className} /><IconPuzzle className={className} /></span>;
    case 'puzzle-cog': return <span className="inline-flex gap-0.5"><IconPuzzle className={className} /><IconCog className={className} /></span>;
    case 'brain-chart': return <span className="inline-flex gap-0.5"><IconBrain className={className} /><IconChart className={className} /></span>;
    case 'brain-blocks': return <span className="inline-flex gap-0.5"><IconBrain className={className} /><IconBlocks className={className} /></span>;
    case 'sparkle': return <IconSparkle className={className} />;
    case 'bolt-cpu': return <span className="inline-flex gap-0.5"><IconBolt className={className} /><IconCpu className={className} /></span>;
    case 'globe-brain': return <span className="inline-flex gap-0.5"><IconGlobe className={className} /><IconBrain className={className} /></span>;
    case 'beaker-brain': return <span className="inline-flex gap-0.5"><IconBeaker className={className} /><IconBrain className={className} /></span>;
    case 'blocks-cpu': return <span className="inline-flex gap-0.5"><IconBlocks className={className} /><IconCpu className={className} /></span>;
    case 'cog': return <IconCog className={className} />;
    default: return <IconBrain className={className} />;
  }
};

// Icon descriptions for tooltip
const ICON_KEY_DESCRIPTIONS: Record<string, string> = {
  'brain': 'Inteligência / Cognição',
  'brain-search': 'IA Investigativa / RAG',
  'wrench-cpu': 'IA Construtora / Geradora',
  'brain-puzzle': 'Raciocínio Complexo',
  'puzzle-cog': 'Engine Inteligente',
  'brain-chart': 'IA Analítica',
  'brain-blocks': 'Inteligência Arquitetada',
  'bolt-cpu': 'Poder Computacional',
  'globe-brain': 'Inteligência Distribuída',
  'beaker-brain': 'Inteligência Emergente',
  'blocks-cpu': 'Arquitetura + IA',
  'cog': 'Processamento / Engine',
  'sparkle': 'Predição / Visão de Futuro',
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

  // Get icon key based on usage_type first, then provider
  const getIconKey = () => {
    if (usage_type && USAGE_TYPE_ICON_KEYS[usage_type]) {
      return USAGE_TYPE_ICON_KEYS[usage_type];
    }
    if (detectedProvider && PROVIDER_ICON_KEYS[detectedProvider]) {
      return PROVIDER_ICON_KEYS[detectedProvider];
    }
    return 'brain'; // Default: intelligence
  };

  const iconKey = getIconKey();
  const iconDescription = ICON_KEY_DESCRIPTIONS[iconKey] || 'IA';

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
        className="cursor-help hover:scale-110 transition-transform inline-flex items-center text-gray-600"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        title={displayName}
      >
        {renderIconByKey(iconKey, 'w-4 h-4')}
        {cached && <span className="ml-0.5"><IconDot className="w-2 h-2 text-green-500" /></span>}
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
              <span className="text-white inline-flex items-center gap-1">
                {renderIconByKey(iconKey, 'w-3 h-3')}
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
                <span className="text-green-400 inline-flex items-center gap-1">
                  <IconCheckCircle className="w-3 h-3" />
                  Resposta em cache
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

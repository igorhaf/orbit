/**
 * Overview Tab Sub-Component
 * Extracted from ItemDetailPanel.tsx
 * Contains read-only description with AI action buttons, metadata grid, labels, components
 * Description is editable only via AI (detalhar/sintetizar/reformular)
 */

'use client';

import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { AIModelBadge } from '@/components/ui/AIModelBadge';
import { tasksApi } from '@/lib/api';
import { BacklogItem } from '@/lib/types';
import { useNotifications } from '@/contexts/NotificationContext';

const COMPLEXITY_OPTIONS = [
  { value: 'low', label: 'Haiku', color: 'bg-green-50 text-green-700 border-green-200' },
  { value: 'medium', label: 'Sonnet', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  { value: 'high', label: 'Opus', color: 'bg-purple-50 text-purple-700 border-purple-200' },
] as const;

export interface OverviewTabProps {
  item: BacklogItem;
  handleGenerateContent: () => void;
  isGeneratingContent: boolean;
  isApproving: boolean;
  onUpdate?: () => void;
  // Keep old props as optional for backward compat (ignored)
  isEditingDescription?: boolean;
  editedDescription?: string;
  setEditedDescription?: (val: string) => void;
  descriptionEditorRef?: React.RefObject<HTMLDivElement>;
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
  handleDescriptionDoubleClick?: () => void;
  handleSaveDescription?: () => void;
  handleCancelEdit?: () => void;
  isSavingDescription?: boolean;
  formatBold?: () => void;
  formatItalic?: () => void;
  formatCode?: () => void;
  formatCodeBlock?: () => void;
  formatHeading1?: () => void;
  formatHeading2?: () => void;
  formatHeading3?: () => void;
  formatBulletList?: () => void;
  formatNumberedList?: () => void;
  formatLink?: () => void;
  formatQuote?: () => void;
  formatTable?: () => void;
}

export default function OverviewTab({
  item,
  handleGenerateContent,
  isGeneratingContent,
  isApproving,
  onUpdate,
}: OverviewTabProps) {
  const { addJob } = useNotifications();
  const [savingComplexity, setSavingComplexity] = useState(false);
  const [expandingDescription, setExpandingDescription] = useState(false);
  const [summarizingDescription, setSummarizingDescription] = useState(false);
  const [rephrasingDescription, setRephrasingDescription] = useState(false);

  const isAnyAIAction = isGeneratingContent || isApproving || expandingDescription || summarizingDescription || rephrasingDescription;

  const handleComplexityChange = async (newValue: string) => {
    setSavingComplexity(true);
    try {
      await tasksApi.update(item.id, { complexity: newValue });
      if (onUpdate) onUpdate();
    } catch (err) {
      console.error('Failed to update complexity:', err);
    } finally {
      setSavingComplexity(false);
    }
  };

  const handleExpandDescription = async () => {
    setExpandingDescription(true);
    try {
      const result = await tasksApi.expandDescription(item.id);
      if (result.job_id) {
        addJob(result.job_id, 'description_generation', `Detalhando: ${item.title.substring(0, 30)}...`, item.title, false, item.id);
      }
      if (onUpdate) onUpdate();
    } catch (error: any) {
      console.error('Failed to expand description:', error);
    } finally {
      setExpandingDescription(false);
    }
  };

  const handleSummarizeDescription = async () => {
    setSummarizingDescription(true);
    try {
      const result = await tasksApi.summarizeDescription(item.id);
      if (result.job_id) {
        addJob(result.job_id, 'description_generation', `Resumindo: ${item.title.substring(0, 30)}...`, item.title, false, item.id);
      }
      if (onUpdate) onUpdate();
    } catch (error: any) {
      console.error('Failed to summarize description:', error);
    } finally {
      setSummarizingDescription(false);
    }
  };

  const handleRephraseDescription = async () => {
    setRephrasingDescription(true);
    try {
      const result = await tasksApi.rephraseDescription(item.id);
      if (result.job_id) {
        addJob(result.job_id, 'description_generation', `Reformulando: ${item.title.substring(0, 30)}...`, item.title, false, item.id);
      }
      if (onUpdate) onUpdate();
    } catch (error: any) {
      console.error('Failed to rephrase description:', error);
    } finally {
      setRephrasingDescription(false);
    }
  };

  const SpinnerIcon = () => (
    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );

  return (
    <div className="space-y-6">
      {/* Description - Read-only with AI action buttons */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-900">Descrição</h3>
          <div className="flex items-center gap-1">
            {/* When description exists: expand + summarize + rephrase */}
            {item.description && (
              <>
                <button
                  type="button"
                  onClick={handleExpandDescription}
                  disabled={isAnyAIAction}
                  title="Detalhar descrição (expandir com mais informações)"
                  className="flex items-center justify-center w-7 h-7 shrink-0 rounded-md border border-gray-300 bg-white text-gray-400 hover:bg-green-50 hover:text-green-600 hover:border-green-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {expandingDescription ? <SpinnerIcon /> : (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                    </svg>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleSummarizeDescription}
                  disabled={isAnyAIAction}
                  title="Resumir descrição (condensar texto)"
                  className="flex items-center justify-center w-7 h-7 shrink-0 rounded-md border border-gray-300 bg-white text-gray-400 hover:bg-orange-50 hover:text-orange-600 hover:border-orange-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {summarizingDescription ? <SpinnerIcon /> : (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 16L14.5 20.5L9 16m11-8L14.5 3.5L9 8M4 12h16" />
                    </svg>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleRephraseDescription}
                  disabled={isAnyAIAction}
                  title="Reformular descrição (reescrever com outras palavras)"
                  className="flex items-center justify-center w-7 h-7 shrink-0 rounded-md border border-gray-300 bg-white text-gray-400 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {rephrasingDescription ? <SpinnerIcon /> : (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  )}
                </button>
              </>
            )}
            {/* When no description: generate via AI */}
            {!item.description && (
              <button
                type="button"
                onClick={handleGenerateContent}
                disabled={isAnyAIAction}
                title="Gerar descrição detalhada com IA"
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100 hover:border-purple-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isGeneratingContent ? <SpinnerIcon /> : (
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                )}
                <span>{isGeneratingContent ? 'Gerando...' : 'IA'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Read-only description display */}
        <div className="rounded-lg p-3 -m-3">
          {item.description ? (
            <div className="prose prose-sm max-w-none text-gray-700">
              <ReactMarkdown>
                {item.description}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm text-gray-400 italic py-4 text-center border-2 border-dashed border-gray-200 rounded-lg">
              Sem descrição. Use o botão IA para gerar automaticamente.
            </p>
          )}
          {item.created_by_ai_model && (
            <div className="mt-2 flex justify-end">
              <AIModelBadge model={item.created_by_ai_model} usage_type="prompt_generation" promptText={item.generated_prompt} />
            </div>
          )}
        </div>
      </div>

      {/* Metadata Grid */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <span className="text-xs font-semibold text-gray-500 uppercase">Status</span>
          <p className="text-sm text-gray-900 mt-1">{item.workflow_state}</p>
        </div>
        <div>
          <span className="text-xs font-semibold text-gray-500 uppercase">Prioridade</span>
          <p className="text-sm text-gray-900 mt-1">{item.priority}</p>
        </div>
        <div>
          <span className="text-xs font-semibold text-gray-500 uppercase">Complexidade</span>
          <div className="mt-1">
            <select
              value={item.complexity || 'medium'}
              onChange={(e) => handleComplexityChange(e.target.value)}
              disabled={savingComplexity}
              className={`text-sm font-medium rounded-md border px-2 py-1 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                (item.complexity || 'medium') === 'low'
                  ? 'bg-green-50 text-green-700 border-green-200'
                  : (item.complexity || 'medium') === 'high'
                  ? 'bg-purple-50 text-purple-700 border-purple-200'
                  : 'bg-blue-50 text-blue-700 border-blue-200'
              }`}
            >
              {COMPLEXITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {item.reporter && (
          <div>
            <span className="text-xs font-semibold text-gray-500 uppercase">Relator</span>
            <p className="text-sm text-gray-900 mt-1">{item.reporter}</p>
          </div>
        )}
        <div>
          <span className="text-xs font-semibold text-gray-500 uppercase">Criado</span>
          <p className="text-sm text-gray-900 mt-1">
            {new Date(item.created_at).toLocaleString()}
          </p>
        </div>
        <div>
          <span className="text-xs font-semibold text-gray-500 uppercase">Atualizado</span>
          <p className="text-sm text-gray-900 mt-1">
            {new Date(item.updated_at).toLocaleString()}
          </p>
        </div>
      </div>

      {/* Labels */}
      {Array.isArray(item.labels) && item.labels.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Etiquetas</h3>
          <div className="flex flex-wrap gap-2">
            {item.labels.map((label, idx) => (
              <span key={idx} className="px-2 py-1 text-xs rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                {label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Components */}
      {item.components && item.components.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Componentes</h3>
          <div className="flex flex-wrap gap-2">
            {item.components.map((component, idx) => (
              <span key={idx} className="px-2 py-1 text-xs rounded bg-gray-100 text-gray-700">
                {component}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

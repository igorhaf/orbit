/**
 * Overview Tab Sub-Component
 * Extracted from ItemDetailPanel.tsx
 * Contains description editor with markdown toolbar, metadata grid, labels, components
 * PROMPT #97 - Inline description editing
 * PROMPT #254 - AI content generation
 * PROMPT #127 - AI model badge
 */

'use client';

import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui';
import { AIModelBadge } from '@/components/ui/AIModelBadge';
import { tasksApi } from '@/lib/api';
import { BacklogItem } from '@/lib/types';

const COMPLEXITY_OPTIONS = [
  { value: 'low', label: 'Haiku', color: 'bg-green-50 text-green-700 border-green-200' },
  { value: 'medium', label: 'Sonnet', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  { value: 'high', label: 'Opus', color: 'bg-purple-50 text-purple-700 border-purple-200' },
] as const;

export interface OverviewTabProps {
  item: BacklogItem;
  isEditingDescription: boolean;
  editedDescription: string;
  setEditedDescription: (val: string) => void;
  descriptionEditorRef: React.RefObject<HTMLDivElement>;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  handleDescriptionDoubleClick: () => void;
  handleSaveDescription: () => void;
  handleCancelEdit: () => void;
  isSavingDescription: boolean;
  handleGenerateContent: () => void;
  isGeneratingContent: boolean;
  isApproving: boolean;
  formatBold: () => void;
  formatItalic: () => void;
  formatCode: () => void;
  formatCodeBlock: () => void;
  formatHeading1: () => void;
  formatHeading2: () => void;
  formatHeading3: () => void;
  formatBulletList: () => void;
  formatNumberedList: () => void;
  formatLink: () => void;
  formatQuote: () => void;
  formatTable: () => void;
  onUpdate?: () => void;
}

export default function OverviewTab({
  item,
  isEditingDescription,
  editedDescription,
  setEditedDescription,
  descriptionEditorRef,
  textareaRef,
  handleDescriptionDoubleClick,
  handleSaveDescription,
  handleCancelEdit,
  isSavingDescription,
  handleGenerateContent,
  isGeneratingContent,
  isApproving,
  formatBold,
  formatItalic,
  formatCode,
  formatCodeBlock,
  formatHeading1,
  formatHeading2,
  formatHeading3,
  formatBulletList,
  formatNumberedList,
  formatLink,
  formatQuote,
  formatTable,
}: OverviewTabProps) {
  const [savingComplexity, setSavingComplexity] = useState(false);

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

  return (
    <div className="space-y-6">
      {/* Description - PROMPT #97: Inline editable with Markdown toolbar */}
      <div ref={descriptionEditorRef}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-900">Descrição</h3>
          <div className="flex items-center gap-2">
            {/* PROMPT #254 - AI content generation button (reuses activate pipeline) */}
            <button
              type="button"
              onClick={handleGenerateContent}
              disabled={isGeneratingContent || isApproving}
              title="Gerar descrição detalhada com IA"
              className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100 hover:border-purple-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {(isGeneratingContent || isApproving) ? (
                <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              )}
              <span>{(isGeneratingContent || isApproving) ? 'Gerando...' : 'IA'}</span>
            </button>
            {!isEditingDescription && (
              <span className="text-xs text-gray-400">Clique duplo para editar</span>
            )}
          </div>
        </div>

        {isEditingDescription ? (
          <div className="border border-blue-300 rounded-lg overflow-hidden shadow-sm">
            {/* Markdown Toolbar */}
            <div className="flex flex-wrap items-center gap-1 p-2 bg-gray-50 border-b border-gray-200">
              {/* Text Formatting */}
              <div className="flex items-center gap-1 pr-2 border-r border-gray-300">
                <button
                  type="button"
                  onClick={formatBold}
                  className="p-1.5 rounded hover:bg-gray-200 text-gray-700 font-bold text-sm"
                  title="Negrito (Ctrl+B)"
                >
                  B
                </button>
                <button
                  type="button"
                  onClick={formatItalic}
                  className="p-1.5 rounded hover:bg-gray-200 text-gray-700 italic text-sm"
                  title="Italico (Ctrl+I)"
                >
                  I
                </button>
                <button
                  type="button"
                  onClick={formatCode}
                  className="p-1.5 rounded hover:bg-gray-200 text-gray-700 font-mono text-sm"
                  title="Código Inline"
                >
                  {'</>'}
                </button>
              </div>

              {/* Headings */}
              <div className="flex items-center gap-1 pr-2 border-r border-gray-300">
                <button
                  type="button"
                  onClick={formatHeading1}
                  className="p-1.5 rounded hover:bg-gray-200 text-gray-700 text-sm font-bold"
                  title="Título 1"
                >
                  H1
                </button>
                <button
                  type="button"
                  onClick={formatHeading2}
                  className="p-1.5 rounded hover:bg-gray-200 text-gray-700 text-sm font-bold"
                  title="Título 2"
                >
                  H2
                </button>
                <button
                  type="button"
                  onClick={formatHeading3}
                  className="p-1.5 rounded hover:bg-gray-200 text-gray-700 text-sm font-bold"
                  title="Título 3"
                >
                  H3
                </button>
              </div>

              {/* Lists */}
              <div className="flex items-center gap-1 pr-2 border-r border-gray-300">
                <button
                  type="button"
                  onClick={formatBulletList}
                  className="p-1.5 rounded hover:bg-gray-200 text-gray-700 text-sm"
                  title="Lista com Marcadores"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={formatNumberedList}
                  className="p-1.5 rounded hover:bg-gray-200 text-gray-700 text-sm"
                  title="Lista Numerada"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h10M7 16h10M3 8h.01M3 12h.01M3 16h.01" />
                  </svg>
                </button>
              </div>

              {/* Blocks */}
              <div className="flex items-center gap-1 pr-2 border-r border-gray-300">
                <button
                  type="button"
                  onClick={formatQuote}
                  className="p-1.5 rounded hover:bg-gray-200 text-gray-700 text-sm"
                  title="Citacao"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={formatCodeBlock}
                  className="p-1.5 rounded hover:bg-gray-200 text-gray-700 text-sm font-mono"
                  title="Bloco de Código"
                >
                  {'```'}
                </button>
                <button
                  type="button"
                  onClick={formatTable}
                  className="p-1.5 rounded hover:bg-gray-200 text-gray-700 text-sm"
                  title="Tabela"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M9 10v8m6-8v8M3 6h18v12H3V6z" />
                  </svg>
                </button>
              </div>

              {/* Link */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={formatLink}
                  className="p-1.5 rounded hover:bg-gray-200 text-gray-700 text-sm"
                  title="Link"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={editedDescription}
              onChange={(e) => setEditedDescription(e.target.value)}
              className="w-full p-4 min-h-[300px] text-sm text-gray-900 font-mono focus:outline-none resize-y"
              placeholder="Digite a descrição usando Markdown..."
              onKeyDown={(e) => {
                // Ctrl+B for bold
                if (e.ctrlKey && e.key === 'b') {
                  e.preventDefault();
                  formatBold();
                }
                // Ctrl+I for italic
                if (e.ctrlKey && e.key === 'i') {
                  e.preventDefault();
                  formatItalic();
                }
                // Escape to cancel
                if (e.key === 'Escape') {
                  e.preventDefault();
                  handleCancelEdit();
                }
                // Ctrl+Enter to save
                if (e.ctrlKey && e.key === 'Enter') {
                  e.preventDefault();
                  handleSaveDescription();
                }
              }}
            />

            {/* Action Buttons */}
            <div className="flex items-center justify-between p-3 bg-gray-50 border-t border-gray-200">
              <span className="text-xs text-gray-500">
                Pressione <kbd className="px-1 py-0.5 bg-gray-200 rounded text-xs">Ctrl+Enter</kbd> para salvar, <kbd className="px-1 py-0.5 bg-gray-200 rounded text-xs">Esc</kbd> para cancelar
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleCancelEdit}
                  disabled={isSavingDescription}
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={handleSaveDescription}
                  disabled={isSavingDescription}
                >
                  {isSavingDescription ? (
                    <>
                      <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-2"></div>
                      Salvando...
                    </>
                  ) : (
                    'Salvar'
                  )}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div
            onDoubleClick={handleDescriptionDoubleClick}
            className="cursor-pointer hover:bg-gray-50 rounded-lg p-3 -m-3 transition-colors group"
            title="Clique duplo para editar"
          >
            {item.description ? (
              <div className="prose prose-sm max-w-none text-gray-700 group-hover:bg-gray-50">
                <ReactMarkdown>
                  {item.description}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic py-4 text-center border-2 border-dashed border-gray-200 rounded-lg">
                Clique duplo para adicionar uma descrição...
              </p>
            )}
            {/* PROMPT #127 - Show AI model icon if content was generated by AI */}
            {item.created_by_ai_model && (
              <div className="mt-2 flex justify-end">
                <AIModelBadge model={item.created_by_ai_model} usage_type="prompt_generation" promptText={item.generated_prompt} />
              </div>
            )}
          </div>
        )}
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
      {item.labels && item.labels.length > 0 && (
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

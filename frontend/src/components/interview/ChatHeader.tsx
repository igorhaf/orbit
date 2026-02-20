/**
 * ChatHeader - Interview header with status badge and action buttons
 * Extracted from ChatInterface.tsx (PROMPT #232)
 */

'use client';

import { Badge, Button } from '@/components/ui';
import { Interview } from '@/lib/types';

interface ChatHeaderProps {
  interview: Interview;
  interviewMode?: string;
  embedded?: boolean;
  generatingPrompts: boolean;
  readOnly?: boolean;
  onGenerateContext: () => void;
  onGenerateEpic: () => void;
  onComplete: () => void;
  onCancel: () => void;
}

/**
 * PROMPT #127 - Improved layout
 * PROMPT #131 - When hideHeader is true, parent handles header rendering
 * PROMPT #130 - Hide action buttons in readOnly mode
 */
export default function ChatHeader({
  interview,
  interviewMode,
  embedded = false,
  generatingPrompts,
  readOnly = false,
  onGenerateContext,
  onGenerateEpic,
  onComplete,
  onCancel,
}: ChatHeaderProps) {
  const isActive = interview.status === 'active';

  return (
    <div className={`border-b px-4 py-2 flex justify-between items-center flex-shrink-0 ${
      embedded
        ? 'bg-gray-50'
        : 'px-6 py-3 bg-gradient-to-r from-blue-50 to-white rounded-t-xl'
    }`}>
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-gray-800">Entrevista</h2>
        <Badge
          variant={
            interview.status === 'active'
              ? 'success'
              : interview.status === 'completed'
              ? 'default'
              : 'danger'
          }
        >
          {interview.status.toUpperCase()}
        </Badge>
      </div>

      {/* PROMPT #130 - Hide action buttons in readOnly mode */}
      {!readOnly && (
        <div className="flex gap-2">
          {/* PROMPT #89 - Context Interview: Generate Context Button */}
          {/* PROMPT #80 - Meta Prompt: Generate Epic Button */}
          {/* PROMPT #131 - Hide Gerar Epic for card_focused mode */}
          {/* PROMPT #122 - Allow generating context immediately if memory scan captured context */}
          {interviewMode === 'context' && (
            <Button
              variant="primary"
              size="sm"
              onClick={onGenerateContext}
              disabled={generatingPrompts || !interview || interview.conversation_data.length < 1}
            >
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Gerar Contexto
            </Button>
          )}
          {interviewMode !== 'context' && interviewMode !== 'card_focused' && (
            <Button
              variant="primary"
              size="sm"
              onClick={onGenerateEpic}
              disabled={generatingPrompts || !interview || interview.conversation_data.length === 0}
            >
              {generatingPrompts ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-1"></div>
                  Gerando Epic...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Gerar Epic
                </>
              )}
            </Button>
          )}

          {isActive && (
            <>
              <Button variant="outline" size="sm" onClick={onComplete}>
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Completar
              </Button>
              <Button variant="danger" size="sm" onClick={onCancel}>
                Cancelar
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

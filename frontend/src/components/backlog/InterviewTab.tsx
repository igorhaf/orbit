/**
 * Interview Tab Sub-Component
 * Extracted from ItemDetailPanel.tsx
 * Shows interview list or ChatInterface for card-focused interviews
 * PROMPT #131 - Card interviews list view and ChatInterface
 * PROMPT #213 - Hide Interview tab for cards from codebase memory scan
 * PROMPT #216 - Reset interview selection when switching tabs
 */

'use client';

import React from 'react';
import { Button } from '@/components/ui';
import { ChatInterface } from '@/components/interview';  // PROMPT #131 - Restored for modal view
import { IconChat, IconCpu } from '@/components/icons';
import { BacklogItem, Interview } from '@/lib/types';

export interface InterviewTabProps {
  item: BacklogItem;
  selectedInterviewId: string | null;
  setSelectedInterviewId: (id: string | null) => void;
  cardInterviews: Interview[];
  loadingInterview: boolean;
  creatingCardInterview: boolean;
  completingInterview: boolean;
  cancellingInterview: boolean;
  handleCreateCardInterview: () => void;
  handleCompleteInterview: () => void;
  handleCancelInterview: () => void;
  onUpdate?: () => void;
  fetchCardInterview: () => void;
}

export default function InterviewTab({
  item,
  selectedInterviewId,
  setSelectedInterviewId,
  cardInterviews,
  loadingInterview,
  creatingCardInterview,
  completingInterview,
  cancellingInterview,
  handleCreateCardInterview,
  handleCompleteInterview,
  handleCancelInterview,
  onUpdate,
  fetchCardInterview,
}: InterviewTabProps) {
  return (
    <div className={selectedInterviewId ? 'flex flex-col flex-1 min-h-0' : 'space-y-4'}>
      {/* PROMPT #131 - Show ChatInterface when interview is selected */}
      {selectedInterviewId ? (
        <div className="flex flex-col flex-1 min-h-0 gap-2">
          {/* Header with title, back link, and action buttons */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <IconChat className="w-5 h-5 text-blue-600" />
            <h3 className="text-sm font-semibold text-gray-900">
              {cardInterviews.find(i => i.id === selectedInterviewId)?.interview_mode === 'card_focused' ? 'Entrevista do Card' : 'Entrevista'}
            </h3>
            <span className={`px-2 py-0.5 text-xs rounded-full ${
              cardInterviews.find(i => i.id === selectedInterviewId)?.status === 'completed'
                ? 'bg-green-100 text-green-700'
                : cardInterviews.find(i => i.id === selectedInterviewId)?.status === 'cancelled'
                ? 'bg-red-100 text-red-700'
                : 'bg-blue-100 text-blue-700'
            }`}>
              {cardInterviews.find(i => i.id === selectedInterviewId)?.status?.toUpperCase()}
            </span>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Action buttons for active interviews */}
            {cardInterviews.find(i => i.id === selectedInterviewId)?.status === 'active' && (
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleCompleteInterview}
                  disabled={completingInterview || cancellingInterview}
                >
                  {completingInterview ? (
                    <>
                      <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-1"></div>
                      Concluindo...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Concluir
                    </>
                  )}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleCancelInterview}
                  disabled={completingInterview || cancellingInterview}
                >
                  {cancellingInterview ? 'Cancelando...' : 'Cancelar'}
                </Button>
              </div>
            )}

            {/* Back to list link */}
            <button
              onClick={() => setSelectedInterviewId(null)}
              className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Voltar para lista
            </button>
          </div>

          {/* ChatInterface - fills remaining space, with header hidden */}
          <div className="border border-gray-200 rounded-lg overflow-hidden flex-1 min-h-0">
            <ChatInterface
              interviewId={selectedInterviewId}
              interviewMode="card_focused"
              onStatusChange={() => {
                fetchCardInterview();
                onUpdate?.();
              }}
              embedded={true}
              parentTaskId={item.id}
              hideHeader={true}
            />
          </div>
        </div>
      ) : (
        <>
          {/* Header with count and add button */}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">
              Entrevistas ({cardInterviews.length})
            </h3>
            <Button
              size="sm"
              variant="outline"
              onClick={handleCreateCardInterview}
              disabled={creatingCardInterview}
            >
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              {creatingCardInterview ? 'Criando...' : 'Nova Entrevista'}
            </Button>
          </div>

          {/* Interview List - Similar to Criteria */}
          {loadingInterview ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : cardInterviews.length === 0 ? (
            /* PROMPT #131 - Empty state with AI Suggestions call-to-action */
            <div className="text-center py-8 border border-dashed border-gray-300 rounded-lg bg-gray-50">
              <span className="mb-3 block"><IconCpu className="w-10 h-10 mx-auto text-gray-400" /></span>
              <p className="text-sm text-gray-700 font-medium mb-2">Sugestões da IA</p>
              <p className="text-xs text-gray-500 mb-4 max-w-sm mx-auto">
                Inicie uma entrevista do card para obter sugestões da IA para melhorar este card,
                decompor em tarefas menores ou refinar critérios de aceitação.
              </p>
              <Button
                size="sm"
                variant="primary"
                onClick={handleCreateCardInterview}
                disabled={creatingCardInterview}
              >
                {creatingCardInterview ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Criando...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    Iniciar Entrevista IA
                  </>
                )}
              </Button>
            </div>
          ) : (
            <ul className="space-y-2">
              {cardInterviews.map((interview) => (
                <li
                  key={interview.id}
                  onClick={() => setSelectedInterviewId(interview.id)}
                  className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:bg-blue-50 hover:border-blue-300 cursor-pointer transition-colors"
                >
                  {/* Interview icon */}
                  <IconChat className="w-5 h-5 text-blue-600" />

                  {/* Interview info */}
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-blue-700">
                      {interview.interview_mode === 'context' ? 'Entrevista de Contexto' :
                       interview.interview_mode === 'meta_prompt' ? 'Entrevista de Epic' :
                       interview.interview_mode === 'card_focused' ? 'Entrevista do Card' :
                       interview.interview_mode === 'task_focused' ? 'Entrevista de Task' :
                       'Entrevista'}
                    </span>
                    <span className="text-xs text-gray-500 ml-2">
                      {interview.conversation_data?.length || 0} mensagens
                    </span>
                  </div>

                  {/* Status badge */}
                  <span className={`px-2 py-0.5 text-xs rounded-full ${
                    interview.status === 'completed'
                      ? 'bg-green-100 text-green-700 border border-green-200'
                      : interview.status === 'active'
                      ? 'bg-blue-100 text-blue-700 border border-blue-200'
                      : 'bg-gray-100 text-gray-700 border border-gray-200'
                  }`}>
                    {interview.status}
                  </span>

                  {/* Arrow icon */}
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </li>
              ))}
            </ul>
          )}

          {/* Interview Traceability (from original interview that created this card) */}
          {(item.interview_question_ids?.length > 0 || (item.interview_insights && Object.keys(item.interview_insights).length > 0)) && (
            <div className="pt-4 border-t border-gray-200">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Rastreabilidade da Entrevista</h3>

              {/* Question IDs */}
              {item.interview_question_ids && item.interview_question_ids.length > 0 && (
                <div className="mb-4">
                  <span className="text-xs font-semibold text-gray-500 uppercase">Perguntas Referenciadas</span>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {item.interview_question_ids.map((qid) => (
                      <span key={qid} className="px-2 py-1 text-xs rounded bg-green-100 text-green-700 border border-green-200">
                        Q{qid}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Interview Insights */}
              {item.interview_insights && Object.keys(item.interview_insights).length > 0 && (
                <div>
                  <span className="text-xs font-semibold text-gray-500 uppercase">Insights</span>
                  <pre className="text-xs bg-gray-50 p-3 rounded border border-gray-200 overflow-x-auto mt-2">
                    {JSON.stringify(item.interview_insights, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

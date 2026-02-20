/**
 * ChatMessages - Messages display area with message bubbles, progress indicators
 * Extracted from ChatInterface.tsx (PROMPT #232)
 */

'use client';

import { RefObject } from 'react';
import { Interview, ConversationMessage } from '@/lib/types';
import { JobProgressBar } from '@/components/ui';
import { MessageBubble } from './MessageBubble';
import { ProvisioningStatusCard } from './ProvisioningStatusCard';

interface ChatMessagesProps {
  interview: Interview;
  embedded?: boolean;
  readOnly?: boolean;
  selectedOptions: string[];
  setSelectedOptions: (options: string[]) => void;
  handleOptionSubmit: (selectedLabels: string[]) => void;
  messagesEndRef: RefObject<HTMLDivElement>;
  // Provisioning status
  provisioningStatus: any;
  onCloseProvisioningStatus: () => void;
  // PROMPT #65 - Send Message Progress
  isSendingMessage: boolean;
  sendMessageJob: any;
  // PROMPT #80 - Epic Generation Progress
  generatingPrompts: boolean;
  // PROMPT #65 - Provisioning Progress
  isProvisioning: boolean;
  provisioningJob: any;
  // AI Thinking indicator
  sending: boolean;
}

/**
 * PROMPT #127 - Improved spacing and layout for messages area
 */
export default function ChatMessages({
  interview,
  embedded = false,
  readOnly = false,
  selectedOptions,
  setSelectedOptions,
  handleOptionSubmit,
  messagesEndRef,
  provisioningStatus,
  onCloseProvisioningStatus,
  isSendingMessage,
  sendMessageJob,
  generatingPrompts,
  isProvisioning,
  provisioningJob,
  sending,
}: ChatMessagesProps) {
  return (
    <div className={`flex-1 overflow-y-auto ${
      embedded
        ? 'px-3 py-2 bg-white'
        : 'px-4 py-4 md:px-8 lg:px-12 bg-gray-50'
    }`}>
      <div className={embedded ? '' : 'max-w-4xl mx-auto'}>
      {interview.conversation_data.length === 0 ? (
        <div className="text-center text-gray-400 py-16">
          <svg
            className="w-12 h-12 mx-auto mb-3 text-gray-300"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
            />
          </svg>
          <p className="text-base mb-1 font-medium">Iniciando IA...</p>
          <p className="text-sm">O assistente ira cumprimentar voce em breve</p>
        </div>
      ) : (
        <>
          {interview.conversation_data.map((msg: ConversationMessage, index: number) => {
            // Find the last unanswered assistant message with options
            // A message is considered "unanswered" if there's no user message after it
            const hasOptions =
              msg.role === 'assistant' &&
              (msg.options?.choices?.length > 0 || msg.content.includes('\u2610') || msg.content.includes('\u25CB'));

            const isUnanswered =
              hasOptions &&
              (index === interview.conversation_data.length - 1 ||
               interview.conversation_data[index + 1]?.role === 'assistant');

            return (
              <MessageBubble
                key={index}
                message={msg}
                onOptionSubmit={handleOptionSubmit}
                selectedOptions={isUnanswered ? selectedOptions : undefined}
                setSelectedOptions={isUnanswered ? setSelectedOptions : undefined}
                readOnly={readOnly}
                compact={embedded}
              />
            );
          })}
          <div ref={messagesEndRef} />

          {/* PROMPT #61 - Show provisioning status after messages */}
          {provisioningStatus && (
            <ProvisioningStatusCard
              provisioning={provisioningStatus}
              projectName={provisioningStatus.projectName || interview?.project?.name || 'Seu Projeto'}
              onClose={onCloseProvisioningStatus}
            />
          )}
        </>
      )}

      {/* PROMPT #65 - Send Message Progress */}
      {isSendingMessage && sendMessageJob && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h4 className="text-sm font-semibold text-blue-900 mb-2">Processando sua mensagem...</h4>
          <JobProgressBar
            percent={sendMessageJob.progress_percent}
            message={sendMessageJob.progress_message}
            status={sendMessageJob.status}
          />
        </div>
      )}

      {/* PROMPT #80 - Epic Generation Progress */}
      {generatingPrompts && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
          <h4 className="text-sm font-semibold text-green-900 mb-2">Gerando Epic...</h4>
          <div className="flex items-center gap-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-600"></div>
            <span className="text-sm text-green-700">Analisando entrevista e criando Epic...</span>
          </div>
          <p className="text-xs text-green-700 mt-2">
            O Epic sera criado automaticamente com base na sua conversa.
          </p>
        </div>
      )}

      {/* PROMPT #65 - Provisioning Progress */}
      {isProvisioning && provisioningJob && (
        <div className="mb-4 p-4 bg-purple-50 border border-purple-200 rounded-lg">
          <h4 className="text-sm font-semibold text-purple-900 mb-2">Provisionando Projeto...</h4>
          <JobProgressBar
            percent={provisioningJob.progress_percent}
            message={provisioningJob.progress_message}
            status={provisioningJob.status}
          />
          <p className="text-xs text-purple-700 mt-2">
            Criando estrutura do projeto, instalando dependencias e configurando ambiente. Isso pode levar 1-3 minutos.
          </p>
        </div>
      )}

      {/* AI Thinking indicator (for non-async operations) */}
      {sending && !isSendingMessage && (
        <div className="flex justify-start mb-4">
          <div className="bg-gray-200 rounded-lg px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
              </div>
              <span className="text-sm text-gray-600 ml-2">A IA esta pensando...</span>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

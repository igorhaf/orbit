/**
 * ChatInput - Input area with text input, send button, option selector
 * Extracted from ChatInterface.tsx (PROMPT #232)
 */

'use client';

import { RefObject } from 'react';
import { Button } from '@/components/ui';

interface ChatInputProps {
  isActive: boolean;
  interviewStatus: string;
  embedded?: boolean;
  message: string;
  setMessage: (value: string) => void;
  selectedOptions: string[];
  setSelectedOptions: (options: string[]) => void;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  sending: boolean;
  isSendingMessage: boolean;
  textareaRef: RefObject<HTMLTextAreaElement>;
}

/**
 * PROMPT #127 - Improved spacing
 * PROMPT #130 - Hidden in readOnly mode (handled by parent)
 * PROMPT #131 - flex-shrink-0 to prevent shrinking
 */
export default function ChatInput({
  isActive,
  interviewStatus,
  embedded = false,
  message,
  setMessage,
  selectedOptions,
  setSelectedOptions,
  onSend,
  onKeyDown,
  sending,
  isSendingMessage,
  textareaRef,
}: ChatInputProps) {
  return (
    <div className={`border-t bg-white flex-shrink-0 ${
      embedded
        ? 'px-3 py-2'
        : 'px-4 py-3 md:px-8 lg:px-12 rounded-b-xl'
    }`}>
      <div className={embedded ? '' : 'max-w-4xl mx-auto'}>
      {isActive ? (
        <div className="flex flex-col gap-2">
          {/* Show selected options indicator */}
          {selectedOptions.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-sm text-blue-800 font-medium">
                {selectedOptions.length} opção(ões) selecionada(s)
              </span>
              <button
                onClick={() => setSelectedOptions([])}
                className="ml-auto text-blue-600 hover:text-blue-800"
                title="Limpar seleção"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          <div className="flex gap-3">
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={selectedOptions.length > 0 ? "Ou digite uma resposta personalizada..." : "Digite sua resposta... (Shift+Enter para nova linha, Enter para enviar)"}
              disabled={sending || isSendingMessage}
              className="flex-1 border border-gray-200 rounded-xl px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 text-gray-900 bg-white min-h-[48px] max-h-[200px] overflow-y-auto shadow-sm"
              rows={1}
            />
          <Button
            onClick={onSend}
            disabled={(!message.trim() && selectedOptions.length === 0) || sending || isSendingMessage}
            variant="primary"
            className="px-6 self-end"
          >
            {(sending || isSendingMessage) ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Enviando...
              </>
            ) : selectedOptions.length > 0 ? (
              <>
                <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Enviar Selecionadas ({selectedOptions.length})
              </>
            ) : (
              <>
                <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
                Enviar
              </>
            )}
          </Button>
        </div>
        </div>
      ) : (
        <div className="text-center text-gray-400 py-4 bg-gray-100 rounded-lg">
          <p className="text-sm font-medium">
            Esta entrevista está {interviewStatus === 'completed' ? 'completa' : interviewStatus === 'cancelled' ? 'cancelada' : interviewStatus}. Não é possível enviar mensagens.
          </p>
        </div>
      )}
      </div>
    </div>
  );
}

/**
 * MessageBubble Component
 * Individual message bubble for chat interface
 */

'use client';

import { useState, useMemo } from 'react';
import { Badge, Button, AIModelBadge } from '@/components/ui';
import {
  IconCheck, IconPin, IconCheckCircle,
  IconBug, IconSparkles, IconWrench, IconBlocks, IconDocument,
  IconBolt, IconPuzzle, IconCog, IconLock
} from '@/components/icons';
import { ConversationMessage } from '@/lib/types';
import { parseMessage } from './MessageParser';

// Icon map for motivation type options (PROMPT #119 - no emojis)
const OPTION_ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  bug: IconBug,
  sparkles: IconSparkles,
  wrench: IconWrench,
  blocks: IconBlocks,
  document: IconDocument,
  bolt: IconBolt,
  puzzle: IconPuzzle,
  checkCircle: IconCheckCircle,
  cog: IconCog,
  lock: IconLock,
};

interface Message extends ConversationMessage {
  role: 'user' | 'assistant' | 'system';
}

interface Props {
  message: Message;
  onOptionSubmit?: (selectedOptions: string[]) => void;
  selectedOptions?: string[];
  setSelectedOptions?: (options: string[]) => void;
  readOnly?: boolean;  // PROMPT #130 - When true, disables all interactive elements
  compact?: boolean;   // PROMPT #130 - When true, reduces vertical spacing for embedded mode
}

export function MessageBubble({
  message,
  onOptionSubmit,
  selectedOptions: externalSelectedOptions,
  setSelectedOptions: externalSetSelectedOptions,
  readOnly = false,
  compact = false
}: Props) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const [internalSelectedOptions, setInternalSelectedOptions] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);

  // Use external state if provided, otherwise use internal state
  const selectedOptions = externalSelectedOptions !== undefined ? externalSelectedOptions : internalSelectedOptions;
  const setSelectedOptions = externalSetSelectedOptions || setInternalSelectedOptions;

  // Parse message content for Unicode options (☐ ☑ ○ ●)
  // This provides backward compatibility with AI responses that include Unicode symbols
  const parsedContent = useMemo(() => parseMessage(message.content), [message.content]);

  if (isSystem) {
    return (
      <div className="text-center py-2">
        <Badge variant="default" className="bg-gray-100 text-gray-600">
          {message.content}
        </Badge>
      </div>
    );
  }

  // Determine which options to use: structured (message.options) takes priority,
  // fall back to parsed Unicode options for backward compatibility
  const effectiveOptions = message.options || parsedContent.options;
  const hasOptions = effectiveOptions && effectiveOptions.choices.length > 0;
  const isSingleChoice = effectiveOptions?.type === 'single';
  const isMultipleChoice = effectiveOptions?.type === 'multiple';

  // Determine display content: use parsed question if we parsed options, otherwise use full content
  const displayContent = parsedContent.hasOptions ? parsedContent.question : message.content;

  const handleOptionToggle = (optionId: string) => {
    if (isSingleChoice) {
      setSelectedOptions([optionId]);
    } else if (isMultipleChoice) {
      setSelectedOptions((prev) =>
        prev.includes(optionId)
          ? prev.filter((id) => id !== optionId)
          : [...prev, optionId]
      );
    }
  };

  const handleSubmitOptions = () => {
    if (selectedOptions.length > 0 && onOptionSubmit && effectiveOptions && !submitted) {
      // Get actual labels from selected IDs
      const selectedLabels = selectedOptions
        .map(id => effectiveOptions.choices.find(choice => choice.id === id)?.label)
        .filter(Boolean) as string[];

      // Mark as submitted BEFORE calling onOptionSubmit to prevent double-submit
      setSubmitted(true);

      onOptionSubmit(selectedLabels);
      setSelectedOptions([]);
    }
  };

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} ${compact ? 'mb-2 pb-2' : 'mb-3 pb-3'} border-b border-gray-100`}>
      {/* PROMPT #130 - WhatsApp-style width: max-w-[75%] for both user and assistant */}
      <div className={`max-w-[75%] ${isUser ? 'order-2' : 'order-1'}`}>
        {/* Role Badge with AI Model indicator */}
        <div className={`text-xs ${compact ? 'mb-1' : 'mb-1.5'} flex items-center gap-1.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
          <Badge variant={isUser ? 'info' : 'default'} size="sm">
            {isUser ? 'Você' : 'Assistente IA'}
          </Badge>
          {/* PROMPT #128 - Show AI model icon for assistant messages */}
          {!isUser && message.model && <AIModelBadge model={message.model} usage_type="interview" />}
        </div>

        {/* Message Card - PROMPT #56: Using div instead of Card to avoid bg-white override */}
        <div
          className={`${compact ? 'px-3 py-2' : 'px-5 py-4'} rounded-xl shadow-sm ${
            isUser
              ? 'bg-blue-600 text-white border border-blue-600'
              : 'bg-white text-gray-800 border border-gray-100'
          }`}
        >
          <div className="whitespace-pre-wrap break-words text-base leading-relaxed">
            {displayContent}
          </div>

          {/* Predefined Options */}
          {hasOptions && !isUser && (
            <div className={`${compact ? 'mt-2 p-2' : 'mt-4 p-4'} rounded-lg border-2 ${compact ? 'space-y-1' : 'space-y-2'} ${
              submitted
                ? 'bg-gray-100 border-gray-300 opacity-60'
                : readOnly
                ? 'bg-gray-50 border-gray-300'
                : 'bg-gray-50 border-gray-200'
            }`}>
              {submitted && !readOnly && (
                <div className={`${compact ? 'mb-2 p-1.5' : 'mb-3 p-2'} bg-green-100 border border-green-300 rounded text-xs text-green-800 font-medium`}>
                  <span className="inline-flex items-center gap-1"><IconCheck className="w-3 h-3" /> Resposta enviada</span>
                </div>
              )}
              {!readOnly && (
                <div className={`text-xs font-semibold text-gray-700 ${compact ? 'mb-2' : 'mb-3'}`}>
                  {isSingleChoice ? <span className="inline-flex items-center gap-1"><IconPin className="w-3 h-3" /> Selecione uma opção:</span> : <span className="inline-flex items-center gap-1"><IconCheckCircle className="w-3 h-3" /> Selecione uma ou mais opções:</span>}
                </div>
              )}
              {effectiveOptions!.choices.map((option) => {
                const isSelected = selectedOptions.includes(option.id);
                return (
                  <div
                    key={option.id}
                    className={`flex items-center ${compact ? 'p-2' : 'p-3'} rounded-lg border-2 transition-all ${
                      submitted
                        ? 'border-gray-300 bg-gray-200 cursor-default opacity-60'
                        : readOnly
                        ? 'border-gray-300 bg-gray-100 cursor-default'
                        : isSelected
                        ? 'border-blue-500 bg-blue-50 shadow-sm cursor-pointer'
                        : 'border-gray-300 bg-white hover:border-blue-300 hover:bg-gray-50 cursor-pointer'
                    }`}
                    onClick={() => !submitted && !readOnly && handleOptionToggle(option.id)}
                  >
                    <input
                      type={isSingleChoice ? 'radio' : 'checkbox'}
                      name={isSingleChoice ? 'option-group' : undefined}
                      checked={isSelected}
                      onChange={() => {}}
                      disabled={submitted || readOnly}
                      className="w-5 h-5 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <span className={`ml-3 text-sm font-medium flex-1 flex items-center gap-2 ${
                      submitted ? 'text-gray-500' : 'text-gray-900'
                    }`}>
                      {'icon' in option && typeof (option as any).icon === 'string' && OPTION_ICON_MAP[(option as any).icon] ? (
                        (() => { const Icon = OPTION_ICON_MAP[(option as any).icon]; return <Icon className="w-4 h-4 shrink-0" />; })()
                      ) : null}
                      {option.label}
                    </span>
                    {isSelected && !submitted && !readOnly && (
                      <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                );
              })}

              {/* Hide submit button and separator in readOnly mode */}
              {!readOnly && (
                <>
                  <Button
                    onClick={handleSubmitOptions}
                    disabled={selectedOptions.length === 0 || submitted}
                    variant="primary"
                    size="sm"
                    className={`w-full ${compact ? 'mt-2' : 'mt-4'}`}
                  >
                    {submitted ? (
                      <span className="inline-flex items-center gap-1"><IconCheck className="w-3 h-3" /> Enviado</span>
                    ) : isSingleChoice ? (
                      selectedOptions.length > 0 ? <span className="inline-flex items-center gap-1"><IconCheck className="w-3 h-3" /> Enviar Resposta</span> : 'Selecione uma opção'
                    ) : (
                      selectedOptions.length > 0
                        ? <span className="inline-flex items-center gap-1"><IconCheck className="w-3 h-3" /> Enviar Selecionadas ({selectedOptions.length})</span>
                        : 'Selecione pelo menos uma opção'
                    )}
                  </Button>

                  {/* Visual Separator - only show if not submitted */}
                  {!submitted && (
                    <div className={`relative ${compact ? 'my-2' : 'my-4'}`}>
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-gray-300"></div>
                      </div>
                      <div className="relative flex justify-center">
                        <span className="bg-gray-50 px-4 py-1 text-xs font-medium text-gray-600 rounded-full border border-gray-300">
                          ou digite sua própria resposta abaixo
                        </span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* User's Selected Options Display */}
          {isUser && message.selected_options && message.selected_options.length > 0 && (
            <div className={`${compact ? 'mt-2 pt-2' : 'mt-3 pt-3'} border-t border-blue-400`}>
              <div className="text-xs text-blue-100 mb-1">Opções selecionadas:</div>
              <div className="flex flex-wrap gap-1">
                {message.selected_options.map((optionId) => (
                  <Badge key={optionId} variant="default" size="sm" className="bg-blue-400 text-white">
                    {optionId}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Timestamp and AI Model - PROMPT #127 */}
          <div className={`flex items-center gap-3 ${compact ? 'mt-1' : 'mt-2'} ${isUser ? 'justify-end' : 'justify-start'}`}>
            {message.timestamp && (
              <span className={`text-xs ${isUser ? 'text-blue-100' : 'text-gray-400'}`}>
                {new Date(message.timestamp).toLocaleTimeString()}
              </span>
            )}
            {/* Show AI model badge for assistant messages */}
            {!isUser && message.model && (
              <AIModelBadge model={message.model} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * MessageBubble Component
 * Individual message bubble for chat interface
 */

'use client';

import { useState, useMemo } from 'react';
import { Badge, Button } from '@/components/ui';
import { ConversationMessage } from '@/lib/types';
import { parseMessage } from './MessageParser';

interface Message extends ConversationMessage {
  role: 'user' | 'assistant' | 'system';
}

interface Props {
  message: Message;
  onOptionSubmit?: (selectedOptions: string[]) => void;
}

export function MessageBubble({ message, onOptionSubmit }: Props) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);

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
    if (selectedOptions.length > 0 && onOptionSubmit && effectiveOptions) {
      // Get actual labels from selected IDs
      const selectedLabels = selectedOptions
        .map(id => effectiveOptions.choices.find(choice => choice.id === id)?.label)
        .filter(Boolean) as string[];

      onOptionSubmit(selectedLabels);
      setSelectedOptions([]);
    }
  };

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className={`max-w-[70%] ${isUser ? 'order-2' : 'order-1'}`}>
        {/* Role Badge */}
        <div className={`text-xs mb-1 ${isUser ? 'text-right' : 'text-left'}`}>
          <Badge variant={isUser ? 'info' : 'default'} size="sm">
            {isUser ? 'You' : 'AI Assistant'}
          </Badge>
        </div>

        {/* Message Card - PROMPT #56: Using div instead of Card to avoid bg-white override */}
        <div
          className={`p-4 rounded-lg border ${
            isUser
              ? 'bg-blue-500 text-white border-blue-500'
              : 'bg-gray-100 text-gray-900 border-gray-200'
          }`}
        >
          <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
            {displayContent}
          </div>

          {/* Predefined Options */}
          {hasOptions && !isUser && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg border-2 border-gray-200 space-y-2">
              <div className="text-xs font-semibold text-gray-700 mb-3">
                {isSingleChoice ? '📍 Select one option:' : '✅ Select one or more options:'}
              </div>
              {effectiveOptions!.choices.map((option) => {
                const isSelected = selectedOptions.includes(option.id);
                return (
                  <label
                    key={option.id}
                    className={`flex items-center p-3 rounded-lg border-2 cursor-pointer transition-all ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50 shadow-sm'
                        : 'border-gray-300 bg-white hover:border-blue-300 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type={isSingleChoice ? 'radio' : 'checkbox'}
                      name={isSingleChoice ? 'option-group' : undefined}
                      checked={isSelected}
                      onChange={() => handleOptionToggle(option.id)}
                      className="w-5 h-5 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 cursor-pointer"
                    />
                    <span className="ml-3 text-sm text-gray-900 font-medium flex-1">
                      {option.label}
                    </span>
                    {isSelected && (
                      <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </label>
                );
              })}

              <Button
                onClick={handleSubmitOptions}
                disabled={selectedOptions.length === 0}
                variant="primary"
                size="sm"
                className="w-full mt-4"
              >
                {isSingleChoice ? (
                  selectedOptions.length > 0 ? '✓ Submit Answer' : 'Select an option'
                ) : (
                  selectedOptions.length > 0
                    ? `✓ Submit Selected (${selectedOptions.length})`
                    : 'Select at least one option'
                )}
              </Button>

              {/* Visual Separator */}
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-300"></div>
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-gray-50 px-4 py-1 text-xs font-medium text-gray-600 rounded-full border border-gray-300">
                    or type your own answer below
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* User's Selected Options Display */}
          {isUser && message.selected_options && message.selected_options.length > 0 && (
            <div className="mt-3 pt-3 border-t border-blue-400">
              <div className="text-xs text-blue-100 mb-1">Selected options:</div>
              <div className="flex flex-wrap gap-1">
                {message.selected_options.map((optionId) => (
                  <Badge key={optionId} variant="default" size="sm" className="bg-blue-400 text-white">
                    {optionId}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {message.timestamp && (
            <div className={`text-xs mt-2 ${isUser ? 'text-blue-100' : 'text-gray-400'}`}>
              {new Date(message.timestamp).toLocaleTimeString()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

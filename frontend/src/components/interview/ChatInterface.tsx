/**
 * ChatInterface Component
 * Main chat interface for interviews with REAL AI interaction
 */

'use client';

import { useState, useRef, useEffect } from 'react';
import { interviewsApi } from '@/lib/api';
import { Interview } from '@/lib/types';
import { Button, Badge } from '@/components/ui';
import { MessageBubble } from './MessageBubble';

interface Props {
  interviewId: string;
  onStatusChange?: () => void;
}

export function ChatInterface({ interviewId, onStatusChange }: Props) {
  const [interview, setInterview] = useState<Interview | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [generatingPrompts, setGeneratingPrompts] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    loadInterview();
  }, [interviewId]);

  useEffect(() => {
    scrollToBottom();
  }, [interview?.conversation_data]);

  const loadInterview = async () => {
    setLoading(true);
    try {
      const response = await interviewsApi.get(interviewId);
      const interviewData = response.data || response;
      setInterview(interviewData || null);

      // Se não tem mensagens, iniciar automaticamente com IA
      if (!interviewData?.conversation_data || interviewData.conversation_data.length === 0) {
        await startInterviewWithAI();
      }
    } catch (error) {
      console.error('Failed to load interview:', error);
      setInterview(null); // Reset on error
      alert('Failed to load interview');
    } finally {
      setLoading(false);
    }
  };

  const startInterviewWithAI = async () => {
    setInitializing(true);
    try {
      console.log('Starting interview with AI...');
      await interviewsApi.start(interviewId);

      // Recarregar para pegar mensagem inicial da IA
      const response = await interviewsApi.get(interviewId);
      const data = response.data || response;
      setInterview(data || null);

      console.log('Interview started successfully!');
    } catch (error) {
      console.error('Failed to start interview with AI:', error);
      // Não mostrar erro ao usuário, apenas log
    } finally {
      setInitializing(false);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSend = async (selectedOptions?: string[]) => {
    if ((!message.trim() && !selectedOptions) || sending) return;

    setSending(true);
    const userMessage = message;
    setMessage('');

    try {
      // Enviar mensagem e obter resposta da IA
      await interviewsApi.sendMessage(interviewId, {
        content: userMessage || 'Selected options',
        selected_options: selectedOptions
      });

      // Recarregar para pegar resposta da IA
      const response = await interviewsApi.get(interviewId);
      const data = response.data || response;
      setInterview(data || null);

    } catch (error: any) {
      console.error('Failed to send message:', error);
      const errorMessage = error.response?.data?.detail || 'Failed to send message';
      alert(`Error: ${errorMessage}`);
      setMessage(userMessage); // Restaurar mensagem em caso de erro
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  const handleOptionSubmit = async (selectedLabels: string[]) => {
    // Join labels with comma and send as message content
    const content = selectedLabels.join(', ');

    // Clear any existing text in the input
    setMessage('');

    // Send the message with the selected labels as content
    setSending(true);
    try {
      await interviewsApi.sendMessage(interviewId, {
        content: content,
        selected_options: selectedLabels
      });

      // Reload to get AI response
      const response = await interviewsApi.get(interviewId);
      const data = response.data || response;
      setInterview(data || null);

      // Check if we just completed the 4 stack questions (PROMPT #46 - Phase 1)
      await detectAndSaveStack(data);
    } catch (error: any) {
      console.error('Failed to send message:', error);
      const errorMessage = error.response?.data?.detail || 'Failed to send message';
      alert(`Error: ${errorMessage}`);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  // PROMPT #46 - Phase 1: Auto-detect and save stack configuration
  const detectAndSaveStack = async (interviewData: Interview) => {
    if (!interviewData?.conversation_data) return;

    const messages = interviewData.conversation_data;

    // Check if we have exactly 9 messages (1 AI Q1 + 1 User A1 + 1 AI Q2 + 1 User A2 + 1 AI Q3 + 1 User A3 + 1 AI Q4 + 1 User A4 + 1 AI Q5)
    // Or 8 messages (before AI asks Q5)
    if (messages.length < 8 || messages.length > 9) return;

    // Verify the messages are stack questions by checking for "Question 1", "Question 2", etc
    const aiMessages = messages.filter((m: any) => m.role === 'assistant');
    if (aiMessages.length < 4) return;

    // Check if this looks like stack questions (contains specific keywords)
    const firstQuestion = aiMessages[0]?.content || '';
    if (!firstQuestion.includes('backend') && !firstQuestion.includes('Backend')) return;

    // Extract user answers (messages at index 1, 3, 5, 7)
    const backendAnswer = messages[1]?.content || '';    // Answer to Q1 (Backend)
    const databaseAnswer = messages[3]?.content || '';   // Answer to Q2 (Database)
    const frontendAnswer = messages[5]?.content || '';   // Answer to Q3 (Frontend)
    const cssAnswer = messages[7]?.content || '';        // Answer to Q4 (CSS)

    if (!backendAnswer || !databaseAnswer || !frontendAnswer || !cssAnswer) return;

    // Map answers to stack values (lowercase, remove extra text)
    const extractStackValue = (answer: string): string => {
      const lower = answer.toLowerCase();
      // Extract the framework name before any parentheses or extra text
      const match = lower.match(/^([a-z\s\-\.]+?)(?:\s*\(|$)/);
      return match ? match[1].trim().replace(/\s+/g, '') : lower.split(/[\s,]/)[0];
    };

    const stack = {
      backend: extractStackValue(backendAnswer),
      database: extractStackValue(databaseAnswer),
      frontend: extractStackValue(frontendAnswer),
      css: extractStackValue(cssAnswer)
    };

    try {
      console.log('🎯 Stack detected and saving:', stack);
      await interviewsApi.saveStack(interviewId, stack);
      console.log('✅ Stack configuration saved successfully!');
    } catch (error) {
      console.error('❌ Failed to save stack:', error);
      // Don't show error to user - this is automatic
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleComplete = async () => {
    if (!confirm('Mark this interview as completed?')) return;

    try {
      await interviewsApi.updateStatus(interviewId, 'completed');
      await loadInterview();
      onStatusChange?.();
    } catch (error) {
      console.error('Failed to complete interview:', error);
      alert('Failed to complete interview. Please try again.');
    }
  };

  const handleCancel = async () => {
    if (!confirm('Cancel this interview?')) return;

    try {
      await interviewsApi.updateStatus(interviewId, 'cancelled');
      await loadInterview();
      onStatusChange?.();
    } catch (error) {
      console.error('Failed to cancel interview:', error);
      alert('Failed to cancel interview. Please try again.');
    }
  };

  const handleGeneratePrompts = async () => {
    if (!interview) return;

    const hasMessages = interview.conversation_data && interview.conversation_data.length > 0;
    if (!hasMessages) {
      alert('Cannot generate prompts from an empty interview. Please add some messages first.');
      return;
    }

    if (!confirm('Generate tasks automatically from this interview using AI?\n\nThis will analyze the conversation and create micro-tasks that will appear in your Kanban board.')) {
      return;
    }

    setGeneratingPrompts(true);
    try {
      const response = await interviewsApi.generatePrompts(interviewId);
      // Handle both response formats (direct data or wrapped in .data)
      const data = response.data || response;

      // Backend should return tasks_created or prompts_generated
      const tasksCount = data.tasks_created || data.prompts_generated || 0;

      alert(
        `✅ Success!\n\n` +
        `${tasksCount} tasks were created automatically from your interview.\n\n` +
        `Check your Kanban board to see them in the Backlog column!`
      );

      // Optionally reload interview to update any metadata
      await loadInterview();
    } catch (error: any) {
      console.error('Failed to generate prompts:', error);
      const errorMessage = error.response?.data?.detail || 'Failed to generate prompts. Please try again.';
      alert(`❌ Error:\n\n${errorMessage}`);
    } finally {
      setGeneratingPrompts(false);
    }
  };

  if (loading || initializing) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="text-gray-600">
            {initializing ? 'Starting interview with AI...' : 'Loading interview...'}
          </p>
        </div>
      </div>
    );
  }

  if (!interview) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-gray-500">Interview not found</div>
      </div>
    );
  }

  const isActive = interview.status === 'active';

  return (
    <div className="flex flex-col h-[calc(100vh-12rem)] bg-white rounded-lg shadow-lg">
      {/* Header */}
      <div className="border-b p-4 flex justify-between items-center bg-gray-50 rounded-t-lg">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-gray-900">Interview Session</h2>
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

        <div className="flex gap-2">
          {/* Generate Prompts Button - Primary Action */}
          <Button
            variant="primary"
            size="sm"
            onClick={handleGeneratePrompts}
            disabled={generatingPrompts || !interview || interview.conversation_data.length === 0}
          >
            {generatingPrompts ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-1"></div>
                Generating...
              </>
            ) : (
              <>
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                🤖 Generate Prompts
              </>
            )}
          </Button>

          {isActive && (
            <>
              <Button variant="outline" size="sm" onClick={handleComplete}>
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Complete
              </Button>
              <Button variant="danger" size="sm" onClick={handleCancel}>
                Cancel
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-6 bg-gradient-to-b from-gray-50 to-white">
        {interview.conversation_data.length === 0 ? (
          <div className="text-center text-gray-400 py-12">
            <svg
              className="w-16 h-16 mx-auto mb-4 text-gray-300"
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
            <p className="text-lg mb-2 font-medium">Initializing AI...</p>
            <p className="text-sm">The AI assistant will greet you shortly</p>
          </div>
        ) : (
          <>
            {interview.conversation_data.map((msg, index) => (
              <MessageBubble
                key={index}
                message={msg}
                onOptionSubmit={handleOptionSubmit}
              />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}

        {/* AI Thinking indicator */}
        {sending && (
          <div className="flex justify-start mb-4">
            <div className="bg-gray-200 rounded-lg px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                </div>
                <span className="text-sm text-gray-600 ml-2">AI is thinking...</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="border-t p-4 bg-gray-50 rounded-b-lg">
        {isActive ? (
          <div className="flex gap-2">
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your response... (Shift+Enter for new line, Enter to send)"
              disabled={sending}
              className="flex-1 border border-gray-300 rounded-lg px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
              rows={3}
            />
            <Button
              onClick={handleSend}
              disabled={!message.trim() || sending}
              variant="primary"
              className="px-6 self-end"
            >
              {sending ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Sending...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                  Send
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="text-center text-gray-400 py-4 bg-gray-100 rounded-lg">
            <p className="text-sm font-medium">
              This interview is {interview.status}. Cannot send messages.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

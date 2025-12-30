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

  // PROMPT #57 - Track pre-filled values for title/description questions
  const [prefilledValue, setPrefilledValue] = useState<string | null>(null);
  const [isProjectInfoQuestion, setIsProjectInfoQuestion] = useState(false);
  const [currentQuestionNumber, setCurrentQuestionNumber] = useState<number | null>(null);

  useEffect(() => {
    loadInterview();
  }, [interviewId]);

  useEffect(() => {
    // PROMPT #56 - Improved auto-scroll with delay for DOM rendering
    const timer = setTimeout(() => {
      scrollToBottom();
    }, 100);
    return () => clearTimeout(timer);
  }, [interview?.conversation_data]);

  // PROMPT #57 - Auto-fill textarea when AI asks project info questions (Q1, Q2)
  useEffect(() => {
    if (!interview?.conversation_data || interview.conversation_data.length === 0) {
      setPrefilledValue(null);
      setIsProjectInfoQuestion(false);
      setCurrentQuestionNumber(null);
      return;
    }

    const lastMessage = interview.conversation_data[interview.conversation_data.length - 1];

    // Only pre-fill if last message is from assistant with prefilled_value
    if (lastMessage?.role === 'assistant' && lastMessage.prefilled_value) {
      console.log('🔖 Detected prefilled question:', {
        questionNumber: lastMessage.question_number,
        prefilledValue: lastMessage.prefilled_value
      });

      setMessage(lastMessage.prefilled_value);
      setPrefilledValue(lastMessage.prefilled_value);
      setIsProjectInfoQuestion(lastMessage.question_number === 1 || lastMessage.question_number === 2);
      setCurrentQuestionNumber(lastMessage.question_number || null);

      // Focus textarea for immediate editing
      setTimeout(() => textareaRef.current?.focus(), 150);
    } else {
      // Reset if last message doesn't have prefilled value
      setPrefilledValue(null);
      setIsProjectInfoQuestion(false);
      setCurrentQuestionNumber(null);
    }
  }, [interview?.conversation_data]);

  const loadInterview = async () => {
    setLoading(true);
    try {
      console.log('📥 Loading interview:', interviewId);
      const response = await interviewsApi.get(interviewId);
      const interviewData = response.data || response;
      console.log('📄 Interview loaded:', interviewData);
      setInterview(interviewData || null);

      // Se não tem mensagens, iniciar automaticamente com IA
      const hasMessages = interviewData?.conversation_data && interviewData.conversation_data.length > 0;
      console.log('💬 Has messages:', hasMessages, 'Count:', interviewData?.conversation_data?.length);

      if (!hasMessages) {
        console.log('🎬 No messages found, auto-starting interview with AI...');
        await startInterviewWithAI();
      }
    } catch (error) {
      console.error('❌ Failed to load interview:', error);
      setInterview(null); // Reset on error
      alert('Failed to load interview');
    } finally {
      setLoading(false);
    }
  };

  const startInterviewWithAI = async () => {
    setInitializing(true);
    try {
      console.log('🚀 Starting interview with AI...');
      console.log('📍 Interview ID:', interviewId);

      const startResponse = await interviewsApi.start(interviewId);
      console.log('📨 Start response:', startResponse);

      // Recarregar para pegar mensagem inicial da IA
      console.log('🔄 Reloading interview to get AI response...');
      const response = await interviewsApi.get(interviewId);
      const data = response.data || response;
      console.log('📄 Reloaded interview data:', data);
      console.log('💬 Conversation messages:', data?.conversation_data?.length);

      setInterview(data || null);

      console.log('✅ Interview started successfully!');
    } catch (error: any) {
      console.error('❌ Failed to start interview with AI:', error);
      console.error('❌ Error details:', {
        message: error.message,
        response: error.response,
        status: error.response?.status,
        data: error.response?.data
      });

      // PROMPT #56 - Enhanced error reporting
      const errorMessage = error.response?.data?.detail || error.message || 'Unknown error';
      alert(
        `❌ Falha ao iniciar entrevista automaticamente:\n\n${errorMessage}\n\n` +
        `Você pode enviar uma mensagem manualmente para começar a conversa.`
      );
    } finally {
      setInitializing(false);
    }
  };

  const scrollToBottom = () => {
    // PROMPT #56 - More robust scroll with fallback
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  };

  const handleSend = async (selectedOptions?: string[]) => {
    if ((!message.trim() && !selectedOptions) || sending) return;

    setSending(true);
    const userMessage = message;
    setMessage('');

    try {
      // PROMPT #57 - If user edited title/description, update project first
      if (isProjectInfoQuestion && prefilledValue !== null && userMessage !== prefilledValue) {
        console.log('📝 User edited project info, updating project...', {
          questionNumber: currentQuestionNumber,
          original: prefilledValue,
          edited: userMessage
        });

        const updateData: { title?: string; description?: string } = {};

        if (currentQuestionNumber === 1) {
          updateData.title = userMessage;
        } else if (currentQuestionNumber === 2) {
          updateData.description = userMessage;
        }

        try {
          await interviewsApi.updateProjectInfo(interviewId, updateData);
          console.log('✅ Project info updated successfully');
        } catch (updateError: any) {
          console.error('❌ Failed to update project info:', updateError);
          // Continue anyway - we'll still send the message
        }
      }

      // Enviar mensagem e obter resposta da IA (ou próxima pergunta fixa)
      await interviewsApi.sendMessage(interviewId, {
        content: userMessage || 'Selected options',
        selected_options: selectedOptions
      });

      // Recarregar para pegar resposta da IA
      const response = await interviewsApi.get(interviewId);
      const data = response.data || response;
      setInterview(data || null);

      // Reset project info tracking
      setPrefilledValue(null);
      setIsProjectInfoQuestion(false);
      setCurrentQuestionNumber(null);

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

  // PROMPT #57 - Auto-detect and save stack configuration (updated for 6 questions)
  const detectAndSaveStack = async (interviewData: Interview) => {
    if (!interviewData?.conversation_data) return;

    const messages = interviewData.conversation_data;

    // PROMPT #57 - With 6 fixed questions, we need 12 messages total:
    // Q1 (Title) + A1 + Q2 (Description) + A2 + Q3 (Backend) + A3 + Q4 (Database) + A4 + Q5 (Frontend) + A5 + Q6 (CSS) + A6
    // Or 13 messages (12 + next question)
    if (messages.length < 12 || messages.length > 13) return;

    // Verify the messages are stack questions by checking for backend keyword in Q3
    const aiMessages = messages.filter((m: any) => m.role === 'assistant');
    if (aiMessages.length < 6) return;

    // Check if Q3 (index 4) is the backend question
    const backendQuestion = aiMessages[2]?.content || '';  // Q3 is the 3rd AI message (index 2)
    if (!backendQuestion.includes('backend') && !backendQuestion.includes('Backend')) return;

    // Extract user answers (PROMPT #57 - Updated indices for 6 questions)
    // Stack answers are now at indices 5, 7, 9, 11 (Questions 3, 4, 5, 6)
    const backendAnswer = messages[5]?.content || '';    // Answer to Q3 (Backend)
    const databaseAnswer = messages[7]?.content || '';   // Answer to Q4 (Database)
    const frontendAnswer = messages[9]?.content || '';   // Answer to Q5 (Frontend)
    const cssAnswer = messages[11]?.content || '';       // Answer to Q6 (CSS)

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
              className="flex-1 border border-gray-300 rounded-lg px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 text-gray-900 bg-white"
              rows={3}
            />
            <Button
              onClick={() => handleSend()}
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

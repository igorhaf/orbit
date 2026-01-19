/**
 * ChatInterface Component
 * Main chat interface for interviews with REAL AI interaction
 */

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { interviewsApi, backlogApi } from '@/lib/api';
import { Interview } from '@/lib/types';
import { Button, Badge, JobProgressBar, Dialog, DialogFooter } from '@/components/ui';
import { MessageBubble } from './MessageBubble';
import { ProvisioningStatusCard } from './ProvisioningStatusCard';
import { useJobPolling } from '@/hooks';

interface Props {
  interviewId: string;
  onStatusChange?: () => void;
  onComplete?: () => void;  // PROMPT #89 - Called when interview is completed (for context generation)
  interviewMode?: 'context' | 'meta_prompt' | 'orchestrator' | string;  // PROMPT #89 - Interview mode hint
}

export function ChatInterface({ interviewId, onStatusChange, onComplete, interviewMode }: Props) {
  const router = useRouter();
  const [interview, setInterview] = useState<Interview | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [generatingPrompts, setGeneratingPrompts] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [notFound, setNotFound] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // PROMPT #82 - Prevent double start in React StrictMode
  const startingInterviewRef = useRef(false);

  // Debug: Log selectedOptions changes
  useEffect(() => {
    console.log('🔍 ChatInterface - selectedOptions changed:', selectedOptions);
  }, [selectedOptions]);

  // PROMPT #57 - Track pre-filled values for title/description questions
  const [prefilledValue, setPrefilledValue] = useState<string | null>(null);
  const [isProjectInfoQuestion, setIsProjectInfoQuestion] = useState(false);
  const [currentQuestionNumber, setCurrentQuestionNumber] = useState<number | null>(null);

  // PROMPT #61 - Track provisioning status for UI feedback
  const [provisioningStatus, setProvisioningStatus] = useState<any>(null);

  // PROMPT #51 - Track AI errors (credits, authentication, etc.)
  const [aiError, setAiError] = useState<{ type: string; message: string; provider?: string } | null>(null);

  // PROMPT #81 - Track fallback mode (API failure, using system fallback)
  const [fallbackWarning, setFallbackWarning] = useState<{ message: string; error?: string } | null>(null);

  // PROMPT #87 - Modal states for Epic generation
  const [showEpicConfirmModal, setShowEpicConfirmModal] = useState(false);
  const [showEpicSuccessModal, setShowEpicSuccessModal] = useState(false);
  const [showEpicErrorModal, setShowEpicErrorModal] = useState(false);
  const [epicResult, setEpicResult] = useState<{ title?: string; error?: string } | null>(null);

  // PROMPT #65 - Async job tracking
  const [sendMessageJobId, setSendMessageJobId] = useState<string | null>(null);
  const [generatePromptsJobId, setGeneratePromptsJobId] = useState<string | null>(null);
  const [provisioningJobId, setProvisioningJobId] = useState<string | null>(null);

  // PROMPT #65 - Stable callbacks for send message polling (prevents re-renders)
  const handleSendMessageComplete = useCallback((result: any) => {
    console.log('✅ Send message job completed:', result);

    // PROMPT #65 - Clear from localStorage on completion
    localStorage.removeItem(`sendMessageJob_${interviewId}`);

    // PROMPT #81 - Detect fallback mode
    const isFallback = result?.usage?.fallback === true ||
                       result?.message?.model === 'system/fallback';
    if (isFallback) {
      console.log('⚠️ Fallback mode detected:', result?.usage?.error);
      setFallbackWarning({
        message: 'A IA está temporariamente indisponível. O sistema está usando respostas de fallback.',
        error: result?.usage?.error
      });
    }

    setSendMessageJobId(null);
    loadInterview(); // Reload to get new message
  }, [interviewId]);

  const handleSendMessageError = useCallback((error: string) => {
    console.error('❌ Send message job failed:', error);

    // PROMPT #65 - Clear from localStorage on error
    localStorage.removeItem(`sendMessageJob_${interviewId}`);

    setSendMessageJobId(null);
    alert(`Failed to send message: ${error}`);
  }, [interviewId]);

  // PROMPT #65 - Poll job status for send message
  const { job: sendMessageJob, isPolling: isSendingMessage } = useJobPolling(sendMessageJobId, {
    enabled: !!sendMessageJobId,
    onComplete: handleSendMessageComplete,
    onError: handleSendMessageError,
  });

  // PROMPT #65 - Stable callbacks for generate prompts polling (prevents re-renders)
  const handleGeneratePromptsComplete = useCallback((result: any) => {
    console.log('✅ Generate prompts job completed:', result);

    // PROMPT #65 - Clear from localStorage on completion
    localStorage.removeItem(`generateJob_${interviewId}`);

    setGeneratePromptsJobId(null);

    const tasksCount = result?.total_items || result?.tasks_created || 0;
    const storiesCount = result?.stories_created || 0;

    alert(
      `✅ Success!\n\n` +
      `${storiesCount} stories and ${tasksCount} tasks were created automatically from your interview.\n\n` +
      `Check your Backlog to see them!`
    );

    loadInterview();
  }, [interviewId]);

  const handleGeneratePromptsError = useCallback((error: string) => {
    console.error('❌ Generate prompts job failed:', error);

    // PROMPT #65 - Clear from localStorage on error
    localStorage.removeItem(`generateJob_${interviewId}`);

    setGeneratePromptsJobId(null);

    // Detect AI-specific errors
    const errorLower = error.toLowerCase();
    if (errorLower.includes('credit') || errorLower.includes('balance') || errorLower.includes('quota')) {
      setAiError({
        type: 'credits',
        message: 'Créditos da IA esgotados. Por favor, adicione créditos na sua conta da IA ou configure uma nova API key.',
      });
    } else {
      alert(`❌ Error generating prompts:\n\n${error}`);
    }
  }, [interviewId]);

  // PROMPT #65 - Poll job status for prompt generation
  const { job: generatePromptsJob, isPolling: isGeneratingPrompts } = useJobPolling(generatePromptsJobId, {
    enabled: !!generatePromptsJobId,
    onComplete: handleGeneratePromptsComplete,
    onError: handleGeneratePromptsError,
  });

  // PROMPT #65 - Debug: Log isGeneratingPrompts changes
  useEffect(() => {
    console.log('🎯 isGeneratingPrompts changed:', isGeneratingPrompts);
    console.log('🎯 generatePromptsJobId:', generatePromptsJobId);
    console.log('🎯 generatePromptsJob:', generatePromptsJob);
  }, [isGeneratingPrompts, generatePromptsJobId, generatePromptsJob]);

  // PROMPT #65 - Stable callbacks for provisioning polling (prevents re-renders)
  const handleProvisioningComplete = useCallback((result: any) => {
    console.log('✅ Provisioning job completed:', result);

    // PROMPT #65 - Clear from localStorage on completion
    localStorage.removeItem(`provisioningJob_${interviewId}`);

    setProvisioningJobId(null);

    // Display provisioning status card
    setProvisioningStatus({
      ...result,
      projectName: interview?.project?.name || 'Your Project'
    });

    loadInterview();
  }, [interviewId, interview?.project?.name]);

  const handleProvisioningError = useCallback((error: string) => {
    console.error('❌ Provisioning job failed:', error);

    // PROMPT #65 - Clear from localStorage on error
    localStorage.removeItem(`provisioningJob_${interviewId}`);

    setProvisioningJobId(null);
    alert(`❌ Error provisioning project:\n\n${error}`);
  }, [interviewId]);

  // PROMPT #65 - Poll job status for provisioning
  const { job: provisioningJob, isPolling: isProvisioning } = useJobPolling(provisioningJobId, {
    enabled: !!provisioningJobId,
    onComplete: handleProvisioningComplete,
    onError: handleProvisioningError,
  });

  useEffect(() => {
    loadInterview();
    checkForPendingJobs(); // PROMPT #65 - Check for pending jobs on mount
  }, [interviewId]);

  // PROMPT #65 - Continuously sync jobIds from localStorage (survives Fast Refresh)
  // This catches jobIds that were saved AFTER component mounted (due to Fast Refresh timing)
  useEffect(() => {
    const syncInterval = setInterval(() => {
      // Check for generatePromptsJobId
      const savedGenerateJobId = localStorage.getItem(`generateJob_${interviewId}`);
      if (savedGenerateJobId && savedGenerateJobId !== generatePromptsJobId) {
        console.log('🔄 Syncing generatePromptsJobId from localStorage:', savedGenerateJobId);
        setGeneratePromptsJobId(savedGenerateJobId);
      }

      // Check for provisioningJobId
      const savedProvisioningJobId = localStorage.getItem(`provisioningJob_${interviewId}`);
      if (savedProvisioningJobId && savedProvisioningJobId !== provisioningJobId) {
        console.log('🔄 Syncing provisioningJobId from localStorage:', savedProvisioningJobId);
        setProvisioningJobId(savedProvisioningJobId);
      }

      // Check for sendMessageJobId
      const savedSendMessageJobId = localStorage.getItem(`sendMessageJob_${interviewId}`);
      if (savedSendMessageJobId && savedSendMessageJobId !== sendMessageJobId) {
        console.log('🔄 Syncing sendMessageJobId from localStorage:', savedSendMessageJobId);
        setSendMessageJobId(savedSendMessageJobId);
      }
    }, 100); // Check every 100ms

    return () => clearInterval(syncInterval);
  }, [interviewId, generatePromptsJobId, provisioningJobId, sendMessageJobId]);

  // PROMPT #65 - Check for pending/running jobs when component mounts
  const checkForPendingJobs = async () => {
    try {
      // Restore job IDs from localStorage (survives Fast Refresh)
      const savedGenerateJobId = localStorage.getItem(`generateJob_${interviewId}`);
      const savedProvisioningJobId = localStorage.getItem(`provisioningJob_${interviewId}`);
      const savedSendMessageJobId = localStorage.getItem(`sendMessageJob_${interviewId}`);

      if (savedGenerateJobId) {
        console.log('🔄 Restoring generatePromptsJobId from localStorage:', savedGenerateJobId);
        setGeneratePromptsJobId(savedGenerateJobId);
      }

      if (savedProvisioningJobId) {
        console.log('🔄 Restoring provisioningJobId from localStorage:', savedProvisioningJobId);
        setProvisioningJobId(savedProvisioningJobId);
      }

      if (savedSendMessageJobId) {
        console.log('🔄 Restoring sendMessageJobId from localStorage:', savedSendMessageJobId);
        setSendMessageJobId(savedSendMessageJobId);
      }

      console.log('✅ Component mounted, job polling active');
    } catch (error) {
      console.error('Failed to check pending jobs:', error);
    }
  };

  useEffect(() => {
    // PROMPT #56 - Improved auto-scroll with delay for DOM rendering
    const timer = setTimeout(() => {
      scrollToBottom();
    }, 100);
    return () => clearTimeout(timer);
  }, [interview?.conversation_data]);

  // Auto-resize textarea as user types (WhatsApp-style)
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto';
    // Set height based on content, with max of 200px (about 8 lines)
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  }, [message]);

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
    setNotFound(false);
    try {
      console.log('📥 Loading interview:', interviewId);
      const response = await interviewsApi.get(interviewId);
      const interviewData = response.data || response;
      console.log('📄 Interview loaded:', interviewData);
      setInterview(interviewData || null);

      // Se não tem mensagens, iniciar automaticamente com IA
      const hasMessages = interviewData?.conversation_data && interviewData.conversation_data.length > 0;
      console.log('💬 Has messages:', hasMessages, 'Count:', interviewData?.conversation_data?.length);

      if (!hasMessages && !startingInterviewRef.current) {
        console.log('🎬 No messages found, auto-starting interview with AI...');
        startingInterviewRef.current = true;
        await startInterviewWithAI();
      }
    } catch (error: any) {
      console.error('❌ Failed to load interview:', error);
      setInterview(null); // Reset on error

      // Check if it's a 404 error (interview not found)
      if (error.response?.status === 404) {
        console.log('🔍 Interview not found (404)');
        setNotFound(true);
      } else {
        // For other errors, show generic alert
        alert('Failed to load interview');
      }
    } finally {
      setLoading(false);
    }
  };

  const startInterviewWithAI = async () => {
    // PROMPT #82 - Double-check guard (React StrictMode protection)
    if (initializing) {
      console.log('⏳ Already initializing, skipping duplicate start...');
      return;
    }

    setInitializing(true);
    try {
      console.log('🚀 Starting interview with AI...');
      console.log('📍 Interview ID:', interviewId);

      const startResponse = await interviewsApi.start(interviewId);
      console.log('📨 Start response:', startResponse);

      // PROMPT #81 - Detect fallback on start
      const startData = startResponse.data || startResponse;
      if (startData?.model === 'system/fallback' || startData?.message?.model === 'system/fallback') {
        console.log('⚠️ Fallback mode detected on start');
        setFallbackWarning({
          message: 'A IA está temporariamente indisponível. O sistema está usando respostas de fallback.',
          error: 'API não disponível no momento'
        });
      }

      // Recarregar para pegar mensagem inicial da IA
      console.log('🔄 Reloading interview to get AI response...');
      const response = await interviewsApi.get(interviewId);
      const data = response.data || response;
      console.log('📄 Reloaded interview data:', data);
      console.log('💬 Conversation messages:', data?.conversation_data?.length);

      // PROMPT #81 - Check if first message uses fallback
      const firstMessage = data?.conversation_data?.[0];
      if (firstMessage?.model === 'system/fallback') {
        setFallbackWarning({
          message: 'A IA está temporariamente indisponível. O sistema está usando respostas de fallback.',
          error: 'API não disponível no momento'
        });
      }

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

  const handleSend = async (optionsFromButton?: string[]) => {
    // Use options from button parameter or from state
    const optionsToSend = optionsFromButton || selectedOptions;

    if ((!message.trim() && optionsToSend.length === 0) || sending) return;

    setSending(true);
    const userMessage = message;
    setMessage('');
    setSelectedOptions([]); // Clear selected options

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

      // PROMPT #65 - Enviar mensagem ASYNC (não bloqueia UI)
      console.log('🚀 Sending message async...');
      const response = await interviewsApi.sendMessageAsync(interviewId, {
        content: userMessage || optionsToSend.join(', '),
        selected_options: optionsToSend.length > 0 ? optionsToSend : undefined
      });

      const data = response.data || response;
      const jobId = data.job_id;

      console.log('✅ Message job created:', jobId);

      // PROMPT #65 - Save to localStorage (survives Fast Refresh)
      localStorage.setItem(`sendMessageJob_${interviewId}`, jobId);

      setSendMessageJobId(jobId); // Start polling for job status

      // Reset project info tracking
      setPrefilledValue(null);
      setIsProjectInfoQuestion(false);
      setCurrentQuestionNumber(null);

    } catch (error: any) {
      console.error('Failed to send message:', error);
      const errorDetail = error.response?.data?.detail || error.message || 'Failed to send message';

      // Detect AI-specific errors (credits, authentication, etc.)
      const errorLower = errorDetail.toLowerCase();

      if (errorLower.includes('credit') || errorLower.includes('balance') || errorLower.includes('quota')) {
        setAiError({
          type: 'credits',
          message: 'Créditos da IA esgotados. Por favor, adicione créditos na sua conta da IA ou configure uma nova API key.',
          provider: errorLower.includes('anthropic') ? 'Anthropic (Claude)' :
                   errorLower.includes('openai') ? 'OpenAI (GPT)' :
                   errorLower.includes('google') || errorLower.includes('gemini') ? 'Google (Gemini)' : undefined
        });
      } else if (errorLower.includes('authentication') || errorLower.includes('api key') || errorLower.includes('invalid x-api-key') || errorLower.includes('unauthorized')) {
        setAiError({
          type: 'auth',
          message: 'API key inválida ou expirada. Por favor, configure uma API key válida nas configurações.',
          provider: errorLower.includes('anthropic') ? 'Anthropic (Claude)' :
                   errorLower.includes('openai') ? 'OpenAI (GPT)' :
                   errorLower.includes('google') || errorLower.includes('gemini') ? 'Google (Gemini)' : undefined
        });
      } else if (errorLower.includes('rate limit')) {
        setAiError({
          type: 'rate_limit',
          message: 'Limite de requisições excedido. Por favor, aguarde alguns minutos antes de tentar novamente.',
          provider: errorLower.includes('anthropic') ? 'Anthropic (Claude)' :
                   errorLower.includes('openai') ? 'OpenAI (GPT)' :
                   errorLower.includes('google') || errorLower.includes('gemini') ? 'Google (Gemini)' : undefined
        });
      } else {
        // Generic error - show alert
        alert(`Error: ${errorDetail}`);
      }

      setMessage(userMessage); // Restaurar mensagem em caso de erro
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  const handleOptionSubmit = async (selectedLabels: string[]) => {
    // Join labels with comma and send as message content
    const content = selectedLabels.join(', ');

    // DEBUG: Log what's being sent to backend
    console.log('🔍 ChatInterface - Sending option selection to backend:');
    console.log('  - Content:', content);
    console.log('  - Selected Options:', selectedLabels);

    // Clear any existing text in the input and selected options
    setMessage('');
    setSelectedOptions([]);

    // Send the message with the selected labels as content
    setSending(true);
    try {
      await interviewsApi.sendMessage(interviewId, {
        content: content,
        selected_options: selectedLabels
      });

      console.log('✅ ChatInterface - Message sent successfully');

      // Reload to get AI response
      const response = await interviewsApi.get(interviewId);
      const data = response.data || response;
      setInterview(data || null);

      // Check if we just completed the 4 stack questions (PROMPT #46 - Phase 1)
      await detectAndSaveStack(data);
    } catch (error: any) {
      console.error('Failed to send message:', error);
      const errorDetail = error.response?.data?.detail || error.message || 'Failed to send message';

      // Detect AI-specific errors (credits, authentication, etc.)
      const errorLower = errorDetail.toLowerCase();

      if (errorLower.includes('credit') || errorLower.includes('balance') || errorLower.includes('quota')) {
        setAiError({
          type: 'credits',
          message: 'Créditos da IA esgotados. Por favor, adicione créditos na sua conta da IA ou configure uma nova API key.',
          provider: errorLower.includes('anthropic') ? 'Anthropic (Claude)' :
                   errorLower.includes('openai') ? 'OpenAI (GPT)' :
                   errorLower.includes('google') || errorLower.includes('gemini') ? 'Google (Gemini)' : undefined
        });
      } else if (errorLower.includes('authentication') || errorLower.includes('api key') || errorLower.includes('invalid x-api-key') || errorLower.includes('unauthorized')) {
        setAiError({
          type: 'auth',
          message: 'API key inválida ou expirada. Por favor, configure uma API key válida nas configurações.',
          provider: errorLower.includes('anthropic') ? 'Anthropic (Claude)' :
                   errorLower.includes('openai') ? 'OpenAI (GPT)' :
                   errorLower.includes('google') || errorLower.includes('gemini') ? 'Google (Gemini)' : undefined
        });
      } else if (errorLower.includes('rate limit')) {
        setAiError({
          type: 'rate_limit',
          message: 'Limite de requisições excedido. Por favor, aguarde alguns minutos antes de tentar novamente.',
          provider: errorLower.includes('anthropic') ? 'Anthropic (Claude)' :
                   errorLower.includes('openai') ? 'OpenAI (GPT)' :
                   errorLower.includes('google') || errorLower.includes('gemini') ? 'Google (Gemini)' : undefined
        });
      } else {
        // Generic error - show alert
        alert(`Error: ${errorDetail}`);
      }
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  // PROMPT #57 - Auto-detect and save stack configuration (updated for 7 questions)
  // PROMPT #67 - Mobile support (Q7 added)
  const detectAndSaveStack = async (interviewData: Interview) => {
    if (!interviewData?.conversation_data) return;

    const messages = interviewData.conversation_data;

    // PROMPT #82 - Fixed answer indices (was reading from wrong messages!)
    // Message structure:
    // 0: Initial | 1: User start | 2: Q1 | 3: A1 | 4: Q2 | 5: A2 | 6: Q3 | 7: A3 | 8: Q4 | 9: A4 | 10: Q5 | 11: A5 | 12: Q6 | 13: A6 | 14: Q7 | 15: A7 | 16: Q8
    // We need at least 16 messages (indices 0-15) to have all 7 answers
    // Or 17 messages if Q8 has been sent
    if (messages.length < 16 || messages.length > 17) return;

    // Verify the messages are stack questions by checking for backend keyword in Q3
    const aiMessages = messages.filter((m: any) => m.role === 'assistant');
    if (aiMessages.length < 7) return;

    // Check if Q3 (index 6) is the backend question
    const backendQuestion = aiMessages[2]?.content || '';  // Q3 is the 3rd AI message (index 2)
    if (!backendQuestion.includes('backend') && !backendQuestion.includes('Backend')) return;

    // Extract user answers - PROMPT #82 - CRITICAL FIX: Correct indices!
    // Stack answers are at indices 7, 9, 11, 13, 15 (A3, A4, A5, A6, A7)
    const backendAnswer = messages[7]?.content || '';    // Answer to Q3 (Backend) - was [5] (WRONG!)
    const databaseAnswer = messages[9]?.content || '';   // Answer to Q4 (Database) - was [7] (WRONG!)
    const frontendAnswer = messages[11]?.content || '';   // Answer to Q5 (Frontend) - was [9] (WRONG!)
    const cssAnswer = messages[13]?.content || '';       // Answer to Q6 (CSS) - was [11] (WRONG!)
    const mobileAnswer = messages[15]?.content || '';    // Answer to Q7 (Mobile) - was [13] (WRONG!)

    if (!backendAnswer || !databaseAnswer || !frontendAnswer || !cssAnswer) return;

    // Map answers to stack values (lowercase, remove extra text)
    const extractStackValue = (answer: string): string | null => {
      console.log('🔍 extractStackValue - raw answer:', answer);

      // Remove leading symbols (○, ●, ◉, etc.) that come from option formatting
      const cleaned = answer.replace(/^[○●◉☐■□▪▫•‣⁃]+\s*/, '').trim();
      const lower = cleaned.toLowerCase();

      console.log('🔍 extractStackValue - cleaned:', cleaned, '| lower:', lower);

      // Check if answer indicates "I don't know" or "None" - return null for these cases
      // Be more specific: check if it STARTS with these terms or is EXACTLY these terms
      const dontKnowPatterns = [
        /^i\s*don'?t\s*know/i,
        /^not\s*sure/i,
        /^skip/i,
        /^none$/i,
        /^❓/,
      ];

      for (const pattern of dontKnowPatterns) {
        if (pattern.test(cleaned)) {
          console.log('🚫 extractStackValue - matched "don\'t know" pattern:', pattern);
          return null;
        }
      }

      // Extract the framework name before any parentheses or extra text
      const match = lower.match(/^([a-z\s\-\.]+?)(?:\s*\(|$)/);
      let extracted = match ? match[1].trim() : lower.trim();

      // For multi-word frameworks, take only the first word (e.g., "tailwind css" → "tailwind")
      // UNLESS it contains dots/hyphens which indicate a version (e.g., "next.js" → "nextjs")
      if (extracted.includes('.') || extracted.includes('-')) {
        // Remove dots and hyphens: "next.js" → "nextjs", "vue.js" → "vuejs"
        extracted = extracted.replace(/[\.\-]+/g, '');
      } else {
        // Take only first word: "tailwind css" → "tailwind", "material ui" → "material"
        extracted = extracted.split(/\s+/)[0];
      }

      console.log('✅ extractStackValue - extracted value:', extracted);
      return extracted;
    };

    const stack = {
      backend: extractStackValue(backendAnswer),
      database: extractStackValue(databaseAnswer),
      frontend: extractStackValue(frontendAnswer),
      css: extractStackValue(cssAnswer),
      mobile: extractStackValue(mobileAnswer) || null  // PROMPT #67 - Mobile is optional
    };

    try {
      // PROMPT #65 - Save stack ASYNC (non-blocking provisioning)
      console.log('🎯 Stack detected, saving async:', stack);
      const response = await interviewsApi.saveStackAsync(interviewId, stack);
      const data = response.data || response;
      const jobId = data.job_id;

      console.log('✅ Stack saved, provisioning job created:', jobId);

      // PROMPT #65 - Save to localStorage (survives Fast Refresh)
      localStorage.setItem(`provisioningJob_${interviewId}`, jobId);

      setProvisioningJobId(jobId); // Start polling for provisioning status
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

  // PROMPT #80/87 - Generate Epic only (not full backlog)
  // PROMPT #87 - Open confirmation modal instead of browser confirm
  const handleGenerateEpic = () => {
    if (!interview) return;

    const hasMessages = interview.conversation_data && interview.conversation_data.length > 0;
    if (!hasMessages) {
      setEpicResult({ error: 'Cannot generate Epic from an empty interview. Please add some messages first.' });
      setShowEpicErrorModal(true);
      return;
    }

    // Show confirmation modal
    setShowEpicConfirmModal(true);
  };

  // PROMPT #87 - Actually execute Epic generation after confirmation
  const executeEpicGeneration = async () => {
    if (!interview) return;

    setShowEpicConfirmModal(false);
    setGeneratingPrompts(true);

    try {
      const projectId = interview.project_id;
      console.log('🚀 Generating Epic from interview...');

      // Step 1: Generate Epic suggestion
      const generateResponse = await backlogApi.generateEpic(interviewId, projectId);
      const data = generateResponse.data || generateResponse;

      if (!data.suggestions || data.suggestions.length === 0) {
        throw new Error('No Epic suggestion generated');
      }

      const epicSuggestion = data.suggestions[0];
      console.log('📋 Epic suggestion generated:', epicSuggestion.title);

      // Step 2: Auto-approve and create Epic
      const approveResponse = await backlogApi.approveEpic(epicSuggestion, projectId, interviewId);
      const epic = approveResponse.data || approveResponse;

      console.log('✅ Epic created:', epic.id, epic.title);

      // Show success modal
      setEpicResult({ title: epic.title });
      setShowEpicSuccessModal(true);

      // Refresh interview to show updated state
      await loadInterview();

    } catch (error: any) {
      console.error('❌ Failed to generate Epic:', error);
      const errorDetail = error.response?.data?.detail || error.message || 'Failed to generate Epic.';
      setEpicResult({ error: errorDetail });
      setShowEpicErrorModal(true);
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
        <div className="max-w-md text-center">
          <div className="mb-6">
            <svg
              className="w-20 h-20 mx-auto text-gray-300 mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              {notFound ? 'Interview Not Found' : 'Failed to Load Interview'}
            </h3>
            <p className="text-gray-600 mb-6">
              {notFound
                ? 'The interview you are looking for does not exist or may have been deleted.'
                : 'An unexpected error occurred while loading the interview.'}
            </p>
          </div>

          <div className="flex gap-3 justify-center">
            <Button
              variant="primary"
              onClick={() => router.push('/interviews')}
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Go to Interviews
            </Button>
            {!notFound && (
              <Button
                variant="outline"
                onClick={() => loadInterview()}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Try Again
              </Button>
            )}
          </div>
        </div>
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
          {/* PROMPT #89 - Context Interview: Generate Context Button */}
          {/* PROMPT #80 - Meta Prompt: Generate Epic Button */}
          {interviewMode === 'context' ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => onComplete?.()}
              disabled={generatingPrompts || !interview || interview.conversation_data.length < 6}
            >
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              📝 Gerar Contexto
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={handleGenerateEpic}
              disabled={generatingPrompts || !interview || interview.conversation_data.length === 0}
            >
              {generatingPrompts ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-1"></div>
                  Generating Epic...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  🎯 Gerar Épico
                </>
              )}
            </Button>
          )}

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

      {/* PROMPT #81 - Fallback Warning Banner */}
      {fallbackWarning && (
        <div className="mx-4 mt-4 p-4 rounded-lg border-2 bg-blue-50 border-blue-300">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold mb-1 text-blue-900">
                ⚠️ Modo Fallback Ativo
              </h3>
              <p className="text-sm text-blue-800">
                {fallbackWarning.message}
              </p>
              {fallbackWarning.error && (
                <p className="text-xs text-blue-600 mt-1">
                  Detalhes: {fallbackWarning.error}
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => router.push('/ai-models')}
                  className="text-sm px-3 py-1 rounded font-medium bg-blue-600 hover:bg-blue-700 text-white"
                >
                  Configurar API Keys
                </button>
                <button
                  onClick={() => setFallbackWarning(null)}
                  className="text-sm px-3 py-1 rounded font-medium bg-gray-200 hover:bg-gray-300 text-gray-700"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI Error Banner */}
      {aiError && (
        <div className={`mx-4 mt-4 p-4 rounded-lg border-2 ${
          aiError.type === 'credits' ? 'bg-red-50 border-red-300' :
          aiError.type === 'auth' ? 'bg-yellow-50 border-yellow-300' :
          'bg-orange-50 border-orange-300'
        }`}>
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0">
              {aiError.type === 'credits' ? (
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ) : aiError.type === 'auth' ? (
                <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              ) : (
                <svg className="w-6 h-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              )}
            </div>
            <div className="flex-1">
              <h3 className={`font-semibold mb-1 ${
                aiError.type === 'credits' ? 'text-red-900' :
                aiError.type === 'auth' ? 'text-yellow-900' :
                'text-orange-900'
              }`}>
                {aiError.type === 'credits' ? '💳 Créditos Esgotados' :
                 aiError.type === 'auth' ? '🔒 Erro de Autenticação' :
                 '⚠️ Limite de Requisições'}
                {aiError.provider && ` - ${aiError.provider}`}
              </h3>
              <p className={`text-sm ${
                aiError.type === 'credits' ? 'text-red-800' :
                aiError.type === 'auth' ? 'text-yellow-800' :
                'text-orange-800'
              }`}>
                {aiError.message}
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => router.push('/ai-models')}
                  className={`text-sm px-3 py-1 rounded font-medium ${
                    aiError.type === 'credits' ? 'bg-red-600 hover:bg-red-700 text-white' :
                    aiError.type === 'auth' ? 'bg-yellow-600 hover:bg-yellow-700 text-white' :
                    'bg-orange-600 hover:bg-orange-700 text-white'
                  }`}
                >
                  Configurar API Keys
                </button>
                <button
                  onClick={() => setAiError(null)}
                  className="text-sm px-3 py-1 rounded font-medium bg-gray-200 hover:bg-gray-300 text-gray-700"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
            {interview.conversation_data.map((msg, index) => {
              // Find the last unanswered assistant message with options
              // A message is considered "unanswered" if there's no user message after it
              const hasOptions =
                msg.role === 'assistant' &&
                (msg.options?.choices?.length > 0 || msg.content.includes('☐') || msg.content.includes('○'));

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
                />
              );
            })}
            <div ref={messagesEndRef} />

            {/* PROMPT #61 - Show provisioning status after messages */}
            {provisioningStatus && (
              <ProvisioningStatusCard
                provisioning={provisioningStatus}
                projectName={provisioningStatus.projectName || interview?.project?.name || 'Your Project'}
                onClose={() => setProvisioningStatus(null)}
              />
            )}
          </>
        )}

        {/* PROMPT #65 - Send Message Progress */}
        {isSendingMessage && sendMessageJob && (
          <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h4 className="text-sm font-semibold text-blue-900 mb-2">🤖 Processing your message...</h4>
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
            <h4 className="text-sm font-semibold text-green-900 mb-2">🎯 Generating Epic...</h4>
            <div className="flex items-center gap-2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-600"></div>
              <span className="text-sm text-green-700">Analyzing interview and creating Epic...</span>
            </div>
            <p className="text-xs text-green-700 mt-2">
              The Epic will be created automatically based on your conversation.
            </p>
          </div>
        )}

        {/* PROMPT #65 - Provisioning Progress */}
        {isProvisioning && provisioningJob && (
          <div className="mb-4 p-4 bg-purple-50 border border-purple-200 rounded-lg">
            <h4 className="text-sm font-semibold text-purple-900 mb-2">🏗️ Provisioning Project...</h4>
            <JobProgressBar
              percent={provisioningJob.progress_percent}
              message={provisioningJob.progress_message}
              status={provisioningJob.status}
            />
            <p className="text-xs text-purple-700 mt-2">
              Creating project structure, installing dependencies, and configuring environment. This may take 1-3 minutes.
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
                <span className="text-sm text-gray-600 ml-2">AI is thinking...</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="border-t p-4 bg-gray-50 rounded-b-lg">
        {isActive ? (
          <div className="flex flex-col gap-2">
            {/* Show selected options indicator */}
            {selectedOptions.length > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
                <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-blue-800 font-medium">
                  {selectedOptions.length} option{selectedOptions.length > 1 ? 's' : ''} selected
                </span>
                <button
                  onClick={() => setSelectedOptions([])}
                  className="ml-auto text-blue-600 hover:text-blue-800"
                  title="Clear selection"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}

            <div className="flex gap-2">
              <textarea
                ref={textareaRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={selectedOptions.length > 0 ? "Or type a custom response..." : "Type your response... (Shift+Enter for new line, Enter to send)"}
                disabled={sending || isSendingMessage}
                className="flex-1 border border-gray-300 rounded-lg px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 text-gray-900 bg-white min-h-[44px] max-h-[200px] overflow-y-auto"
                rows={1}
              />
            <Button
              onClick={() => handleSend()}
              disabled={(!message.trim() && selectedOptions.length === 0) || sending || isSendingMessage}
              variant="primary"
              className="px-6 self-end"
            >
              {(sending || isSendingMessage) ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Sending...
                </>
              ) : selectedOptions.length > 0 ? (
                <>
                  <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Send Selected ({selectedOptions.length})
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
          </div>
        ) : (
          <div className="text-center text-gray-400 py-4 bg-gray-100 rounded-lg">
            <p className="text-sm font-medium">
              This interview is {interview.status}. Cannot send messages.
            </p>
          </div>
        )}
      </div>

      {/* PROMPT #87 - Epic Generation Confirmation Modal */}
      <Dialog
        open={showEpicConfirmModal}
        onClose={() => setShowEpicConfirmModal(false)}
        title="Generate Epic"
        size="sm"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
              <span className="text-2xl">🎯</span>
            </div>
            <div>
              <p className="text-sm text-gray-700">
                Generate an Epic from this interview using AI?
              </p>
              <p className="text-xs text-gray-500 mt-1">
                The Epic will be created automatically based on your conversation.
              </p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => setShowEpicConfirmModal(false)}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={executeEpicGeneration}
          >
            Generate Epic
          </Button>
        </DialogFooter>
      </Dialog>

      {/* PROMPT #87 - Epic Generation Success Modal */}
      <Dialog
        open={showEpicSuccessModal}
        onClose={() => setShowEpicSuccessModal(false)}
        title="Epic Created"
        size="sm"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
              <span className="text-2xl">✅</span>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">
                {epicResult?.title}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                You can now decompose it into Stories from the Backlog page.
              </p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => setShowEpicSuccessModal(false)}
          >
            Close
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setShowEpicSuccessModal(false);
              router.push(`/projects/${interview?.project_id}?tab=backlog`);
            }}
          >
            Go to Backlog
          </Button>
        </DialogFooter>
      </Dialog>

      {/* PROMPT #87 - Epic Generation Error Modal */}
      <Dialog
        open={showEpicErrorModal}
        onClose={() => setShowEpicErrorModal(false)}
        title="Error"
        size="sm"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
              <span className="text-2xl">❌</span>
            </div>
            <div>
              <p className="text-sm text-gray-700">
                {epicResult?.error || 'An error occurred while generating the Epic.'}
              </p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="primary"
            onClick={() => setShowEpicErrorModal(false)}
          >
            Close
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

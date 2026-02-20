/**
 * ChatInterface Component
 * Main chat interface for interviews with REAL AI interaction
 * PROMPT #232 - Refactored: extracted sub-components (ChatHeader, ChatBanners, ChatMessages, ChatInput, ChatModals)
 */

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { interviewsApi, backlogApi, projectsApi, tasksApi } from '@/lib/api';
import { Interview } from '@/lib/types';
import { formatErrorMessage } from '@/components/ui/ErrorDialog';
import { useJobPolling } from '@/hooks';

// PROMPT #232 - Sub-components
import ChatHeader from './ChatHeader';
import { FallbackWarningBanner, AIErrorBanner } from './ChatBanners';
import type { FallbackWarningState, AIErrorState } from './ChatBanners';
import ChatMessages from './ChatMessages';
import ChatInput from './ChatInput';
import ChatModals from './ChatModals';
import type { NotificationDialogState, ConfirmDialogState, EpicResult } from './ChatModals';
import { classifyAIError, detectStack } from './chatUtils';
import { LoadingScreen, NotFoundScreen } from './ChatStatusScreens';

interface Props {
  interviewId: string;
  onStatusChange?: () => void;
  onComplete?: () => void;  // PROMPT #89 - Called when interview is completed (for context generation)
  interviewMode?: 'context' | 'meta_prompt' | 'orchestrator' | 'card_focused' | string;  // PROMPT #89 - Interview mode hint
  embedded?: boolean;  // PROMPT #130 - When true, removes outer container styling for embedding in modals/panels
  readOnly?: boolean;  // PROMPT #130 - When true, hides input and action buttons (display mode only)
  parentTaskId?: string;  // PROMPT #131 - Parent task ID for card_focused mode
  hideHeader?: boolean;  // PROMPT #131 - When true, hides internal header (parent handles it)
}

export function ChatInterface({ interviewId, onStatusChange, onComplete, interviewMode, embedded = false, readOnly = false, parentTaskId, hideHeader = false }: Props) {
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
    console.log('ChatInterface - selectedOptions changed:', selectedOptions);
  }, [selectedOptions]);

  // PROMPT #57 - Track pre-filled values for title/description questions
  const [prefilledValue, setPrefilledValue] = useState<string | null>(null);
  const [isProjectInfoQuestion, setIsProjectInfoQuestion] = useState(false);
  const [currentQuestionNumber, setCurrentQuestionNumber] = useState<number | null>(null);

  // PROMPT #61 - Track provisioning status for UI feedback
  const [provisioningStatus, setProvisioningStatus] = useState<any>(null);

  // PROMPT #51 - Track AI errors (credits, authentication, etc.)
  const [aiError, setAiError] = useState<AIErrorState | null>(null);

  // PROMPT #81 - Track fallback mode (API failure, using system fallback)
  const [fallbackWarning, setFallbackWarning] = useState<FallbackWarningState | null>(null);

  // PROMPT #87 - Modal states for Epic generation
  const [showEpicConfirmModal, setShowEpicConfirmModal] = useState(false);
  const [showEpicSuccessModal, setShowEpicSuccessModal] = useState(false);
  const [showEpicErrorModal, setShowEpicErrorModal] = useState(false);
  const [epicResult, setEpicResult] = useState<EpicResult | null>(null);

  // PROMPT #109 - Notification dialog state (replaces crude browser alerts)
  const [notificationDialog, setNotificationDialog] = useState<NotificationDialogState>({
    open: false,
    title: '',
    message: '',
    details: undefined,
    type: 'error'
  });

  // PROMPT #118 - Confirm dialog states (replaces crude browser confirm())
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    open: false,
    title: '',
    message: '',
    type: 'warning',
    onConfirm: () => {},
    confirmLabel: 'OK',
    isLoading: false
  });

  // PROMPT #65 - Async job tracking
  const [sendMessageJobId, setSendMessageJobId] = useState<string | null>(null);
  const [generatePromptsJobId, setGeneratePromptsJobId] = useState<string | null>(null);
  const [provisioningJobId, setProvisioningJobId] = useState<string | null>(null);

  // PROMPT #65 - Stable callbacks for send message polling (prevents re-renders)
  const handleSendMessageComplete = useCallback((result: any) => {
    console.log('Send message job completed:', result);

    // PROMPT #65 - Clear from localStorage on completion
    localStorage.removeItem(`sendMessageJob_${interviewId}`);

    // PROMPT #81 - Detect fallback mode
    const isFallback = result?.usage?.fallback === true ||
                       result?.message?.model === 'system/fallback';
    if (isFallback) {
      console.log('Fallback mode detected:', result?.usage?.error);
      setFallbackWarning({
        message: 'A IA esta temporariamente indisponivel. O sistema esta usando respostas de fallback.',
        error: result?.usage?.error
      });
    }

    setSendMessageJobId(null);
    loadInterview(); // Reload to get new message
  }, [interviewId]);

  const handleSendMessageError = useCallback((error: string) => {
    console.error('Send message job failed:', error);

    // PROMPT #65 - Clear from localStorage on error
    localStorage.removeItem(`sendMessageJob_${interviewId}`);

    setSendMessageJobId(null);
    setNotificationDialog({
      open: true,
      title: 'Erro ao enviar mensagem',
      message: formatErrorMessage(error),
      details: typeof error === 'string' ? undefined : JSON.stringify(error, null, 2),
      type: 'error'
    });
  }, [interviewId]);

  // PROMPT #65 - Poll job status for send message
  const { job: sendMessageJob, isPolling: isSendingMessage } = useJobPolling(sendMessageJobId, {
    enabled: !!sendMessageJobId,
    onComplete: handleSendMessageComplete,
    onError: handleSendMessageError,
  });

  // PROMPT #65 - Stable callbacks for generate prompts polling (prevents re-renders)
  const handleGeneratePromptsComplete = useCallback((result: any) => {
    console.log('Generate prompts job completed:', result);

    // PROMPT #65 - Clear from localStorage on completion
    localStorage.removeItem(`generateJob_${interviewId}`);

    setGeneratePromptsJobId(null);

    const tasksCount = result?.total_items || result?.tasks_created || 0;
    const storiesCount = result?.stories_created || 0;

    setNotificationDialog({
      open: true,
      title: 'Sucesso!',
      message: `${storiesCount} stories e ${tasksCount} tasks foram criadas automaticamente a partir da sua entrevista.\n\nConfira seu Backlog para visualiza-las!`,
      type: 'success'
    });

    loadInterview();
  }, [interviewId]);

  const handleGeneratePromptsError = useCallback((error: string) => {
    console.error('Generate prompts job failed:', error);

    // PROMPT #65 - Clear from localStorage on error
    localStorage.removeItem(`generateJob_${interviewId}`);

    setGeneratePromptsJobId(null);

    // Detect AI-specific errors
    const errorLower = error.toLowerCase();
    if (errorLower.includes('credit') || errorLower.includes('balance') || errorLower.includes('quota')) {
      setAiError({
        type: 'credits',
        message: 'Creditos de IA esgotados. Adicione creditos a sua conta de IA ou configure uma nova API key.',
      });
    } else {
      setNotificationDialog({
        open: true,
        title: 'Erro ao gerar prompts',
        message: formatErrorMessage(error),
        type: 'error'
      });
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
    console.log('isGeneratingPrompts changed:', isGeneratingPrompts);
    console.log('generatePromptsJobId:', generatePromptsJobId);
    console.log('generatePromptsJob:', generatePromptsJob);
  }, [isGeneratingPrompts, generatePromptsJobId, generatePromptsJob]);

  // PROMPT #65 - Stable callbacks for provisioning polling (prevents re-renders)
  const handleProvisioningComplete = useCallback((result: any) => {
    console.log('Provisioning job completed:', result);

    // PROMPT #65 - Clear from localStorage on completion
    localStorage.removeItem(`provisioningJob_${interviewId}`);

    setProvisioningJobId(null);

    // Display provisioning status card
    setProvisioningStatus({
      ...result,
      projectName: interview?.project?.name || 'Seu Projeto'
    });

    loadInterview();
  }, [interviewId, interview?.project?.name]);

  const handleProvisioningError = useCallback((error: string) => {
    console.error('Provisioning job failed:', error);

    // PROMPT #65 - Clear from localStorage on error
    localStorage.removeItem(`provisioningJob_${interviewId}`);

    setProvisioningJobId(null);
    setNotificationDialog({
      open: true,
      title: 'Erro ao provisionar projeto',
      message: formatErrorMessage(error),
      type: 'error'
    });
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

  // PROMPT #134 - Removed 100ms localStorage polling
  // WebSocket now provides real-time updates for job status.
  // Job IDs are restored from localStorage on mount via checkForPendingJobs().

  // PROMPT #65 - Check for pending/running jobs when component mounts
  const checkForPendingJobs = async () => {
    try {
      // Restore job IDs from localStorage (survives Fast Refresh)
      const savedGenerateJobId = localStorage.getItem(`generateJob_${interviewId}`);
      const savedProvisioningJobId = localStorage.getItem(`provisioningJob_${interviewId}`);
      const savedSendMessageJobId = localStorage.getItem(`sendMessageJob_${interviewId}`);

      if (savedGenerateJobId) {
        console.log('Restoring generatePromptsJobId from localStorage:', savedGenerateJobId);
        setGeneratePromptsJobId(savedGenerateJobId);
      }

      if (savedProvisioningJobId) {
        console.log('Restoring provisioningJobId from localStorage:', savedProvisioningJobId);
        setProvisioningJobId(savedProvisioningJobId);
      }

      if (savedSendMessageJobId) {
        console.log('Restoring sendMessageJobId from localStorage:', savedSendMessageJobId);
        setSendMessageJobId(savedSendMessageJobId);
      }

      console.log('Component mounted, job polling active');
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
      console.log('Detected prefilled question:', {
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
      console.log('Loading interview:', interviewId);
      const response = await interviewsApi.get(interviewId);
      const interviewData = response.data || response;
      console.log('Interview loaded:', interviewData);
      setInterview(interviewData || null);

      // Se nao tem mensagens, iniciar automaticamente com IA
      const hasMessages = interviewData?.conversation_data && interviewData.conversation_data.length > 0;
      console.log('Has messages:', hasMessages, 'Count:', interviewData?.conversation_data?.length);

      if (!hasMessages && !startingInterviewRef.current) {
        console.log('No messages found, auto-starting interview with AI...');
        startingInterviewRef.current = true;
        await startInterviewWithAI();
      }
    } catch (error: any) {
      console.error('Failed to load interview:', error);
      setInterview(null); // Reset on error

      // Check if it's a 404 error (interview not found)
      if (error.response?.status === 404) {
        console.log('Interview not found (404)');
        setNotFound(true);
      } else {
        // For other errors, show error dialog
        setNotificationDialog({
          open: true,
          title: 'Erro ao carregar entrevista',
          message: 'Falha ao carregar a entrevista. Por favor, tente novamente.',
          type: 'error'
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const startInterviewWithAI = async () => {
    // PROMPT #82 - Double-check guard (React StrictMode protection)
    if (initializing) {
      console.log('Already initializing, skipping duplicate start...');
      return;
    }

    setInitializing(true);
    try {
      console.log('Starting interview with AI...');
      console.log('Interview ID:', interviewId);

      const startResponse = await interviewsApi.start(interviewId);
      console.log('Start response:', startResponse);

      // PROMPT #81 - Detect fallback on start
      const startData = startResponse.data || startResponse;
      if (startData?.model === 'system/fallback' || startData?.message?.model === 'system/fallback') {
        console.log('Fallback mode detected on start');
        setFallbackWarning({
          message: 'A IA esta temporariamente indisponivel. O sistema esta usando respostas de fallback.',
          error: 'API indisponivel no momento'
        });
      }

      // Reload to get initial AI message
      console.log('Reloading interview to get AI response...');
      const response = await interviewsApi.get(interviewId);
      const data = response.data || response;
      console.log('Reloaded interview data:', data);
      console.log('Conversation messages:', data?.conversation_data?.length);

      // PROMPT #81 - Check if first message uses fallback
      const firstMessage = data?.conversation_data?.[0];
      if (firstMessage?.model === 'system/fallback') {
        setFallbackWarning({
          message: 'A IA esta temporariamente indisponivel. O sistema esta usando respostas de fallback.',
          error: 'API indisponivel no momento'
        });
      }

      setInterview(data || null);

      console.log('Interview started successfully!');
    } catch (error: any) {
      console.error('Failed to start interview with AI:', error);
      console.error('Error details:', {
        message: error.message,
        response: error.response,
        status: error.response?.status,
        data: error.response?.data
      });

      // PROMPT #56 - Enhanced error reporting
      const errorMessage = error.response?.data?.detail || error.message || 'Erro desconhecido';
      setNotificationDialog({
        open: true,
        title: 'Falha ao iniciar entrevista',
        message: `${formatErrorMessage(errorMessage)}\n\nVoce pode enviar uma mensagem manualmente para comecar a conversa.`,
        type: 'error'
      });
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
        console.log('User edited project info, updating project...', {
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
          console.log('Project info updated successfully');
        } catch (updateError: any) {
          console.error('Failed to update project info:', updateError);
          // Continue anyway - we'll still send the message
        }
      }

      // PROMPT #65 - Enviar mensagem ASYNC (nao bloqueia UI)
      console.log('Sending message async...');
      const response = await interviewsApi.sendMessageAsync(interviewId, {
        content: userMessage || optionsToSend.join(', '),
        selected_options: optionsToSend.length > 0 ? optionsToSend : undefined
      });

      const data = response.data || response;
      const jobId = data.job_id;

      console.log('Message job created:', jobId);

      // PROMPT #65 - Save to localStorage (survives Fast Refresh)
      localStorage.setItem(`sendMessageJob_${interviewId}`, jobId);

      setSendMessageJobId(jobId); // Start polling for job status

      // Reset project info tracking
      setPrefilledValue(null);
      setIsProjectInfoQuestion(false);
      setCurrentQuestionNumber(null);

    } catch (error: any) {
      console.error('Failed to send message:', error);
      const errorDetail = error.response?.data?.detail || error.message || 'Falha ao enviar mensagem';

      // Detect AI-specific errors (credits, authentication, etc.)
      handleAIError(errorDetail);

      setMessage(userMessage); // Restaurar mensagem em caso de erro
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  const handleOptionSubmit = async (selectedLabels: string[]) => {
    // PROMPT #109 - Validate that options are not empty
    const validLabels = selectedLabels.filter(label => label && label.trim() !== '');

    if (validLabels.length === 0) {
      setNotificationDialog({
        open: true,
        title: 'Opcao invalida',
        message: 'Por favor, selecione uma opcao valida ou digite sua resposta no campo de texto.',
        type: 'warning'
      });
      return;
    }

    // Join labels with comma and send as message content
    const content = validLabels.join(', ');

    // DEBUG: Log what's being sent to backend
    console.log('ChatInterface - Sending option selection to backend:');
    console.log('  - Content:', content);
    console.log('  - Selected Options:', validLabels);

    // Clear any existing text in the input and selected options
    setMessage('');
    setSelectedOptions([]);

    // Send the message with the selected labels as content
    setSending(true);
    try {
      await interviewsApi.sendMessage(interviewId, {
        content: content,
        selected_options: validLabels
      });

      console.log('ChatInterface - Message sent successfully');

      // Reload to get AI response
      const response = await interviewsApi.get(interviewId);
      const data = response.data || response;
      setInterview(data || null);

      // Check if we just completed the 4 stack questions (PROMPT #46 - Phase 1)
      await detectAndSaveStack(data);
    } catch (error: any) {
      console.error('Failed to send message:', error);
      const errorDetail = error.response?.data?.detail || error.message || 'Falha ao enviar mensagem';

      // Detect AI-specific errors (credits, authentication, etc.)
      handleAIError(errorDetail);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  // PROMPT #232 - AI error detection using extracted utility
  const handleAIError = (errorDetail: string) => {
    const aiErr = classifyAIError(errorDetail);
    if (aiErr) {
      setAiError(aiErr);
    } else {
      setNotificationDialog({
        open: true,
        title: 'Erro',
        message: formatErrorMessage(errorDetail),
        details: typeof errorDetail === 'object' ? JSON.stringify(errorDetail, null, 2) : undefined,
        type: 'error'
      });
    }
  };

  // PROMPT #57 / #67 / #82 - Auto-detect and save stack configuration using extracted utility
  const detectAndSaveStack = async (interviewData: Interview) => {
    const stack = detectStack(interviewData);
    if (!stack) return;

    try {
      // PROMPT #65 - Save stack ASYNC (non-blocking provisioning)
      console.log('Stack detected, saving async:', stack);
      const response = await interviewsApi.saveStackAsync(interviewId, stack);
      const data = response.data || response;
      const jobId = data.job_id;

      console.log('Stack saved, provisioning job created:', jobId);

      // PROMPT #65 - Save to localStorage (survives Fast Refresh)
      localStorage.setItem(`provisioningJob_${interviewId}`, jobId);

      setProvisioningJobId(jobId); // Start polling for provisioning status
    } catch (error) {
      console.error('Failed to save stack:', error);
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
    // PROMPT #131 - Card inference mode: complete and run inference
    const isCardInference = interviewMode === 'card_focused';

    setConfirmDialog({
      open: true,
      title: isCardInference ? 'Completar e Atualizar Card' : 'Completar Entrevista',
      message: isCardInference
        ? 'Completar esta entrevista e atualizar o card com as informacoes coletadas?'
        : 'Marcar esta entrevista como completa?',
      type: 'info',
      confirmLabel: isCardInference ? 'Completar e Atualizar' : 'Completar',
      isLoading: false,
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, isLoading: true }));
        try {
          // PROMPT #131 - Run card inference if in card_focused mode
          if (isCardInference && parentTaskId) {
            console.log('Running card inference for task:', parentTaskId);
            try {
              await tasksApi.runCardInference(parentTaskId, interviewId);
              console.log('Card inference completed');
            } catch (inferenceError) {
              console.error('Card inference failed, continuing with completion:', inferenceError);
              // Continue even if inference fails
            }
          }

          await interviewsApi.updateStatus(interviewId, 'completed');
          await loadInterview();
          onStatusChange?.();
          setConfirmDialog(prev => ({ ...prev, open: false, isLoading: false }));
        } catch (error) {
          console.error('Failed to complete interview:', error);
          setConfirmDialog(prev => ({ ...prev, open: false, isLoading: false }));
          setNotificationDialog({
            open: true,
            title: 'Erro',
            message: 'Falha ao completar entrevista. Por favor, tente novamente.',
            type: 'error'
          });
        }
      }
    });
  };

  const handleCancel = async () => {
    // PROMPT #118 - Use ConfirmDialog instead of native confirm()
    const isContextInterview = interview?.interview_mode === 'context';
    const confirmMessage = isContextInterview
      ? 'Cancelar esta entrevista? O projeto sera excluido pois ainda nao tem contexto definido.'
      : 'Cancelar esta entrevista?';

    setConfirmDialog({
      open: true,
      title: isContextInterview ? 'Cancelar Entrevista e Projeto' : 'Cancelar Entrevista',
      message: confirmMessage,
      type: 'danger',
      confirmLabel: 'Cancelar Entrevista',
      isLoading: false,
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, isLoading: true }));
        try {
          await interviewsApi.updateStatus(interviewId, 'cancelled');

          // PROMPT #109 - Delete project if cancelling context interview
          if (isContextInterview && interview?.project_id) {
            console.log('Deleting project due to context interview cancellation:', interview.project_id);
            try {
              await projectsApi.delete(interview.project_id);
              console.log('Project deleted successfully');
              setConfirmDialog(prev => ({ ...prev, open: false, isLoading: false }));
              // Redirect to projects list
              router.push('/projects');
              return;
            } catch (deleteError) {
              console.error('Failed to delete project:', deleteError);
              // Continue even if project deletion fails
            }
          }

          await loadInterview();
          onStatusChange?.();
          setConfirmDialog(prev => ({ ...prev, open: false, isLoading: false }));
        } catch (error) {
          console.error('Failed to cancel interview:', error);
          setConfirmDialog(prev => ({ ...prev, open: false, isLoading: false }));
          setNotificationDialog({
            open: true,
            title: 'Erro',
            message: 'Falha ao cancelar entrevista. Por favor, tente novamente.',
            type: 'error'
          });
        }
      }
    });
  };

  // PROMPT #80/87 - Generate Epic only (not full backlog)
  // PROMPT #87 - Open confirmation modal instead of browser confirm
  const handleGenerateEpic = () => {
    if (!interview) return;

    const hasMessages = interview.conversation_data && interview.conversation_data.length > 0;
    if (!hasMessages) {
      setEpicResult({ error: 'Nao e possivel gerar Epic de uma entrevista vazia. Adicione algumas mensagens primeiro.' });
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
      console.log('Generating Epic from interview...');

      // Step 1: Generate Epic suggestion
      const generateResponse = await backlogApi.generateEpic(interviewId, projectId);
      const data = generateResponse.data || generateResponse;

      if (!data.suggestions || data.suggestions.length === 0) {
        throw new Error('Nenhuma sugestao de Epic foi gerada');
      }

      const epicSuggestion = data.suggestions[0];
      console.log('Epic suggestion generated:', epicSuggestion.title);

      // Step 2: Auto-approve and create Epic
      const approveResponse = await backlogApi.approveEpic(epicSuggestion, projectId, interviewId);
      const epic = approveResponse.data || approveResponse;

      console.log('Epic created:', epic.id, epic.title);

      // Show success modal
      setEpicResult({ title: epic.title });
      setShowEpicSuccessModal(true);

      // Refresh interview to show updated state
      await loadInterview();

    } catch (error: any) {
      console.error('Failed to generate Epic:', error);
      const errorDetail = error.response?.data?.detail || error.message || 'Falha ao gerar Epic.';
      setEpicResult({ error: errorDetail });
      setShowEpicErrorModal(true);
    } finally {
      setGeneratingPrompts(false);
    }
  };

  if (loading || initializing) {
    return <LoadingScreen initializing={initializing} />;
  }

  if (!interview) {
    return <NotFoundScreen notFound={notFound} onRetry={loadInterview} />;
  }

  const isActive = interview.status === 'active';

  return (
    <div className={`flex flex-col bg-white ${
      embedded
        ? 'h-full'
        : 'h-[calc(100vh-6rem)] rounded-xl shadow-lg border border-gray-100'
    }`}>
      {/* Header - PROMPT #127 - Improved layout */}
      {/* PROMPT #131 - When hideHeader is true, hide completely (parent handles header and buttons) */}
      {!hideHeader && (
        <ChatHeader
          interview={interview}
          interviewMode={interviewMode}
          embedded={embedded}
          generatingPrompts={generatingPrompts}
          readOnly={readOnly}
          onGenerateContext={() => onComplete?.()}
          onGenerateEpic={handleGenerateEpic}
          onComplete={handleComplete}
          onCancel={handleCancel}
        />
      )}

      {/* PROMPT #81 - Fallback Warning Banner */}
      {fallbackWarning && (
        <FallbackWarningBanner
          fallbackWarning={fallbackWarning}
          onDismiss={() => setFallbackWarning(null)}
        />
      )}

      {/* AI Error Banner */}
      {aiError && (
        <AIErrorBanner
          aiError={aiError}
          onDismiss={() => setAiError(null)}
        />
      )}

      {/* Messages Area - PROMPT #127 - Improved spacing and layout */}
      <ChatMessages
        interview={interview}
        embedded={embedded}
        readOnly={readOnly}
        selectedOptions={selectedOptions}
        setSelectedOptions={setSelectedOptions}
        handleOptionSubmit={handleOptionSubmit}
        messagesEndRef={messagesEndRef as React.RefObject<HTMLDivElement>}
        provisioningStatus={provisioningStatus}
        onCloseProvisioningStatus={() => setProvisioningStatus(null)}
        isSendingMessage={isSendingMessage}
        sendMessageJob={sendMessageJob}
        generatingPrompts={generatingPrompts}
        isProvisioning={isProvisioning}
        provisioningJob={provisioningJob}
        sending={sending}
      />

      {/* Input Area - PROMPT #127 - Improved spacing */}
      {/* PROMPT #130 - Hide input area in readOnly mode */}
      {/* PROMPT #131 - flex-shrink-0 to prevent shrinking */}
      {!readOnly && (
        <ChatInput
          isActive={isActive}
          interviewStatus={interview.status}
          embedded={embedded}
          message={message}
          setMessage={setMessage}
          selectedOptions={selectedOptions}
          setSelectedOptions={setSelectedOptions}
          onSend={() => handleSend()}
          onKeyDown={handleKeyDown}
          sending={sending}
          isSendingMessage={isSendingMessage}
          textareaRef={textareaRef as React.RefObject<HTMLTextAreaElement>}
        />
      )}

      {/* PROMPT #232 - All modals extracted to ChatModals */}
      <ChatModals
        projectId={interview?.project_id}
        showEpicConfirmModal={showEpicConfirmModal}
        onCloseEpicConfirmModal={() => setShowEpicConfirmModal(false)}
        onExecuteEpicGeneration={executeEpicGeneration}
        showEpicSuccessModal={showEpicSuccessModal}
        onCloseEpicSuccessModal={() => setShowEpicSuccessModal(false)}
        epicResult={epicResult}
        showEpicErrorModal={showEpicErrorModal}
        onCloseEpicErrorModal={() => setShowEpicErrorModal(false)}
        notificationDialog={notificationDialog}
        onCloseNotificationDialog={() => setNotificationDialog({ ...notificationDialog, open: false })}
        confirmDialog={confirmDialog}
        onCloseConfirmDialog={() => setConfirmDialog({ ...confirmDialog, open: false })}
      />
    </div>
  );
}

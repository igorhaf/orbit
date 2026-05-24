/**
 * chatUtils - Utility functions extracted from ChatInterface
 * PROMPT #232 - Stack detection logic and AI error detection
 */

import { Interview, ConversationMessage } from '@/lib/types';
import type { AIErrorState } from './ChatBanners';

/**
 * v2.5: claudius-only. Errors come from the Claudius proxy → returns its label.
 */
function detectProvider(errorLower: string): string | undefined {
  if (errorLower.includes('claudius') || errorLower.includes('claude')) return 'Claudius (Claude)';
  return undefined;
}

/**
 * Classify AI error from error detail string.
 * Returns an AIErrorState if it's a known AI error, or null if it's a generic error.
 */
export function classifyAIError(errorDetail: string): AIErrorState | null {
  const errorLower = errorDetail.toLowerCase();

  if (errorLower.includes('credit') || errorLower.includes('balance') || errorLower.includes('quota')) {
    return {
      type: 'credits',
      message: 'Creditos de IA esgotados. Adicione creditos a sua conta de IA ou configure uma nova API key.',
      provider: detectProvider(errorLower),
    };
  }

  if (errorLower.includes('authentication') || errorLower.includes('api key') ||
      errorLower.includes('invalid x-api-key') || errorLower.includes('unauthorized')) {
    return {
      type: 'auth',
      message: 'API key invalida ou expirada. Configure uma API key valida nas configuracoes.',
      provider: detectProvider(errorLower),
    };
  }

  if (errorLower.includes('rate limit')) {
    return {
      type: 'rate_limit',
      message: 'Limite de requisicoes excedido. Aguarde alguns minutos antes de tentar novamente.',
      provider: detectProvider(errorLower),
    };
  }

  return null; // Generic error
}

/**
 * Extract a stack framework value from a user answer string.
 * PROMPT #57 / PROMPT #82
 */
function extractStackValue(answer: string): string | null {
  // Remove leading symbols that come from option formatting
  const cleaned = answer.replace(/^[\u25CB\u25CF\u25C9\u2610\u25A0\u25A1\u25AA\u25AB\u2022\u2023\u2043]+\s*/, '').trim();
  const lower = cleaned.toLowerCase();

  // Check if answer indicates "I don't know" or "None"
  const dontKnowPatterns = [
    /^i\s*don'?t\s*know/i,
    /^not\s*sure/i,
    /^skip/i,
    /^none$/i,
    /^\u2753/,
  ];

  for (const pattern of dontKnowPatterns) {
    if (pattern.test(cleaned)) {
      return null;
    }
  }

  // Extract the framework name before any parentheses or extra text
  const match = lower.match(/^([a-z\s\-\.]+?)(?:\s*\(|$)/);
  let extracted = match ? match[1].trim() : lower.trim();

  // For multi-word frameworks, take only the first word
  if (extracted.includes('.') || extracted.includes('-')) {
    extracted = extracted.replace(/[\.\-]+/g, '');
  } else {
    extracted = extracted.split(/\s+/)[0];
  }

  return extracted;
}

/**
 * Detect stack configuration from interview conversation data.
 * PROMPT #57 / PROMPT #67 / PROMPT #82
 * Returns stack object or null if stack questions not detected.
 */
export function detectStack(interviewData: Interview): {
  backend: string | null;
  database: string | null;
  frontend: string | null;
  css: string | null;
  mobile: string | null;
} | null {
  if (!interviewData?.conversation_data) return null;

  const messages = interviewData.conversation_data;

  // PROMPT #82 - Fixed answer indices
  // We need at least 16 messages (indices 0-15) to have all 7 answers
  // Or 17 messages if Q8 has been sent
  if (messages.length < 16 || messages.length > 17) return null;

  // Verify the messages are stack questions by checking for backend keyword in Q3
  const aiMessages = messages.filter((m: ConversationMessage) => m.role === 'assistant');
  if (aiMessages.length < 7) return null;

  // Check if Q3 (index 6) is the backend question
  const backendQuestion = aiMessages[2]?.content || '';
  if (!backendQuestion.includes('backend') && !backendQuestion.includes('Backend')) return null;

  // Extract user answers - PROMPT #82 - CRITICAL FIX: Correct indices!
  const backendAnswer = messages[7]?.content || '';
  const databaseAnswer = messages[9]?.content || '';
  const frontendAnswer = messages[11]?.content || '';
  const cssAnswer = messages[13]?.content || '';
  const mobileAnswer = messages[15]?.content || '';

  if (!backendAnswer || !databaseAnswer || !frontendAnswer || !cssAnswer) return null;

  return {
    backend: extractStackValue(backendAnswer),
    database: extractStackValue(databaseAnswer),
    frontend: extractStackValue(frontendAnswer),
    css: extractStackValue(cssAnswer),
    mobile: extractStackValue(mobileAnswer) || null,
  };
}

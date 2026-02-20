/**
 * ChatBanners - Fallback Warning and AI Error banners
 * Extracted from ChatInterface.tsx (PROMPT #232)
 */

'use client';

import { useRouter } from 'next/navigation';

// PROMPT #81 - Fallback warning state
export interface FallbackWarningState {
  message: string;
  error?: string;
}

// PROMPT #51 - AI error state
export interface AIErrorState {
  type: string;
  message: string;
  provider?: string;
}

interface FallbackWarningBannerProps {
  fallbackWarning: FallbackWarningState;
  onDismiss: () => void;
}

interface AIErrorBannerProps {
  aiError: AIErrorState;
  onDismiss: () => void;
}

/**
 * PROMPT #81 - Fallback Warning Banner
 * Displayed when AI is temporarily unavailable and system is using fallback responses.
 */
export function FallbackWarningBanner({ fallbackWarning, onDismiss }: FallbackWarningBannerProps) {
  const router = useRouter();

  return (
    <div className="mx-4 mt-4 p-4 rounded-lg border-2 bg-blue-50 border-blue-300">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0">
          <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="font-semibold mb-1 text-blue-900">
            Modo Fallback Ativo
          </h3>
          <p className="text-sm text-blue-800">
            {fallbackWarning.message}
          </p>
          {fallbackWarning.error && (
            <p className="text-xs text-blue-600 mt-1">
              Detalhes do erro: {fallbackWarning.error}
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
              onClick={onDismiss}
              className="text-sm px-3 py-1 rounded font-medium bg-gray-200 hover:bg-gray-300 text-gray-700"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * AI Error Banner
 * Displayed when AI encounters errors like credits exhausted, auth failures, or rate limits.
 */
export function AIErrorBanner({ aiError, onDismiss }: AIErrorBannerProps) {
  const router = useRouter();

  return (
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
            {aiError.type === 'credits' ? 'Creditos Esgotados' :
             aiError.type === 'auth' ? 'Erro de Autenticacao' :
             'Limite de Requisicoes Excedido'}
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
              onClick={onDismiss}
              className="text-sm px-3 py-1 rounded font-medium bg-gray-200 hover:bg-gray-300 text-gray-700"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

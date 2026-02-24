/**
 * ChatStatusScreens - Loading and not-found/error states for ChatInterface
 * Extracted from ChatInterface.tsx (PROMPT #232)
 */

'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';

interface LoadingScreenProps {
  initializing: boolean;
}

/**
 * Loading spinner shown while interview data is being fetched or AI is starting.
 */
export function LoadingScreen({ initializing }: LoadingScreenProps) {
  return (
    <div className="flex items-center justify-center h-96">
      <div className="flex flex-col items-center gap-3">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <p className="text-gray-600">
          {initializing ? 'Iniciando entrevista com IA...' : 'Carregando entrevista...'}
        </p>
      </div>
    </div>
  );
}

interface NotFoundScreenProps {
  notFound: boolean;
  onRetry: () => void;
}

/**
 * Error/not-found screen when interview fails to load or doesn't exist.
 */
export function NotFoundScreen({ notFound, onRetry }: NotFoundScreenProps) {
  const router = useRouter();

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
            {notFound ? 'Entrevista Não Encontrada' : 'Falha ao Carregar Entrevista'}
          </h3>
          <p className="text-gray-600 mb-6">
            {notFound
              ? 'A entrevista que você procura não existe ou pode ter sido excluída.'
              : 'Ocorreu um erro inesperado ao carregar a entrevista.'}
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
            Ir para Entrevistas
          </Button>
          {!notFound && (
            <Button
              variant="outline"
              onClick={onRetry}
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Tentar Novamente
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * ErrorDialog Component
 * Modal dialog for displaying error messages in a user-friendly way
 * Replaces crude browser alerts with proper styled modals
 */

'use client';

import React from 'react';
import { Dialog, DialogFooter } from './Dialog';
import { Button } from './Button';

export interface ErrorDialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  message: string;
  type?: 'error' | 'warning' | 'info';
  details?: string;
}

export const ErrorDialog: React.FC<ErrorDialogProps> = ({
  open,
  onClose,
  title,
  message,
  type = 'error',
  details,
}) => {
  const icons = {
    error: (
      <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
    warning: (
      <svg className="h-6 w-6 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
    info: (
      <svg className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  };

  const colors = {
    error: 'bg-red-50 border-red-200',
    warning: 'bg-yellow-50 border-yellow-200',
    info: 'bg-blue-50 border-blue-200',
  };

  const defaultTitles = {
    error: 'Erro',
    warning: 'Aviso',
    info: 'Informacao',
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title || defaultTitles[type]}
      size="sm"
    >
      <div className={`p-4 rounded-lg border ${colors[type]} mb-4`}>
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            {icons[type]}
          </div>
          <div className="flex-1">
            <p className="text-sm text-gray-800 whitespace-pre-wrap">
              {message}
            </p>
            {details && (
              <details className="mt-2">
                <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">
                  Detalhes tecnicos
                </summary>
                <pre className="mt-2 p-2 bg-gray-100 rounded text-xs text-gray-600 overflow-x-auto">
                  {details}
                </pre>
              </details>
            )}
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button onClick={onClose} variant="primary">
          Fechar
        </Button>
      </DialogFooter>
    </Dialog>
  );
};

/**
 * Helper function to safely convert any error to a displayable string
 * Handles: strings, Error objects, objects with message, plain objects
 */
export function formatErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === 'object') {
    // Check for common error object shapes
    if ('message' in error && typeof (error as any).message === 'string') {
      return (error as any).message;
    }
    if ('detail' in error && typeof (error as any).detail === 'string') {
      return (error as any).detail;
    }
    if ('error' in error && typeof (error as any).error === 'string') {
      return (error as any).error;
    }

    // Try to stringify the object
    try {
      const str = JSON.stringify(error, null, 2);
      if (str !== '{}') {
        return str;
      }
    } catch {
      // Ignore stringify errors
    }
  }

  return 'Um erro inesperado ocorreu. Por favor, tente novamente.';
}

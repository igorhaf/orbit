/**
 * ConfirmDialog Component
 * Modal dialog for confirmation prompts
 * Replaces crude browser confirm() with proper styled modals
 *
 * PROMPT #118 - Created to replace native confirm() dialogs
 */

'use client';

import React from 'react';
import { Dialog, DialogFooter } from './Dialog';
import { Button } from './Button';

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message: string;
  type?: 'warning' | 'danger' | 'info';
  confirmLabel?: string;
  cancelLabel?: string;
  isLoading?: boolean;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  onClose,
  onConfirm,
  title,
  message,
  type = 'warning',
  confirmLabel = 'OK',
  cancelLabel = 'Cancelar',
  isLoading = false,
}) => {
  const icons = {
    warning: (
      <svg className="h-6 w-6 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
    danger: (
      <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
    ),
    info: (
      <svg className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  };

  const colors = {
    warning: 'bg-yellow-50 border-yellow-200',
    danger: 'bg-red-50 border-red-200',
    info: 'bg-blue-50 border-blue-200',
  };

  const defaultTitles = {
    warning: 'Confirmacao',
    danger: 'Atencao',
    info: 'Confirmacao',
  };

  const confirmButtonVariant = type === 'danger' ? 'danger' : 'primary';

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
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button
          onClick={onClose}
          variant="outline"
          disabled={isLoading}
        >
          {cancelLabel}
        </Button>
        <Button
          onClick={onConfirm}
          variant={confirmButtonVariant}
          disabled={isLoading}
        >
          {isLoading ? 'Processando...' : confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
};

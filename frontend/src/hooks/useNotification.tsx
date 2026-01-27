/**
 * useNotification Hook
 * PROMPT #112 - Replaces browser alerts with styled dialogs
 *
 * Usage:
 * const { showNotification, NotificationComponent } = useNotification();
 *
 * // Show error
 * showNotification({ type: 'error', message: 'Failed to save' });
 *
 * // Show success
 * showNotification({ type: 'success', message: 'Saved successfully!' });
 *
 * // In JSX
 * return (
 *   <div>
 *     {NotificationComponent}
 *     ...
 *   </div>
 * );
 */

import { useState, useCallback, useMemo } from 'react';
import { ErrorDialog, formatErrorMessage } from '@/components/ui/ErrorDialog';

export type NotificationType = 'error' | 'warning' | 'info' | 'success';

export interface NotificationOptions {
  type?: NotificationType;
  title?: string;
  message: string;
  details?: string;
}

export interface UseNotificationReturn {
  showNotification: (options: NotificationOptions) => void;
  showError: (message: string | unknown, title?: string) => void;
  showSuccess: (message: string, title?: string) => void;
  showWarning: (message: string, title?: string) => void;
  showInfo: (message: string, title?: string) => void;
  closeNotification: () => void;
  NotificationComponent: React.ReactNode;
}

export function useNotification(): UseNotificationReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [notification, setNotification] = useState<NotificationOptions>({
    type: 'info',
    message: '',
  });

  const showNotification = useCallback((options: NotificationOptions) => {
    setNotification({
      type: options.type || 'info',
      title: options.title,
      message: options.message,
      details: options.details,
    });
    setIsOpen(true);
  }, []);

  const showError = useCallback((message: string | unknown, title?: string) => {
    const formattedMessage = typeof message === 'string'
      ? message
      : formatErrorMessage(message);
    showNotification({ type: 'error', message: formattedMessage, title });
  }, [showNotification]);

  const showSuccess = useCallback((message: string, title?: string) => {
    showNotification({ type: 'success', message, title });
  }, [showNotification]);

  const showWarning = useCallback((message: string, title?: string) => {
    showNotification({ type: 'warning', message, title });
  }, [showNotification]);

  const showInfo = useCallback((message: string, title?: string) => {
    showNotification({ type: 'info', message, title });
  }, [showNotification]);

  const closeNotification = useCallback(() => {
    setIsOpen(false);
  }, []);

  const NotificationComponent = useMemo(() => (
    <ErrorDialog
      open={isOpen}
      onClose={closeNotification}
      type={notification.type}
      title={notification.title}
      message={notification.message}
      details={notification.details}
    />
  ), [isOpen, notification, closeNotification]);

  return {
    showNotification,
    showError,
    showSuccess,
    showWarning,
    showInfo,
    closeNotification,
    NotificationComponent,
  };
}

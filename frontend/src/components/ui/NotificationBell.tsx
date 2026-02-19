'use client';

/**
 * NotificationBell Component
 * PROMPT #128 - Background Job Notifications
 * PROMPT #133 - Deep linking support for notifications
 * PROMPT #141 - Toast tooltip for new notifications
 *
 * Bell icon in navbar that shows active jobs and notification history.
 * Displays badge with count of active/unread notifications.
 * Shows toast tooltip when new notification arrives (if user not watching).
 * Clicking a notification navigates to the relevant screen via deep_link.
 */

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useNotifications, JOB_TYPE_ICONS, JobNotification } from '@/contexts/NotificationContext';
import { IconBrain } from '@/components/icons'; // PROMPT #188

export function NotificationBell() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const {
    activeJobs,
    notifications,
    unreadCount,
    toastNotification,
    dismissToast,
    markAsRead,
    markAllAsRead,
    clearNotification,
    clearAllNotifications,
  } = useNotifications();

  // PROMPT #133 - Handle notification click with deep link navigation
  const handleNotificationClick = (notif: JobNotification) => {
    markAsRead(notif.id);
    setIsOpen(false);  // Close dropdown

    // Navigate to deep_link if available
    if (notif.deep_link) {
      router.push(notif.deep_link);
    }
  };

  // PROMPT #150 - Badge count = ONLY unread completed notifications
  // Active jobs appear in dropdown but don't increment the badge counter
  // This prevents notification overload from in-progress jobs
  const badgeCount = unreadCount;

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Format relative time
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'agora';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    return `${diffDays}d`;
  };

  // Get status color
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'text-gray-500';
      case 'running':
        return 'text-blue-500';
      case 'completed':
        return 'text-green-500';
      case 'failed':
        return 'text-red-500';
      case 'cancelled':
        return 'text-yellow-500';
      default:
        return 'text-gray-500';
    }
  };

  // Get status text
  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending':
        return 'Pendente';
      case 'running':
        return 'Em execução';
      case 'completed':
        return 'Concluido';
      case 'failed':
        return 'Falhou';
      case 'cancelled':
        return 'Cancelado';
      default:
        return status;
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
        title="Notificações"
      >
        {/* Bell Icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>

        {/* Badge */}
        {badgeCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-bold leading-none text-white transform bg-red-500 rounded-full min-w-[18px]">
            {badgeCount > 99 ? '99+' : badgeCount}
          </span>
        )}

        {/* Pulsing indicator for active jobs */}
        {activeJobs.length > 0 && (
          <span className="absolute top-0 right-0 block h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
        )}
      </button>

      {/* PROMPT #141 - Toast Tooltip for new notifications */}
      {toastNotification && !isOpen && (
        <div
          className="absolute right-0 top-full mt-2 w-96 bg-white rounded-lg shadow-xl border border-gray-200 z-50 overflow-hidden animate-in slide-in-from-top-2 fade-in duration-200"
          onClick={() => {
            handleNotificationClick(toastNotification);
            dismissToast();
          }}
        >
          {/* Toast Header with close button */}
          <div className="flex items-start gap-3 p-3 cursor-pointer hover:bg-gray-50 transition-colors">
            {/* Status indicator */}
            <div className={`flex-shrink-0 mt-0.5 ${
              toastNotification.status === 'completed' ? 'text-green-500' :
              toastNotification.status === 'failed' ? 'text-red-500' :
              'text-blue-500'
            }`}>
              {toastNotification.status === 'completed' ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ) : toastNotification.status === 'failed' ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ) : (
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {toastNotification.title}
              </p>
              <p className={`text-xs truncate mt-0.5 ${getStatusColor(toastNotification.status)}`}>
                {getStatusText(toastNotification.status)}
                {toastNotification.error && `: ${toastNotification.error}`}
              </p>
              {toastNotification.deep_link && (
                <p className="text-xs text-blue-600 mt-1">Clique para ver →</p>
              )}
            </div>

            {/* Close button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                dismissToast();
              }}
              className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Progress bar animation at bottom */}
          <div className="h-1 bg-gray-100">
            <div
              className={`h-full ${
                toastNotification.status === 'completed' ? 'bg-green-500' :
                toastNotification.status === 'failed' ? 'bg-red-500' :
                'bg-blue-500'
              } animate-shrink-width`}
              style={{ animation: 'shrink-width 4s linear forwards' }}
            />
          </div>
        </div>
      )}

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-96 bg-white rounded-lg shadow-xl border border-gray-200 z-50 overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Notificações</h3>
            <div className="flex items-center gap-2">
              {/* PROMPT #141 - Show "Mark as read" only when unread exists */}
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="text-xs text-blue-600 hover:text-blue-800 transition-colors"
                >
                  Marcar como lido
                </button>
              )}
              {/* PROMPT #141 - Show "Clear" only when there are notifications (completed jobs) */}
              {notifications.length > 0 && (
                <button
                  onClick={() => {
                    clearAllNotifications();
                    // Close dropdown after clearing
                    setIsOpen(false);
                  }}
                  className="text-xs text-red-500 hover:text-red-700 transition-colors"
                >
                  Limpar histórico
                </button>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="max-h-96 overflow-y-auto">
            {/* Active Jobs Section */}
            {activeJobs.length > 0 && (
              <div className="border-b border-gray-100">
                <div className="px-4 py-2 bg-blue-50">
                  <span className="text-xs font-medium text-blue-700">
                    Em progresso ({activeJobs.length})
                  </span>
                </div>
                {activeJobs.map((job) => (
                  <div
                    key={job.id}
                    className="px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                  >
                    <div className="flex items-start gap-3">
                      {/* Icon */}
                      <span className="flex-shrink-0 inline-flex items-center text-gray-600">
                        {JOB_TYPE_ICONS[job.job_type] || <IconBrain className="w-4 h-4" />}
                      </span>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {job.title}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          {job.progress_message || job.description || 'Processando...'}
                        </p>

                        {/* Progress bar */}
                        <div className="mt-2">
                          <div className="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
                            {job.progress_percent !== null ? (
                              <div
                                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                                style={{ width: `${job.progress_percent}%` }}
                              />
                            ) : (
                              <div className="h-full w-full bg-gradient-to-r from-blue-500 to-blue-300 animate-pulse" />
                            )}
                          </div>
                          {job.progress_percent !== null && (
                            <span className="text-[10px] text-gray-400 mt-0.5 block">
                              {job.progress_percent}%
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Time */}
                      <span className="text-[10px] text-gray-400 flex-shrink-0">
                        {formatTime(job.created_at)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Completed Notifications */}
            {notifications.length > 0 && (
              <>
                {activeJobs.length > 0 && (
                  <div className="px-4 py-2 bg-gray-50">
                    <span className="text-xs font-medium text-gray-600">Histórico</span>
                  </div>
                )}
                {notifications.map((notif) => (
                  <div
                    key={notif.id}
                    className={`px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 cursor-pointer ${
                      !notif.read ? 'bg-blue-50/50' : ''
                    }`}
                    onClick={() => handleNotificationClick(notif)}
                  >
                    <div className="flex items-start gap-3">
                      {/* Icon */}
                      <span className="flex-shrink-0 inline-flex items-center text-gray-600">
                        {JOB_TYPE_ICONS[notif.job_type] || <IconBrain className="w-4 h-4" />}
                      </span>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`text-sm truncate ${!notif.read ? 'font-semibold' : 'font-medium'} text-gray-900`}>
                            {notif.title}
                          </p>
                          {!notif.read && (
                            <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0" />
                          )}
                        </div>
                        <p className={`text-xs truncate ${getStatusColor(notif.status)}`}>
                          {getStatusText(notif.status)}
                          {notif.error && `: ${notif.error}`}
                        </p>
                      </div>

                      {/* Time & Clear */}
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-[10px] text-gray-400">
                          {formatTime(notif.completed_at || notif.created_at)}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            clearNotification(notif.id);
                          }}
                          className="text-gray-400 hover:text-gray-600"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* Empty State */}
            {activeJobs.length === 0 && notifications.length === 0 && (
              <div className="px-4 py-8 text-center">
                <svg
                  className="w-12 h-12 mx-auto text-gray-300 mb-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                  />
                </svg>
                <p className="text-sm text-gray-500">Sem notificações</p>
                <p className="text-xs text-gray-400 mt-1">
                  As geracoes de IA aparecerao aqui
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

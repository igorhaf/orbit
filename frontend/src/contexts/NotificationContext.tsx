'use client';

/**
 * NotificationContext - Global notification state management
 * PROMPT #128 - Background Job Notifications
 * PROMPT #134 - Migrated from polling to WebSocket for real-time updates
 *
 * Manages active jobs, completed notifications, and provides
 * real-time updates for the notification bell in the navbar.
 *
 * WebSocket Events:
 * - job_started: Job started processing
 * - job_progress: Job progress updated
 * - job_completed: Job completed successfully
 * - job_failed: Job failed
 * - job_cancelled: Job was cancelled
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

// Notification types
export interface JobNotification {
  id: string;
  job_id: string;
  job_type: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress_percent: number | null;
  progress_message: string | null;
  result?: any;
  error?: string | null;
  created_at: string;
  completed_at?: string | null;
  read: boolean;
  title: string;
  description?: string;
  // PROMPT #133 - Deep linking support
  deep_link?: string | null;
  notification_title?: string | null;
  project_id?: string | null;
  task_id?: string | null;
  interview_id?: string | null;
  // PROMPT #140 - Track if user is watching this job on the page
  // If watching=true when job completes, it's auto-marked as read (no notification badge)
  watching?: boolean;
  // PROMPT #120 - Job priority system
  priority?: number | null;
}

interface NotificationContextType {
  // Active jobs being tracked
  activeJobs: JobNotification[];

  // Completed/failed notifications (history)
  notifications: JobNotification[];

  // Unread count for badge
  unreadCount: number;

  // PROMPT #141 - Toast notification for bell tooltip
  toastNotification: JobNotification | null;
  dismissToast: () => void;

  // Methods
  // PROMPT #140 - watching param: if true, job completion won't show unread notification
  addJob: (jobId: string, jobType: string, title: string, description?: string, watching?: boolean) => void;
  updateJob: (jobId: string, updates: Partial<JobNotification>) => void;
  markAsRead: (notificationId: string) => void;
  markAllAsRead: () => void;
  clearNotification: (notificationId: string) => void;
  clearAllNotifications: () => void;
  // PROMPT #140 - Stop watching a job (called when user leaves the page)
  stopWatching: (jobId: string) => void;

  // PROMPT #134 - WebSocket connection status (replaces polling)
  isConnected: boolean;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

// Job type to human-readable title mapping
const JOB_TYPE_TITLES: Record<string, string> = {
  'interview_message': 'Resposta da Entrevista',
  'backlog_generation': 'Gerando Backlog',
  'task_generation': 'Gerando Tasks',
  'epic_activation': 'Ativando Epic',
  'story_activation': 'Ativando Story',
  'task_activation': 'Ativando Task',
  'subtask_activation': 'Ativando Subtask',
  'task_execution': 'Executando Task',
  'batch_execution': 'Execução em Lote',
  'commit_generation': 'Gerando Commit',
  'context_generation': 'Gerando Contexto',
  // PROMPT #133 - New job types
  'interview_question': 'Gerando Pergunta',
  'memory_scan': 'Analisando Código',
  'project_title': 'Gerando Título',
  'suggested_epics': 'Gerando Épicos',
};

// Job type to icon mapping (matching AIModelBadge style)
export const JOB_TYPE_ICONS: Record<string, string> = {
  'interview_message': '🧠🔍',
  'backlog_generation': '🧠🧩',
  'task_generation': '🧠🧩',
  'epic_activation': '🧠🏗️',
  'story_activation': '🧠🏗️',
  'task_activation': '🧠🏗️',
  'subtask_activation': '🧠🏗️',
  'task_execution': '🛠️🤖',
  'batch_execution': '🛠️🤖',
  'commit_generation': '🧩⚙️',
  'context_generation': '🧠🏗️',
  // PROMPT #133 - New job types
  'interview_question': '🎤',
  'memory_scan': '🔍',
  'project_title': '📝',
  'suggested_epics': '🎯',
};

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [activeJobs, setActiveJobs] = useState<JobNotification[]>([]);
  const [notifications, setNotifications] = useState<JobNotification[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  // PROMPT #141 - Toast notification state
  const [toastNotification, setToastNotification] = useState<JobNotification | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // PROMPT #134 - WebSocket refs
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // API and WebSocket URLs
  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
  const WS_URL = API_BASE.replace('http', 'ws');

  // Calculate unread count
  const unreadCount = notifications.filter(n => !n.read).length;

  // PROMPT #141 - Dismiss toast notification
  const dismissToast = useCallback(() => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = null;
    }
    setToastNotification(null);
  }, []);

  // PROMPT #141 - Show toast notification (auto-dismiss after 4 seconds)
  const showToast = useCallback((notification: JobNotification) => {
    // Clear any existing toast timeout
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }

    setToastNotification(notification);

    // Auto-dismiss after 4 seconds
    toastTimeoutRef.current = setTimeout(() => {
      setToastNotification(null);
      toastTimeoutRef.current = null;
    }, 4000);
  }, []);

  // Add a new job to track
  // PROMPT #140 - watching: if true, user is on the page watching this job
  // When job completes, it will be auto-marked as read (no notification badge)
  const addJob = useCallback((jobId: string, jobType: string, title: string, description?: string, watching: boolean = false) => {
    const newJob: JobNotification = {
      id: `notif-${jobId}`,
      job_id: jobId,
      job_type: jobType,
      status: 'pending',
      progress_percent: null,
      progress_message: 'Aguardando...',
      created_at: new Date().toISOString(),
      read: false,
      title: title || JOB_TYPE_TITLES[jobType] || 'Processando...',
      description,
      watching, // PROMPT #140
    };

    setActiveJobs(prev => {
      // Avoid duplicates
      if (prev.some(j => j.job_id === jobId)) return prev;
      return [...prev, newJob];
    });
  }, []);

  // PROMPT #140 - Stop watching a job (user left the page)
  const stopWatching = useCallback((jobId: string) => {
    setActiveJobs(prev =>
      prev.map(j => j.job_id === jobId ? { ...j, watching: false } : j)
    );
  }, []);

  // Update job status
  const updateJob = useCallback((jobId: string, updates: Partial<JobNotification>) => {
    setActiveJobs(prev => {
      const jobIndex = prev.findIndex(j => j.job_id === jobId);
      if (jobIndex === -1) return prev;

      const updatedJobs = [...prev];
      const updatedJob = { ...updatedJobs[jobIndex], ...updates };

      // If job completed/failed/cancelled, move to notifications
      if (['completed', 'failed', 'cancelled'].includes(updatedJob.status)) {
        updatedJob.completed_at = new Date().toISOString();

        // PROMPT #140 - If user was watching this job, auto-mark as read
        // This prevents notification badge when user is on the page seeing the result
        if (updatedJob.watching) {
          updatedJob.read = true;
        } else {
          // PROMPT #141 - Show toast notification when user is NOT watching
          // This gives a brief visual alert for background jobs
          showToast(updatedJob);
        }

        // Remove from active jobs
        updatedJobs.splice(jobIndex, 1);

        // Add to notifications history
        setNotifications(prevNotifs => [updatedJob, ...prevNotifs].slice(0, 50)); // Keep last 50

        return updatedJobs;
      }

      updatedJobs[jobIndex] = updatedJob;
      return updatedJobs;
    });
  }, [showToast]);

  // Mark notification as read
  const markAsRead = useCallback((notificationId: string) => {
    setNotifications(prev =>
      prev.map(n => n.id === notificationId ? { ...n, read: true } : n)
    );
  }, []);

  // Mark all as read
  const markAllAsRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  // Clear a notification
  const clearNotification = useCallback((notificationId: string) => {
    setNotifications(prev => prev.filter(n => n.id !== notificationId));
  }, []);

  // Clear all notifications
  const clearAllNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  // PROMPT #134 - Handle WebSocket events
  const handleWebSocketEvent = useCallback((message: any) => {
    const { event, data } = message;

    // PROMPT #155 - Handle incremental epic generation events
    if (event === 'epics_batch_created') {
      // Dispatch custom event for pages to listen (like Backlog page)
      window.dispatchEvent(new CustomEvent('epicsBatchCreated', {
        detail: {
          projectId: data.project_id,
          batchNumber: data.batch_number,
          totalBatches: data.total_batches,
          epicsCount: data.epics_count,
          epics: data.epics
        }
      }));
      console.log(`📦 Epic batch ${data.batch_number}/${data.total_batches}: ${data.epics_count} epics`);
      return;
    }

    if (!data?.job_id) {
      // Handle non-job events (pong, etc.)
      if (event === 'pong') return;
      console.log('WebSocket event without job_id:', event);
      return;
    }

    // Check if we're tracking this job
    setActiveJobs(prevJobs => {
      const jobExists = prevJobs.some(j => j.job_id === data.job_id);

      // If job doesn't exist in activeJobs, add it (for jobs started in other tabs)
      if (!jobExists && event === 'job_started') {
        const newJob: JobNotification = {
          id: `notif-${data.job_id}`,
          job_id: data.job_id,
          job_type: data.job_type,
          status: 'running',
          progress_percent: null,
          progress_message: 'Processando...',
          created_at: new Date().toISOString(),
          read: false,
          title: data.notification_title || JOB_TYPE_TITLES[data.job_type] || 'Processando...',
        };
        return [...prevJobs, newJob];
      }

      return prevJobs;
    });

    // Now update the job
    switch (event) {
      case 'job_started':
        updateJob(data.job_id, {
          status: 'running',
          progress_message: 'Processando...',
        });
        break;

      case 'job_progress':
        updateJob(data.job_id, {
          status: 'running',
          progress_percent: data.progress_percent,
          progress_message: data.progress_message,
        });
        break;

      case 'job_completed':
        updateJob(data.job_id, {
          status: 'completed',
          result: data.result,
          title: data.notification_title || JOB_TYPE_TITLES[data.job_type] || 'Concluído',
          deep_link: data.deep_link,
          project_id: data.project_id,
          task_id: data.task_id,
          interview_id: data.interview_id,
        });
        break;

      case 'job_failed':
        updateJob(data.job_id, {
          status: 'failed',
          error: data.error,
          title: data.notification_title || JOB_TYPE_TITLES[data.job_type] || 'Falhou',
          deep_link: data.deep_link,
          project_id: data.project_id,
          task_id: data.task_id,
          interview_id: data.interview_id,
        });
        break;

      case 'job_cancelled':
        updateJob(data.job_id, {
          status: 'cancelled',
        });
        break;
    }
  }, [updateJob]);

  // PROMPT #134 - Connect to WebSocket
  const connect = useCallback(() => {
    // Don't connect if already connected or connecting
    if (wsRef.current?.readyState === WebSocket.OPEN ||
        wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    try {
      const ws = new WebSocket(`${WS_URL}/api/v1/ws/notifications`);

      ws.onopen = () => {
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
        console.log('🔔 Notification WebSocket connected');

        // Start ping interval to keep connection alive
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
        }
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ command: 'ping' }));
          }
        }, 30000);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          handleWebSocketEvent(message);
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;

        // Clear ping interval
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }

        // Reconnect with exponential backoff
        const maxAttempts = 10;
        if (reconnectAttemptsRef.current < maxAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
          reconnectAttemptsRef.current++;
          console.log(`🔄 Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`);
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        } else {
          console.error('Max reconnection attempts reached');
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
    }
  }, [WS_URL, handleWebSocketEvent]);

  // PROMPT #134 - Connect WebSocket on mount
  useEffect(() => {
    connect();

    // Fetch active jobs on mount (for jobs that started before connection)
    const fetchActiveJobs = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/v1/jobs/active`);
        if (response.ok) {
          const jobs = await response.json();
          if (jobs.length > 0) {
            const mappedJobs: JobNotification[] = jobs.map((job: any) => ({
              id: `notif-${job.id}`,
              job_id: job.id,
              job_type: job.job_type,
              status: job.status,
              progress_percent: job.progress_percent,
              progress_message: job.progress_message,
              created_at: job.created_at,
              read: false,
              title: job.notification_title || JOB_TYPE_TITLES[job.job_type] || 'Processando...',
              deep_link: job.deep_link,
              project_id: job.project_id,
              task_id: job.task_id,
              interview_id: job.interview_id,
            }));
            setActiveJobs(prev => {
              // Merge, avoiding duplicates
              const existingIds = new Set(prev.map(j => j.job_id));
              const newJobs = mappedJobs.filter(j => !existingIds.has(j.job_id));
              return [...prev, ...newJobs];
            });
          }
        }
      } catch (error) {
        console.log('Could not fetch active jobs:', error);
      }
    };

    fetchActiveJobs();

    // Cleanup on unmount
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect, API_BASE]);

  return (
    <NotificationContext.Provider
      value={{
        activeJobs,
        notifications,
        unreadCount,
        toastNotification, // PROMPT #141
        dismissToast, // PROMPT #141
        addJob,
        updateJob,
        markAsRead,
        markAllAsRead,
        clearNotification,
        clearAllNotifications,
        stopWatching, // PROMPT #140
        isConnected,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
}

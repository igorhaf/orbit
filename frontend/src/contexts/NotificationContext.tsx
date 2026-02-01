'use client';

/**
 * NotificationContext - Global notification state management
 * PROMPT #128 - Background Job Notifications
 *
 * Manages active jobs, completed notifications, and provides
 * real-time updates for the notification bell in the navbar.
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
}

interface NotificationContextType {
  // Active jobs being tracked
  activeJobs: JobNotification[];

  // Completed/failed notifications (history)
  notifications: JobNotification[];

  // Unread count for badge
  unreadCount: number;

  // Methods
  addJob: (jobId: string, jobType: string, title: string, description?: string) => void;
  updateJob: (jobId: string, updates: Partial<JobNotification>) => void;
  markAsRead: (notificationId: string) => void;
  markAllAsRead: () => void;
  clearNotification: (notificationId: string) => void;
  clearAllNotifications: () => void;

  // Polling control
  startPolling: () => void;
  stopPolling: () => void;
  isPolling: boolean;
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
  const [isPolling, setIsPolling] = useState(false);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

  // Calculate unread count
  const unreadCount = notifications.filter(n => !n.read).length;

  // Add a new job to track
  const addJob = useCallback((jobId: string, jobType: string, title: string, description?: string) => {
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
    };

    setActiveJobs(prev => [...prev, newJob]);

    // Start polling if not already
    if (!isPolling) {
      startPolling();
    }
  }, [isPolling]);

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

        // Remove from active jobs
        updatedJobs.splice(jobIndex, 1);

        // Add to notifications history
        setNotifications(prevNotifs => [updatedJob, ...prevNotifs].slice(0, 50)); // Keep last 50

        return updatedJobs;
      }

      updatedJobs[jobIndex] = updatedJob;
      return updatedJobs;
    });
  }, []);

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

  // Poll active jobs for updates
  const pollJobs = useCallback(async () => {
    if (activeJobs.length === 0) return;

    for (const job of activeJobs) {
      try {
        const response = await fetch(`${API_URL}/jobs/${job.job_id}`);
        if (response.ok) {
          const data = await response.json();
          // PROMPT #133 - Include deep_link and notification_title from API
          const updates: Partial<JobNotification> = {
            status: data.status,
            progress_percent: data.progress_percent,
            progress_message: data.progress_message,
            result: data.result,
            error: data.error,
            deep_link: data.deep_link,
            project_id: data.project_id,
            task_id: data.task_id,
            interview_id: data.interview_id,
          };
          // Update title from notification_title if available (e.g., "✅ Pergunta gerada...")
          if (data.notification_title) {
            updates.title = data.notification_title;
          }
          updateJob(job.job_id, updates);
        }
      } catch (error) {
        console.error(`Error polling job ${job.job_id}:`, error);
      }
    }
  }, [activeJobs, API_URL, updateJob]);

  // Start polling
  const startPolling = useCallback(() => {
    if (pollingIntervalRef.current) return;

    setIsPolling(true);
    pollingIntervalRef.current = setInterval(() => {
      pollJobs();
    }, 2000); // Poll every 2 seconds
  }, [pollJobs]);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    setIsPolling(false);
  }, []);

  // Auto-stop polling when no active jobs
  useEffect(() => {
    if (activeJobs.length === 0 && isPolling) {
      stopPolling();
    }
  }, [activeJobs.length, isPolling, stopPolling]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  // Fetch active jobs on mount
  useEffect(() => {
    const fetchActiveJobs = async () => {
      try {
        const response = await fetch(`${API_URL}/jobs/active`);
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
              // PROMPT #133 - Include deep link fields
              deep_link: job.deep_link,
              project_id: job.project_id,
              task_id: job.task_id,
              interview_id: job.interview_id,
            }));
            setActiveJobs(mappedJobs);
            startPolling();
          }
        }
      } catch (error) {
        // Silently fail - endpoint might not exist yet
        console.log('Could not fetch active jobs:', error);
      }
    };

    fetchActiveJobs();
  }, [API_URL, startPolling]);

  return (
    <NotificationContext.Provider
      value={{
        activeJobs,
        notifications,
        unreadCount,
        addJob,
        updateJob,
        markAsRead,
        markAllAsRead,
        clearNotification,
        clearAllNotifications,
        startPolling,
        stopPolling,
        isPolling,
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

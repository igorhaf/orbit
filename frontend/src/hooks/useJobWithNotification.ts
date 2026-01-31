'use client';

/**
 * useJobWithNotification Hook
 * PROMPT #128 - Background Job Notifications
 *
 * Wraps job polling with automatic notification tracking.
 * When a job is started, it's automatically added to the notification system.
 * When it completes/fails, a notification appears in the bell.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNotifications } from '@/contexts/NotificationContext';
import { useJobPolling } from './useJobPolling';

interface UseJobWithNotificationOptions {
  interval?: number;
  enabled?: boolean;
  onComplete?: (result: any) => void;
  onError?: (error: string) => void;
  onCancelled?: () => void;
  // Notification options
  title?: string;
  description?: string;
}

export function useJobWithNotification(
  jobId: string | null,
  jobType: string,
  options: UseJobWithNotificationOptions = {}
) {
  const { addJob, updateJob } = useNotifications();
  const [hasAddedJob, setHasAddedJob] = useState(false);

  const {
    interval = 1500,
    enabled = true,
    onComplete,
    onError,
    onCancelled,
    title,
    description,
  } = options;

  // Wrap callbacks to update notification
  const handleComplete = useCallback((result: any) => {
    if (jobId) {
      updateJob(jobId, { status: 'completed', result });
    }
    onComplete?.(result);
  }, [jobId, updateJob, onComplete]);

  const handleError = useCallback((error: string) => {
    if (jobId) {
      updateJob(jobId, { status: 'failed', error });
    }
    onError?.(error);
  }, [jobId, updateJob, onError]);

  const handleCancelled = useCallback(() => {
    if (jobId) {
      updateJob(jobId, { status: 'cancelled' });
    }
    onCancelled?.();
  }, [jobId, updateJob, onCancelled]);

  // Use standard job polling with wrapped callbacks
  const { job, isPolling, error, refetch } = useJobPolling(jobId, {
    interval,
    enabled: enabled && !!jobId,
    onComplete: handleComplete,
    onError: handleError,
    onCancelled: handleCancelled,
  });

  // Add job to notifications when it starts
  useEffect(() => {
    if (jobId && !hasAddedJob) {
      addJob(jobId, jobType, title || '', description);
      setHasAddedJob(true);
    }
  }, [jobId, jobType, title, description, addJob, hasAddedJob]);

  // Update job progress in notifications
  useEffect(() => {
    if (job && jobId && hasAddedJob) {
      updateJob(jobId, {
        status: job.status,
        progress_percent: job.progress_percent,
        progress_message: job.progress_message,
      });
    }
  }, [job?.status, job?.progress_percent, job?.progress_message, jobId, updateJob, hasAddedJob]);

  // Reset state when jobId changes
  useEffect(() => {
    if (!jobId) {
      setHasAddedJob(false);
    }
  }, [jobId]);

  return {
    job,
    isPolling,
    error,
    refetch,
  };
}

// Helper function to start a job and track it
export function startJobWithNotification(
  addJob: (jobId: string, jobType: string, title: string, description?: string) => void,
  jobId: string,
  jobType: string,
  title: string,
  description?: string
) {
  addJob(jobId, jobType, title, description);
}

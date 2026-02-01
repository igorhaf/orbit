/**
 * useJobPolling Hook
 * PROMPT #65 - Async Job System
 * PROMPT #134 - Migrated from polling to WebSocket
 *
 * Now uses WebSocket via NotificationContext for real-time updates.
 * No more polling - receives instant updates when job status changes.
 *
 * Usage:
 *   const { job, isPolling } = useJobPolling(jobId);
 *
 *   if (isPolling) {
 *     return <ProgressBar percent={job?.progress_percent} message={job?.progress_message} />
 *   }
 *
 *   if (job?.status === 'completed') {
 *     return <SuccessMessage result={job.result} />
 *   }
 */

import { useState, useEffect, useCallback } from 'react';
import { useNotifications } from '@/contexts/NotificationContext';
import { jobsApi } from '@/lib/api';

export interface AsyncJob {
  id: string;
  job_type: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress_percent: number | null;
  progress_message: string | null;
  result: any | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  // PROMPT #133 - Deep linking
  deep_link?: string | null;
  notification_title?: string | null;
  project_id?: string | null;
  task_id?: string | null;
  interview_id?: string | null;
}

interface UseJobPollingOptions {
  /**
   * Polling interval in milliseconds
   * @deprecated PROMPT #134 - No longer used, WebSocket provides instant updates
   */
  interval?: number;

  /**
   * Enable automatic polling
   * @default true
   */
  enabled?: boolean;

  /**
   * Callback when job completes successfully
   */
  onComplete?: (result: any) => void;

  /**
   * Callback when job fails
   */
  onError?: (error: string) => void;

  /**
   * Callback when job is cancelled
   */
  onCancelled?: () => void;
}

/**
 * Hook to track async job status via WebSocket.
 * PROMPT #134 - Migrated from polling to WebSocket for instant updates.
 *
 * @param jobId - The job ID to track
 * @param options - Configuration options
 */
export function useJobPolling(
  jobId: string | null,
  options: UseJobPollingOptions = {}
) {
  const {
    enabled = true,
    onComplete,
    onError,
    onCancelled,
  } = options;

  const [job, setJob] = useState<AsyncJob | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // PROMPT #134 - Use NotificationContext to track job via WebSocket
  const { activeJobs, notifications, addJob } = useNotifications();

  // Find job in activeJobs or notifications
  const trackedJob = jobId
    ? activeJobs.find(j => j.job_id === jobId) || notifications.find(n => n.job_id === jobId)
    : null;

  // Sync job state from NotificationContext
  useEffect(() => {
    if (!trackedJob) return;

    const asyncJob: AsyncJob = {
      id: trackedJob.job_id,
      job_type: trackedJob.job_type,
      status: trackedJob.status,
      progress_percent: trackedJob.progress_percent,
      progress_message: trackedJob.progress_message,
      result: trackedJob.result || null,
      error: trackedJob.error || null,
      created_at: trackedJob.created_at,
      started_at: null,
      completed_at: trackedJob.completed_at || null,
      deep_link: trackedJob.deep_link,
      notification_title: trackedJob.notification_title,
      project_id: trackedJob.project_id,
      task_id: trackedJob.task_id,
      interview_id: trackedJob.interview_id,
    };

    setJob(asyncJob);

    // Update isPolling based on status
    if (['completed', 'failed', 'cancelled'].includes(trackedJob.status)) {
      setIsPolling(false);
    } else {
      setIsPolling(true);
    }

    // Trigger callbacks
    if (trackedJob.status === 'completed' && onComplete) {
      onComplete(trackedJob.result);
    } else if (trackedJob.status === 'failed' && onError) {
      setError(trackedJob.error || 'Job failed');
      onError(trackedJob.error || 'Job failed');
    } else if (trackedJob.status === 'cancelled' && onCancelled) {
      onCancelled();
    }
  }, [trackedJob, onComplete, onError, onCancelled]);

  // Initial fetch when jobId changes (in case job started before WebSocket connected)
  const fetchJobStatus = useCallback(async () => {
    if (!jobId) return;

    try {
      const response = await jobsApi.get(jobId);
      const data = response.data || response;

      // Add job to NotificationContext if not already tracked
      if (!trackedJob) {
        addJob(jobId, data.job_type, data.notification_title || 'Processando...');
      }

      setJob(data);

      // If job is completed, failed, or cancelled, stop polling
      if (data.status === 'completed') {
        setIsPolling(false);
        onComplete?.(data.result);
      } else if (data.status === 'failed') {
        setIsPolling(false);
        setError(data.error);
        onError?.(data.error);
      } else if (data.status === 'cancelled') {
        setIsPolling(false);
        onCancelled?.();
      }
    } catch (err: any) {
      console.error('Failed to fetch job status:', err);
      setError(err.message || 'Failed to fetch job status');
      setIsPolling(false);
    }
  }, [jobId, trackedJob, addJob, onComplete, onError, onCancelled]);

  // Fetch job status once on mount/jobId change
  useEffect(() => {
    if (!jobId || !enabled) {
      setIsPolling(false);
      return;
    }

    // Only fetch if not already tracked
    if (!trackedJob) {
      setIsPolling(true);
      setError(null);
      fetchJobStatus();
    }
  }, [jobId, enabled, trackedJob, fetchJobStatus]);

  return {
    job,
    isPolling,
    error,
    refetch: fetchJobStatus,
  };
}

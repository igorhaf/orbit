/**
 * useJobPolling Hook
 * PROMPT #65 - Async Job System
 *
 * Polls async job status until completion or failure.
 * Provides real-time progress updates for long-running background tasks.
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
import { jobsApi } from '@/lib/api';

export interface AsyncJob {
  id: string;
  job_type: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress_percent: number | null;
  progress_message: string | null;
  result: any | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface UseJobPollingOptions {
  /**
   * Polling interval in milliseconds
   * @default 1500
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
}

export function useJobPolling(
  jobId: string | null,
  options: UseJobPollingOptions = {}
) {
  const {
    interval = 1500,
    enabled = true,
    onComplete,
    onError,
  } = options;

  const [job, setJob] = useState<AsyncJob | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchJobStatus = useCallback(async () => {
    if (!jobId) return;

    try {
      const response = await jobsApi.get(jobId);
      const data = response.data || response;
      setJob(data);

      // If job is completed or failed, stop polling
      if (data.status === 'completed') {
        setIsPolling(false);
        onComplete?.(data.result);
      } else if (data.status === 'failed') {
        setIsPolling(false);
        setError(data.error);
        onError?.(data.error);
      }
    } catch (err: any) {
      console.error('Failed to fetch job status:', err);
      setError(err.message || 'Failed to fetch job status');
      setIsPolling(false);
    }
  }, [jobId, onComplete, onError]);

  useEffect(() => {
    if (!jobId || !enabled) {
      setIsPolling(false);
      return;
    }

    setIsPolling(true);
    setError(null);

    // Fetch immediately
    fetchJobStatus();

    // Set up polling interval
    const pollInterval = setInterval(() => {
      fetchJobStatus();
    }, interval);

    return () => {
      clearInterval(pollInterval);
    };
  }, [jobId, enabled, interval, fetchJobStatus]);

  return {
    job,
    isPolling,
    error,
    refetch: fetchJobStatus,
  };
}

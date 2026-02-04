/**
 * JobIndicator Component
 * PROMPT #162 - Visual badge indicating active jobs for an entity
 *
 * Shows a pulsing indicator when there are active jobs running
 * for a specific project, interview, or task.
 *
 * Usage:
 *   <JobIndicator entityType="project" entityId={project.id} />
 *   <JobIndicator entityType="interview" entityId={interview.id} />
 *   <JobIndicator entityType="task" entityId={task.id} />
 */

'use client';

import React from 'react';
import { useNotifications, JobNotification, JOB_TYPE_ICONS } from '@/contexts/NotificationContext';
import { clsx } from 'clsx';

interface JobIndicatorProps {
  /** Type of entity to check for active jobs */
  entityType: 'project' | 'interview' | 'task';
  /** UUID of the entity */
  entityId: string;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Show job type icon */
  showIcon?: boolean;
  /** Show job progress percentage */
  showProgress?: boolean;
  /** Additional CSS classes */
  className?: string;
}

export const JobIndicator: React.FC<JobIndicatorProps> = ({
  entityType,
  entityId,
  size = 'sm',
  showIcon = false,
  showProgress = false,
  className,
}) => {
  const { activeJobs } = useNotifications();

  // Find active jobs for this entity
  const entityJobs = activeJobs.filter((job: JobNotification) => {
    const idField = `${entityType}_id` as keyof JobNotification;
    return job[idField] === entityId && ['pending', 'running'].includes(job.status);
  });

  // No active jobs for this entity
  if (entityJobs.length === 0) {
    return null;
  }

  // Get the most recent/relevant job
  const primaryJob = entityJobs[0];
  const jobIcon = JOB_TYPE_ICONS[primaryJob.job_type] || '⚙️';

  // Size classes
  const sizeClasses = {
    sm: 'w-2 h-2',
    md: 'w-3 h-3',
    lg: 'w-4 h-4',
  };

  const textSizeClasses = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
  };

  // Simple dot indicator (default)
  if (!showIcon && !showProgress) {
    return (
      <span
        className={clsx(
          sizeClasses[size],
          'bg-blue-500 rounded-full animate-pulse',
          'inline-block',
          className
        )}
        title={`Processing: ${primaryJob.progress_message || primaryJob.job_type}`}
      />
    );
  }

  // Extended indicator with icon and/or progress
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1',
        'bg-blue-100 text-blue-800 rounded-full px-2 py-0.5',
        textSizeClasses[size],
        className
      )}
      title={primaryJob.progress_message || `Processing ${primaryJob.job_type}`}
    >
      {/* Pulsing dot */}
      <span
        className={clsx(
          sizeClasses[size],
          'bg-blue-500 rounded-full animate-pulse inline-block'
        )}
      />

      {/* Job icon */}
      {showIcon && <span>{jobIcon}</span>}

      {/* Progress percentage */}
      {showProgress && primaryJob.progress_percent !== null && (
        <span className="font-medium">{primaryJob.progress_percent}%</span>
      )}

      {/* Multiple jobs indicator */}
      {entityJobs.length > 1 && (
        <span className="text-blue-600">+{entityJobs.length - 1}</span>
      )}
    </span>
  );
};

/**
 * JobIndicatorBadge - A wrapper for JobIndicator positioned absolutely
 *
 * Usage:
 *   <div className="relative">
 *     <ProjectCard />
 *     <JobIndicatorBadge entityType="project" entityId={project.id} />
 *   </div>
 */
export const JobIndicatorBadge: React.FC<JobIndicatorProps & { position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' }> = ({
  position = 'top-right',
  ...props
}) => {
  const positionClasses = {
    'top-right': 'top-1 right-1',
    'top-left': 'top-1 left-1',
    'bottom-right': 'bottom-1 right-1',
    'bottom-left': 'bottom-1 left-1',
  };

  return (
    <span className={clsx('absolute', positionClasses[position])}>
      <JobIndicator {...props} />
    </span>
  );
};

export default JobIndicator;

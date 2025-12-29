/**
 * TaskStatusBadge Component
 * Displays task execution status with animations
 */

import React from 'react';
import { clsx } from 'clsx';
import { Badge } from '@/components/ui';

export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'validating';

export interface TaskStatusBadgeProps {
  status: TaskStatus;
  animated?: boolean;
  className?: string;
}

export const TaskStatusBadge: React.FC<TaskStatusBadgeProps> = ({
  status,
  animated = true,
  className
}) => {
  const statusConfig = {
    pending: {
      variant: 'default' as const,
      label: 'Pending',
      icon: '⏳',
      animation: '',
    },
    in_progress: {
      variant: 'info' as const,
      label: 'Running',
      icon: '▶️',
      animation: animated ? 'animate-pulse' : '',
    },
    validating: {
      variant: 'warning' as const,
      label: 'Validating',
      icon: '🔍',
      animation: animated ? 'animate-pulse' : '',
    },
    completed: {
      variant: 'success' as const,
      label: 'Completed',
      icon: '✅',
      animation: '',
    },
    failed: {
      variant: 'danger' as const,
      label: 'Failed',
      icon: '❌',
      animation: '',
    },
  };

  const config = statusConfig[status];

  return (
    <Badge
      variant={config.variant}
      className={clsx(config.animation, className)}
    >
      <span className="mr-1">{config.icon}</span>
      {config.label}
    </Badge>
  );
};

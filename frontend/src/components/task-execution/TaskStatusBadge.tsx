/**
 * TaskStatusBadge Component
 * Displays task execution status with animations
 */

import React from 'react';
import { clsx } from 'clsx';
import { Badge } from '@/components/ui';
import { IconClock, IconPlay, IconSearch, IconCheckCircle, IconXCircle } from '@/components/icons'; // PROMPT #188

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
      label: 'Pendente',
      icon: <IconClock className="w-3.5 h-3.5" />,
      animation: '',
    },
    in_progress: {
      variant: 'info' as const,
      label: 'Em execucao',
      icon: <IconPlay className="w-3.5 h-3.5" />,
      animation: animated ? 'animate-pulse' : '',
    },
    validating: {
      variant: 'warning' as const,
      label: 'Validando',
      icon: <IconSearch className="w-3.5 h-3.5" />,
      animation: animated ? 'animate-pulse' : '',
    },
    completed: {
      variant: 'success' as const,
      label: 'Completed',
      icon: <IconCheckCircle className="w-3.5 h-3.5" />,
      animation: '',
    },
    failed: {
      variant: 'danger' as const,
      label: 'Failed',
      icon: <IconXCircle className="w-3.5 h-3.5" />,
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

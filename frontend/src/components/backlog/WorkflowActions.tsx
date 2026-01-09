/**
 * Workflow Actions Component
 * Status transition buttons with workflow validation
 * JIRA Transformation - PROMPT #62 - Phase 6
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui';
import { tasksApi } from '@/lib/api';
import { BacklogItem } from '@/lib/types';

interface WorkflowActionsProps {
  item: BacklogItem;
  onTransition?: () => void;
}

interface ValidTransition {
  to_status: string;
  label: string;
  color: 'primary' | 'success' | 'warning' | 'danger';
  icon: string;
}

export default function WorkflowActions({ item, onTransition }: WorkflowActionsProps) {
  const [validTransitions, setValidTransitions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState<string | null>(null);
  const [transitionReason, setTransitionReason] = useState('');

  useEffect(() => {
    fetchValidTransitions();
  }, [item.id]);

  const fetchValidTransitions = async () => {
    try {
      const transitions = await tasksApi.getValidTransitions(item.id);
      setValidTransitions(transitions.valid_transitions || []);
    } catch (error) {
      console.error('Error fetching valid transitions:', error);
    }
  };

  const getTransitionConfig = (toStatus: string): ValidTransition => {
    const configs: Record<string, ValidTransition> = {
      'todo': {
        to_status: 'todo',
        label: 'Move to To Do',
        color: 'primary',
        icon: '📋',
      },
      'in_progress': {
        to_status: 'in_progress',
        label: 'Start Progress',
        color: 'primary',
        icon: '▶️',
      },
      'review': {
        to_status: 'review',
        label: 'Send to Review',
        color: 'warning',
        icon: '👀',
      },
      'done': {
        to_status: 'done',
        label: 'Mark as Done',
        color: 'success',
        icon: '✅',
      },
      'backlog': {
        to_status: 'backlog',
        label: 'Move to Backlog',
        color: 'primary',
        icon: '⬅️',
      },
      'blocked': {
        to_status: 'blocked',
        label: 'Mark as Blocked',
        color: 'danger',
        icon: '🚫',
      },
      'cancelled': {
        to_status: 'cancelled',
        label: 'Cancel',
        color: 'danger',
        icon: '❌',
      },
    };

    return configs[toStatus] || {
      to_status: toStatus,
      label: toStatus.replace('_', ' '),
      color: 'primary',
      icon: '→',
    };
  };

  const handleTransition = async (toStatus: string) => {
    setLoading(true);
    try {
      await tasksApi.transitionStatus(item.id, {
        to_status: toStatus,
        transitioned_by: 'current_user', // TODO: Get from auth context
        transition_reason: transitionReason || undefined,
      });

      setShowConfirm(null);
      setTransitionReason('');

      if (onTransition) {
        onTransition();
      }
    } catch (error: any) {
      console.error('Error transitioning status:', error);
      alert(error.message || 'Failed to transition status');
    } finally {
      setLoading(false);
    }
  };

  if (validTransitions.length === 0) {
    return (
      <div className="text-sm text-gray-500 italic">
        No transitions available from current status
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Current Status */}
      <div className="flex items-center gap-2 pb-2 border-b">
        <span className="text-xs font-semibold text-gray-500 uppercase">Current Status:</span>
        <span className="px-3 py-1 text-sm font-medium rounded border bg-blue-50 text-blue-800 border-blue-200">
          {item.workflow_state}
        </span>
      </div>

      {/* Transition Buttons */}
      <div className="flex flex-wrap gap-2">
        {validTransitions.map((toStatus) => {
          const config = getTransitionConfig(toStatus);

          return (
            <Button
              key={toStatus}
              variant={config.color === 'primary' ? 'outline' : config.color}
              size="sm"
              onClick={() => setShowConfirm(toStatus)}
              leftIcon={<span>{config.icon}</span>}
            >
              {config.label}
            </Button>
          );
        })}
      </div>

      {/* Confirmation Dialog */}
      {showConfirm && (
        <div className="mt-4 p-4 border-2 border-blue-500 rounded-lg bg-blue-50">
          <div className="mb-3">
            <p className="text-sm font-semibold text-gray-900 mb-1">
              Confirm Status Transition
            </p>
            <p className="text-xs text-gray-600">
              Change status from <strong>{item.workflow_state}</strong> to{' '}
              <strong>{showConfirm}</strong>
            </p>
          </div>

          {/* Reason (Optional) */}
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Reason (optional)
            </label>
            <textarea
              value={transitionReason}
              onChange={(e) => setTransitionReason(e.target.value)}
              placeholder="Why are you making this change?"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={2}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowConfirm(null);
                setTransitionReason('');
              }}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => handleTransition(showConfirm)}
              isLoading={loading}
            >
              Confirm Transition
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

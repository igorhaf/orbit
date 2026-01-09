/**
 * ModificationApprovalModal Component
 * PROMPT #95 - Blocking System UI
 *
 * Modal for approving/rejecting AI-suggested task modifications.
 * Shows diff view between original and proposed changes.
 */

'use client';

import { useState } from 'react';
import { Dialog, Button, Badge, Input } from '@/components/ui';
import { Task } from '@/lib/types';
import { SimilarityBadge } from './SimilarityBadge';

interface Props {
  task: Task;
  isOpen: boolean;
  onClose: () => void;
  onApprove: () => Promise<void>;
  onReject: (reason?: string) => Promise<void>;
}

export function ModificationApprovalModal({
  task,
  isOpen,
  onClose,
  onApprove,
  onReject,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectionInput, setShowRejectionInput] = useState(false);

  const modification = task.pending_modification;

  if (!modification) {
    return null;
  }

  const handleApprove = async () => {
    setLoading(true);
    try {
      await onApprove();
      onClose();
    } catch (error) {
      console.error('Failed to approve modification:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    setLoading(true);
    try {
      await onReject(rejectionReason || undefined);
      onClose();
    } catch (error) {
      console.error('Failed to reject modification:', error);
    } finally {
      setLoading(false);
    }
  };

  // Helper to render diff (original vs proposed)
  const renderDiff = (label: string, original: string | undefined, proposed: string | undefined) => {
    const hasChange = original !== proposed;

    return (
      <div className="mb-4">
        <h4 className="text-sm font-semibold text-gray-700 mb-2">{label}</h4>
        <div className="grid grid-cols-2 gap-4">
          {/* Original */}
          <div className="border rounded-lg p-3 bg-red-50 border-red-200">
            <div className="text-xs text-red-600 font-medium mb-1">Original</div>
            <div className={`text-sm ${hasChange ? 'line-through text-gray-500' : 'text-gray-900'}`}>
              {original || <span className="text-gray-400 italic">Empty</span>}
            </div>
          </div>

          {/* Proposed */}
          <div className="border rounded-lg p-3 bg-green-50 border-green-200">
            <div className="text-xs text-green-600 font-medium mb-1">Proposed</div>
            <div className={`text-sm ${hasChange ? 'font-semibold text-green-800' : 'text-gray-900'}`}>
              {proposed || <span className="text-gray-400 italic">Empty</span>}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Review Proposed Modification"
      size="xl"
    >
      <div className="space-y-6">
        {/* Header with similarity badge */}
        <div className="flex items-center justify-between pb-4 border-b">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              AI Suggested Modification
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              Review the changes and approve or reject the modification
            </p>
          </div>
          <SimilarityBadge score={modification.similarity_score} className="text-base px-3 py-1.5" />
        </div>

        {/* Blocking reason */}
        {task.blocked_reason && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex items-start">
              <span className="text-yellow-600 mr-2">ℹ️</span>
              <div>
                <p className="text-sm font-medium text-yellow-800">Blocked Reason:</p>
                <p className="text-sm text-yellow-700 mt-1">{task.blocked_reason}</p>
              </div>
            </div>
          </div>
        )}

        {/* Diff view */}
        <div className="space-y-4">
          {/* Title diff */}
          {renderDiff('Title', modification.original_title || task.title, modification.title)}

          {/* Description diff */}
          {renderDiff(
            'Description',
            modification.original_description || task.description || undefined,
            modification.description
          )}

          {/* Story points diff (if changed) */}
          {modification.story_points !== undefined && modification.story_points !== task.story_points && (
            <div className="mb-4">
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Story Points</h4>
              <div className="flex items-center gap-4">
                <Badge className="bg-red-100 text-red-800 border-red-200">
                  Original: {task.story_points || 'None'}
                </Badge>
                <span className="text-gray-400">→</span>
                <Badge className="bg-green-100 text-green-800 border-green-200">
                  Proposed: {modification.story_points}
                </Badge>
              </div>
            </div>
          )}

          {/* Acceptance criteria diff (if exists) */}
          {modification.acceptance_criteria && modification.acceptance_criteria.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Acceptance Criteria</h4>
              <div className="grid grid-cols-2 gap-4">
                {/* Original */}
                <div className="border rounded-lg p-3 bg-red-50 border-red-200">
                  <div className="text-xs text-red-600 font-medium mb-2">Original</div>
                  {task.acceptance_criteria && task.acceptance_criteria.length > 0 ? (
                    <ul className="space-y-1">
                      {task.acceptance_criteria.map((criterion, idx) => (
                        <li key={idx} className="text-sm text-gray-700 line-through">
                          • {criterion}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-gray-400 text-sm italic">None</span>
                  )}
                </div>

                {/* Proposed */}
                <div className="border rounded-lg p-3 bg-green-50 border-green-200">
                  <div className="text-xs text-green-600 font-medium mb-2">Proposed</div>
                  <ul className="space-y-1">
                    {modification.acceptance_criteria.map((criterion, idx) => (
                      <li key={idx} className="text-sm text-green-800 font-semibold">
                        • {criterion}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Suggested at timestamp */}
          <div className="text-xs text-gray-500">
            Suggested at: {new Date(modification.suggested_at).toLocaleString()}
          </div>
        </div>

        {/* Rejection reason input (shown when user clicks Reject) */}
        {showRejectionInput && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Rejection Reason (optional)
            </label>
            <Input
              type="text"
              placeholder="Why are you rejecting this modification?"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              className="w-full"
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </Button>

          {!showRejectionInput ? (
            <>
              <Button
                variant="danger"
                onClick={() => setShowRejectionInput(true)}
                disabled={loading}
              >
                ❌ Reject
              </Button>
              <Button
                variant="primary"
                onClick={handleApprove}
                disabled={loading}
              >
                {loading ? 'Approving...' : '✅ Approve Modification'}
              </Button>
            </>
          ) : (
            <Button
              variant="danger"
              onClick={handleReject}
              disabled={loading}
            >
              {loading ? 'Rejecting...' : 'Confirm Rejection'}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

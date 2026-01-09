/**
 * Bulk Action Bar Component
 * Actions for multiple selected backlog items
 * JIRA Transformation - PROMPT #62 - Phase 3
 */

'use client';

import React, { useState } from 'react';
import { Card, CardContent, Button } from '@/components/ui';
import { PriorityLevel, TaskStatus } from '@/lib/types';

interface BulkActionBarProps {
  selectedCount: number;
  selectedIds: Set<string>;
  onAssignTo?: (assignee: string) => void;
  onChangePriority?: (priority: PriorityLevel) => void;
  onAddLabel?: (label: string) => void;
  onMoveToStatus?: (status: TaskStatus) => void;
  onDelete?: () => void;
  onClearSelection?: () => void;
}

export default function BulkActionBar({
  selectedCount,
  selectedIds,
  onAssignTo,
  onChangePriority,
  onAddLabel,
  onMoveToStatus,
  onDelete,
  onClearSelection,
}: BulkActionBarProps) {
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showPriorityDialog, setShowPriorityDialog] = useState(false);
  const [showLabelDialog, setShowLabelDialog] = useState(false);
  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const [assigneeInput, setAssigneeInput] = useState('');
  const [labelInput, setLabelInput] = useState('');

  if (selectedCount === 0) {
    return null;
  }

  const handleAssign = () => {
    if (onAssignTo && assigneeInput.trim()) {
      onAssignTo(assigneeInput.trim());
      setAssigneeInput('');
      setShowAssignDialog(false);
    }
  };

  const handleAddLabel = () => {
    if (onAddLabel && labelInput.trim()) {
      onAddLabel(labelInput.trim());
      setLabelInput('');
      setShowLabelDialog(false);
    }
  };

  return (
    <Card variant="bordered" className="sticky bottom-4 shadow-lg border-2 border-blue-500">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-4">
          {/* Selection Info */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-semibold text-sm">
                {selectedCount}
              </div>
              <span className="text-sm font-medium text-gray-900">
                item{selectedCount !== 1 ? 's' : ''} selected
              </span>
            </div>
            {onClearSelection && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClearSelection}
                className="text-xs text-gray-600"
              >
                Clear
              </Button>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            {/* Assign */}
            {onAssignTo && (
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAssignDialog(!showAssignDialog)}
                  leftIcon={
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  }
                >
                  Assign
                </Button>
                {showAssignDialog && (
                  <div className="absolute bottom-full mb-2 left-0 bg-white border border-gray-300 rounded-lg shadow-lg p-3 min-w-[200px]">
                    <input
                      type="text"
                      placeholder="Assignee username..."
                      value={assigneeInput}
                      onChange={(e) => setAssigneeInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAssign()}
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <Button size="sm" variant="primary" onClick={handleAssign} className="flex-1">
                        Assign
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setShowAssignDialog(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Priority */}
            {onChangePriority && (
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowPriorityDialog(!showPriorityDialog)}
                  leftIcon={
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" />
                    </svg>
                  }
                >
                  Priority
                </Button>
                {showPriorityDialog && (
                  <div className="absolute bottom-full mb-2 left-0 bg-white border border-gray-300 rounded-lg shadow-lg p-2 min-w-[160px]">
                    {Object.values(PriorityLevel).map((priority) => (
                      <button
                        key={priority}
                        onClick={() => {
                          onChangePriority(priority);
                          setShowPriorityDialog(false);
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 rounded capitalize"
                      >
                        {priority}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Add Label */}
            {onAddLabel && (
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowLabelDialog(!showLabelDialog)}
                  leftIcon={
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                    </svg>
                  }
                >
                  Label
                </Button>
                {showLabelDialog && (
                  <div className="absolute bottom-full mb-2 left-0 bg-white border border-gray-300 rounded-lg shadow-lg p-3 min-w-[200px]">
                    <input
                      type="text"
                      placeholder="Label name..."
                      value={labelInput}
                      onChange={(e) => setLabelInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddLabel()}
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <Button size="sm" variant="primary" onClick={handleAddLabel} className="flex-1">
                        Add
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setShowLabelDialog(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Move to Status */}
            {onMoveToStatus && (
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowStatusDialog(!showStatusDialog)}
                  leftIcon={
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  }
                >
                  Status
                </Button>
                {showStatusDialog && (
                  <div className="absolute bottom-full mb-2 left-0 bg-white border border-gray-300 rounded-lg shadow-lg p-2 min-w-[160px]">
                    {Object.values(TaskStatus).map((status) => (
                      <button
                        key={status}
                        onClick={() => {
                          onMoveToStatus(status);
                          setShowStatusDialog(false);
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 rounded capitalize"
                      >
                        {status.replace('_', ' ')}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Delete */}
            {onDelete && (
              <div className="relative">
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setShowDeleteDialog(true)}
                  leftIcon={
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  }
                >
                  Delete
                </Button>
                {showDeleteDialog && (
                  <div className="absolute bottom-full mb-2 right-0 bg-white border border-red-300 rounded-lg shadow-lg p-4 min-w-[280px]">
                    <div className="text-sm font-medium text-gray-900 mb-2">
                      Delete {selectedCount} item{selectedCount !== 1 ? 's' : ''}?
                    </div>
                    <p className="text-xs text-gray-600 mb-3">
                      This action cannot be undone.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          onDelete();
                          setShowDeleteDialog(false);
                        }}
                        className="flex-1"
                      >
                        Delete
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setShowDeleteDialog(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

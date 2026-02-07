/**
 * Inline Card Creator Component
 * PROMPT #187 - Manual card creation with ghost card pattern
 *
 * Renders a temporary "ghost card" with an inline title input.
 * Card is only persisted to the database when the user types a title and confirms.
 * If the title is left empty, the card is automatically discarded.
 */

'use client';

import React, { useState, useRef, useEffect } from 'react';
import { tasksApi } from '@/lib/api';
import { ItemType } from '@/lib/types';

const getItemTypeIcon = (type: ItemType) => {
  switch (type) {
    case ItemType.EPIC:
      return <span className="text-purple-600 font-bold text-sm">E</span>;
    case ItemType.STORY:
      return <span className="text-blue-600 font-bold text-sm">S</span>;
    case ItemType.TASK:
      return <span className="text-green-600 font-bold text-sm">T</span>;
    case ItemType.SUBTASK:
      return <span className="text-gray-600 font-bold text-sm">ST</span>;
    default:
      return <span className="text-gray-400 text-sm">?</span>;
  }
};

const getItemTypeLabel = (type: ItemType): string => {
  switch (type) {
    case ItemType.EPIC: return 'Epic';
    case ItemType.STORY: return 'Story';
    case ItemType.TASK: return 'Task';
    case ItemType.SUBTASK: return 'Subtask';
    case ItemType.BUG: return 'Bug';
    default: return type;
  }
};

const getItemTypeBadgeColor = (type: ItemType): string => {
  switch (type) {
    case ItemType.EPIC: return 'bg-purple-100 text-purple-700 border-purple-200';
    case ItemType.STORY: return 'bg-blue-100 text-blue-700 border-blue-200';
    case ItemType.TASK: return 'bg-green-100 text-green-700 border-green-200';
    case ItemType.SUBTASK: return 'bg-gray-100 text-gray-700 border-gray-200';
    default: return 'bg-gray-100 text-gray-700 border-gray-200';
  }
};

interface InlineCardCreatorProps {
  itemType: ItemType;
  projectId: string;
  parentId?: string | null;
  onCreated: (newItem: any) => void;
  onCancel: () => void;
  variant?: 'backlog-row' | 'hierarchy-card';
}

export default function InlineCardCreator({
  itemType,
  projectId,
  parentId,
  onCreated,
  onCancel,
  variant = 'hierarchy-card',
}: InlineCardCreatorProps) {
  const [title, setTitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isSubmitting = useRef(false);

  useEffect(() => {
    // Auto-focus on mount with a small delay for rendering
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  const handleCreate = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      onCancel();
      return;
    }

    if (isSubmitting.current) return;
    isSubmitting.current = true;
    setIsSaving(true);
    setError(null);

    try {
      const result = await tasksApi.create({
        project_id: projectId,
        title: trimmedTitle,
        item_type: itemType,
        parent_id: parentId || undefined,
        workflow_state: 'open',
      });
      onCreated(result);
    } catch (err) {
      console.error('Failed to create card:', err);
      setError('Failed to create. Press Enter to retry.');
      setIsSaving(false);
      isSubmitting.current = false;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCreate();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  const handleBlur = () => {
    if (isSaving) return;
    // Small delay to allow click events to fire first
    setTimeout(() => {
      if (isSubmitting.current || isSaving) return;
      if (title.trim()) {
        handleCreate();
      } else {
        onCancel();
      }
    }, 200);
  };

  const label = getItemTypeLabel(itemType);

  if (variant === 'backlog-row') {
    return (
      <div className="border-b-2 border-dashed border-blue-300 bg-blue-50/40">
        <div className="flex items-center gap-3 py-3 px-4">
          <div className="w-6" />
          <div className="flex items-center gap-2 min-w-[80px]">
            {getItemTypeIcon(itemType)}
            <span className={`px-2 py-0.5 text-xs font-medium rounded border ${getItemTypeBadgeColor(itemType)}`}>
              {label}
            </span>
          </div>
          {isSaving ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
              Creating...
            </div>
          ) : (
            <div className="flex-1">
              <input
                ref={inputRef}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleBlur}
                placeholder={`New ${label} title...`}
                className="w-full px-3 py-1.5 text-sm border border-blue-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
              />
              <div className="flex items-center gap-3 mt-1">
                <p className="text-xs text-gray-400">Enter to save, Esc to cancel</p>
                {error && <p className="text-xs text-red-500">{error}</p>}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // hierarchy-card variant
  return (
    <div className="border-2 border-dashed border-blue-300 rounded-lg p-4 bg-blue-50/30">
      <div className="flex items-center gap-2">
        <span className="flex items-center">{getItemTypeIcon(itemType)}</span>
        <span className={`px-2 py-0.5 text-xs font-medium rounded border ${getItemTypeBadgeColor(itemType)}`}>
          {label}
        </span>
        {isSaving ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
            Creating...
          </div>
        ) : (
          <div className="flex-1">
            <input
              ref={inputRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleBlur}
              placeholder={`New ${label} title...`}
              className="w-full px-3 py-1.5 text-sm border border-blue-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
            />
            <div className="flex items-center gap-3 mt-1">
              <p className="text-xs text-gray-400">Enter to save, Esc to cancel</p>
              {error && <p className="text-xs text-red-500">{error}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

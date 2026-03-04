/**
 * Hierarchy Tab Sub-Component
 * Extracted from ItemDetailPanel.tsx
 * Shows parent item and children list with generate/add buttons
 * PROMPT #127 - Generate children
 * PROMPT #176 - Persistent loading state during generation
 * PROMPT #187 - Manual child card creation with InlineCardCreator
 */

'use client';

import React from 'react';
import { Button } from '@/components/ui';
import InlineCardCreator from './InlineCardCreator'; // PROMPT #187
import { BacklogItem, ItemType, PriorityLevel } from '@/lib/types';

export interface HierarchyTabProps {
  item: BacklogItem;
  parent: BacklogItem | null;
  children: BacklogItem[];
  onNavigateToItem?: (item: BacklogItem) => void;
  isSuggestedItem: boolean;
  isGeneratingChildren: boolean;
  isAddingChild: boolean;
  setIsAddingChild: (val: boolean) => void;
  childType: ItemType | undefined;
  childTypeLabel: string | undefined;
  childrenCount: number;
  setChildrenCount: (val: number) => void;
  showGenerateChildrenDialog: boolean;
  setShowGenerateChildrenDialog: (val: boolean) => void;
  handleGenerateChildren: (count: number) => void;
  fetchItemDetails: () => void;
  onUpdate?: () => void;
  getItemTypeIcon: (type: ItemType) => React.ReactNode;
  getPriorityColor: (priority: PriorityLevel) => string;
}

export default function HierarchyTab({
  item,
  parent,
  children,
  onNavigateToItem,
  isSuggestedItem,
  isGeneratingChildren,
  isAddingChild,
  setIsAddingChild,
  childType,
  childTypeLabel,
  showGenerateChildrenDialog,
  setShowGenerateChildrenDialog,
  childrenCount,
  setChildrenCount,
  fetchItemDetails,
  onUpdate,
  getItemTypeIcon,
  getPriorityColor,
}: HierarchyTabProps) {
  return (
    <div className="space-y-6">
      {/* Parent */}
      {parent && (
        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Pai</h3>
          <div
            className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors"
            onClick={() => onNavigateToItem?.(parent)}
          >
            <div className="flex items-center gap-2">
              <span className="flex items-center text-gray-600">{getItemTypeIcon(parent.item_type)}</span>
              <span className="text-sm font-medium text-gray-900">{parent.title}</span>
            </div>
          </div>
        </div>
      )}

      {/* Children */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900">
            Filhos ({children.length})
          </h3>
          {/* PROMPT #187 - Add child + Generate children buttons */}
          {!isSuggestedItem && (
            <div className="flex items-center gap-2">
              {/* PROMPT #187 - Manual add child button */}
              {childType && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isAddingChild}
                  onClick={() => setIsAddingChild(true)}
                >
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Adicionar {childTypeLabel}
                </Button>
              )}
              {/* PROMPT #127 - Generate children button */}
              {/* PROMPT #176 - Persistent loading state during generation */}
              <Button
                size="sm"
                variant="primary"
                disabled={isGeneratingChildren}
                onClick={() => {
                  const defaults: Record<string, number> = { epic: 10, story: 8, task: 5 };
                  setChildrenCount(defaults[item.item_type] || 10);
                  setShowGenerateChildrenDialog(true);
                }}
              >
                {isGeneratingChildren ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-1"></div>
                    Gerando...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    {item.item_type === 'epic' ? 'Gerar Stories' :
                     item.item_type === 'story' ? 'Gerar Tasks' : 'Gerar'}
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
        {children.length === 0 && !isAddingChild ? (
          <p className="text-sm text-gray-500 italic">Nenhum item filho</p>
        ) : (
          <div className="space-y-2">
            {children.map((child) => (
              <div
                key={child.id}
                className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors"
                onClick={() => onNavigateToItem?.(child)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center text-gray-600">{getItemTypeIcon(child.item_type)}</span>
                    <span className="text-sm font-medium text-gray-900">{child.title}</span>
                  </div>
                  <span className={`px-2 py-0.5 text-xs font-medium rounded border ${getPriorityColor(child.priority)}`}>
                    {child.priority}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        {/* PROMPT #187 - Inline child card creator */}
        {isAddingChild && childType && (
          <div className="mt-2">
            <InlineCardCreator
              itemType={childType}
              projectId={item.project_id}
              parentId={item.id}
              onCreated={() => {
                setIsAddingChild(false);
                fetchItemDetails();
                if (onUpdate) onUpdate();
              }}
              onCancel={() => setIsAddingChild(false)}
              variant="hierarchy-card"
            />
          </div>
        )}
      </div>
    </div>
  );
}

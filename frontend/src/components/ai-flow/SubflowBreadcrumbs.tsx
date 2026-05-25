/**
 * SubflowBreadcrumbs — shows the navigation trail when the user "enters"
 * a subflow (double-click). Click any segment to pop back to it.
 *
 * v3.0
 */
'use client';

import React from 'react';
import { ChevronRight, Home } from 'lucide-react';
import type { Subflow } from '@/hooks/useCanvasState';

interface Props {
  subflowStack: string[];
  subflows: Record<string, Subflow>;
  onPopTo: (index: number) => void;  // index = -1 means root
}

export function SubflowBreadcrumbs({ subflowStack, subflows, onPopTo }: Props) {
  if (subflowStack.length === 0) return null;
  return (
    <div className="flex items-center gap-1 px-3 py-1.5 text-xs bg-cyan-50 border-b border-cyan-200">
      <button
        onClick={() => onPopTo(-1)}
        className="inline-flex items-center gap-1 text-cyan-700 hover:underline"
      >
        <Home className="w-3 h-3" />
        Canvas
      </button>
      {subflowStack.map((sfId, i) => (
        <React.Fragment key={sfId}>
          <ChevronRight className="w-3 h-3 text-cyan-400" />
          <button
            onClick={() => onPopTo(i)}
            className={`text-cyan-700 ${i < subflowStack.length - 1 ? 'hover:underline' : 'font-semibold cursor-default'}`}
            disabled={i === subflowStack.length - 1}
          >
            {subflows[sfId]?.label || sfId}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}

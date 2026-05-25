/**
 * CanvasTabBar — strip of tabs between the toolbar and the canvas.
 *
 * Tab "Canvas" is fixed (root view). Other tabs represent open subflows
 * (e.g. Discovery, Cards, Wiki, QA). Closeable via the × on each non-root tab.
 *
 * v3.1
 */
'use client';

import React from 'react';
import { X, Home, Layers } from 'lucide-react';
import type { CanvasTab } from '@/hooks/useCanvasState';

interface Props {
  tabs: CanvasTab[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  // Optional indicator: tabIds currently with an active execution (for animation)
  runningTabIds?: Set<string>;
}

export function CanvasTabBar({ tabs, activeTabId, onSelectTab, onCloseTab, runningTabIds }: Props) {
  return (
    <div className="flex items-center gap-1 px-3 py-1.5 border-b border-gray-200 bg-gray-50 overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const isRoot = tab.id === 'canvas';
        const isRunning = runningTabIds?.has(tab.id);
        return (
          <div
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            className={`group inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md cursor-pointer transition-colors ${
              isActive
                ? 'bg-white text-gray-900 border border-gray-200 shadow-sm font-medium'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {isRoot ? <Home className="w-3.5 h-3.5" /> : <Layers className="w-3.5 h-3.5 text-cyan-600" />}
            <span className="whitespace-nowrap">{tab.label}</span>
            {isRunning && (
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" title="executando" />
            )}
            {!isRoot && (
              <button
                onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
                className="ml-1 p-0.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200"
                title="Fechar aba"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

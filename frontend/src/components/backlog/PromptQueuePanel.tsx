'use client';

/**
 * PROMPT #215 - Prompt Queue Panel
 * Displays and manages the prompt orchestration priority queue for a project.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { promptQueueApi } from '@/lib/api';
import { PromptQueueItem } from '@/lib/types';

interface PromptQueuePanelProps {
  projectId: string;
}

// Item type icons
const TYPE_ICONS: Record<string, string> = {
  epic: '🎯',
  story: '📖',
  task: '✓',
  subtask: '◦',
  bug: '🐛',
};

// Priority colors
const PRIORITY_COLORS: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 border-red-200',
  high: 'bg-orange-100 text-orange-700 border-orange-200',
  medium: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  low: 'bg-blue-100 text-blue-700 border-blue-200',
  trivial: 'bg-gray-100 text-gray-600 border-gray-200',
};

// Status colors
const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700',
  ready: 'bg-blue-100 text-blue-700',
  executing: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  skipped: 'bg-gray-100 text-gray-500',
  blocked: 'bg-orange-100 text-orange-700',
};

export default function PromptQueuePanel({ projectId }: PromptQueuePanelProps) {
  const [items, setItems] = useState<PromptQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, pending: 0, ready: 0, executing: 0, completed: 0 });
  const [sortStrategy, setSortStrategy] = useState('balanced');
  const [sorting, setSorting] = useState(false);
  const [populating, setPopulating] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    try {
      const data = await promptQueueApi.get(projectId);
      setItems(data.items || []);
      setStats({
        total: data.total || 0,
        pending: data.pending_count || 0,
        ready: data.ready_count || 0,
        executing: data.executing_count || 0,
        completed: data.completed_count || 0,
      });
    } catch (err) {
      console.error('Failed to load queue:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const handleAutoSort = async () => {
    setSorting(true);
    try {
      await promptQueueApi.autoSort(projectId, sortStrategy);
      await loadQueue();
    } catch (err) {
      console.error('Failed to auto-sort:', err);
    } finally {
      setSorting(false);
    }
  };

  const handlePopulate = async () => {
    setPopulating(true);
    try {
      await promptQueueApi.populate(projectId);
      await loadQueue();
    } catch (err) {
      console.error('Failed to populate queue:', err);
    } finally {
      setPopulating(false);
    }
  };

  const handleRemove = async (itemId: string) => {
    try {
      await promptQueueApi.remove(projectId, itemId);
      await loadQueue();
    } catch (err) {
      console.error('Failed to remove item:', err);
    }
  };

  const handleClearCompleted = async () => {
    try {
      await promptQueueApi.clearCompleted(projectId);
      await loadQueue();
    } catch (err) {
      console.error('Failed to clear completed:', err);
    }
  };

  const handleSkip = async (itemId: string) => {
    try {
      await promptQueueApi.updateStatus(projectId, itemId, 'skipped');
      await loadQueue();
    } catch (err) {
      console.error('Failed to skip item:', err);
    }
  };

  // Drag and drop reorder
  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetId) return;

    const currentOrder = items.map(i => i.id);
    const fromIdx = currentOrder.indexOf(draggedId);
    const toIdx = currentOrder.indexOf(targetId);

    if (fromIdx === -1 || toIdx === -1) return;

    // Reorder array
    const newOrder = [...currentOrder];
    newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, draggedId);

    try {
      await promptQueueApi.reorder(projectId, newOrder);
      await loadQueue();
    } catch (err) {
      console.error('Failed to reorder:', err);
    }

    setDraggedId(null);
  };

  const getScoreBar = (score: number, max: number, color: string) => {
    const pct = Math.min((score / max) * 100, 100);
    return (
      <div className="w-12 h-1.5 bg-gray-200 rounded-full overflow-hidden" title={`${score}`}>
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
    );
  };

  const formatAge = (dateStr: string | null) => {
    if (!dateStr) return '';
    const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
    if (days === 0) return 'today';
    if (days === 1) return '1d';
    return `${days}d`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header stats */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-gray-900">Execution Queue</h3>
          <div className="flex gap-2">
            <Badge className="bg-gray-100 text-gray-700">{stats.total} total</Badge>
            {stats.pending > 0 && <Badge className="bg-gray-100 text-gray-600">{stats.pending} pending</Badge>}
            {stats.ready > 0 && <Badge className="bg-blue-100 text-blue-700">{stats.ready} ready</Badge>}
            {stats.executing > 0 && <Badge className="bg-yellow-100 text-yellow-700">{stats.executing} executing</Badge>}
            {stats.completed > 0 && <Badge className="bg-green-100 text-green-700">{stats.completed} done</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {stats.completed > 0 && (
            <Button variant="outline" size="sm" onClick={handleClearCompleted}>
              Clear Done
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handlePopulate} disabled={populating}>
            {populating ? 'Carregando...' : 'Popular'}
          </Button>
        </div>
      </div>

      {/* Sort controls */}
      <div className="flex items-center gap-3 bg-gray-50 p-3 rounded-lg">
        <span className="text-sm font-medium text-gray-700">Strategy:</span>
        <Select
          value={sortStrategy}
          onChange={(e) => setSortStrategy(e.target.value)}
          options={[
            { value: 'balanced', label: 'Balanced' },
            { value: 'hierarchy_first', label: 'Hierarchy First' },
            { value: 'priority_first', label: 'Priority First' },
            { value: 'dependency_first', label: 'Dependency First' },
            { value: 'age_first', label: 'Age First' },
          ]}
          className="w-44"
        />
        <Button variant="outline" size="sm" onClick={handleAutoSort} disabled={sorting}>
          {sorting ? 'Ordenando...' : 'Auto-Ordenar'}
        </Button>
        <div className="ml-auto flex items-center gap-4 text-[10px] text-gray-500">
          <span className="flex items-center gap-1">{getScoreBar(70, 100, 'bg-purple-400')} Hierarchy</span>
          <span className="flex items-center gap-1">{getScoreBar(70, 100, 'bg-orange-400')} Priority</span>
          <span className="flex items-center gap-1">{getScoreBar(70, 100, 'bg-blue-400')} Age</span>
          <span className="flex items-center gap-1">{getScoreBar(70, 100, 'bg-green-400')} Deps</span>
        </div>
      </div>

      {/* Queue items */}
      {items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-gray-500 mb-4">Queue is empty. Populate it with project cards.</p>
            <Button variant="primary" onClick={handlePopulate} disabled={populating}>
              {populating ? 'Populando...' : 'Popular a partir dos Cards'}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-1">
          {items.map((item, idx) => (
            <div
              key={item.id}
              draggable={item.status === 'pending' || item.status === 'ready' || item.status === 'blocked'}
              onDragStart={(e) => handleDragStart(e, item.id)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, item.id)}
              className={`
                flex items-center gap-3 px-4 py-2.5 rounded-lg border transition-all
                ${draggedId === item.id ? 'opacity-50 border-blue-400 bg-blue-50' : ''}
                ${item.status === 'completed' ? 'bg-green-50/50 border-green-200' : ''}
                ${item.status === 'failed' ? 'bg-red-50/50 border-red-200' : ''}
                ${item.status === 'executing' ? 'bg-yellow-50/50 border-yellow-200' : ''}
                ${item.status === 'skipped' ? 'opacity-50 border-gray-200' : ''}
                ${!['completed', 'failed', 'executing', 'skipped'].includes(item.status) ? 'bg-white border-gray-200 hover:border-blue-300 cursor-grab' : 'border-gray-200'}
              `}
            >
              {/* Position */}
              <span className="text-xs font-mono text-gray-400 w-6 text-right">{idx + 1}</span>

              {/* Drag handle */}
              <span className="text-gray-300 cursor-grab">⠿</span>

              {/* Type icon */}
              <span className="text-sm">{TYPE_ICONS[item.task_item_type || 'task'] || '•'}</span>

              {/* Title */}
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-gray-900 truncate block">
                  {item.task_title || 'Untitled'}
                </span>
              </div>

              {/* Score bars */}
              <div className="flex items-center gap-1">
                {getScoreBar(item.hierarchy_score, 100, 'bg-purple-400')}
                {getScoreBar(item.priority_score, 100, 'bg-orange-400')}
                {getScoreBar(item.age_score, 100, 'bg-blue-400')}
                {getScoreBar(item.dependency_score, 100, 'bg-green-400')}
              </div>

              {/* Priority badge */}
              {item.task_priority && (
                <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded border ${PRIORITY_COLORS[item.task_priority] || 'bg-gray-100 text-gray-600'}`}>
                  {item.task_priority}
                </span>
              )}

              {/* Age */}
              <span className="text-[10px] text-gray-400 w-8 text-right">
                {formatAge(item.task_created_at)}
              </span>

              {/* Manual override indicator */}
              {item.manual_override && (
                <span className="text-[10px] text-blue-500" title="Reordenado manualmente">✋</span>
              )}

              {/* Status badge */}
              <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${STATUS_COLORS[item.status] || 'bg-gray-100 text-gray-600'}`}>
                {item.status}
              </span>

              {/* Actions */}
              {(item.status === 'pending' || item.status === 'ready' || item.status === 'blocked') && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleSkip(item.id)}
                    className="p-1 text-gray-400 hover:text-yellow-600 transition-colors"
                    title="Pular"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleRemove(item.id)}
                    className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                    title="Remover da fila"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

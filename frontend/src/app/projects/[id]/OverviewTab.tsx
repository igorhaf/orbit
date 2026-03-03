'use client';

/**
 * OverviewTab - Overview/Settings Tab Component
 * Extracted from project detail page (PROMPT #232)
 * PROMPT #241 - Added "Configuracoes" subtab with ignore_paths management
 * Shows project description (with inline markdown editor), statistics, and settings sub-tabs
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { Card, CardHeader, CardTitle, CardContent, Button, AIModelBadge } from '@/components/ui';
import { Project, Task } from '@/lib/types';
import { projectsApi } from '@/lib/api';

type OverviewSubTab = 'description' | 'statistics' | 'settings';

interface TasksByStatus {
  backlog: Task[];
  todo: Task[];
  in_progress: Task[];
  review: Task[];
  done: Task[];
}

interface OverviewTabProps {
  project: Project;
  tasks: Task[];
  tasksByStatus: TasksByStatus;
  overviewSubTab: OverviewSubTab;
  setOverviewSubTab: (tab: OverviewSubTab) => void;
  onProjectUpdate?: (project: Project) => void;
  // Description editing
  isEditingDescription: boolean;
  editedDescription: string;
  setEditedDescription: (desc: string) => void;
  isFormattingDescription: boolean;
  isSavingDescription: boolean;
  descriptionEditorRef: React.Ref<HTMLDivElement>;
  textareaRef: React.Ref<HTMLTextAreaElement>;
  handleDescriptionDoubleClick: () => void;
  handleSaveDescription: () => void;
  handleCancelDescriptionEdit: () => void;
  // Markdown formatting helpers
  formatBold: () => void;
  formatItalic: () => void;
  formatCode: () => void;
  formatCodeBlock: () => void;
  formatHeading1: () => void;
  formatHeading2: () => void;
  formatHeading3: () => void;
  formatBulletList: () => void;
  formatNumberedList: () => void;
  formatLink: () => void;
  formatQuote: () => void;
  formatTable: () => void;
  // PROMPT #240 - AI auto-generate description
  generatingDescription?: boolean;
  onGenerateDescription?: () => void;
  // PROMPT #241 - Expand/Summarize description
  expandingDescription?: boolean;
  onExpandDescription?: () => void;
  summarizingDescription?: boolean;
  onSummarizeDescription?: () => void;
  // PROMPT #244 - Rephrase description
  rephrasingDescription?: boolean;
  onRephraseDescription?: () => void;
  // PROMPT #242/243 - Persist selection + visual highlight
  onPersistSelection?: (selectedText: string) => void;
  pinnedFragments?: string[];
  changedFragments?: string[];
  onUnpinFragment?: (fragment: string) => void;
}

/**
 * PROMPT #243 fix - Expands a partial selection to full word boundaries.
 * If the user selects "aconh" but the word is "maconha", returns "maconha".
 * Expands both the first and last word to their full forms in the source text.
 */
function expandToWordBoundaries(selectedText: string, sourceText: string): string {
  const trimmed = selectedText.trim();
  if (!trimmed || !sourceText) return trimmed;

  // Find the selected text in the source (case-sensitive first, then case-insensitive)
  let idx = sourceText.indexOf(trimmed);
  if (idx === -1) {
    // Try stripping markdown formatting from source for matching
    const plain = sourceText.replace(/[*_#`>\[\]()~|]/g, '');
    idx = plain.indexOf(trimmed);
    if (idx === -1) return trimmed; // Can't find it, return as-is
    // Use the plain text for boundary expansion
    return expandInText(trimmed, plain, idx);
  }
  return expandInText(trimmed, sourceText, idx);
}

function expandInText(selected: string, text: string, idx: number): string {
  const wordChar = /[^\s.,;:!?()[\]{}"'`\n\r\t—–-]/;

  // Expand start backwards to word boundary
  let start = idx;
  while (start > 0 && wordChar.test(text[start - 1])) {
    start--;
  }

  // Expand end forwards to word boundary
  let end = idx + selected.length;
  while (end < text.length && wordChar.test(text[end])) {
    end++;
  }

  return text.slice(start, end);
}

/**
 * PROMPT #243 - Creates a highlight span for a pinned fragment.
 */
function pinnedSpan(
  text: string,
  fragment: string,
  key: string | number,
  onUnpinFragment?: (fragment: string) => void,
  isChanged?: boolean,
): React.ReactNode {
  return (
    <span
      key={key}
      data-pinned="true"
      className={
        isChanged
          ? "bg-gray-900 text-white px-1 rounded cursor-pointer hover:bg-red-700 transition-colors ring-2 ring-amber-400 animate-pulse"
          : "bg-gray-900 text-white px-1 rounded cursor-pointer hover:bg-red-700 transition-colors"
      }
      title={isChanged ? "Trecho reformulado pela IA — clique para remover" : "Trecho fixado — clique para remover"}
      onClick={(e) => {
        e.stopPropagation();
        onUnpinFragment?.(fragment);
      }}
    >
      {text}
    </span>
  );
}

/**
 * PROMPT #243 - Extracts plain text from React children (flattening elements).
 */
function extractText(children: React.ReactNode): string {
  let result = '';
  React.Children.forEach(children, (child) => {
    if (typeof child === 'string') {
      result += child;
    } else if (typeof child === 'number') {
      result += String(child);
    } else if (React.isValidElement(child) && child.props.children) {
      result += extractText(child.props.children);
    }
  });
  return result;
}

/**
 * PROMPT #243 - Finds all pinned fragment match ranges in a flat text string.
 * Returns sorted, non-overlapping ranges [{start, end, fragment}].
 */
function findPinnedRanges(
  text: string,
  pinnedFragments: string[],
): Array<{ start: number; end: number; fragment: string }> {
  if (!pinnedFragments.length || !text) return [];

  const sorted = [...pinnedFragments].sort((a, b) => b.length - a.length);
  const ranges: Array<{ start: number; end: number; fragment: string }> = [];

  for (const frag of sorted) {
    let searchFrom = 0;
    while (true) {
      const idx = text.indexOf(frag, searchFrom);
      if (idx === -1) break;
      // Check no overlap with existing ranges
      const newEnd = idx + frag.length;
      const overlaps = ranges.some(r => idx < r.end && newEnd > r.start);
      if (!overlaps) {
        ranges.push({ start: idx, end: newEnd, fragment: frag });
      }
      searchFrom = idx + 1;
    }
  }

  ranges.sort((a, b) => a.start - b.start);
  return ranges;
}

/**
 * PROMPT #243 - Rebuilds React children with highlights injected across element boundaries.
 *
 * Strategy:
 * 1. Flatten children to plain text
 * 2. Find pinned fragment positions in the flat text
 * 3. Walk children tree, tracking current offset in flat text
 * 4. When a fragment range overlaps a child segment, split and wrap with highlight
 */
function renderChildrenWithHighlights(
  children: React.ReactNode,
  pinnedFragments: string[],
  onUnpinFragment?: (fragment: string) => void,
  changedFragments?: string[],
): React.ReactNode {
  if (!pinnedFragments.length) return children;

  const fullText = extractText(children);
  const ranges = findPinnedRanges(fullText, pinnedFragments);
  if (!ranges.length) return children;

  const changedSet = new Set(changedFragments || []);
  let keyCounter = 0;

  // Recursively process children, injecting highlights based on flat-text offset
  function processChildren(
    childNodes: React.ReactNode,
    offset: number, // current position in flat text
  ): { nodes: React.ReactNode[]; offset: number } {
    const result: React.ReactNode[] = [];

    React.Children.forEach(childNodes, (child) => {
      if (typeof child === 'string' || typeof child === 'number') {
        const text = String(child);
        const segStart = offset;
        const segEnd = offset + text.length;

        // Collect ranges that overlap this text segment
        const overlapping = ranges.filter(r => r.start < segEnd && r.end > segStart);

        if (!overlapping.length) {
          result.push(child);
          offset = segEnd;
          return;
        }

        // Split text according to highlight ranges
        let pos = 0; // position within this text segment
        for (const range of overlapping) {
          const hlStart = Math.max(range.start - segStart, 0);
          const hlEnd = Math.min(range.end - segStart, text.length);

          // Text before highlight
          if (hlStart > pos) {
            result.push(text.slice(pos, hlStart));
          }

          // Highlighted portion
          if (hlEnd > hlStart) {
            const isChanged = changedSet.has(range.fragment);
            result.push(
              pinnedSpan(text.slice(hlStart, hlEnd), range.fragment, `pin-${keyCounter++}`, onUnpinFragment, isChanged)
            );
          }

          pos = hlEnd;
        }

        // Remaining text after last highlight
        if (pos < text.length) {
          result.push(text.slice(pos));
        }

        offset = segEnd;
      } else if (React.isValidElement(child) && child.props.children != null) {
        // Recurse into element children (e.g. <strong>, <em>, <a>)
        const { nodes: innerNodes, offset: newOffset } = processChildren(
          child.props.children,
          offset,
        );
        result.push(React.cloneElement(child, { key: child.key ?? `el-${keyCounter++}` }, ...innerNodes));
        offset = newOffset;
      } else {
        // Pass through other elements (no children or non-element)
        result.push(child);
      }
    });

    return { nodes: result, offset };
  }

  const { nodes } = processChildren(children, 0);
  return nodes;
}

export default function OverviewTab({
  project,
  tasks,
  tasksByStatus,
  overviewSubTab,
  setOverviewSubTab,
  onProjectUpdate,
  isEditingDescription,
  editedDescription,
  setEditedDescription,
  isFormattingDescription,
  isSavingDescription,
  descriptionEditorRef,
  textareaRef,
  handleDescriptionDoubleClick,
  handleSaveDescription,
  handleCancelDescriptionEdit,
  formatBold,
  formatItalic,
  formatCode,
  formatCodeBlock,
  formatHeading1,
  formatHeading2,
  formatHeading3,
  formatBulletList,
  formatNumberedList,
  formatLink,
  formatQuote,
  formatTable,
  generatingDescription,
  onGenerateDescription,
  expandingDescription,
  onExpandDescription,
  summarizingDescription,
  onSummarizeDescription,
  rephrasingDescription,
  onRephraseDescription,
  onPersistSelection,
  pinnedFragments = [],
  changedFragments = [],
  onUnpinFragment,
}: OverviewTabProps) {
  // PROMPT #242/243 - Floating "Persistência" button that appears near the selection.
  // Uses a callback ref and direct DOM manipulation to avoid React re-renders that would
  // destroy the browser's native text selection (the root cause of the multi-pin bug).
  const descriptionDisplayRef = useRef<HTMLDivElement | null>(null);
  const selectedTextRef = useRef('');
  const floatingBtnRef = useRef<HTMLButtonElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  // Stable refs for values used inside DOM event handlers
  const onPersistSelectionRef = useRef(onPersistSelection);
  onPersistSelectionRef.current = onPersistSelection;
  const descriptionSourceRef = useRef(editedDescription || project.description || '');
  descriptionSourceRef.current = editedDescription || project.description || '';

  // Callback ref: sets up floating button + listeners whenever the div mounts/remounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const descriptionRefCallback = useCallback((el: HTMLDivElement | null) => {
    // Cleanup previous setup
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }

    descriptionDisplayRef.current = el;
    if (!el) return;

    // Create floating button (DOM-managed, outside React render cycle)
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>';
    btn.className = 'fixed z-50 flex items-center justify-center w-8 h-8 rounded-full shadow-lg border border-purple-300 bg-white text-purple-600 hover:bg-purple-100 hover:scale-110 transition-all cursor-pointer';
    btn.title = 'Persistir trecho selecionado';
    btn.style.display = 'none';
    document.body.appendChild(btn);
    floatingBtnRef.current = btn;

    const showBtn = (x: number, y: number) => {
      btn.style.display = 'flex';
      btn.style.left = `${x}px`;
      btn.style.top = `${y}px`;
    };
    const hideBtn = () => {
      btn.style.display = 'none';
      selectedTextRef.current = '';
    };

    const onMouseUp = () => {
      requestAnimationFrame(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !descriptionDisplayRef.current) {
          hideBtn();
          return;
        }
        const range = selection.getRangeAt(0);
        if (!descriptionDisplayRef.current.contains(range.commonAncestorContainer)) {
          hideBtn();
          return;
        }
        const raw = selection.toString().trim();
        if (!raw) { hideBtn(); return; }
        const source = descriptionSourceRef.current;
        const expanded = expandToWordBoundaries(raw, source);
        selectedTextRef.current = expanded;

        // Position button at the end of the selection
        const rect = range.getBoundingClientRect();
        showBtn(rect.right + 6, rect.top - 4);
      });
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.target === btn || btn.contains(e.target as Node)) return;
      if ((e.target as HTMLElement)?.closest?.('[data-pinned]')) return;
      hideBtn();
    };

    const onBtnMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const onBtnClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const text = selectedTextRef.current;
      if (!text) return;
      hideBtn();
      window.getSelection()?.removeAllRanges();
      onPersistSelectionRef.current?.(text);
    };

    btn.addEventListener('mousedown', onBtnMouseDown);
    btn.addEventListener('click', onBtnClick);
    el.addEventListener('mouseup', onMouseUp);
    el.addEventListener('mousedown', onMouseDown);

    const onDocMouseDown = (e: MouseEvent) => {
      if (!el.contains(e.target as Node) && e.target !== btn && !btn.contains(e.target as Node)) {
        hideBtn();
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);

    // Store cleanup function
    cleanupRef.current = () => {
      btn.removeEventListener('mousedown', onBtnMouseDown);
      btn.removeEventListener('click', onBtnClick);
      el.removeEventListener('mouseup', onMouseUp);
      el.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousedown', onDocMouseDown);
      btn.remove();
      floatingBtnRef.current = null;
    };
  }, []);

  // PROMPT #241 - Settings state for ignore_paths
  const [ignorePaths, setIgnorePaths] = useState<string[]>(project.ignore_paths || []);
  const [newIgnorePath, setNewIgnorePath] = useState('');
  const [isSavingIgnorePaths, setIsSavingIgnorePaths] = useState(false);
  const [ignorePathsSaved, setIgnorePathsSaved] = useState(false);

  // AI-detected patterns (read-only)
  const aiPatterns = project.initial_memory_context?.custom_ignore_patterns;
  const aiDirs: string[] = aiPatterns?.directories || [];

  const handleAddIgnorePath = () => {
    const path = newIgnorePath.trim();
    if (!path) return;
    // Ensure trailing slash for directories
    const normalized = path.endsWith('/') ? path : path + '/';
    if (ignorePaths.includes(normalized)) return;
    setIgnorePaths([...ignorePaths, normalized]);
    setNewIgnorePath('');
    setIgnorePathsSaved(false);
  };

  const handleRemoveIgnorePath = (path: string) => {
    setIgnorePaths(ignorePaths.filter(p => p !== path));
    setIgnorePathsSaved(false);
  };

  const handleSaveIgnorePaths = async () => {
    setIsSavingIgnorePaths(true);
    try {
      const updated = await projectsApi.update(project.id, { ignore_paths: ignorePaths });
      if (onProjectUpdate) onProjectUpdate(updated);
      setIgnorePathsSaved(true);
      setTimeout(() => setIgnorePathsSaved(false), 3000);
    } catch (err) {
      console.error('Failed to save ignore paths:', err);
    } finally {
      setIsSavingIgnorePaths(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Overview Sub-Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: 'description', label: 'Descrição do Projeto' },
            { id: 'statistics', label: 'Estatísticas' },
            { id: 'settings', label: 'Configurações' },
          ].map((sub) => (
            <button
              key={sub.id}
              onClick={() => setOverviewSubTab(sub.id as OverviewSubTab)}
              className={`
                pb-4 px-1 border-b-2 font-medium text-sm
                ${
                  overviewSubTab === sub.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }
              `}
            >
              {sub.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Sub-Tab: Project Description */}
      {overviewSubTab === 'description' && (
        <>
        {/* PROMPT #272 - Wiki stats moved to Wiki tab */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle>Descrição do Projeto</CardTitle>
              {/* PROMPT #240/241 - Description AI buttons */}
              {!isEditingDescription && (
                <>
                  {/* When description exists: expand (detalhar) + summarize (resumir) */}
                  {project.description && onExpandDescription && (
                    <button
                      type="button"
                      onClick={onExpandDescription}
                      disabled={expandingDescription || summarizingDescription || rephrasingDescription || generatingDescription}
                      title="Detalhar descrição (expandir com mais informações)"
                      className="flex items-center justify-center w-7 h-7 shrink-0 rounded-md border border-gray-300 bg-white text-gray-400 hover:bg-green-50 hover:text-green-600 hover:border-green-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      {expandingDescription ? (
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                        </svg>
                      )}
                    </button>
                  )}
                  {project.description && onSummarizeDescription && (
                    <button
                      type="button"
                      onClick={onSummarizeDescription}
                      disabled={expandingDescription || summarizingDescription || rephrasingDescription || generatingDescription}
                      title="Resumir descrição (condensar texto)"
                      className="flex items-center justify-center w-7 h-7 shrink-0 rounded-md border border-gray-300 bg-white text-gray-400 hover:bg-orange-50 hover:text-orange-600 hover:border-orange-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      {summarizingDescription ? (
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 16L14.5 20.5L9 16m11-8L14.5 3.5L9 8M4 12h16" />
                        </svg>
                      )}
                    </button>
                  )}
                  {/* PROMPT #244 - Rephrase (reformular) description */}
                  {project.description && onRephraseDescription && (
                    <button
                      type="button"
                      onClick={onRephraseDescription}
                      disabled={expandingDescription || summarizingDescription || rephrasingDescription || generatingDescription}
                      title="Reformular descrição (reescrever com outras palavras)"
                      className="flex items-center justify-center w-7 h-7 shrink-0 rounded-md border border-gray-300 bg-white text-gray-400 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      {rephrasingDescription ? (
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      )}
                    </button>
                  )}
                  {/* PROMPT #242/243 - Persist button is now a floating element managed via DOM */}
                  {/* When no description: generate from title */}
                  {!project.description && onGenerateDescription && (
                    <button
                      type="button"
                      onClick={onGenerateDescription}
                      disabled={generatingDescription}
                      title="Gerar descrição via IA a partir do título"
                      className="flex items-center justify-center w-7 h-7 shrink-0 rounded-md border border-gray-300 bg-white text-gray-400 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      {generatingDescription ? (
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                      )}
                    </button>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              {isFormattingDescription && (
                <span className="text-xs text-gray-500 italic">Formatando para Markdown...</span>
              )}
              {isSavingDescription && (
                <span className="text-xs text-gray-500 italic">Salvando...</span>
              )}
              {!isEditingDescription && (
                <span className="text-xs text-gray-400">Clique duplo para editar</span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {isEditingDescription ? (
              <div ref={descriptionEditorRef} className="border border-blue-300 rounded-lg overflow-hidden shadow-sm">
                {/* Markdown Toolbar */}
                <div className="flex flex-wrap items-center gap-1 p-2 bg-gray-50 border-b border-gray-200">
                  {/* Text Formatting */}
                  <div className="flex items-center gap-1 pr-2 border-r border-gray-300">
                    <button type="button" onClick={formatBold} className="p-1.5 rounded hover:bg-gray-200 text-gray-700 font-bold text-sm" title="Negrito (Ctrl+B)">B</button>
                    <button type="button" onClick={formatItalic} className="p-1.5 rounded hover:bg-gray-200 text-gray-700 italic text-sm" title="Itálico (Ctrl+I)">I</button>
                    <button type="button" onClick={formatCode} className="p-1.5 rounded hover:bg-gray-200 text-gray-700 font-mono text-sm" title="Código Inline">{'</>'}</button>
                  </div>
                  {/* Headings */}
                  <div className="flex items-center gap-1 pr-2 border-r border-gray-300">
                    <button type="button" onClick={formatHeading1} className="p-1.5 rounded hover:bg-gray-200 text-gray-700 text-sm font-bold" title="Título 1">H1</button>
                    <button type="button" onClick={formatHeading2} className="p-1.5 rounded hover:bg-gray-200 text-gray-700 text-sm font-bold" title="Título 2">H2</button>
                    <button type="button" onClick={formatHeading3} className="p-1.5 rounded hover:bg-gray-200 text-gray-700 text-sm font-bold" title="Título 3">H3</button>
                  </div>
                  {/* Lists */}
                  <div className="flex items-center gap-1 pr-2 border-r border-gray-300">
                    <button type="button" onClick={formatBulletList} className="p-1.5 rounded hover:bg-gray-200 text-gray-700 text-sm" title="Lista com Marcadores">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
                    </button>
                    <button type="button" onClick={formatNumberedList} className="p-1.5 rounded hover:bg-gray-200 text-gray-700 text-sm" title="Lista Numerada">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h10M7 16h10M3 8h.01M3 12h.01M3 16h.01" /></svg>
                    </button>
                  </div>
                  {/* Blocks */}
                  <div className="flex items-center gap-1 pr-2 border-r border-gray-300">
                    <button type="button" onClick={formatQuote} className="p-1.5 rounded hover:bg-gray-200 text-gray-700 text-sm" title="Citação">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                    </button>
                    <button type="button" onClick={formatCodeBlock} className="p-1.5 rounded hover:bg-gray-200 text-gray-700 text-sm font-mono" title="Bloco de Código">{'```'}</button>
                    <button type="button" onClick={formatTable} className="p-1.5 rounded hover:bg-gray-200 text-gray-700 text-sm" title="Tabela">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M9 10v8m6-8v8M3 6h18v12H3V6z" /></svg>
                    </button>
                  </div>
                  {/* Link */}
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={formatLink} className="p-1.5 rounded hover:bg-gray-200 text-gray-700 text-sm" title="Link">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                    </button>
                  </div>
                </div>

                {/* Textarea */}
                <textarea
                  ref={textareaRef}
                  value={editedDescription}
                  onChange={(e) => setEditedDescription(e.target.value)}
                  className="w-full p-4 min-h-[300px] text-sm text-gray-900 font-mono focus:outline-none resize-y"
                  placeholder="Digite a descrição usando Markdown..."
                  onKeyDown={(e) => {
                    if (e.ctrlKey && e.key === 'b') { e.preventDefault(); formatBold(); }
                    if (e.ctrlKey && e.key === 'i') { e.preventDefault(); formatItalic(); }
                    if (e.key === 'Escape') { e.preventDefault(); handleCancelDescriptionEdit(); }
                    if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); handleSaveDescription(); }
                  }}
                />

                {/* Action Buttons */}
                <div className="flex items-center justify-between p-3 bg-gray-50 border-t border-gray-200">
                  <span className="text-xs text-gray-500">
                    Markdown suportado | Ctrl+B negrito | Ctrl+I italico | Ctrl+Enter salvar | Esc cancelar
                  </span>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={handleCancelDescriptionEdit}>Cancelar</Button>
                    <Button variant="primary" size="sm" onClick={handleSaveDescription} disabled={isSavingDescription}>
                      {isSavingDescription ? 'Salvando...' : 'Salvar'}
                    </Button>
                  </div>
                </div>
              </div>
            ) : project.description ? (
              <div
                ref={descriptionRefCallback}
                className="prose prose-sm max-w-none cursor-pointer hover:bg-gray-50 rounded p-2 -m-2 transition-colors"
                onDoubleClick={handleDescriptionDoubleClick}
              >
                <ReactMarkdown
                  components={pinnedFragments.length > 0 ? {
                    // PROMPT #243 - Custom text renderer to highlight pinned fragments
                    p: ({ children, ...props }) => (
                      <p {...props}>{renderChildrenWithHighlights(children, pinnedFragments, onUnpinFragment, changedFragments)}</p>
                    ),
                    li: ({ children, ...props }) => (
                      <li {...props}>{renderChildrenWithHighlights(children, pinnedFragments, onUnpinFragment, changedFragments)}</li>
                    ),
                    strong: ({ children, ...props }) => (
                      <strong {...props}>{renderChildrenWithHighlights(children, pinnedFragments, onUnpinFragment, changedFragments)}</strong>
                    ),
                    em: ({ children, ...props }) => (
                      <em {...props}>{renderChildrenWithHighlights(children, pinnedFragments, onUnpinFragment, changedFragments)}</em>
                    ),
                  } : undefined}
                >
                  {editedDescription || project.description}
                </ReactMarkdown>
                <div className="mt-2 flex justify-end not-prose">
                  <AIModelBadge model="description-format" usage_type="general" decorative />
                </div>
              </div>
            ) : (
              <p
                className="text-gray-500 text-sm italic cursor-pointer hover:bg-gray-50 rounded p-2 -m-2 transition-colors"
                onDoubleClick={handleDescriptionDoubleClick}
              >
                Nenhuma descrição ainda. Clique duplo para adicionar uma.
              </p>
            )}
          </CardContent>
        </Card>
        </>
      )}

      {/* Sub-Tab: Statistics */}
      {overviewSubTab === 'statistics' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Statistics */}
          <Card>
            <CardHeader>
              <CardTitle>Estatísticas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-gray-500">Total de Tarefas</p>
                <p className="text-2xl font-bold text-gray-900">
                  {tasks.length}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Concluidas</p>
                <p className="text-2xl font-bold text-green-600">
                  {tasksByStatus.done.length}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Em Progresso</p>
                <p className="text-2xl font-bold text-blue-600">
                  {tasksByStatus.in_progress.length}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Pendentes</p>
                <p className="text-2xl font-bold text-gray-600">
                  {tasksByStatus.todo.length + tasksByStatus.backlog.length}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Progress */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Progresso por Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {Object.entries(tasksByStatus).map(([status, statusTasks]) => {
                const percentage = tasks.length
                  ? (statusTasks.length / tasks.length) * 100
                  : 0;

                return (
                  <div key={status}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium text-gray-700 capitalize">
                        {status.replace('_', ' ')}
                      </span>
                      <span className="text-gray-500">
                        {statusTasks.length} ({percentage.toFixed(0)}%)
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${
                          status === 'done'
                            ? 'bg-green-500'
                            : status === 'in_progress'
                            ? 'bg-blue-500'
                            : status === 'review'
                            ? 'bg-purple-500'
                            : 'bg-gray-400'
                        }`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Sub-Tab: Settings (PROMPT #241) */}
      {overviewSubTab === 'settings' && (
        <div className="space-y-6">
          {/* Ignore Paths */}
          <Card>
            <CardHeader>
              <CardTitle>Pastas Ignoradas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-gray-500">
                Pastas listadas aqui serao excluidas do scan de codebase, RAG e geracao de cards.
                Os caminhos sao relativos a raiz do projeto.
              </p>

              {/* Current ignore_paths (editable) */}
              {ignorePaths.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-gray-700 uppercase tracking-wide">Configurado pelo usuario</p>
                  {ignorePaths.map((path) => (
                    <div key={path} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                        <code className="text-sm text-gray-800">{path}</code>
                      </div>
                      <button
                        onClick={() => handleRemoveIgnorePath(path)}
                        className="text-red-400 hover:text-red-600 p-1"
                        title="Remover"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* AI-detected patterns (read-only) */}
              {aiDirs.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-gray-700 uppercase tracking-wide">Detectado pela IA (somente leitura)</p>
                  {aiDirs.map((dir) => (
                    <div key={dir} className="flex items-center bg-blue-50 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        <code className="text-sm text-blue-800">{dir}</code>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {ignorePaths.length === 0 && aiDirs.length === 0 && (
                <p className="text-sm text-gray-400 italic">Nenhuma pasta ignorada configurada.</p>
              )}

              {/* Add new path */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newIgnorePath}
                  onChange={(e) => setNewIgnorePath(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddIgnorePath(); } }}
                  placeholder="Ex: vendor/, node_modules/custom/"
                  className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <Button variant="ghost" size="sm" onClick={handleAddIgnorePath} disabled={!newIgnorePath.trim()}>
                  Adicionar
                </Button>
              </div>

              {/* Save button */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
                {ignorePathsSaved && (
                  <span className="text-sm text-green-600">Salvo com sucesso!</span>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSaveIgnorePaths}
                  disabled={isSavingIgnorePaths}
                >
                  {isSavingIgnorePaths ? 'Salvando...' : 'Salvar'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Project Info (read-only) */}
          <Card>
            <CardHeader>
              <CardTitle>Informações do Projeto</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Caminho do Código</p>
                <code className="text-sm text-gray-800">{project.code_path}</code>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Status</p>
                <span className={`text-sm font-medium ${project.status === 'active' ? 'text-green-600' : 'text-gray-600'}`}>
                  {project.status === 'active' ? 'Ativo' : project.status === 'processing' ? 'Processando' : 'Rascunho'}
                </span>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Contexto Travado</p>
                <span className="text-sm text-gray-800">{project.context_locked ? 'Sim' : 'Nao'}</span>
              </div>
              {project.protected && (
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Protegido</p>
                  <span className="text-sm text-green-600">Sim - Protegido contra exclusao</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

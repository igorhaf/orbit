/**
 * MarkdownEditor — Reusable markdown editor with toolbar + keyboard shortcuts.
 * Extracted from the OverviewTab description editor pattern (PROMPT #248).
 *
 * Toolbar: Bold | Italic | Code | H1 | H2 | H3 | BulletList | NumberedList | Quote | CodeBlock | Table | Link
 * Shortcuts: Ctrl+B bold, Ctrl+I italic, Ctrl+Enter save, Esc cancel
 */

'use client';

import React, { useRef, useCallback } from 'react';

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: string;
  onSave?: () => void;
  onCancel?: () => void;
  showStatusBar?: boolean;
  autoFocus?: boolean;
  className?: string;
}

export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
  value,
  onChange,
  placeholder = 'Digite usando Markdown...',
  minHeight = '300px',
  onSave,
  onCancel,
  showStatusBar = true,
  autoFocus = false,
  className,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertMarkdown = useCallback((before: string, after: string = '') => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = value.substring(start, end);
    const newText = value.substring(0, start) + before + selectedText + after + value.substring(end);

    onChange(newText);

    setTimeout(() => {
      textarea.focus();
      const newCursorPos = start + before.length + selectedText.length + after.length;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  }, [value, onChange]);

  const formatBold = () => insertMarkdown('**', '**');
  const formatItalic = () => insertMarkdown('*', '*');
  const formatCode = () => insertMarkdown('`', '`');
  const formatCodeBlock = () => insertMarkdown('\n```\n', '\n```\n');
  const formatHeading1 = () => insertMarkdown('# ');
  const formatHeading2 = () => insertMarkdown('## ');
  const formatHeading3 = () => insertMarkdown('### ');
  const formatBulletList = () => insertMarkdown('- ');
  const formatNumberedList = () => insertMarkdown('1. ');
  const formatLink = () => insertMarkdown('[', '](url)');
  const formatQuote = () => insertMarkdown('> ');
  const formatTable = () => insertMarkdown('\n| Header 1 | Header 2 |\n|----------|----------|\n| Cell 1 | Cell 2 |\n');

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.ctrlKey && e.key === 'b') { e.preventDefault(); formatBold(); }
    if (e.ctrlKey && e.key === 'i') { e.preventDefault(); formatItalic(); }
    if (e.ctrlKey && e.key === 'Enter' && onSave) { e.preventDefault(); onSave(); }
    if (e.key === 'Escape' && onCancel) {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <div className={`border border-blue-300 rounded-lg overflow-hidden shadow-sm ${className || ''}`}>
      {/* Markdown Toolbar */}
      <div className="flex flex-wrap items-center gap-1 p-2 bg-gray-50 border-b border-gray-200">
        {/* Text Formatting */}
        <div className="flex items-center gap-1 pr-2 border-r border-gray-300">
          <button type="button" onClick={formatBold} className="p-1.5 rounded hover:bg-gray-200 text-gray-700 font-bold text-sm" title="Negrito (Ctrl+B)">B</button>
          <button type="button" onClick={formatItalic} className="p-1.5 rounded hover:bg-gray-200 text-gray-700 italic text-sm" title="Italico (Ctrl+I)">I</button>
          <button type="button" onClick={formatCode} className="p-1.5 rounded hover:bg-gray-200 text-gray-700 font-mono text-sm" title="Codigo Inline">{'</>'}</button>
        </div>
        {/* Headings */}
        <div className="flex items-center gap-1 pr-2 border-r border-gray-300">
          <button type="button" onClick={formatHeading1} className="p-1.5 rounded hover:bg-gray-200 text-gray-700 text-sm font-bold" title="Titulo 1">H1</button>
          <button type="button" onClick={formatHeading2} className="p-1.5 rounded hover:bg-gray-200 text-gray-700 text-sm font-bold" title="Titulo 2">H2</button>
          <button type="button" onClick={formatHeading3} className="p-1.5 rounded hover:bg-gray-200 text-gray-700 text-sm font-bold" title="Titulo 3">H3</button>
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
          <button type="button" onClick={formatQuote} className="p-1.5 rounded hover:bg-gray-200 text-gray-700 text-sm" title="Citacao">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
          </button>
          <button type="button" onClick={formatCodeBlock} className="p-1.5 rounded hover:bg-gray-200 text-gray-700 text-sm font-mono" title="Bloco de Codigo">{'```'}</button>
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
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full p-4 text-sm text-gray-900 font-mono focus:outline-none resize-y"
        style={{ minHeight }}
        placeholder={placeholder}
        onKeyDown={handleKeyDown}
        autoFocus={autoFocus}
      />

      {/* Status Bar */}
      {showStatusBar && (
        <div className="px-3 py-2 bg-gray-50 border-t border-gray-200">
          <span className="text-xs text-gray-500">
            Markdown suportado | Ctrl+B negrito | Ctrl+I italico{onSave ? ' | Ctrl+Enter salvar' : ''}{onCancel ? ' | Esc cancelar' : ''}
          </span>
        </div>
      )}
    </div>
  );
};

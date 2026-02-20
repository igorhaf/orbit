'use client';

/**
 * OverviewTab - Overview/Settings Tab Component
 * Extracted from project detail page (PROMPT #232)
 * Shows project description (with inline markdown editor) and statistics sub-tabs
 */

import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Card, CardHeader, CardTitle, CardContent, Button, AIModelBadge } from '@/components/ui';
import { Project, Task } from '@/lib/types';

type OverviewSubTab = 'description' | 'statistics';

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
}

export default function OverviewTab({
  project,
  tasks,
  tasksByStatus,
  overviewSubTab,
  setOverviewSubTab,
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
}: OverviewTabProps) {
  return (
    <div className="space-y-6">
      {/* Overview Sub-Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: 'description', label: 'Descrição do Projeto' },
            { id: 'statistics', label: 'Estatisticas' },
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
            <CardTitle>Descrição do Projeto</CardTitle>
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
                    Markdown suportado | Ctrl+B negrito | Ctrl+I itálico | Ctrl+Enter salvar | Esc cancelar
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
                className="prose prose-sm max-w-none cursor-pointer hover:bg-gray-50 rounded p-2 -m-2 transition-colors"
                onDoubleClick={handleDescriptionDoubleClick}
              >
                <ReactMarkdown>
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
              <CardTitle>Estatisticas</CardTitle>
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
    </div>
  );
}

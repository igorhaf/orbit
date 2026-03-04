/**
 * Wiki Panel Component
 * PROMPT #272 - Wiki as project tab instead of separate page
 * PROMPT #247 - Redesign: UI consistency + per-page AI operations
 * PROMPT #248 - Rich editor with markdown toolbar + AI create flow
 * PROMPT #249 - Inline creation flow (no dialog), sidebar sync, duplicate titles
 *
 * Embeddable wiki viewer with sidebar navigation, page detail, and AI generation.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, Button, Dialog, DialogFooter, MarkdownEditor } from '@/components/ui';
import { wikiApi, knowledgeApi, ragApi } from '@/lib/api';
import { useNotification, useJobPolling } from '@/hooks';
import ReactMarkdown from 'react-markdown';

interface WikiTreeItem {
  id: string;
  slug: string;
  title: string;
  parent_id: string | null;
  order_index: number;
  source: string;
  children: WikiTreeItem[];
}

interface WikiPage {
  id: string;
  project_id: string;
  slug: string;
  title: string;
  content: string;
  parent_id: string | null;
  order_index: number;
  source: string;
  created_at: string;
  updated_at: string;
}

interface WikiPanelProps {
  projectId: string;
}

export default function WikiPanel({ projectId }: WikiPanelProps) {
  const { showSuccess, showError, NotificationComponent } = useNotification();

  const [tree, setTree] = useState<WikiTreeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  // Selected page state
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [selectedPage, setSelectedPage] = useState<WikiPage | null>(null);
  const [loadingPage, setLoadingPage] = useState(false);

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [saving, setSaving] = useState(false);

  // Inline creation mode — page exists in backend but user is filling title/content
  const [isCreating, setIsCreating] = useState(false);

  // Delete dialog
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Wiki Knowledge stats
  const [wikiStats, setWikiStats] = useState<{
    business_rules_count: number;
    interview_answers_count: number;
    code_files_count: number;
    total_documents: number;
  } | null>(null);
  const [isEnriching, setIsEnriching] = useState(false);

  // AI per-page state
  const [aiAction, setAiAction] = useState<string | null>(null);
  const [aiJobId, setAiJobId] = useState<string | null>(null);

  // Job polling for AI operations
  useJobPolling(aiJobId, {
    enabled: !!aiJobId,
    onComplete: (result: any) => {
      const actionLabel = aiAction === 'generate' ? 'gerado' : aiAction === 'expand' ? 'expandido' : aiAction === 'summarize' ? 'resumido' : 'reformulado';
      showSuccess(`Conteudo ${actionLabel} com sucesso`);
      setAiAction(null);
      setAiJobId(null);
      // Reload page
      if (selectedSlug) {
        reloadPage(selectedSlug);
      }
    },
    onError: (error: string) => {
      showError(error || 'Falha na operacao de IA');
      setAiAction(null);
      setAiJobId(null);
    },
  });

  const reloadPage = async (slug: string) => {
    try {
      const pageData = await wikiApi.get(projectId, slug);
      setSelectedPage(pageData);
      setEditContent(pageData.content);
      setEditTitle(pageData.title);
      loadTree();
    } catch {
      // ignore
    }
  };

  const loadTree = useCallback(async () => {
    setLoading(true);
    try {
      const wikiTree = await wikiApi.tree(projectId);
      setTree(wikiTree);
    } catch (error) {
      console.error('Failed to load wiki tree:', error);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  // Load wiki knowledge stats + enrichment status
  useEffect(() => {
    const loadStats = async () => {
      try {
        const [stats, enrichStatus] = await Promise.all([
          knowledgeApi.getFullStats(projectId),
          ragApi.enrichmentStatus(projectId),
        ]);
        setWikiStats(stats);
        setIsEnriching(enrichStatus.is_enriching);
      } catch {
        // Stats are decorative, ignore errors
      }
    };

    loadStats();

    if (isEnriching) {
      const interval = setInterval(loadStats, 15000);
      return () => clearInterval(interval);
    }
  }, [projectId, isEnriching]);

  // Load page content when slug changes
  useEffect(() => {
    if (!selectedSlug) {
      setSelectedPage(null);
      return;
    }

    const loadPage = async () => {
      setLoadingPage(true);
      try {
        const pageData = await wikiApi.get(projectId, selectedSlug);
        setSelectedPage(pageData);
        setEditContent(pageData.content);
        setEditTitle(pageData.title);
      } catch (error) {
        console.error('Failed to load wiki page:', error);
        showError('Pagina nao encontrada');
        setSelectedSlug(null);
      } finally {
        setLoadingPage(false);
      }
    };

    loadPage();
  }, [projectId, selectedSlug, showError]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await wikiApi.generateFromContext(projectId);
      showSuccess(`${res.detail}`);
      loadTree();
    } catch (error: any) {
      showError(error.message || 'Falha ao gerar wiki');
    } finally {
      setGenerating(false);
    }
  };

  const makeSlug = (title: string) =>
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();

  // Collect all titles from tree (flat)
  const collectTitles = (items: WikiTreeItem[]): string[] => {
    const titles: string[] = [];
    for (const item of items) {
      titles.push(item.title);
      if (item.children) titles.push(...collectTitles(item.children));
    }
    return titles;
  };

  // Generate a unique title with incremental suffix
  const getUniqueTitle = (baseTitle: string): string => {
    const existingTitles = collectTitles(tree);
    if (!existingTitles.includes(baseTitle)) return baseTitle;
    let counter = 2;
    while (existingTitles.includes(`${baseTitle} (${counter})`)) {
      counter++;
    }
    return `${baseTitle} (${counter})`;
  };

  // Create a new page inline (no dialog)
  const handleCreateInline = async () => {
    const title = getUniqueTitle('Nova Pagina');
    const slug = makeSlug(title);
    try {
      await wikiApi.create(projectId, {
        title,
        slug,
        content: '',
        source: 'manual',
      });
      await loadTree();
      setSelectedSlug(slug);
      setIsCreating(true);
      setEditing(true);
      setEditTitle(title);
      setEditContent('');
    } catch (error: any) {
      showError(error.message || 'Falha ao criar pagina');
    }
  };

  const handleSave = async () => {
    if (!selectedPage) return;
    setSaving(true);
    try {
      const updates: any = {};
      if (editTitle !== selectedPage.title) updates.title = editTitle;
      if (editContent !== selectedPage.content) updates.content = editContent;

      await wikiApi.update(projectId, selectedSlug!, updates);
      showSuccess('Pagina salva');
      setEditing(false);
      setIsCreating(false);
      const pageData = await wikiApi.get(projectId, selectedSlug!);
      setSelectedPage(pageData);
      setEditContent(pageData.content);
      setEditTitle(pageData.title);
      loadTree();
    } catch (error: any) {
      showError(error.message || 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedPage) return;
    try {
      await wikiApi.delete(projectId, selectedSlug!);
      showSuccess('Pagina excluida');
      setSelectedSlug(null);
      setSelectedPage(null);
      setShowDeleteDialog(false);
      setIsCreating(false);
      loadTree();
    } catch (error: any) {
      showError(error.message || 'Falha ao excluir');
    }
  };

  // Cancel creation — delete the newly created page
  const handleCancelCreate = async () => {
    if (selectedPage && isCreating) {
      try {
        await wikiApi.delete(projectId, selectedSlug!);
      } catch {
        // ignore
      }
    }
    setEditing(false);
    setIsCreating(false);
    setSelectedSlug(null);
    setSelectedPage(null);
    loadTree();
  };

  // AI actions
  const handleAiAction = async (action: 'generate' | 'expand' | 'summarize' | 'rephrase') => {
    if (!selectedSlug || aiJobId) return;
    // If creating, save first so AI has the latest content
    if (isCreating && editTitle.trim()) {
      await handleSave();
    }
    setAiAction(action);
    try {
      const apiMethod = {
        generate: wikiApi.generateContent,
        expand: wikiApi.expandContent,
        summarize: wikiApi.summarizeContent,
        rephrase: wikiApi.rephraseContent,
      }[action];
      const result = await apiMethod(projectId, selectedSlug);
      setAiJobId(result.job_id);
    } catch (error: any) {
      showError(error.message || 'Falha ao iniciar operacao de IA');
      setAiAction(null);
    }
  };

  const isAiProcessing = !!aiJobId;

  // Source badge
  const sourceBadge = (source: string) => {
    if (source === 'ai_generated') return <span className="px-1.5 py-0.5 rounded-full text-xs bg-purple-100 text-purple-700">AI</span>;
    if (source === 'enrichment') return <span className="px-1.5 py-0.5 rounded-full text-xs bg-green-100 text-green-700">Atualizado</span>;
    if (source === 'manual') return <span className="px-1.5 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700">Manual</span>;
    return null;
  };

  // Spinner SVG
  const spinnerSvg = (size = 'w-3.5 h-3.5') => (
    <svg className={`${size} animate-spin`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );

  const renderSidebarItem = (item: WikiTreeItem, depth = 0) => {
    const isActive = item.slug === selectedSlug;
    // During creation, show the editing title for the active item, grey out others
    const displayTitle = isActive && isCreating ? (editTitle || 'Nova Pagina') : item.title;
    const isDisabled = isCreating && !isActive;

    return (
      <div key={item.id}>
        <button
          onClick={() => {
            if (isDisabled) return;
            setEditing(false);
            setIsCreating(false);
            setSelectedSlug(item.slug);
          }}
          disabled={isDisabled}
          style={{ paddingLeft: `${0.5 + depth * 0.75}rem`, paddingRight: '0.5rem' }}
          className={`w-full text-left py-2 rounded text-sm transition-colors ${
            isActive
              ? 'bg-blue-50 text-blue-700 font-medium'
              : isDisabled
                ? 'text-gray-300 cursor-not-allowed'
                : 'text-gray-700 hover:bg-gray-50'
          }`}
        >
          <span className="truncate block">{displayTitle}</span>
        </button>
        {item.children && item.children.length > 0 && (
          <div>{item.children.map((child) => renderSidebarItem(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // Empty state
  if (tree.length === 0 && !isCreating) {
    return (
      <div className="space-y-6">
        {NotificationComponent}
        <Card className="p-8 text-center">
          <div className="text-gray-400 mb-3">
            <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">Wiki Vazia</h3>
          <p className="text-gray-500 mb-6 max-w-md mx-auto text-sm">
            Crie paginas manualmente ou gere automaticamente a partir do contexto do projeto.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button variant="outline" onClick={handleGenerate} disabled={generating}>
              {generating ? 'Gerando...' : 'Gerar do Contexto'}
            </Button>
            <Button variant="primary" onClick={handleCreateInline}>
              Nova Pagina
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // Render stats bar
  function renderStatsBar() {
    if (!wikiStats || wikiStats.total_documents === 0) return null;
    return (
      <div className="flex items-center gap-4 px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600">
        <span className="font-medium text-gray-700">Conhecimento Wiki:</span>
        <span>{wikiStats.business_rules_count} regras extraidas</span>
        <span className="text-gray-300">|</span>
        <span>{wikiStats.interview_answers_count} respostas de entrevista</span>
        <span className="text-gray-300">|</span>
        <span>{wikiStats.code_files_count} arquivos escaneados</span>
      </div>
    );
  }

  // Count total pages in tree (including children)
  const countPages = (items: WikiTreeItem[]): number => {
    return items.reduce((sum, item) => sum + 1 + (item.children ? countPages(item.children) : 0), 0);
  };
  const totalPages = countPages(tree);

  // Main wiki view with sidebar + content
  return (
    <div className="space-y-4">
      {NotificationComponent}

      {/* Wiki Knowledge stats bar */}
      {renderStatsBar()}

      {/* Header with actions */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">
          {totalPages} pagina{totalPages !== 1 ? 's' : ''}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleGenerate} disabled={generating || isCreating}>
            {generating ? 'Gerando...' : 'Gerar do Contexto'}
          </Button>
          <Button variant="primary" size="sm" onClick={handleCreateInline} disabled={isCreating}>
            Nova Pagina
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar tree */}
        <div className="lg:col-span-1">
          <div className="sticky top-4">
            <Card className="p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Paginas</h3>
              <div className="space-y-1">
                {tree.map((item) => renderSidebarItem(item))}
              </div>
            </Card>
          </div>
        </div>

        {/* Content area */}
        <div className="lg:col-span-3">
          {!selectedSlug ? (
            // Grid of page cards when no page selected
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {tree.map((page) => (
                <Card
                  key={page.id}
                  className="p-4 cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => setSelectedSlug(page.slug)}
                >
                  <div className="flex items-start justify-between mb-1">
                    <h3 className="font-medium text-gray-900 text-sm">{page.title}</h3>
                    {sourceBadge(page.source)}
                  </div>
                  {page.children && page.children.length > 0 && (
                    <p className="text-xs text-gray-400">{page.children.length} sub-paginas</p>
                  )}
                </Card>
              ))}
            </div>
          ) : loadingPage ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : selectedPage ? (
            // Page detail view
            <div>
              {/* Page header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {!isCreating && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setSelectedSlug(null); setEditing(false); }}
                      title="Voltar"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </Button>
                  )}
                  {editing ? (
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder="Titulo da pagina..."
                      className="text-xl font-bold text-gray-900 border-b-2 border-blue-500 focus:outline-none bg-transparent flex-1 min-w-0"
                      autoFocus={isCreating}
                    />
                  ) : (
                    <h2 className="text-xl font-bold text-gray-900">{selectedPage.title}</h2>
                  )}
                  {!isCreating && sourceBadge(selectedPage.source)}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {/* AI action buttons - shown when not editing (or during creation for generate) */}
                  {(!editing || isCreating) && (
                    <>
                      {/* Generate */}
                      <button
                        type="button"
                        onClick={() => handleAiAction('generate')}
                        disabled={isAiProcessing}
                        title="Gerar conteudo via IA"
                        className="flex items-center justify-center w-7 h-7 shrink-0 rounded-md border border-gray-300 bg-white text-gray-400 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        {aiAction === 'generate' ? spinnerSvg() : (
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                        )}
                      </button>
                      {/* Expand */}
                      {selectedPage.content && selectedPage.content.length > 10 && !isCreating && (
                        <button
                          type="button"
                          onClick={() => handleAiAction('expand')}
                          disabled={isAiProcessing}
                          title="Expandir conteudo (adicionar mais detalhes)"
                          className="flex items-center justify-center w-7 h-7 shrink-0 rounded-md border border-gray-300 bg-white text-gray-400 hover:bg-green-50 hover:text-green-600 hover:border-green-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          {aiAction === 'expand' ? spinnerSvg() : (
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                            </svg>
                          )}
                        </button>
                      )}
                      {/* Summarize */}
                      {selectedPage.content && selectedPage.content.length > 10 && !isCreating && (
                        <button
                          type="button"
                          onClick={() => handleAiAction('summarize')}
                          disabled={isAiProcessing}
                          title="Resumir conteudo (condensar texto)"
                          className="flex items-center justify-center w-7 h-7 shrink-0 rounded-md border border-gray-300 bg-white text-gray-400 hover:bg-orange-50 hover:text-orange-600 hover:border-orange-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          {aiAction === 'summarize' ? spinnerSvg() : (
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 16L14.5 20.5L9 16m11-8L14.5 3.5L9 8M4 12h16" />
                            </svg>
                          )}
                        </button>
                      )}
                      {/* Rephrase */}
                      {selectedPage.content && selectedPage.content.length > 10 && !isCreating && (
                        <button
                          type="button"
                          onClick={() => handleAiAction('rephrase')}
                          disabled={isAiProcessing}
                          title="Reformular conteudo (reescrever com outras palavras)"
                          className="flex items-center justify-center w-7 h-7 shrink-0 rounded-md border border-gray-300 bg-white text-gray-400 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          {aiAction === 'rephrase' ? spinnerSvg() : (
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                          )}
                        </button>
                      )}

                      <div className="w-px h-5 bg-gray-200 mx-1" />
                    </>
                  )}

                  {editing ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={isCreating ? handleCancelCreate : () => { setEditing(false); setEditContent(selectedPage.content); setEditTitle(selectedPage.title); }}
                        disabled={saving}
                      >
                        Cancelar
                      </Button>
                      <Button variant="primary" size="sm" onClick={handleSave} disabled={saving || !editTitle.trim()}>
                        {saving ? 'Salvando...' : 'Salvar'}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                        Editar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowDeleteDialog(true)}
                        className="text-gray-400 hover:text-red-600 hover:bg-red-50"
                        title="Excluir pagina"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {/* Page metadata */}
              {!isCreating && (
                <div className="text-xs text-gray-400 mb-3 flex items-center gap-4">
                  <span>Atualizado {new Date(selectedPage.updated_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  <span>/{selectedPage.slug}</span>
                  {!editing && <span className="text-gray-300">Clique duplo para editar</span>}
                </div>
              )}

              {/* AI processing indicator */}
              {isAiProcessing && (
                <div className="flex items-center gap-2 px-4 py-2 mb-3 bg-purple-50 border border-purple-200 rounded-lg text-sm text-purple-700">
                  {spinnerSvg('w-4 h-4')}
                  <span>
                    {aiAction === 'generate' ? 'Gerando conteudo...' :
                     aiAction === 'expand' ? 'Expandindo conteudo...' :
                     aiAction === 'summarize' ? 'Resumindo conteudo...' :
                     'Reformulando conteudo...'}
                  </span>
                </div>
              )}

              {/* Content */}
              <Card className="p-5">
                {editing ? (
                  <MarkdownEditor
                    value={editContent}
                    onChange={setEditContent}
                    placeholder={isCreating ? 'Escreva o conteudo da pagina ou use o botao de IA para gerar automaticamente...' : 'Conteudo Markdown...'}
                    minHeight={isCreating ? '300px' : '400px'}
                    onSave={handleSave}
                    onCancel={isCreating ? handleCancelCreate : () => {
                      setEditing(false);
                      setEditContent(selectedPage.content);
                      setEditTitle(selectedPage.title);
                    }}
                  />
                ) : selectedPage.content ? (
                  <div
                    className="prose prose-sm max-w-none cursor-pointer hover:bg-gray-50 rounded p-2 -m-2 transition-colors"
                    onDoubleClick={() => setEditing(true)}
                  >
                    <ReactMarkdown
                      urlTransform={(url) => url}
                      components={{
                        a: ({ href, children, node, ...rest }) => {
                          // Internal wiki links: wiki:slug or plain slug
                          let targetSlug: string | null = null;
                          if (href && href.startsWith('wiki:')) {
                            targetSlug = href.replace('wiki:', '');
                          } else if (href && !href.startsWith('http') && !href.startsWith('mailto:') && !href.startsWith('/') && !href.startsWith('#')) {
                            targetSlug = href;
                          }
                          if (targetSlug) {
                            return (
                              <span
                                role="link"
                                tabIndex={0}
                                className="text-blue-600 hover:text-blue-800 underline cursor-pointer"
                                onClick={() => {
                                  setEditing(false);
                                  setSelectedSlug(targetSlug);
                                }}
                                onKeyDown={(e) => { if (e.key === 'Enter') { setEditing(false); setSelectedSlug(targetSlug); } }}
                              >
                                {children}
                              </span>
                            );
                          }
                          return <a href={href} className="text-blue-600 hover:text-blue-800 underline" target="_blank" rel="noopener noreferrer" {...rest}>{children}</a>;
                        },
                        code: ({ children, className, ...props }) => {
                          const isInline = !className;
                          if (isInline) {
                            return <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono text-pink-600" {...props}>{children}</code>;
                          }
                          return <code className={className} {...props}>{children}</code>;
                        },
                      }}
                    >
                      {selectedPage.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div
                    className="text-sm text-gray-400 italic py-8 text-center border-2 border-dashed border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                    onDoubleClick={() => setEditing(true)}
                  >
                    Nenhum conteudo ainda. Clique duplo para adicionar ou use o botao de IA para gerar.
                  </div>
                )}
              </Card>
            </div>
          ) : null}
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={showDeleteDialog} onClose={() => setShowDeleteDialog(false)} title="Excluir Pagina">
        <p className="text-sm text-gray-600">
          Tem certeza que deseja excluir a pagina <strong>&quot;{selectedPage?.title}&quot;</strong>? Esta acao nao pode ser desfeita.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={handleDelete}>
            Excluir
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

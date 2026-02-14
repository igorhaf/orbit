/**
 * Wiki Panel Component
 * PROMPT #272 - Wiki as project tab instead of separate page
 *
 * Embeddable wiki viewer with sidebar navigation and page detail.
 * Combines wiki index and page view into a single inline component.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, Button } from '@/components/ui';
import { wikiApi, knowledgeApi, ragApi } from '@/lib/api';
import { useNotification } from '@/hooks';
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

  // Create dialog
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newPage, setNewPage] = useState({ title: '', content: '' });
  const [creating, setCreating] = useState(false);

  // Wiki Knowledge stats
  const [wikiStats, setWikiStats] = useState<{
    business_rules_count: number;
    interview_answers_count: number;
    code_files_count: number;
    total_documents: number;
  } | null>(null);
  const [isEnriching, setIsEnriching] = useState(false);
  const [enrichingRules, setEnrichingRules] = useState(false);

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

    // Auto-refresh while enriching
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

  const handleEnrichRules = async (force: boolean = false) => {
    setEnrichingRules(true);
    try {
      const res = await wikiApi.enrichRules(projectId, force);
      showSuccess(res.detail || 'Enriquecimento iniciado em background');
    } catch (error: any) {
      showError(error.message || 'Falha ao iniciar enriquecimento');
    } finally {
      setEnrichingRules(false);
    }
  };

  const handleCreate = async () => {
    if (!newPage.title.trim()) {
      showError('Titulo obrigatorio');
      return;
    }
    setCreating(true);
    try {
      const slug = newPage.title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim();
      await wikiApi.create(projectId, {
        title: newPage.title,
        slug,
        content: newPage.content || `## ${newPage.title}\n\nConteudo da pagina.`,
        source: 'manual',
      });
      showSuccess('Pagina criada');
      setShowCreateDialog(false);
      setNewPage({ title: '', content: '' });
      loadTree();
    } catch (error: any) {
      showError(error.message || 'Falha ao criar pagina');
    } finally {
      setCreating(false);
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
      // Reload page and tree
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
    if (!confirm(`Deletar pagina "${selectedPage.title}"?`)) return;

    try {
      await wikiApi.delete(projectId, selectedSlug!);
      showSuccess('Pagina deletada');
      setSelectedSlug(null);
      setSelectedPage(null);
      loadTree();
    } catch (error: any) {
      showError(error.message || 'Falha ao deletar');
    }
  };

  // Find a tree item by slug (recursive search)
  const findTreeItem = (items: WikiTreeItem[], slug: string): WikiTreeItem | null => {
    for (const item of items) {
      if (item.slug === slug) return item;
      if (item.children) {
        const found = findTreeItem(item.children, slug);
        if (found) return found;
      }
    }
    return null;
  };

  // Sidebar shows only root pages. Sub-pages are accessible via links inside parent page content.
  const renderSidebarItem = (item: WikiTreeItem) => {
    const isActive = item.slug === selectedSlug;
    return (
      <div key={item.id}>
        <button
          onClick={() => {
            setEditing(false);
            setSelectedSlug(item.slug);
          }}
          className={`w-full text-left px-3 py-1.5 rounded text-sm transition-colors ${
            isActive
              ? 'bg-blue-100 text-blue-700 font-medium'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
          }`}
        >
          <span className="truncate block">{item.title}</span>
        </button>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // Empty state
  if (tree.length === 0) {
    return (
      <div className="space-y-6">
        {NotificationComponent}
        <Card className="p-12 text-center">
          <div className="text-gray-400 mb-4">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">Wiki vazia</h3>
          <p className="text-gray-500 mb-6 max-w-md mx-auto">
            Crie paginas manualmente ou gere automaticamente a partir do contexto do projeto.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button variant="outline" onClick={handleGenerate} disabled={generating}>
              {generating ? 'Gerando...' : 'Gerar do Contexto'}
            </Button>
            <Button variant="primary" onClick={() => setShowCreateDialog(true)}>
              Nova Pagina
            </Button>
          </div>
        </Card>
        {renderCreateDialog()}
      </div>
    );
  }

  function renderCreateDialog() {
    if (!showCreateDialog) return null;
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
          <div className="p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Nova Pagina Wiki</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Titulo</label>
                <input
                  type="text"
                  value={newPage.title}
                  onChange={(e) => setNewPage({ ...newPage, title: e.target.value })}
                  placeholder="Ex: Arquitetura do Sistema"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Conteudo inicial (Markdown)</label>
                <textarea
                  value={newPage.content}
                  onChange={(e) => setNewPage({ ...newPage, content: e.target.value })}
                  placeholder="## Titulo&#10;&#10;Conteudo da pagina em Markdown..."
                  rows={5}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <Button variant="outline" onClick={() => setShowCreateDialog(false)} disabled={creating}>
                Cancelar
              </Button>
              <Button variant="primary" onClick={handleCreate} disabled={creating || !newPage.title.trim()}>
                {creating ? 'Criando...' : 'Criar Pagina'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Render stats bar (reused in both empty and main views)
  function renderStatsBar() {
    if (!wikiStats || wikiStats.total_documents === 0) return null;
    return (
      <div className="flex items-center gap-4 px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600">
        <span className="font-medium text-gray-700">Wiki Knowledge:</span>
        <span>{wikiStats.business_rules_count} rules extracted</span>
        <span className="text-gray-300">|</span>
        <span>{wikiStats.interview_answers_count} interview answers</span>
        <span className="text-gray-300">|</span>
        <span>{wikiStats.code_files_count} files scanned</span>
        {isEnriching && (
          <>
            <span className="text-gray-300">|</span>
            <span className="flex items-center gap-1 text-blue-600">
              <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-600" />
              Enriching...
            </span>
          </>
        )}
      </div>
    );
  }

  // Main wiki view with sidebar + content
  return (
    <div className="space-y-4">
      {NotificationComponent}

      {/* Wiki Knowledge stats bar */}
      {renderStatsBar()}

      {/* Header with actions */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">
          {tree.length} pagina{tree.length !== 1 ? 's' : ''}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleGenerate} disabled={generating}>
            {generating ? 'Gerando...' : 'Gerar do Contexto'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleEnrichRules(true)} disabled={enrichingRules}>
            {enrichingRules ? 'Enriquecendo...' : 'Enriquecer Regras'}
          </Button>
          <Button variant="primary" size="sm" onClick={() => setShowCreateDialog(true)}>
            Nova Pagina
          </Button>
        </div>
      </div>

      <div className="flex gap-4">
        {/* Sidebar tree */}
        <div className="w-72 flex-shrink-0">
          <Card className="p-3">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Paginas</h2>
            <div className="space-y-0.5">
              {tree.map((item) => renderSidebarItem(item))}
            </div>
          </Card>
        </div>

        {/* Content area */}
        <div className="flex-1 min-w-0">
          {!selectedSlug ? (
            // Grid of page cards when no page selected
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {tree.map((page) => (
                <Card
                  key={page.id}
                  className="p-4 cursor-pointer hover:shadow-md transition-shadow border-l-4 border-l-blue-500"
                  onClick={() => setSelectedSlug(page.slug)}
                >
                  <div className="flex items-start justify-between mb-1">
                    <h3 className="font-medium text-gray-900 text-sm">{page.title}</h3>
                    {page.source === 'ai_generated' && (
                      <span className="px-1.5 py-0.5 rounded-full text-xs bg-purple-100 text-purple-700">AI</span>
                    )}
                    {page.source === 'enrichment' && (
                      <span className="px-1.5 py-0.5 rounded-full text-xs bg-green-100 text-green-700">Enriquecido</span>
                    )}
                    {page.source === 'manual' && (
                      <span className="px-1.5 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700">Manual</span>
                    )}
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
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => { setSelectedSlug(null); setEditing(false); }}
                    className="text-gray-400 hover:text-gray-600"
                    title="Voltar"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  {editing ? (
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="text-xl font-bold text-gray-900 border-b-2 border-blue-500 focus:outline-none bg-transparent"
                    />
                  ) : (
                    <h2 className="text-xl font-bold text-gray-900">{selectedPage.title}</h2>
                  )}
                  {selectedPage.source === 'ai_generated' && (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-700">AI</span>
                  )}
                  {selectedPage.source === 'enrichment' && (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">Enriquecido</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {editing ? (
                    <>
                      <Button variant="outline" size="sm" onClick={() => { setEditing(false); setEditContent(selectedPage.content); setEditTitle(selectedPage.title); }} disabled={saving}>
                        Cancelar
                      </Button>
                      <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
                        {saving ? 'Salvando...' : 'Salvar'}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                        Editar
                      </Button>
                      <button
                        onClick={handleDelete}
                        className="p-1.5 text-gray-400 hover:text-red-600 rounded hover:bg-red-50 transition-colors"
                        title="Deletar pagina"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Page metadata */}
              <div className="text-xs text-gray-400 mb-3 flex items-center gap-4">
                <span>Atualizado em {new Date(selectedPage.updated_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                <span>/{selectedPage.slug}</span>
              </div>

              {/* Content */}
              <Card className="p-5">
                {editing ? (
                  <div className="space-y-4">
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="w-full min-h-[400px] p-4 border border-gray-200 rounded-lg font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
                      placeholder="Conteudo em Markdown..."
                    />
                    <div className="border-t pt-4">
                      <span className="text-xs font-medium text-gray-500 uppercase mb-2 block">Preview</span>
                      <div className="prose prose-sm max-w-none p-4 bg-gray-50 rounded-lg">
                        <ReactMarkdown>{editContent}</ReactMarkdown>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="prose prose-sm max-w-none">
                    <ReactMarkdown
                      components={{
                        a: ({ href, children, ...props }) => {
                          // Internal wiki links: wiki:slug or plain slug (no protocol)
                          let targetSlug: string | null = null;
                          if (href && href.startsWith('wiki:')) {
                            targetSlug = href.replace('wiki:', '');
                          } else if (href && !href.startsWith('http') && !href.startsWith('mailto:') && !href.startsWith('/') && !href.startsWith('#')) {
                            targetSlug = href;
                          }
                          if (targetSlug) {
                            return (
                              <a
                                href="#"
                                className="text-blue-600 hover:text-blue-800 underline"
                                onClick={(e) => {
                                  e.preventDefault();
                                  setEditing(false);
                                  setSelectedSlug(targetSlug);
                                }}
                                {...props}
                              >
                                {children}
                              </a>
                            );
                          }
                          return <a href={href} className="text-blue-600 hover:text-blue-800 underline" target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
                        },
                        h2: ({ children, ...props }) => (
                          <h2 className="text-xl font-bold text-gray-900 mt-6 mb-3 pb-2 border-b" {...props}>{children}</h2>
                        ),
                        h3: ({ children, ...props }) => (
                          <h3 className="text-lg font-semibold text-gray-800 mt-4 mb-2" {...props}>{children}</h3>
                        ),
                        ul: ({ children, ...props }) => (
                          <ul className="list-disc pl-6 space-y-1" {...props}>{children}</ul>
                        ),
                        ol: ({ children, ...props }) => (
                          <ol className="list-decimal pl-6 space-y-1" {...props}>{children}</ol>
                        ),
                        code: ({ children, className, ...props }) => {
                          const isInline = !className;
                          if (isInline) {
                            return <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono text-pink-600" {...props}>{children}</code>;
                          }
                          return <code className={className} {...props}>{children}</code>;
                        },
                        pre: ({ children, ...props }) => (
                          <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm" {...props}>{children}</pre>
                        ),
                        blockquote: ({ children, ...props }) => (
                          <blockquote className="border-l-4 border-blue-500 pl-4 italic text-gray-600" {...props}>{children}</blockquote>
                        ),
                        table: ({ children, ...props }) => (
                          <div className="overflow-x-auto">
                            <table className="min-w-full border border-gray-200 rounded-lg" {...props}>{children}</table>
                          </div>
                        ),
                        th: ({ children, ...props }) => (
                          <th className="bg-gray-50 px-4 py-2 text-left text-sm font-medium text-gray-700 border-b" {...props}>{children}</th>
                        ),
                        td: ({ children, ...props }) => (
                          <td className="px-4 py-2 text-sm text-gray-600 border-b" {...props}>{children}</td>
                        ),
                      }}
                    >
                      {selectedPage.content}
                    </ReactMarkdown>
                    {/* Child page links only for root pages (sidebar items) */}
                    {(() => {
                      // Only show auto-links for root-level pages. Sub-pages manage their own links in content.
                      const treeItem = selectedSlug ? tree.find(t => t.slug === selectedSlug) : null;
                      if (!treeItem || !treeItem.children || treeItem.children.length === 0) return null;
                      return (
                        <ul className="mt-8 space-y-1 list-disc pl-5">
                          {treeItem.children.map((child) => (
                            <li key={child.id}>
                              <button
                                onClick={() => { setEditing(false); setSelectedSlug(child.slug); }}
                                className="text-blue-600 hover:text-blue-800 hover:underline text-sm"
                              >
                                {child.title}
                              </button>
                            </li>
                          ))}
                        </ul>
                      );
                    })()}
                  </div>
                )}
              </Card>
            </div>
          ) : null}
        </div>
      </div>

      {renderCreateDialog()}
    </div>
  );
}

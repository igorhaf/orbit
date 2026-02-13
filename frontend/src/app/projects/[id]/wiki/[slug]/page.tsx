/**
 * Wiki Page View/Edit
 * PROMPT #261 - Multi-page Wiki System
 *
 * Displays a single wiki page with markdown rendering.
 * Supports inline editing with markdown preview.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Layout, Breadcrumbs } from '@/components/layout';
import { Card, Button } from '@/components/ui';
import { projectsApi, wikiApi } from '@/lib/api';
import { useNotification } from '@/hooks';
import ReactMarkdown from 'react-markdown';

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

interface WikiTreeItem {
  id: string;
  slug: string;
  title: string;
  parent_id: string | null;
  order_index: number;
  source: string;
  children: WikiTreeItem[];
}

export default function WikiPageView() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const slug = params.slug as string;
  const { showSuccess, showError, NotificationComponent } = useNotification();

  const [project, setProject] = useState<any>(null);
  const [page, setPage] = useState<WikiPage | null>(null);
  const [tree, setTree] = useState<WikiTreeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [proj, pageData, wikiTree] = await Promise.all([
        projectsApi.get(projectId),
        wikiApi.get(projectId, slug),
        wikiApi.tree(projectId),
      ]);
      setProject(proj.data || proj);
      setPage(pageData);
      setTree(wikiTree);
      setEditContent(pageData.content);
      setEditTitle(pageData.title);
    } catch (error) {
      console.error('Failed to load wiki page:', error);
      showError('Pagina nao encontrada');
      router.push(`/projects/${projectId}/wiki`);
    } finally {
      setLoading(false);
    }
  }, [projectId, slug, router, showError]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSave = async () => {
    if (!page) return;
    setSaving(true);
    try {
      const updates: any = {};
      if (editTitle !== page.title) updates.title = editTitle;
      if (editContent !== page.content) updates.content = editContent;

      await wikiApi.update(projectId, slug, updates);
      showSuccess('Pagina salva');
      setEditing(false);
      loadData();
    } catch (error: any) {
      showError(error.message || 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!page) return;
    if (!confirm(`Deletar pagina "${page.title}"?`)) return;

    try {
      await wikiApi.delete(projectId, slug);
      showSuccess('Pagina deletada');
      router.push(`/projects/${projectId}/wiki`);
    } catch (error: any) {
      showError(error.message || 'Falha ao deletar');
    }
  };

  const renderSidebarItem = (item: WikiTreeItem, depth: number = 0) => {
    const isActive = item.slug === slug;
    return (
      <div key={item.id}>
        <button
          onClick={() => router.push(`/projects/${projectId}/wiki/${item.slug}`)}
          className={`w-full text-left px-3 py-1.5 rounded text-sm transition-colors ${
            isActive
              ? 'bg-blue-100 text-blue-700 font-medium'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
          }`}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
        >
          <span className="truncate block">{item.title}</span>
        </button>
        {item.children && item.children.map((child) => renderSidebarItem(child, depth + 1))}
      </div>
    );
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </Layout>
    );
  }

  if (!page) return null;

  return (
    <Layout>
      {NotificationComponent}
      <Breadcrumbs />

      <div className="flex gap-6">
        {/* Sidebar */}
        <div className="w-64 flex-shrink-0 hidden lg:block">
          <Card className="p-3 sticky top-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Paginas</h2>
              <button
                onClick={() => router.push(`/projects/${projectId}/wiki`)}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                Ver todas
              </button>
            </div>
            <div className="space-y-0.5">
              {tree.map((item) => renderSidebarItem(item))}
            </div>
          </Card>
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          {/* Page Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push(`/projects/${projectId}/wiki`)}
                className="text-gray-400 hover:text-gray-600 lg:hidden"
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
                  className="text-2xl font-bold text-gray-900 border-b-2 border-blue-500 focus:outline-none bg-transparent"
                />
              ) : (
                <h1 className="text-2xl font-bold text-gray-900">{page.title}</h1>
              )}
              {page.source === 'ai_generated' && (
                <span className="px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-700">AI</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {editing ? (
                <>
                  <Button variant="outline" onClick={() => { setEditing(false); setEditContent(page.content); setEditTitle(page.title); }} disabled={saving}>
                    Cancelar
                  </Button>
                  <Button variant="primary" onClick={handleSave} disabled={saving}>
                    {saving ? 'Salvando...' : 'Salvar'}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" onClick={() => setEditing(true)}>
                    Editar
                  </Button>
                  <button
                    onClick={handleDelete}
                    className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                    title="Deletar pagina"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Page metadata */}
          <div className="text-xs text-gray-400 mb-4 flex items-center gap-4">
            <span>Atualizado em {new Date(page.updated_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            <span>/{page.slug}</span>
          </div>

          {/* Content */}
          <Card className="p-6">
            {editing ? (
              <div className="space-y-4">
                <div className="border-b pb-2 mb-2">
                  <span className="text-xs font-medium text-gray-500 uppercase">Markdown</span>
                </div>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full min-h-[400px] p-4 border border-gray-200 rounded-lg font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
                  placeholder="Conteudo em Markdown..."
                />
                {/* Live preview */}
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
                      // Internal wiki links: [[page-slug]] or [text](wiki:slug)
                      if (href && href.startsWith('wiki:')) {
                        const targetSlug = href.replace('wiki:', '');
                        return (
                          <a
                            href={`/projects/${projectId}/wiki/${targetSlug}`}
                            className="text-blue-600 hover:text-blue-800 underline"
                            onClick={(e) => {
                              e.preventDefault();
                              router.push(`/projects/${projectId}/wiki/${targetSlug}`);
                            }}
                            {...props}
                          >
                            {children}
                          </a>
                        );
                      }
                      return <a href={href} className="text-blue-600 hover:text-blue-800 underline" {...props}>{children}</a>;
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
                  {page.content}
                </ReactMarkdown>
              </div>
            )}
          </Card>

          {/* Related pages */}
          {!editing && tree.length > 1 && (
            <div className="mt-6">
              <h3 className="text-sm font-medium text-gray-500 mb-3">Outras paginas</h3>
              <div className="flex flex-wrap gap-2">
                {tree
                  .filter((p) => p.slug !== slug)
                  .map((p) => (
                    <button
                      key={p.id}
                      onClick={() => router.push(`/projects/${projectId}/wiki/${p.slug}`)}
                      className="px-3 py-1.5 bg-gray-100 hover:bg-blue-50 text-gray-700 hover:text-blue-700 rounded-lg text-sm transition-colors"
                    >
                      {p.title}
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

/**
 * Wiki Index Page
 * PROMPT #261 - Multi-page Wiki System
 *
 * Displays the wiki page tree with sidebar navigation.
 * Allows creating, editing, and navigating wiki pages.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Layout, Breadcrumbs } from '@/components/layout';
import { Card, Button } from '@/components/ui';
import { projectsApi, wikiApi } from '@/lib/api';
import { useNotification } from '@/hooks';

interface WikiTreeItem {
  id: string;
  slug: string;
  title: string;
  parent_id: string | null;
  order_index: number;
  source: string;
  children: WikiTreeItem[];
}

export default function WikiIndexPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const { showSuccess, showError, NotificationComponent } = useNotification();

  const [project, setProject] = useState<any>(null);
  const [tree, setTree] = useState<WikiTreeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newPage, setNewPage] = useState({ title: '', content: '' });
  const [creating, setCreating] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [proj, wikiTree] = await Promise.all([
        projectsApi.get(projectId),
        wikiApi.tree(projectId),
      ]);
      setProject(proj.data || proj);
      setTree(wikiTree);
    } catch (error) {
      console.error('Failed to load wiki:', error);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await wikiApi.generateFromContext(projectId);
      showSuccess(`${res.detail}`);
      loadData();
    } catch (error: any) {
      showError(error.message || 'Falha ao gerar wiki');
    } finally {
      setGenerating(false);
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
      loadData();
    } catch (error: any) {
      showError(error.message || 'Falha ao criar pagina');
    } finally {
      setCreating(false);
    }
  };

  const renderTreeItem = (item: WikiTreeItem) => (
    <div key={item.id}>
      <button
        onClick={() => router.push(`/projects/${projectId}/wiki/${item.slug}`)}
        className="w-full text-left px-3 py-2 rounded-lg hover:bg-blue-50 hover:text-blue-700 transition-colors text-sm flex items-center gap-2"
      >
        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span className="truncate">{item.title}</span>
        {item.source === 'ai_generated' && (
          <span className="text-xs text-purple-500 ml-auto flex-shrink-0">AI</span>
        )}
      </button>
    </div>
  );

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      {NotificationComponent}
      <Breadcrumbs />

      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Wiki</h1>
            <p className="text-gray-500 mt-1">
              Documentacao estruturada do projeto {project?.name}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={handleGenerate}
              disabled={generating}
            >
              {generating ? 'Gerando...' : 'Gerar do Contexto'}
            </Button>
            <Button variant="primary" onClick={() => setShowCreateDialog(true)}>
              Nova Pagina
            </Button>
          </div>
        </div>

        {tree.length === 0 ? (
          /* Empty state */
          <Card className="p-12 text-center">
            <div className="text-gray-400 mb-4">
              <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">Wiki vazia</h3>
            <p className="text-gray-500 mb-6 max-w-md mx-auto">
              Crie paginas manualmente ou gere automaticamente a partir do contexto do projeto (scan, entrevista, regras de negocio).
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
        ) : (
          /* Wiki tree as grid of page cards */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {tree.map((page) => (
              <Card
                key={page.id}
                className="p-4 cursor-pointer hover:shadow-md transition-shadow border-l-4 border-l-blue-500"
                onClick={() => router.push(`/projects/${projectId}/wiki/${page.slug}`)}
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-medium text-gray-900">{page.title}</h3>
                  {page.source === 'ai_generated' && (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-700">AI</span>
                  )}
                  {page.source === 'enrichment' && (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">Updated</span>
                  )}
                  {page.source === 'manual' && (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700">Manual</span>
                  )}
                </div>
                {page.children && page.children.length > 0 && (
                  <p className="text-xs text-gray-400">{page.children.length} sub-paginas</p>
                )}
              </Card>
            ))}
          </div>
        )}

        {/* Sidebar tree (shown below on mobile, beside on desktop) */}
        {tree.length > 0 && (
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wider">Indice</h2>
            <div className="space-y-0.5">
              {tree.map((item) => renderTreeItem(item))}
            </div>
          </Card>
        )}
      </div>

      {/* Create Dialog */}
      {showCreateDialog && (
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
      )}
    </Layout>
  );
}

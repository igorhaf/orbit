/**
 * Knowledge Base Page
 * PROMPT #147 - Incremental RAG Feeding for Business Rules
 *
 * Allows users to:
 * - View all business rules (from code scan, interviews, manual)
 * - Add business rules manually
 * - Upload documents (MD, TXT)
 * - View knowledge statistics
 */

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { Layout, Breadcrumbs } from '@/components/layout';
import { Card, CardHeader, CardTitle, CardContent, Button } from '@/components/ui';
import { projectsApi, knowledgeApi } from '@/lib/api';
import { useNotification } from '@/hooks';

// Types
interface BusinessRule {
  id: string;
  title: string;
  description: string;
  category: string;
  source: string;
  created_at: string;
}

interface Document {
  filename: string;
  chunks: number;
  uploaded_at: string | null;
}

interface KnowledgeStats {
  total_documents: number;
  business_rules_count: number;
  interview_answers_count: number;
  code_files_count: number;
  documents_count: number;
  by_category: Record<string, number>;
  by_source: Record<string, number>;
}

type Category = 'validation' | 'workflow' | 'calculation' | 'permission' | 'integration';

const CATEGORIES: { value: Category; label: string; description: string }[] = [
  { value: 'validation', label: 'Validação', description: 'Email único, CPF válido, senha mínima' },
  { value: 'workflow', label: 'Fluxo de Trabalho', description: 'Fluxos de aprovacao, processos de pedido' },
  { value: 'calculation', label: 'Calculo', description: 'Limites de desconto, calculo de frete' },
  { value: 'permission', label: 'Permissão', description: 'Apenas admin, acesso do proprietario' },
  { value: 'integration', label: 'Integração', description: 'APIs externas, webhooks' },
];

const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  manual: { label: 'Manual', color: 'bg-blue-100 text-blue-800' },
  code_scan: { label: 'Scan de Código', color: 'bg-green-100 text-green-800' },
  interview: { label: 'Entrevista', color: 'bg-purple-100 text-purple-800' },
  document: { label: 'Documento', color: 'bg-orange-100 text-orange-800' },
  unknown: { label: 'Desconhecido', color: 'bg-gray-100 text-gray-800' },
};

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  validation: { label: 'Validação', color: 'bg-red-100 text-red-800' },
  workflow: { label: 'Fluxo de Trabalho', color: 'bg-yellow-100 text-yellow-800' },
  calculation: { label: 'Calculo', color: 'bg-cyan-100 text-cyan-800' },
  permission: { label: 'Permissão', color: 'bg-pink-100 text-pink-800' },
  integration: { label: 'Integração', color: 'bg-indigo-100 text-indigo-800' },
};

export default function KnowledgePage() {
  const params = useParams();
  const projectId = params.id as string;
  const { showSuccess, showError, NotificationComponent } = useNotification();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State
  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState<BusinessRule[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [activeTab, setActiveTab] = useState<'rules' | 'documents' | 'stats'>('rules');

  // Filter state
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<string>('');

  // Add Rule Dialog state
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newRule, setNewRule] = useState({
    title: '',
    description: '',
    category: 'validation' as Category,
  });
  const [submitting, setSubmitting] = useState(false);

  // Upload state
  const [uploading, setUploading] = useState(false);

  // Load project
  const loadProject = useCallback(async () => {
    try {
      const res = await projectsApi.get(projectId);
      setProject(res.data || res);
    } catch (error) {
      console.error('Failed to load project:', error);
      showError('Falha ao carregar projeto');
    }
  }, [projectId, showError]);

  // Load business rules
  const loadRules = useCallback(async () => {
    try {
      const params: any = {};
      if (categoryFilter) params.category = categoryFilter;
      if (sourceFilter) params.source = sourceFilter;

      const res = await knowledgeApi.listRules(projectId, params);
      setRules(res);
    } catch (error) {
      console.error('Failed to load rules:', error);
      showError('Falha ao carregar regras de negocio');
    }
  }, [projectId, categoryFilter, sourceFilter, showError]);

  // Load documents
  const loadDocuments = useCallback(async () => {
    try {
      const res = await knowledgeApi.listDocuments(projectId);
      setDocuments(res.documents);
    } catch (error) {
      console.error('Failed to load documents:', error);
      showError('Falha ao carregar documentos');
    }
  }, [projectId, showError]);

  // Load stats
  const loadStats = useCallback(async () => {
    try {
      const res = await knowledgeApi.getFullStats(projectId);
      setStats(res);
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  }, [projectId]);

  // Initial load
  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      await Promise.all([loadProject(), loadRules(), loadDocuments(), loadStats()]);
      setLoading(false);
    };
    loadAll();
  }, [loadProject, loadRules, loadDocuments, loadStats]);

  // Reload rules when filters change
  useEffect(() => {
    loadRules();
  }, [categoryFilter, sourceFilter, loadRules]);

  // Add rule handler
  const handleAddRule = async () => {
    if (!newRule.title.trim() || !newRule.description.trim()) {
      showError('Título e descrição são obrigatorios');
      return;
    }

    setSubmitting(true);
    try {
      await knowledgeApi.addRule(projectId, newRule);
      showSuccess(`Regra "${newRule.title}" adicionada com sucesso`);
      setShowAddDialog(false);
      setNewRule({ title: '', description: '', category: 'validation' });
      loadRules();
      loadStats();
    } catch (error: any) {
      showError(error.message || 'Falha ao adicionar regra');
    } finally {
      setSubmitting(false);
    }
  };

  // Delete rule handler
  const handleDeleteRule = async (ruleId: string, ruleTitle: string) => {
    if (!confirm(`Deletar regra "${ruleTitle}"?`)) return;

    try {
      await knowledgeApi.deleteRule(projectId, ruleId);
      showSuccess('Regra excluida');
      loadRules();
      loadStats();
    } catch (error: any) {
      showError(error.message || 'Falha ao excluir regra');
    }
  };

  // Upload document handler
  const handleUploadDocument = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const res = await knowledgeApi.uploadDocument(projectId, file);
      showSuccess(`Documento "${res.filename}" enviado (${res.chunks_indexed} chunks indexados)`);
      loadDocuments();
      loadStats();
    } catch (error: any) {
      showError(error.message || 'Falha ao enviar documento');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Delete document handler
  const handleDeleteDocument = async (filename: string) => {
    if (!confirm(`Deletar documento "${filename}" e todos os seus chunks?`)) return;

    try {
      const res = await knowledgeApi.deleteDocument(projectId, filename);
      showSuccess(`Documento excluido (${res.chunks_deleted} chunks removidos)`);
      loadDocuments();
      loadStats();
    } catch (error: any) {
      showError(error.message || 'Falha ao excluir documento');
    }
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

  return (
    <Layout>
      {NotificationComponent}

      {/* Breadcrumbs */}
      <Breadcrumbs />

      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Base de Conhecimento</h1>
            <p className="text-gray-500 mt-1">
              Gerencie regras de negocio e documentos para contexto de IA
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <>
                  <span className="animate-spin mr-2">...</span>
                  Enviando...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Enviar Documento
                </>
              )}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.txt,.rst,.yaml,.yml,.json"
              onChange={handleUploadDocument}
              className="hidden"
            />

            <Button variant="primary" onClick={() => setShowAddDialog(true)}>
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Adicionar Regra
            </Button>
          </div>
        </div>

        {/* Stats Summary */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <Card className="p-4">
              <div className="text-2xl font-bold text-gray-900">{stats.total_documents}</div>
              <div className="text-sm text-gray-500">Total de Itens</div>
            </Card>
            <Card className="p-4">
              <div className="text-2xl font-bold text-blue-600">{stats.business_rules_count}</div>
              <div className="text-sm text-gray-500">Regras de Negocio</div>
            </Card>
            <Card className="p-4">
              <div className="text-2xl font-bold text-purple-600">{stats.interview_answers_count}</div>
              <div className="text-sm text-gray-500">Respostas de Entrevista</div>
            </Card>
            <Card className="p-4">
              <div className="text-2xl font-bold text-green-600">{stats.code_files_count}</div>
              <div className="text-sm text-gray-500">Arquivos de Código</div>
            </Card>
            <Card className="p-4">
              <div className="text-2xl font-bold text-orange-600">{stats.documents_count}</div>
              <div className="text-sm text-gray-500">Documentos</div>
            </Card>
          </div>
        )}

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            {[
              { id: 'rules', label: 'Regras de Negocio', count: rules.length },
              { id: 'documents', label: 'Documentos', count: documents.length },
              { id: 'stats', label: 'Estatisticas' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
                {tab.count !== undefined && (
                  <span className={`px-2 py-0.5 rounded-full text-xs ${
                    activeTab === tab.id ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        {activeTab === 'rules' && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="flex items-center gap-4">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Todas as Categorias</option>
                {CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>{cat.label}</option>
                ))}
              </select>

              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Todas as Fontes</option>
                <option value="manual">Manual</option>
                <option value="code_scan">Scan de Código</option>
                <option value="interview">Entrevista</option>
                <option value="document">Documento</option>
              </select>

              {(categoryFilter || sourceFilter) && (
                <button
                  onClick={() => { setCategoryFilter(''); setSourceFilter(''); }}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  Limpar filtros
                </button>
              )}
            </div>

            {/* Rules List */}
            {rules.length === 0 ? (
              <Card className="p-8 text-center">
                <div className="text-gray-400 mb-4">
                  <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">Nenhuma regra de negocio ainda</h3>
                <p className="text-gray-500 mb-4">
                  Adicione regras de negocio manualmente ou execute um scan do codebase para extrair automaticamente.
                </p>
                <Button variant="primary" onClick={() => setShowAddDialog(true)}>
                  Adicionar Primeira Regra
                </Button>
              </Card>
            ) : (
              <div className="space-y-3">
                {rules.map((rule) => (
                  <Card key={rule.id} className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="font-medium text-gray-900">{rule.title}</h3>
                          <span className={`px-2 py-0.5 rounded-full text-xs ${CATEGORY_LABELS[rule.category]?.color || 'bg-gray-100 text-gray-800'}`}>
                            {CATEGORY_LABELS[rule.category]?.label || rule.category}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-xs ${SOURCE_LABELS[rule.source]?.color || SOURCE_LABELS.unknown.color}`}>
                            {SOURCE_LABELS[rule.source]?.label || rule.source}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600">{rule.description}</p>
                        <p className="text-xs text-gray-400 mt-2">
                          Adicionado em {new Date(rule.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDeleteRule(rule.id, rule.title)}
                        className="text-gray-400 hover:text-red-600 p-1"
                        title="Excluir regra"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'documents' && (
          <div className="space-y-4">
            {documents.length === 0 ? (
              <Card className="p-8 text-center">
                <div className="text-gray-400 mb-4">
                  <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">Nenhum documento enviado</h3>
                <p className="text-gray-500 mb-4">
                  Envie arquivos de documentação (MD, TXT, YAML) para adicionar conhecimento ao RAG.
                </p>
                <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                  Enviar Documento
                </Button>
              </Card>
            ) : (
              <div className="space-y-3">
                {documents.map((doc) => (
                  <Card key={doc.filename} className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-orange-100 rounded-lg">
                          <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </div>
                        <div>
                          <h3 className="font-medium text-gray-900">{doc.filename}</h3>
                          <p className="text-sm text-gray-500">
                            {doc.chunks} chunks indexados
                            {doc.uploaded_at && ` • Enviado em ${new Date(doc.uploaded_at).toLocaleDateString()}`}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteDocument(doc.filename)}
                        className="text-gray-400 hover:text-red-600 p-1"
                        title="Excluir documento"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'stats' && stats && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* By Category */}
            <Card>
              <CardHeader>
                <CardTitle>Regras por Categoria</CardTitle>
              </CardHeader>
              <CardContent>
                {Object.keys(stats.by_category).length === 0 ? (
                  <p className="text-gray-500 text-sm">Nenhuma regra de negocio ainda</p>
                ) : (
                  <div className="space-y-3">
                    {Object.entries(stats.by_category).map(([category, count]) => (
                      <div key={category} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs ${CATEGORY_LABELS[category]?.color || 'bg-gray-100 text-gray-800'}`}>
                            {CATEGORY_LABELS[category]?.label || category}
                          </span>
                        </div>
                        <span className="font-medium">{count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* By Source */}
            <Card>
              <CardHeader>
                <CardTitle>Conhecimento por Fonte</CardTitle>
              </CardHeader>
              <CardContent>
                {Object.keys(stats.by_source).length === 0 ? (
                  <p className="text-gray-500 text-sm">Nenhum item de conhecimento ainda</p>
                ) : (
                  <div className="space-y-3">
                    {Object.entries(stats.by_source).map(([source, count]) => (
                      <div key={source} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs ${SOURCE_LABELS[source]?.color || SOURCE_LABELS.unknown.color}`}>
                            {SOURCE_LABELS[source]?.label || source}
                          </span>
                        </div>
                        <span className="font-medium">{count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Add Rule Dialog */}
      {showAddDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Adicionar Regra de Negocio</h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Título
                  </label>
                  <input
                    type="text"
                    value={newRule.title}
                    onChange={(e) => setNewRule({ ...newRule, title: e.target.value })}
                    placeholder="Ex.: Email deve ser único por tenant"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Descrição
                  </label>
                  <textarea
                    value={newRule.description}
                    onChange={(e) => setNewRule({ ...newRule, description: e.target.value })}
                    placeholder="Descreva a regra de negocio em detalhe..."
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Categoria
                  </label>
                  <select
                    value={newRule.category}
                    onChange={(e) => setNewRule({ ...newRule, category: e.target.value as Category })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat.value} value={cat.value}>
                        {cat.label} - {cat.description}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <Button
                  variant="outline"
                  onClick={() => setShowAddDialog(false)}
                  disabled={submitting}
                >
                  Cancelar
                </Button>
                <Button
                  variant="primary"
                  onClick={handleAddRule}
                  disabled={submitting || !newRule.title.trim() || !newRule.description.trim()}
                >
                  {submitting ? 'Adicionando...' : 'Adicionar Regra'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

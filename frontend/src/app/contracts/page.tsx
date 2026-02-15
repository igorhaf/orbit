/**
 * Contracts Page
 * Full CRUD for YAML contract management
 *
 * PROMPT #104 - Contracts Area (Initial)
 * PROMPT #114 - Fix YAML display and add editing
 * PROMPT #164 - Full CRUD with domain/status/version support
 */

'use client';

import React, { useEffect, useState } from 'react';
import { Layout, Breadcrumbs } from '@/components/layout';
import { Card, CardHeader, CardTitle, CardContent, Button, Input } from '@/components/ui';
import {
  FileCode, X, Edit2, Save, RefreshCw, Search, Check, AlertCircle,
  Plus, Trash2, History, Eye, Map, ChevronDown
} from 'lucide-react';

interface Contract {
  name: string;
  path: string;
  category: string;
  domain: string;
  description: string;
  version: number;
  status: string;
  tags: string[];
}

interface ContractDetail extends Contract {
  content: string;
}

interface ContractVersion {
  filename: string;
  timestamp: string;
  size: number;
  created_at: string;
  is_deleted: boolean;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const CATEGORY_COLORS: Record<string, string> = {
  business: 'bg-indigo-100 text-indigo-800',
  generation: 'bg-blue-100 text-blue-800',
  commits: 'bg-green-100 text-green-800',
  components: 'bg-purple-100 text-purple-800',
  interviews: 'bg-cyan-100 text-cyan-800',
  memory: 'bg-pink-100 text-pink-800',
};

const DOMAIN_COLORS: Record<string, string> = {
  business: 'bg-indigo-600 text-white',
  interview: 'bg-cyan-600 text-white',
  generation: 'bg-blue-600 text-white',
  memory: 'bg-pink-600 text-white',
  component: 'bg-purple-600 text-white',
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-800 border-green-200',
  draft: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  deprecated: 'bg-gray-100 text-gray-600 border-gray-200',
};

const DOMAINS = ['all', 'business', 'interview', 'generation', 'memory', 'component'];
const STATUSES = ['all', 'active', 'draft', 'deprecated'];

// HTML escape function to prevent XSS and rendering issues
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Simple YAML syntax highlighting using regex
function highlightYaml(content: string): string {
  const escaped = escapeHtml(content);

  return escaped
    .replace(/^(#.*)$/gm, '<span class="text-gray-400 italic">$1</span>')
    .replace(/^(\s*)([a-zA-Z_][a-zA-Z0-9_-]*)(:)/gm, '$1<span class="text-cyan-400">$2</span><span class="text-white">$3</span>')
    .replace(/(&quot;[^&]*&quot;)/g, '<span class="text-green-400">$1</span>')
    .replace(/(&#039;[^&]*&#039;)/g, '<span class="text-green-400">$1</span>')
    .replace(/(:\s*)(\d+(\.\d+)?)\s*$/gm, '$1<span class="text-yellow-400">$2</span>')
    .replace(/(:\s*)(true|false)\s*$/gm, '$1<span class="text-purple-400">$2</span>')
    .replace(/(:\s*)(null|~)\s*$/gm, '$1<span class="text-red-400">$2</span>')
    .replace(/^(\s*)(-)(\s)/gm, '$1<span class="text-orange-400">$2</span>$3')
    .replace(/(\{\{[^}]+\}\})/g, '<span class="text-pink-400">$1</span>')
    .replace(/(:\s*)(\|)$/gm, '$1<span class="text-blue-400">$2</span>');
}

// Default YAML template for new contracts
const DEFAULT_CONTRACT_YAML = `name: new_contract
version: 1
domain: generation
category: generation
description: "Contract description"
usage_type: general

governance:
  status: draft
  owner: "ORBIT Team"
  effective_date: "${new Date().toISOString().split('T')[0]}"
  change_log:
    - version: 1
      date: "${new Date().toISOString().split('T')[0]}"
      author: "Author"
      changes: "Initial version"

variables:
  required: []
  optional: []

system_prompt: |
  Your system prompt here...

user_prompt: |
  Your user prompt here...

tags:
  - tag1
  - tag2
`;

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [filteredContracts, setFilteredContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedDomain, setSelectedDomain] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  // View/Edit modal state
  const [showModal, setShowModal] = useState(false);
  const [selectedContract, setSelectedContract] = useState<ContractDetail | null>(null);
  const [loadingYaml, setLoadingYaml] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'content' | 'versions' | 'semantic'>('content');
  const [versions, setVersions] = useState<ContractVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newContractPath, setNewContractPath] = useState('');
  const [newContractContent, setNewContractContent] = useState(DEFAULT_CONTRACT_YAML);
  const [creating, setCreating] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);

  // Delete modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [contractToDelete, setContractToDelete] = useState<Contract | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Categories dropdown state
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);

  useEffect(() => {
    loadContracts();
  }, []);

  // Filter contracts when search or filters change
  useEffect(() => {
    let filtered = contracts;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(c =>
        c.name.toLowerCase().includes(query) ||
        c.description.toLowerCase().includes(query) ||
        c.path.toLowerCase().includes(query) ||
        c.tags.some(t => t.toLowerCase().includes(query))
      );
    }

    if (selectedCategory !== 'all') {
      filtered = filtered.filter(c => c.category.startsWith(selectedCategory));
    }

    if (selectedDomain !== 'all') {
      filtered = filtered.filter(c => c.domain === selectedDomain);
    }

    if (selectedStatus !== 'all') {
      filtered = filtered.filter(c => c.status === selectedStatus);
    }

    setFilteredContracts(filtered);
  }, [contracts, searchQuery, selectedCategory, selectedDomain, selectedStatus]);

  // Get unique categories
  const categories = ['all', ...Array.from(new Set(contracts.map(c => c.category.split('/')[0])))];

  const loadContracts = async () => {
    setLoading(true);
    try {
      const response = await fetch('http://localhost:8000/api/v1/contracts/');
      const data = await response.json();
      setContracts(data);
      setFilteredContracts(data);
    } catch (error) {
      console.error('Failed to load contracts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRowClick = async (contract: Contract) => {
    setLoadingYaml(true);
    setShowModal(true);
    setIsEditing(false);
    setSaveResult(null);
    setActiveTab('content');
    setVersions([]);

    try {
      const response = await fetch(`http://localhost:8000/api/v1/contracts/${contract.path}`);
      const data = await response.json();
      setSelectedContract(data);
      setEditContent(data.content);
    } catch (error) {
      console.error('Failed to load contract content:', error);
      setSelectedContract({
        ...contract,
        content: '# Error loading YAML content'
      });
    } finally {
      setLoadingYaml(false);
    }
  };

  const loadVersions = async (path: string) => {
    setLoadingVersions(true);
    try {
      const response = await fetch(`http://localhost:8000/api/v1/contracts/${path}/versions`);
      const data = await response.json();
      setVersions(data);
    } catch (error) {
      console.error('Failed to load versions:', error);
    } finally {
      setLoadingVersions(false);
    }
  };

  const handleTabChange = (tab: 'content' | 'versions' | 'semantic') => {
    setActiveTab(tab);
    if (tab === 'versions' && selectedContract && versions.length === 0) {
      loadVersions(selectedContract.path);
    }
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setSelectedContract(null);
    setIsEditing(false);
    setSaveResult(null);
    setVersions([]);
  };

  const handleStartEdit = () => {
    if (selectedContract) {
      setEditContent(selectedContract.content);
      setIsEditing(true);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    if (selectedContract) {
      setEditContent(selectedContract.content);
    }
  };

  const handleSave = async () => {
    if (!selectedContract) return;

    setSaving(true);
    setSaveResult(null);

    try {
      const response = await fetch(
        `http://localhost:8000/api/v1/contracts/${selectedContract.path}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: editContent, create_backup: true }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to save');
      }

      setSelectedContract({ ...selectedContract, content: editContent });
      setIsEditing(false);
      setSaveResult({ success: true, message: 'Contract saved successfully' });
      loadContracts();
    } catch (error: any) {
      setSaveResult({ success: false, message: error.message || 'Failed to save contract' });
    } finally {
      setSaving(false);
    }
  };

  const handleRestoreVersion = async (filename: string) => {
    if (!selectedContract) return;

    try {
      const response = await fetch(
        `http://localhost:8000/api/v1/contracts/${selectedContract.path}/restore?filename=${filename}`,
        { method: 'POST' }
      );

      if (!response.ok) {
        throw new Error('Failed to restore version');
      }

      // Reload contract content
      handleRowClick(selectedContract);
      setSaveResult({ success: true, message: `Restored from ${filename}` });
    } catch (error: any) {
      setSaveResult({ success: false, message: error.message });
    }
  };

  // Create contract handlers
  const handleValidate = async () => {
    setValidating(true);
    setValidation(null);

    try {
      const response = await fetch('http://localhost:8000/api/v1/contracts/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newContractContent }),
      });

      const data = await response.json();
      setValidation(data);
    } catch (error) {
      setValidation({ valid: false, errors: ['Failed to validate'], warnings: [] });
    } finally {
      setValidating(false);
    }
  };

  const handleCreate = async () => {
    if (!newContractPath.trim()) return;

    setCreating(true);
    try {
      const response = await fetch('http://localhost:8000/api/v1/contracts/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: newContractPath,
          content: newContractContent
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to create');
      }

      setShowCreateModal(false);
      setNewContractPath('');
      setNewContractContent(DEFAULT_CONTRACT_YAML);
      setValidation(null);
      loadContracts();
    } catch (error: any) {
      setValidation({ valid: false, errors: [error.message], warnings: [] });
    } finally {
      setCreating(false);
    }
  };

  // Delete contract handlers
  const handleDeleteClick = (contract: Contract, e: React.MouseEvent) => {
    e.stopPropagation();
    setContractToDelete(contract);
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = async () => {
    if (!contractToDelete) return;

    setDeleting(true);
    try {
      const response = await fetch(
        `http://localhost:8000/api/v1/contracts/${contractToDelete.path}?backup=true`,
        { method: 'DELETE' }
      );

      if (!response.ok) {
        throw new Error('Failed to delete');
      }

      setShowDeleteModal(false);
      setContractToDelete(null);
      loadContracts();
    } catch (error) {
      console.error('Failed to delete contract:', error);
    } finally {
      setDeleting(false);
    }
  };

  const getCategoryColor = (category: string) => {
    const baseCategory = category.split('/')[0];
    return CATEGORY_COLORS[baseCategory] || 'bg-gray-100 text-gray-800';
  };

  // Extract semantic map from YAML content
  const getSemanticMap = (content: string): Record<string, string> => {
    try {
      const match = content.match(/semantic_map:\s*\n((?:\s+[A-Z]+\d+:.+\n?)+)/);
      if (!match) return {};

      const mapSection = match[1];
      const entries: Record<string, string> = {};
      const lines = mapSection.split('\n');

      for (const line of lines) {
        const entryMatch = line.match(/\s+([A-Z]+\d+):\s*"?([^"]+)"?/);
        if (entryMatch) {
          entries[entryMatch[1]] = entryMatch[2].trim();
        }
      }

      return entries;
    } catch {
      return {};
    }
  };

  return (
    <Layout>
      <Breadcrumbs />

      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Contratos</h1>
            <p className="mt-2 text-gray-600">
              Contratos YAML que definem comportamento de IA e regras de negocio
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={loadContracts} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
            <Button onClick={() => setShowCreateModal(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Novo Contrato
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-4">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input
              type="text"
              placeholder="Buscar contratos..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Domain Filter */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">Dominio:</span>
            <select
              value={selectedDomain}
              onChange={(e) => setSelectedDomain(e.target.value)}
              className="px-3 py-1.5 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {DOMAINS.map((domain) => (
                <option key={domain} value={domain}>
                  {domain === 'all' ? 'Todos os Dominios' : domain}
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">Status:</span>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="px-3 py-1.5 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status === 'all' ? 'Todos os Status' : status}
                </option>
              ))}
            </select>
          </div>

          {/* Category Pills */}
          <div className="flex items-center gap-2 flex-wrap">
            {categories.slice(0, 6).map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  selectedCategory === cat
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {cat === 'all' ? 'All' : cat}
              </button>
            ))}
            {categories.length > 6 && (
              <div className="relative">
                <button
                  onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
                  className="px-3 py-1.5 rounded-full text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 flex items-center gap-1"
                >
                  More <ChevronDown className="w-3 h-3" />
                </button>
                {showCategoryDropdown && (
                  <div className="absolute top-full mt-1 bg-white border rounded-lg shadow-lg z-10 py-1 min-w-[120px]">
                    {categories.slice(6).map((cat) => (
                      <button
                        key={cat}
                        onClick={() => {
                          setSelectedCategory(cat);
                          setShowCategoryDropdown(false);
                        }}
                        className={`w-full px-4 py-2 text-sm text-left hover:bg-gray-100 ${
                          selectedCategory === cat ? 'bg-blue-50 text-blue-600' : ''
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Contracts Table */}
        <Card>
          <CardHeader>
            <CardTitle>
              Contracts ({filteredContracts.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              </div>
            ) : filteredContracts.length === 0 ? (
              <div className="text-center py-12">
                <FileCode className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">
                  {searchQuery || selectedCategory !== 'all' || selectedDomain !== 'all' || selectedStatus !== 'all'
                    ? 'Nenhum contrato corresponde aos filtros'
                    : 'Nenhum contrato encontrado'
                  }
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Dominio
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Categoria
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Nome
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Descricao
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Versao
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Acoes
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredContracts.map((contract) => (
                      <tr
                        key={contract.path}
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() => handleRowClick(contract)}
                      >
                        <td className="px-4 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${DOMAIN_COLORS[contract.domain] || 'bg-gray-600 text-white'}`}>
                            {contract.domain}
                          </span>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getCategoryColor(contract.category)}`}>
                            {contract.category}
                          </span>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <span className="text-sm font-medium text-gray-900">
                            {contract.name}
                          </span>
                        </td>
                        <td className="px-4 py-4 max-w-xs truncate">
                          <span className="text-sm text-gray-600">
                            {contract.description}
                          </span>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <span className="text-sm text-gray-500">
                            v{contract.version}
                          </span>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${STATUS_COLORS[contract.status] || STATUS_COLORS.draft}`}>
                            {contract.status}
                          </span>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-right">
                          <button
                            onClick={(e) => handleDeleteClick(contract, e)}
                            className="text-gray-400 hover:text-red-600 p-1 rounded hover:bg-red-50 transition-colors"
                            title="Excluir contrato"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* View/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col mx-4">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold text-gray-900">
                    {selectedContract?.name || 'Loading...'}
                  </h2>
                  {selectedContract && (
                    <>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${DOMAIN_COLORS[selectedContract.domain] || 'bg-gray-600 text-white'}`}>
                        {selectedContract.domain}
                      </span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${STATUS_COLORS[selectedContract.status] || STATUS_COLORS.draft}`}>
                        {selectedContract.status}
                      </span>
                      <span className="text-sm text-gray-500">v{selectedContract.version}</span>
                    </>
                  )}
                </div>
                {selectedContract && (
                  <p className="text-sm text-gray-500 mt-1">{selectedContract.path}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!isEditing && selectedContract && activeTab === 'content' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleStartEdit}
                  >
                    <Edit2 className="w-4 h-4 mr-2" />
                    Editar
                  </Button>
                )}
                {isEditing && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCancelEdit}
                      disabled={saving}
                    >
                      Cancelar
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSave}
                      disabled={saving}
                    >
                      {saving ? (
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Save className="w-4 h-4 mr-2" />
                      )}
                      Salvar
                    </Button>
                  </>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCloseModal}
                >
                  <X className="w-5 h-5" />
                </Button>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b px-6">
              <button
                onClick={() => handleTabChange('content')}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                  activeTab === 'content'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Eye className="w-4 h-4 inline mr-2" />
                Conteudo
              </button>
              <button
                onClick={() => handleTabChange('versions')}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                  activeTab === 'versions'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <History className="w-4 h-4 inline mr-2" />
                Versoes
              </button>
              <button
                onClick={() => handleTabChange('semantic')}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                  activeTab === 'semantic'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Map className="w-4 h-4 inline mr-2" />
                Mapa Semantico
              </button>
            </div>

            {/* Save Result */}
            {saveResult && (
              <div className={`mx-6 mt-4 p-3 rounded-lg flex items-center gap-2 ${
                saveResult.success
                  ? 'bg-green-50 border border-green-200'
                  : 'bg-red-50 border border-red-200'
              }`}>
                {saveResult.success ? (
                  <Check className="w-5 h-5 text-green-600" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-red-600" />
                )}
                <span className={saveResult.success ? 'text-green-800' : 'text-red-800'}>
                  {saveResult.message}
                </span>
              </div>
            )}

            {/* Modal Content */}
            <div className="flex-1 overflow-auto p-4">
              {loadingYaml ? (
                <div className="flex items-center justify-center h-64">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
              ) : activeTab === 'content' ? (
                isEditing ? (
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full h-[60vh] p-4 bg-gray-900 text-gray-100 font-mono text-sm rounded-lg border-0 focus:ring-2 focus:ring-blue-500 resize-none"
                    spellCheck={false}
                  />
                ) : (
                  <pre
                    className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-auto text-sm font-mono whitespace-pre-wrap leading-relaxed"
                    dangerouslySetInnerHTML={{
                      __html: highlightYaml(selectedContract?.content || '')
                    }}
                  />
                )
              ) : activeTab === 'versions' ? (
                <div>
                  {loadingVersions ? (
                    <div className="flex items-center justify-center h-32">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    </div>
                  ) : versions.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      <History className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p>Nenhuma versao de backup disponivel</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {versions.map((version) => (
                        <div
                          key={version.filename}
                          className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                        >
                          <div>
                            <p className="font-medium text-gray-900">{version.filename}</p>
                            <p className="text-sm text-gray-500">
                              {new Date(version.created_at).toLocaleString()}
                              {version.is_deleted && <span className="ml-2 text-red-500">(deleted)</span>}
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRestoreVersion(version.filename)}
                          >
                            Restaurar
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : activeTab === 'semantic' ? (
                <div>
                  {(() => {
                    const semanticMap = getSemanticMap(selectedContract?.content || '');
                    const entries = Object.entries(semanticMap);

                    if (entries.length === 0) {
                      return (
                        <div className="text-center py-12 text-gray-500">
                          <Map className="w-12 h-12 mx-auto mb-4 opacity-50" />
                          <p>Nenhum mapa semantico definido neste contrato</p>
                        </div>
                      );
                    }

                    // Group by prefix
                    const groups: Record<string, [string, string][]> = {};
                    entries.forEach(([key, value]) => {
                      const prefix = key.replace(/\d+$/, '');
                      if (!groups[prefix]) groups[prefix] = [];
                      groups[prefix].push([key, value]);
                    });

                    const prefixLabels: Record<string, string> = {
                      'N': 'Entidades (N)',
                      'P': 'Processos (P)',
                      'E': 'Endpoints (E)',
                      'D': 'Dados (D)',
                      'S': 'Servicos (S)',
                      'C': 'Restricoes (C)',
                      'AC': 'Criterios de Aceitacao (AC)',
                      'R': 'Requisitos (R)',
                      'F': 'Funcionalidades (F)',
                      'M': 'Modulos (M)',
                    };

                    return (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {Object.entries(groups).map(([prefix, items]) => (
                          <div key={prefix} className="bg-gray-50 rounded-lg p-4">
                            <h4 className="font-medium text-gray-900 mb-3">
                              {prefixLabels[prefix] || prefix}
                            </h4>
                            <div className="space-y-2">
                              {items.map(([key, value]) => (
                                <div key={key} className="flex gap-2">
                                  <span className="font-mono text-sm text-blue-600 font-medium min-w-[40px]">
                                    {key}
                                  </span>
                                  <span className="text-sm text-gray-700">{value}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold text-gray-900">Criar Novo Contrato</h2>
              <Button variant="ghost" size="sm" onClick={() => setShowCreateModal(false)}>
                <X className="w-5 h-5" />
              </Button>
            </div>

            <div className="p-6 space-y-4 overflow-auto flex-1">
              {/* Path input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Caminho do Contrato
                </label>
                <Input
                  placeholder="categoria/nome_contrato (ex., generation/meu_prompt)"
                  value={newContractPath}
                  onChange={(e) => setNewContractPath(e.target.value)}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Formato: categoria/nome (sem extensao .yaml)
                </p>
              </div>

              {/* YAML content */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Contrato YAML
                </label>
                <textarea
                  value={newContractContent}
                  onChange={(e) => setNewContractContent(e.target.value)}
                  className="w-full h-[45vh] p-4 bg-gray-900 text-gray-100 font-mono text-sm rounded-lg border-0 focus:ring-2 focus:ring-blue-500 resize-none"
                  spellCheck={false}
                />
              </div>

              {/* Validation result */}
              {validation && (
                <div className={`p-4 rounded-lg ${validation.valid ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    {validation.valid ? (
                      <Check className="w-5 h-5 text-green-600" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-red-600" />
                    )}
                    <span className={`font-medium ${validation.valid ? 'text-green-800' : 'text-red-800'}`}>
                      {validation.valid ? 'YAML Valido' : 'YAML Invalido'}
                    </span>
                  </div>
                  {validation.errors.length > 0 && (
                    <ul className="list-disc list-inside text-sm text-red-700">
                      {validation.errors.map((err, i) => <li key={i}>{err}</li>)}
                    </ul>
                  )}
                  {validation.warnings.length > 0 && (
                    <ul className="list-disc list-inside text-sm text-yellow-700 mt-2">
                      {validation.warnings.map((warn, i) => <li key={i}>{warn}</li>)}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t">
              <Button variant="ghost" onClick={() => setShowCreateModal(false)}>
                Cancelar
              </Button>
              <Button variant="outline" onClick={handleValidate} disabled={validating}>
                {validating ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : null}
                Validar
              </Button>
              <Button
                onClick={handleCreate}
                disabled={creating || !newContractPath.trim()}
              >
                {creating ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                Criar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && contractToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Excluir Contrato</h3>
                <p className="text-sm text-gray-500">Esta acao nao pode ser desfeita</p>
              </div>
            </div>

            <p className="text-gray-700 mb-6">
              Tem certeza que deseja excluir <strong>{contractToDelete.name}</strong>?
              Um backup sera criado antes da exclusao.
            </p>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowDeleteModal(false)}>
                Cancelar
              </Button>
              <Button
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={handleConfirmDelete}
                disabled={deleting}
              >
                {deleting ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                Excluir
              </Button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

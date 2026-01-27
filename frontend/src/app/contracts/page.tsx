/**
 * Contracts Page
 * Lists all YAML prompt templates from the system
 * Allows viewing and editing of prompts
 *
 * PROMPT #104 - Contracts Area
 * PROMPT #114 - Fix YAML display and add editing
 */

'use client';

import React, { useEffect, useState } from 'react';
import { Layout, Breadcrumbs } from '@/components/layout';
import { Card, CardHeader, CardTitle, CardContent, Button, Input } from '@/components/ui';
import { FileCode, X, Edit2, Save, RefreshCw, Search, Check, AlertCircle } from 'lucide-react';

interface Contract {
  name: string;
  path: string;
  category: string;
  description: string;
}

interface ContractDetail extends Contract {
  content: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  backlog: 'bg-blue-100 text-blue-800',
  commits: 'bg-green-100 text-green-800',
  components: 'bg-purple-100 text-purple-800',
  context: 'bg-orange-100 text-orange-800',
  discovery: 'bg-pink-100 text-pink-800',
  interviews: 'bg-cyan-100 text-cyan-800',
};

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
  // First escape HTML entities
  const escaped = escapeHtml(content);

  return escaped
    // Comments (lines starting with #)
    .replace(/^(#.*)$/gm, '<span class="text-gray-400 italic">$1</span>')
    // Keys (word followed by colon at start of line or after spaces)
    .replace(/^(\s*)([a-zA-Z_][a-zA-Z0-9_-]*)(:)/gm, '$1<span class="text-cyan-400">$2</span><span class="text-white">$3</span>')
    // Strings in double quotes
    .replace(/(&quot;[^&]*&quot;)/g, '<span class="text-green-400">$1</span>')
    // Strings in single quotes
    .replace(/(&#039;[^&]*&#039;)/g, '<span class="text-green-400">$1</span>')
    // Numbers after colon
    .replace(/(:\s*)(\d+(\.\d+)?)\s*$/gm, '$1<span class="text-yellow-400">$2</span>')
    // Booleans
    .replace(/(:\s*)(true|false)\s*$/gm, '$1<span class="text-purple-400">$2</span>')
    // Null
    .replace(/(:\s*)(null|~)\s*$/gm, '$1<span class="text-red-400">$2</span>')
    // List items (dash at start)
    .replace(/^(\s*)(-)(\s)/gm, '$1<span class="text-orange-400">$2</span>$3')
    // Template variables {{ }}
    .replace(/(\{\{[^}]+\}\})/g, '<span class="text-pink-400">$1</span>')
    // Pipe for multiline strings
    .replace(/(:\s*)(\|)$/gm, '$1<span class="text-blue-400">$2</span>');
}

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [filteredContracts, setFilteredContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selectedContract, setSelectedContract] = useState<ContractDetail | null>(null);
  const [loadingYaml, setLoadingYaml] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Editing state
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    loadContracts();
  }, []);

  // Filter contracts when search or category changes
  useEffect(() => {
    let filtered = contracts;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(c =>
        c.name.toLowerCase().includes(query) ||
        c.description.toLowerCase().includes(query) ||
        c.path.toLowerCase().includes(query)
      );
    }

    if (selectedCategory !== 'all') {
      filtered = filtered.filter(c => c.category.startsWith(selectedCategory));
    }

    setFilteredContracts(filtered);
  }, [contracts, searchQuery, selectedCategory]);

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

  const handleCloseModal = () => {
    setShowModal(false);
    setSelectedContract(null);
    setIsEditing(false);
    setSaveResult(null);
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
          body: JSON.stringify({ content: editContent }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to save');
      }

      const data = await response.json();
      setSelectedContract({ ...selectedContract, content: editContent });
      setIsEditing(false);
      setSaveResult({ success: true, message: 'Contract saved successfully' });

      // Reload contracts list to update any changed metadata
      loadContracts();
    } catch (error: any) {
      setSaveResult({ success: false, message: error.message || 'Failed to save contract' });
    } finally {
      setSaving(false);
    }
  };

  const getCategoryColor = (category: string) => {
    const baseCategory = category.split('/')[0];
    return CATEGORY_COLORS[baseCategory] || 'bg-gray-100 text-gray-800';
  };

  return (
    <Layout>
      <Breadcrumbs />

      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Contracts</h1>
            <p className="mt-2 text-gray-600">
              YAML prompt templates that define AI behavior contracts
            </p>
          </div>
          <Button variant="outline" onClick={loadContracts} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input
              type="text"
              placeholder="Search contracts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="flex items-center gap-2">
            {categories.map((cat) => (
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
          </div>
        </div>

        {/* Contracts Table */}
        <Card>
          <CardHeader>
            <CardTitle>
              Prompt Contracts ({filteredContracts.length})
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
                  {searchQuery || selectedCategory !== 'all'
                    ? 'No contracts match your search'
                    : 'No contracts found'
                  }
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Category
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Description
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
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getCategoryColor(contract.category)}`}>
                            {contract.category}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-sm font-medium text-gray-900">
                            {contract.name}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm text-gray-600">
                            {contract.description}
                          </span>
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

      {/* YAML Content Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col mx-4">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {selectedContract?.name || 'Loading...'}
                </h2>
                {selectedContract && (
                  <p className="text-sm text-gray-500">{selectedContract.path}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!isEditing && selectedContract && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleStartEdit}
                  >
                    <Edit2 className="w-4 h-4 mr-2" />
                    Edit
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
                      Cancel
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
                      Save
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
              ) : isEditing ? (
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
              )}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

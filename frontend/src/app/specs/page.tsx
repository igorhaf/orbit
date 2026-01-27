/**
 * Specs Administration Page
 * Manage framework specifications for dynamic interview questions
 */

'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Layout, Breadcrumbs } from '@/components/layout';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Badge, Dialog } from '@/components/ui';
import { Plus, Edit, Trash2, Filter, X, FileCode, Database, Layout as LayoutIcon, Palette, Sparkles } from 'lucide-react';
import { useNotification } from '@/hooks';

interface Spec {
  id: string;
  category: string;
  name: string;
  spec_type: string;
  title: string;
  description?: string;
  content: string;
  language?: string;
  framework_version?: string;
  ignore_patterns?: string[];
  file_extensions?: string[];
  is_active: boolean;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

const CATEGORIES = [
  { value: 'backend', label: 'Backend', icon: Database, color: 'blue' },
  { value: 'database', label: 'Database', icon: Database, color: 'green' },
  { value: 'frontend', label: 'Frontend', icon: LayoutIcon, color: 'purple' },
  { value: 'css', label: 'CSS', icon: Palette, color: 'pink' },
];

export default function SpecsAdminPage() {
  const router = useRouter();
  const { showError, showSuccess, showWarning, NotificationComponent } = useNotification();
  const [specs, setSpecs] = useState<Spec[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedSpec, setSelectedSpec] = useState<Spec | null>(null);
  const [specToDelete, setSpecToDelete] = useState<Spec | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [formData, setFormData] = useState({
    category: 'backend',
    name: '',
    spec_type: '',
    title: '',
    description: '',
    content: '',
    language: '',
    framework_version: '',
    ignore_patterns: [] as string[],
    file_extensions: [] as string[],
    is_active: true,
  });

  useEffect(() => {
    loadSpecs();
  }, []);

  const loadSpecs = async () => {
    setLoading(true);
    try {
      const response = await fetch('http://localhost:8000/api/v1/specs/');
      const data = await response.json();
      setSpecs(data);
    } catch (error) {
      console.error('Failed to load specs:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (spec: Spec) => {
    setSpecToDelete(spec);
    setShowDeleteDialog(true);
  };

  const confirmDelete = async () => {
    if (!specToDelete) return;

    setIsDeleting(true);
    try {
      await fetch(`http://localhost:8000/api/v1/specs/${specToDelete.id}`, {
        method: 'DELETE',
      });
      setShowDeleteDialog(false);
      setSpecToDelete(null);
      loadSpecs();
    } catch (error) {
      console.error('Failed to delete spec:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleOpenCreate = () => {
    setFormData({
      category: 'backend',
      name: '',
      spec_type: '',
      title: '',
      description: '',
      content: '',
      language: '',
      framework_version: '',
      ignore_patterns: [],
      file_extensions: [],
      is_active: true,
    });
    setShowCreateDialog(true);
  };

  const handleOpenEdit = (spec: Spec) => {
    setFormData({
      category: spec.category,
      name: spec.name,
      spec_type: spec.spec_type,
      title: spec.title,
      description: spec.description || '',
      content: spec.content,
      language: spec.language || '',
      framework_version: spec.framework_version || '',
      ignore_patterns: spec.ignore_patterns || [],
      file_extensions: spec.file_extensions || [],
      is_active: spec.is_active,
    });
    setSelectedSpec(spec);
    setShowEditDialog(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      await fetch('http://localhost:8000/api/v1/specs/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      setShowCreateDialog(false);
      loadSpecs();
    } catch (error) {
      console.error('Failed to create spec:', error);
      showError('Failed to create spec. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSpec) return;

    setIsSubmitting(true);

    try {
      await fetch(`http://localhost:8000/api/v1/specs/${selectedSpec.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      setShowEditDialog(false);
      loadSpecs();
    } catch (error) {
      console.error('Failed to update spec:', error);
      showError('Failed to update spec. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredSpecs = specs.filter(spec => {
    const matchesCategory = filterCategory === 'all' || spec.category === filterCategory;
    const matchesStatus = filterStatus === 'all' ||
      (filterStatus === 'active' && spec.is_active) ||
      (filterStatus === 'inactive' && !spec.is_active);
    const matchesSearch =
      spec.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      spec.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      spec.spec_type.toLowerCase().includes(searchTerm.toLowerCase());

    return matchesCategory && matchesStatus && matchesSearch;
  });

  const stats = {
    total: specs.length,
    active: specs.filter(s => s.is_active).length,
    byCategory: CATEGORIES.map(cat => ({
      ...cat,
      count: specs.filter(s => s.category === cat.value).length,
    })),
  };

  const getCategoryIcon = (category: string) => {
    const cat = CATEGORIES.find(c => c.value === category);
    if (!cat) return FileCode;
    return cat.icon;
  };

  const getCategoryColor = (category: string) => {
    const cat = CATEGORIES.find(c => c.value === category);
    return cat?.color || 'gray';
  };

  return (
    <Layout>
      {/* Breadcrumb and action button aligned on same row */}
      <div className="flex justify-between items-center mb-6">
        <Breadcrumbs />
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => router.push('/specs/generate')}>
            <Sparkles className="w-4 h-4 mr-2" />
            Generate from Code
          </Button>
          <Button variant="primary" onClick={handleOpenCreate}>
            <Plus className="w-4 h-4 mr-2" />
            Add Spec
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Specifications</h1>
          <p className="mt-2 text-gray-600">
            Manage framework specifications for dynamic interview questions and prompt generation using prompter architecture, where specs serve as contracts
          </p>
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-6 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-sm text-gray-500">Total Specs</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{stats.total}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-sm text-gray-500">Active</p>
                <p className="text-3xl font-bold text-green-600 mt-1">{stats.active}</p>
              </div>
            </CardContent>
          </Card>
          {stats.byCategory.map(cat => {
            const Icon = cat.icon;
            return (
              <Card key={cat.value}>
                <CardContent className="pt-6">
                  <div className="text-center">
                    <Icon className={`w-5 h-5 mx-auto text-${cat.color}-600 mb-1`} />
                    <p className="text-sm text-gray-500">{cat.label}</p>
                    <p className={`text-3xl font-bold text-${cat.color}-600 mt-1`}>{cat.count}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-4">
              <div className="flex-1 min-w-[200px]">
                <Input
                  placeholder="Search specs..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full"
                />
              </div>
              <div>
                <select
                  className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                >
                  <option value="all">All Categories</option>
                  {CATEGORIES.map(cat => (
                    <option key={cat.value} value={cat.value}>{cat.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <select
                  className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                >
                  <option value="all">All Status</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              {(searchTerm || filterCategory !== 'all' || filterStatus !== 'all') && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchTerm('');
                    setFilterCategory('all');
                    setFilterStatus('all');
                  }}
                >
                  <X className="w-4 h-4 mr-2" />
                  Clear Filters
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Specs Table */}
        <Card>
          <CardHeader>
            <CardTitle>
              Specifications ({filteredSpecs.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              </div>
            ) : filteredSpecs.length === 0 ? (
              <div className="text-center py-12">
                <FileCode className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">No specs found</p>
                {searchTerm && (
                  <p className="text-sm text-gray-400 mt-1">
                    Try adjusting your search or filters
                  </p>
                )}
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
                        Framework
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Type
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Title
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Language
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Version
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Usage
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredSpecs.map((spec) => {
                      const Icon = getCategoryIcon(spec.category);
                      const color = getCategoryColor(spec.category);

                      return (
                        <tr key={spec.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <Icon className={`w-4 h-4 text-${color}-600 mr-2`} />
                              <span className="text-sm font-medium text-gray-900 capitalize">
                                {spec.category}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm text-gray-900">{spec.name}</span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm text-gray-600">{spec.spec_type}</span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="text-sm text-gray-900">{spec.title}</div>
                            {spec.description && (
                              <div className="text-xs text-gray-500 mt-1 line-clamp-1">
                                {spec.description}
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm text-gray-600">{spec.language || '-'}</span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm text-gray-600">{spec.framework_version || '-'}</span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm text-gray-900">{spec.usage_count}</span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <Badge variant={spec.is_active ? 'success' : 'default'}>
                              {spec.is_active ? 'Active' : 'Inactive'}
                            </Badge>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleOpenEdit(spec)}
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDelete(spec)}
                                className="text-red-600 hover:text-red-700"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Info Card */}
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <div className="text-blue-600 text-xl">💡</div>
              <div className="flex-1">
                <h3 className="font-semibold text-blue-900 mb-1">
                  Dynamic System & Prompter Architecture
                </h3>
                <p className="text-sm text-blue-800">
                  Specs power the dynamic interview system and serve as contracts for prompt generation.
                  Adding new specs automatically makes them available in interview questions and enhances
                  AI-driven code generation with architectural guidelines. No code changes needed!
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Create Dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Create New Spec</h2>

            <form onSubmit={handleCreate} className="space-y-6">
              {/* Category and Framework */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Category *
                  </label>
                  <select
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    required
                  >
                    {CATEGORIES.map(cat => (
                      <option key={cat.value} value={cat.value}>{cat.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Framework Name *
                  </label>
                  <Input
                    placeholder="e.g., laravel, nextjs, postgresql"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>
              </div>

              {/* Spec Type and Title */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Spec Type *
                  </label>
                  <Input
                    placeholder="e.g., controller, model, page"
                    value={formData.spec_type}
                    onChange={(e) => setFormData({ ...formData, spec_type: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Title *
                  </label>
                  <Input
                    placeholder="Human-readable title"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    required
                  />
                </div>
              </div>

              {/* Language and Version */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Programming Language
                  </label>
                  <Input
                    placeholder="e.g., PHP, TypeScript, Python"
                    value={formData.language}
                    onChange={(e) => setFormData({ ...formData, language: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Framework Version
                  </label>
                  <Input
                    placeholder="e.g., 10.x, 14.x"
                    value={formData.framework_version}
                    onChange={(e) => setFormData({ ...formData, framework_version: e.target.value })}
                  />
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description
                </label>
                <textarea
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={2}
                  placeholder="Brief description of this specification"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>

              {/* Content */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Specification Content *
                </label>
                <textarea
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                  rows={8}
                  placeholder="Enter the specification content/template here"
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  required
                />
              </div>

              {/* File Extensions */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  File Extensions (comma-separated)
                </label>
                <Input
                  placeholder="e.g., .php, .tsx, .py"
                  value={formData.file_extensions.join(', ')}
                  onChange={(e) => setFormData({
                    ...formData,
                    file_extensions: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                  })}
                />
              </div>

              {/* Ignore Patterns */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Ignore Patterns (comma-separated)
                </label>
                <Input
                  placeholder="e.g., node_modules, vendor, .git"
                  value={formData.ignore_patterns.join(', ')}
                  onChange={(e) => setFormData({
                    ...formData,
                    ignore_patterns: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                  })}
                />
              </div>

              {/* Is Active */}
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="create-is-active"
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  checked={formData.is_active}
                  onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                />
                <label htmlFor="create-is-active" className="ml-2 text-sm text-gray-700">
                  Active (make this spec available in interviews)
                </label>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowCreateDialog(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Creating...' : 'Create Spec'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Dialog */}
      {showEditDialog && selectedSpec && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Edit Spec</h2>

            <form onSubmit={handleUpdate} className="space-y-6">
              {/* Category and Framework */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Category *
                  </label>
                  <select
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    required
                  >
                    {CATEGORIES.map(cat => (
                      <option key={cat.value} value={cat.value}>{cat.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Framework Name *
                  </label>
                  <Input
                    placeholder="e.g., laravel, nextjs, postgresql"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>
              </div>

              {/* Spec Type and Title */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Spec Type *
                  </label>
                  <Input
                    placeholder="e.g., controller, model, page"
                    value={formData.spec_type}
                    onChange={(e) => setFormData({ ...formData, spec_type: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Title *
                  </label>
                  <Input
                    placeholder="Human-readable title"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    required
                  />
                </div>
              </div>

              {/* Language and Version */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Programming Language
                  </label>
                  <Input
                    placeholder="e.g., PHP, TypeScript, Python"
                    value={formData.language}
                    onChange={(e) => setFormData({ ...formData, language: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Framework Version
                  </label>
                  <Input
                    placeholder="e.g., 10.x, 14.x"
                    value={formData.framework_version}
                    onChange={(e) => setFormData({ ...formData, framework_version: e.target.value })}
                  />
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description
                </label>
                <textarea
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={2}
                  placeholder="Brief description of this specification"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>

              {/* Content */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Specification Content *
                </label>
                <textarea
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                  rows={8}
                  placeholder="Enter the specification content/template here"
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  required
                />
              </div>

              {/* File Extensions */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  File Extensions (comma-separated)
                </label>
                <Input
                  placeholder="e.g., .php, .tsx, .py"
                  value={formData.file_extensions.join(', ')}
                  onChange={(e) => setFormData({
                    ...formData,
                    file_extensions: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                  })}
                />
              </div>

              {/* Ignore Patterns */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Ignore Patterns (comma-separated)
                </label>
                <Input
                  placeholder="e.g., node_modules, vendor, .git"
                  value={formData.ignore_patterns.join(', ')}
                  onChange={(e) => setFormData({
                    ...formData,
                    ignore_patterns: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                  })}
                />
              </div>

              {/* Is Active */}
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="edit-is-active"
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  checked={formData.is_active}
                  onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                />
                <label htmlFor="edit-is-active" className="ml-2 text-sm text-gray-700">
                  Active (make this spec available in interviews)
                </label>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowEditDialog(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Updating...' : 'Update Spec'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Spec?</h3>
            <p className="text-sm text-gray-600 mb-4">Are you sure you want to delete this specification?</p>

            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <div className="flex items-start gap-3">
                <div className="text-red-600 text-2xl">⚠️</div>
                <div>
                  <h4 className="font-semibold text-red-900 mb-1">Warning: This action cannot be undone!</h4>
                  <p className="text-sm text-red-800">
                    Spec "{specToDelete?.title}" will be permanently deleted. This may affect interview questions that rely on this specification.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowDeleteDialog(false)}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={confirmDelete}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Yes, Delete Spec'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

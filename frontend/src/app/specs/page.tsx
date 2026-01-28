/**
 * Specs Administration Page
 * Manage framework specifications for dynamic interview questions
 *
 * PROMPT #117 - Project-specific Specs
 * - Added project filter dropdown (same pattern as commits/rag pages)
 * - Specs are now filtered by selected project
 */

'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Layout, Breadcrumbs } from '@/components/layout';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Badge, Select } from '@/components/ui';
import { Plus, Edit, Trash2, X, FileCode, Database, Layout as LayoutIcon, Palette, Sparkles, RefreshCw, FolderOpen, AlertCircle } from 'lucide-react';
import { useNotification } from '@/hooks';
import { projectsApi } from '@/lib/api';
import { Project } from '@/lib/types';

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
  version: number;
  git_commit_hash?: string;
  created_at: string;
  updated_at: string;
  project_id?: string;
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

  // Project state
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [loadingProjects, setLoadingProjects] = useState(true);

  // Specs state
  const [specs, setSpecs] = useState<Spec[]>([]);
  const [loading, setLoading] = useState(false);
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

  // Load projects on mount
  useEffect(() => {
    const loadProjects = async () => {
      setLoadingProjects(true);
      try {
        const data = await projectsApi.list();
        const projectsList = Array.isArray(data) ? data : data.data || [];
        setProjects(projectsList);
      } catch (error) {
        console.error('Failed to load projects:', error);
      } finally {
        setLoadingProjects(false);
      }
    };
    loadProjects();
  }, []);

  // Auto-select first project when projects load
  useEffect(() => {
    if (!selectedProject && projects.length > 0) {
      setSelectedProject(projects[0].id);
    }
  }, [projects, selectedProject]);

  // Load specs when project changes
  useEffect(() => {
    if (selectedProject) {
      loadSpecs();
    }
  }, [selectedProject]);

  const loadSpecs = async () => {
    if (!selectedProject) return;

    setLoading(true);
    try {
      const url = `http://localhost:8000/api/v1/specs/?project_id=${selectedProject}`;
      const response = await fetch(url);
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
        body: JSON.stringify({
          ...formData,
          project_id: selectedProject,
        }),
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

  const getCategoryIcon = (category: string) => {
    const cat = CATEGORIES.find(c => c.value === category);
    if (!cat) return FileCode;
    return cat.icon;
  };

  const getCategoryColor = (category: string) => {
    const cat = CATEGORIES.find(c => c.value === category);
    return cat?.color || 'gray';
  };

  const selectedProjectData = projects.find(p => p.id === selectedProject);

  if (loadingProjects) {
    return (
      <Layout>
        <Breadcrumbs />
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading projects...</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <Breadcrumbs />
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-100 rounded-lg">
              <FileCode className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Specifications</h1>
              <p className="text-gray-600 mt-1">
                Manage framework specifications for dynamic interview questions
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => router.push('/specs/generate')}>
              <Sparkles className="w-4 h-4 mr-2" />
              Generate from Code
            </Button>
            <Button variant="primary" onClick={handleOpenCreate} disabled={!selectedProject}>
              <Plus className="w-4 h-4 mr-2" />
              Add Spec
            </Button>
          </div>
        </div>

        {projects.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <AlertCircle className="w-16 h-16 mx-auto text-gray-300 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Projects Found</h3>
              <p className="text-gray-600 mb-4">
                Create a project to start managing specifications.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {/* Project Filter */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-col md:flex-row gap-4">
                  {/* Project Dropdown */}
                  <div className="w-full md:w-64">
                    <Select
                      value={selectedProject}
                      onChange={(e) => setSelectedProject(e.target.value)}
                      options={projects.map(project => ({
                        value: project.id,
                        label: project.name,
                      }))}
                    />
                  </div>

                  {/* Search */}
                  <div className="flex-1">
                    <Input
                      placeholder="Search specs..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full"
                    />
                  </div>

                  {/* Category Filter */}
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

                  {/* Status Filter */}
                  <select
                    className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                  >
                    <option value="all">All Status</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>

                  {/* Refresh */}
                  <Button variant="outline" onClick={loadSpecs} disabled={loading}>
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                  </Button>
                </div>

                {/* Stats Row */}
                <div className="flex items-center gap-4 mt-4 pt-4 border-t border-gray-100">
                  <div className="flex items-center gap-2">
                    <FolderOpen className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-gray-600">
                      Project: <strong>{selectedProjectData?.name || 'None'}</strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <FileCode className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-gray-600">
                      {specs.length} specs ({specs.filter(s => s.is_active).length} active)
                    </span>
                  </div>
                  {selectedProjectData?.code_path && (
                    <div className="text-sm text-gray-400 truncate max-w-xs" title={selectedProjectData.code_path}>
                      {selectedProjectData.code_path}
                    </div>
                  )}
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
                      <X className="w-4 h-4 mr-1" />
                      Clear Filters
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Loading */}
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                  <p className="text-gray-600">Loading specs...</p>
                </div>
              </div>
            ) : (
              <>
                {/* Specs Table */}
                <Card>
                  <CardHeader>
                    <CardTitle>
                      Specifications ({filteredSpecs.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {filteredSpecs.length === 0 ? (
                      <div className="text-center py-12">
                        <FileCode className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                        <p className="text-gray-500">No specs found for this project</p>
                        <p className="text-sm text-gray-400 mt-1">
                          Run Pattern Discovery or add specs manually
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
                                    <div className="flex items-center gap-1">
                                      <span className="text-sm font-medium text-gray-900">v{spec.version || 1}</span>
                                      {spec.git_commit_hash && (
                                        <span className="text-xs text-gray-400 font-mono">
                                          @{spec.git_commit_hash}
                                        </span>
                                      )}
                                    </div>
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
                          Project-Specific Specs (PROMPT #117)
                        </h3>
                        <p className="text-sm text-blue-800">
                          Specs are now project-specific. Each project has its own set of specifications
                          discovered from its codebase. Use the project dropdown to switch between projects
                          and view their specs. Run Pattern Discovery to automatically discover code patterns.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        )}
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
                    Spec &quot;{specToDelete?.title}&quot; will be permanently deleted. This may affect interview questions that rely on this specification.
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

      {NotificationComponent}
    </Layout>
  );
}

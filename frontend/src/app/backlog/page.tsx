/**
 * Backlog Page
 * Hierarchical view of Epics, Stories, Tasks, Subtasks, and Bugs
 * JIRA Transformation - PROMPT #62 - Phase 3
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Layout, Breadcrumbs } from '@/components/layout';
import { Button } from '@/components/ui';
import { BacklogListView, BacklogFilters, BulkActionBar, ItemDetailPanel } from '@/components/backlog';
import { projectsApi, tasksApi } from '@/lib/api';
import { BacklogFilters as IBacklogFilters, BacklogItem, Project, PriorityLevel, TaskStatus } from '@/lib/types';

export default function BacklogPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedItem, setSelectedItem] = useState<BacklogItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<IBacklogFilters>({});
  const [showFilters, setShowFilters] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    setLoading(true);
    try {
      const response = await projectsApi.list();
      const data = response.data || response;
      const projectsArray = Array.isArray(data) ? data : [];
      setProjects(projectsArray);

      // Auto-select first project if available
      if (projectsArray.length > 0 && !selectedProjectId) {
        setSelectedProjectId(projectsArray[0].id);
      }
    } catch (error) {
      console.error('Error fetching projects:', error);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  };

  const handleFiltersChange = (newFilters: IBacklogFilters) => {
    setFilters(newFilters);
  };

  const handleClearFilters = () => {
    setFilters({});
  };

  const handleItemSelect = (item: BacklogItem) => {
    setSelectedItem(item);
  };

  const handleBulkAssign = async (assignee: string) => {
    try {
      for (const id of selectedIds) {
        await tasksApi.update(id, { assignee });
      }
      // Refresh the backlog
      window.location.reload();
    } catch (error) {
      console.error('Error assigning items:', error);
    }
  };

  const handleBulkChangePriority = async (priority: PriorityLevel) => {
    try {
      for (const id of selectedIds) {
        await tasksApi.update(id, { priority });
      }
      // Refresh the backlog
      window.location.reload();
    } catch (error) {
      console.error('Error changing priority:', error);
    }
  };

  const handleBulkAddLabel = async (label: string) => {
    try {
      for (const id of selectedIds) {
        // Fetch current labels first
        const item = await tasksApi.get(id);
        const currentLabels = item.labels || [];
        if (!currentLabels.includes(label)) {
          await tasksApi.update(id, { labels: [...currentLabels, label] });
        }
      }
      // Refresh the backlog
      window.location.reload();
    } catch (error) {
      console.error('Error adding label:', error);
    }
  };

  const handleBulkMoveToStatus = async (status: TaskStatus) => {
    try {
      for (const id of selectedIds) {
        await tasksApi.update(id, { status, workflow_state: status });
      }
      // Refresh the backlog
      window.location.reload();
    } catch (error) {
      console.error('Error moving items:', error);
    }
  };

  const handleBulkDelete = async () => {
    try {
      for (const id of selectedIds) {
        await tasksApi.delete(id);
      }
      setSelectedIds(new Set());
      // Refresh the backlog
      window.location.reload();
    } catch (error) {
      console.error('Error deleting items:', error);
    }
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
  };

  if (loading) {
    return (
      <Layout>
        <Breadcrumbs />
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </Layout>
    );
  }

  if (projects.length === 0) {
    return (
      <Layout>
        <Breadcrumbs />
        <div className="text-center py-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">No Projects Found</h2>
          <p className="text-gray-600 mb-4">Create a project first to manage your backlog.</p>
          <Button variant="primary" onClick={() => window.location.href = '/projects'}>
            Go to Projects
          </Button>
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
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Backlog</h1>
            <p className="mt-1 text-sm text-gray-500">
              Hierarchical view of Epics, Stories, Tasks, and Bugs
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Project Selector */}
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>

            {/* Toggle Filters Button */}
            <Button
              variant="outline"
              onClick={() => setShowFilters(!showFilters)}
              leftIcon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
              }
            >
              {showFilters ? 'Hide Filters' : 'Show Filters'}
            </Button>

            {/* Create Item Button */}
            <Button
              variant="primary"
              onClick={() => {/* TODO: Open create dialog */}}
              leftIcon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              }
            >
              New Item
            </Button>
          </div>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Filters Sidebar */}
          {showFilters && (
            <div className="lg:col-span-1">
              <BacklogFilters
                filters={filters}
                onFiltersChange={handleFiltersChange}
                onClearFilters={handleClearFilters}
              />
            </div>
          )}

          {/* Backlog List */}
          <div className={showFilters ? 'lg:col-span-3' : 'lg:col-span-4'}>
            {selectedProjectId ? (
              <BacklogListView
                projectId={selectedProjectId}
                onItemSelect={handleItemSelect}
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
                filters={filters}
              />
            ) : (
              <div className="text-center py-12 text-gray-500">
                Select a project to view backlog
              </div>
            )}
          </div>
        </div>

        {/* Bulk Action Bar (appears when items are selected) */}
        <BulkActionBar
          selectedCount={selectedIds.size}
          selectedIds={selectedIds}
          onAssignTo={handleBulkAssign}
          onChangePriority={handleBulkChangePriority}
          onAddLabel={handleBulkAddLabel}
          onMoveToStatus={handleBulkMoveToStatus}
          onDelete={handleBulkDelete}
          onClearSelection={handleClearSelection}
        />

        {/* Item Detail Panel */}
        {selectedItem && (
          <ItemDetailPanel
            item={selectedItem}
            onClose={() => setSelectedItem(null)}
            onUpdate={() => {
              // Refresh the backlog after updates
              window.location.reload();
            }}
          />
        )}
      </div>
    </Layout>
  );
}

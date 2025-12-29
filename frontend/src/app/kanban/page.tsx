/**
 * Kanban Page
 * Kanban board for managing tasks
 */

'use client';

import React, { useEffect, useState } from 'react';
import { Layout, Breadcrumbs } from '@/components/layout';
import { KanbanBoard } from '@/components/kanban';
import { projectsApi } from '@/lib/api';
import { Project } from '@/lib/types';
import { Select } from '@/components/ui';

export default function KanbanPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const response = await projectsApi.list();
        const data = response.data || response;
        const projectsList = Array.isArray(data) ? data : [];
        setProjects(projectsList);

        // Auto-select first project
        if (projectsList.length > 0) {
          setSelectedProjectId(projectsList[0].id);
        }
      } catch (error) {
        console.error('Error fetching projects:', error);
        setProjects([]); // Reset to empty array on error
      } finally {
        setLoading(false);
      }
    };

    fetchProjects();
  }, []);

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </Layout>
    );
  }

  if (projects.length === 0) {
    return (
      <Layout>
        <div className="text-center py-12">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
            />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900">No projects</h3>
          <p className="mt-1 text-sm text-gray-500">
            Create a project first to use the Kanban board.
          </p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <Breadcrumbs />
      <div className="space-y-6">
        {/* Project Selector */}
        <div className="bg-white p-4 rounded-lg shadow">
          <Select
            label="Select Project"
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
          />
        </div>

        {/* Kanban Board */}
        {selectedProjectId && <KanbanBoard projectId={selectedProjectId} />}
      </div>
    </Layout>
  );
}

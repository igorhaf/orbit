/**
 * Projects List Page
 * View and manage all projects
 */

'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Layout, Breadcrumbs } from '@/components/layout';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Dialog,
  AIModelBadge,
} from '@/components/ui';
import { projectsApi } from '@/lib/api';
import { Project } from '@/lib/types';

/**
 * PROMPT #192 - Strip markdown syntax for plain-text preview in project cards.
 * Removes #, *, -, >, ```, links, images, etc. leaving clean readable text.
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')       // headers
    .replace(/\*\*([^*]+)\*\*/g, '$1')  // bold
    .replace(/\*([^*]+)\*/g, '$1')      // italic
    .replace(/`([^`]+)`/g, '$1')        // inline code
    .replace(/```[\s\S]*?```/g, '')     // code blocks
    .replace(/!\[.*?\]\(.*?\)/g, '')    // images
    .replace(/\[([^\]]+)\]\(.*?\)/g, '$1') // links
    .replace(/^[-*]\s+/gm, '')         // list items
    .replace(/^>\s+/gm, '')            // blockquotes
    .replace(/---+/g, '')              // horizontal rules
    .replace(/\n{3,}/g, '\n\n')        // excessive newlines
    .trim();
}

// PROMPT #301 - Processing state removed; projects are now always active from creation

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // PROMPT #301 - Removed processing job tracking (projects are always active now)

  const fetchProjects = useCallback(async () => {
    try {
      const response = await projectsApi.list();
      const data = response.data || response;
      const projectsList = Array.isArray(data) ? data : [];
      setProjects(projectsList);
      return projectsList;
    } catch (error) {
      console.error('Error fetching projects:', error);
      setProjects([]);
      return [];
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await fetchProjects();
      setLoading(false);
    };
    init();
  }, [fetchProjects]);

  // PROMPT #301 - Removed processing job polling (projects are always active now)

  const handleDeleteProject = async (project: Project) => {
    setProjectToDelete(project);
    setShowDeleteDialog(true);
  };

  const confirmDeleteProject = async () => {
    if (!projectToDelete) return;

    setIsDeleting(true);
    try {
      await projectsApi.delete(projectToDelete.id);
      setShowDeleteDialog(false);
      setProjectToDelete(null);
      fetchProjects();
    } catch (error) {
      console.error('Error deleting project:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Layout>
      <Breadcrumbs />
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Projetos</h1>
            <p className="mt-1 text-sm text-gray-500">
              Gerencie seus projetos de orquestracao de IA
            </p>
          </div>
          <Button
            variant="primary"
            onClick={() => router.push('/projects/new')}
            leftIcon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
            }
          >
            Novo Projeto
          </Button>
        </div>

        {/* Projects List */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : projects.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
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
              <h3 className="mt-2 text-sm font-medium text-gray-900">Nenhum projeto</h3>
              <p className="mt-1 text-sm text-gray-500">
                Comece criando um novo projeto.
              </p>
              <div className="mt-6">
                <Button variant="primary" onClick={() => router.push('/projects/new')}>
                  Novo Projeto
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project) => {
              return (
              <Card
                key={project.id}
                variant="bordered"
              >
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>
                      {project.name}
                    </CardTitle>
                    {/* PROMPT #301 - Simplified status badge (no more processing state) */}
                    {project.status === 'active' ? (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        Ativo
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                        Rascunho
                      </span>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="text-sm text-gray-600 line-clamp-3">
                      {project.description ? stripMarkdown(project.description) : 'Sem descrição'}
                    </p>
                    {/* PROMPT #128 - Show AI model icon if project has AI-generated context */}
                    {project.context_human && (
                      <AIModelBadge model="context" usage_type="context" decorative />
                    )}
                  </div>
                  {/* PROMPT #111 - Show code_path */}
                  {project.code_path && (
                    <div className="text-xs text-gray-500 mb-2 font-mono truncate" title={project.code_path}>
                      {project.code_path}
                    </div>
                  )}
                  {/* Show stack info if provisioned */}
                  {project.stack_backend && (
                    <div className="text-xs text-gray-500 mb-2 flex flex-wrap gap-1">
                      <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{project.stack_backend}</span>
                      <span className="bg-purple-50 text-purple-700 px-2 py-0.5 rounded">{project.stack_database}</span>
                      {project.stack_frontend && project.stack_frontend !== 'none' && (
                        <span className="bg-pink-50 text-pink-700 px-2 py-0.5 rounded">{project.stack_frontend}</span>
                      )}
                      <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded">{project.stack_css}</span>
                    </div>
                  )}
                  <div className="text-xs text-gray-400 mb-4">
                    Criado: {new Date(project.created_at).toLocaleDateString()}
                  </div>
                  <div className="flex gap-2">
                    <Link href={`/projects/${project.id}`} className="flex-1">
                      <Button variant="primary" size="sm" className="w-full">
                        Ver
                      </Button>
                    </Link>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleDeleteProject(project)}
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </Button>
                  </div>
                </CardContent>
              </Card>
              );
            })}
          </div>
        )}

        {/* Delete Confirmation Dialog */}
        <Dialog
          open={showDeleteDialog}
          onClose={() => setShowDeleteDialog(false)}
          title="Excluir Projeto?"
          description="Tem certeza que deseja excluir este projeto?"
        >
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="text-red-600"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg></div>
                <div>
                  <h4 className="font-semibold text-red-900 mb-1">Atenção: Esta ação não pode ser desfeita!</h4>
                  <p className="text-sm text-red-800">
                    O projeto &quot;{projectToDelete?.name}&quot; e todos os dados associados (tarefas, entrevistas, wiki, jobs, documentos RAG) serao permanentemente excluidos.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowDeleteDialog(false)}
                disabled={isDeleting}
              >
                Cancelar
              </Button>
              <Button
                variant="danger"
                onClick={confirmDeleteProject}
                disabled={isDeleting}
                isLoading={isDeleting}
              >
                Sim, Excluir Projeto
              </Button>
            </div>
          </div>
        </Dialog>

      </div>
    </Layout>
  );
}

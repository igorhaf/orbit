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
  Input,
  Dialog,
  DialogFooter,
  AIModelBadge,
} from '@/components/ui';
import { projectsApi, jobsApi } from '@/lib/api';
import { Project, ProjectCreate } from '@/lib/types';

// PROMPT #121 - Track pipeline job progress per processing project
interface ProcessingJobInfo {
  jobId: string;
  progress: number;
  message: string;
}

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [projectToEdit, setProjectToEdit] = useState<Project | null>(null);
  // PROMPT #111 - formData não inclui code_path (imutável após criação)
  const [formData, setFormData] = useState<Omit<ProjectCreate, 'code_path'>>({
    name: '',
    description: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // PROMPT #121 - Processing job progress map: projectId -> job info
  const [processingJobs, setProcessingJobs] = useState<Record<string, ProcessingJobInfo>>({});

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

  // PROMPT #121 - Poll job progress for processing projects
  useEffect(() => {
    const processingProjects = projects.filter(p => p.status === 'processing');
    if (processingProjects.length === 0) return;

    // Fetch active pipeline jobs for each processing project
    const fetchJobProgress = async () => {
      const newJobs: Record<string, ProcessingJobInfo> = {};

      for (const project of processingProjects) {
        try {
          const jobsRes = await jobsApi.list({
            project_id: project.id,
            job_type: 'project_pipeline',
            limit: 1,
            sort_by: 'created_at',
            sort_order: 'desc',
          });
          const jobs = jobsRes.data || jobsRes;
          const jobList = Array.isArray(jobs) ? jobs : jobs?.items || [];

          if (jobList.length > 0) {
            const job = jobList[0];
            newJobs[project.id] = {
              jobId: job.id,
              progress: job.progress_percent || 0,
              message: job.progress_message || 'Processing...',
            };

            // If job completed/failed, refresh projects to get updated status
            if (job.status === 'completed' || job.status === 'failed') {
              fetchProjects();
            }
          }
        } catch (e) {
          // Silently ignore job fetch errors
        }
      }

      setProcessingJobs(newJobs);
    };

    fetchJobProgress();
    const interval = setInterval(fetchJobProgress, 3000);
    return () => clearInterval(interval);
  }, [projects, fetchProjects]);

  const handleOpenEdit = (project: Project) => {
    setProjectToEdit(project);
    // PROMPT #111 - code_path é imutável, não incluir no formData
    setFormData({
      name: project.name,
      description: project.description || '',
    });
    setShowEditDialog(true);
  };

  const handleUpdateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectToEdit) return;

    setIsSubmitting(true);

    try {
      await projectsApi.update(projectToEdit.id, formData);
      setShowEditDialog(false);
      setProjectToEdit(null);
      // PROMPT #111 - code_path removido (imutável)
      setFormData({ name: '', description: '' });
      fetchProjects();
    } catch (error) {
      console.error('Error updating project:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

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
            <h1 className="text-3xl font-bold text-gray-900">Projects</h1>
            <p className="mt-1 text-sm text-gray-500">
              Manage your AI orchestration projects
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
            New Project
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
              <h3 className="mt-2 text-sm font-medium text-gray-900">No projects</h3>
              <p className="mt-1 text-sm text-gray-500">
                Get started by creating a new project.
              </p>
              <div className="mt-6">
                <Button variant="primary" onClick={() => router.push('/projects/new')}>
                  New Project
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project) => {
              const isProcessing = project.status === 'processing';
              const jobInfo = processingJobs[project.id];
              const folderName = project.code_path?.split('/').pop() || project.name;

              return (
              <Card key={project.id} variant="bordered">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className={isProcessing ? 'text-gray-500' : ''}>
                      {isProcessing ? folderName : project.name}
                    </CardTitle>
                    {/* PROMPT #121 - Project lifecycle status badge with processing state */}
                    {isProcessing ? (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-600 mr-1" />
                        Processing
                      </span>
                    ) : project.status === 'active' ? (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                        Draft
                      </span>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {isProcessing ? (
                    /* PROMPT #121 - Processing card with live progress bar */
                    <div className="space-y-3">
                      {/* Folder path */}
                      {project.code_path && (
                        <div className="text-xs text-gray-500 font-mono truncate" title={project.code_path}>
                          {project.code_path}
                        </div>
                      )}

                      {/* Progress bar */}
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs text-gray-500">
                            {jobInfo?.message || 'Initializing...'}
                          </span>
                          <span className="text-xs font-medium text-blue-600">
                            {Math.round(jobInfo?.progress || 0)}%
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-blue-600 h-2 rounded-full transition-all duration-700"
                            style={{ width: `${jobInfo?.progress || 0}%` }}
                          />
                        </div>
                      </div>

                      {/* Timestamp */}
                      <div className="text-xs text-gray-400">
                        Created: {new Date(project.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  ) : (
                  <>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="text-sm text-gray-600 line-clamp-3">
                      {project.description || 'No description'}
                    </p>
                    {/* PROMPT #128 - Show AI model icon if project has AI-generated context */}
                    {project.context_human && (
                      <AIModelBadge model="context" usage_type="context" />
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
                    Created: {new Date(project.created_at).toLocaleDateString()}
                  </div>
                  <div className="flex gap-2">
                    <Link href={`/projects/${project.id}`} className="flex-1">
                      <Button variant="primary" size="sm" className="w-full">
                        View
                      </Button>
                    </Link>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleOpenEdit(project)}
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
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                        />
                      </svg>
                    </Button>
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
                  </>
                  )}
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
          title="Delete Project?"
          description="Are you sure you want to delete this project?"
        >
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="text-red-600 text-2xl">⚠️</div>
                <div>
                  <h4 className="font-semibold text-red-900 mb-1">Warning: This action cannot be undone!</h4>
                  <p className="text-sm text-red-800">
                    Project &quot;{projectToDelete?.name}&quot; and all associated data (tasks, interviews, commits) will be permanently deleted.
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
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={confirmDeleteProject}
                disabled={isDeleting}
                isLoading={isDeleting}
              >
                Yes, Delete Project
              </Button>
            </div>
          </div>
        </Dialog>

        {/* Edit Project Dialog */}
        <Dialog
          open={showEditDialog}
          onClose={() => setShowEditDialog(false)}
          title="Edit Project"
          description="Update project information"
        >
          <form onSubmit={handleUpdateProject}>
            <div className="space-y-4">
              <Input
                label="Project Name"
                placeholder="My AI Project"
                required
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
              />
              <Input
                label="Description"
                placeholder="Project description..."
                value={formData.description || ''}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
              />
              {/* PROMPT #111 - code_path é imutável, exibir apenas como read-only */}
              {projectToEdit?.code_path && (
                <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                  <div className="text-xs font-medium text-gray-500 mb-1">Code Folder (immutable)</div>
                  <div className="text-sm text-gray-700 font-mono break-all">
                    {projectToEdit.code_path}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    This path cannot be changed after project creation.
                  </p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowEditDialog(false)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" isLoading={isSubmitting}>
                Update Project
              </Button>
            </DialogFooter>
          </form>
        </Dialog>
      </div>
    </Layout>
  );
}

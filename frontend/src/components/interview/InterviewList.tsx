/**
 * InterviewList Component
 * List of all interviews with create functionality
 */

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { interviewsApi, projectsApi } from '@/lib/api';
import { Interview, Project } from '@/lib/types';
import { Button, Badge, Card, CardHeader, CardTitle, CardContent, Dialog, DialogFooter, Select } from '@/components/ui';
import { useNotification } from '@/hooks';

interface InterviewListProps {
  projectId?: string;
  showHeader?: boolean;
  showCreateButton?: boolean;
  project?: Project;  // PROMPT #90 - Pass project to detect context state
}

export function InterviewList({
  projectId,
  showHeader = true,
  showCreateButton = true,
  project: projectProp  // PROMPT #90 - Project passed from parent
}: InterviewListProps) {
  const router = useRouter();
  const { showError, showWarning, NotificationComponent } = useNotification();
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState('');
  const [creating, setCreating] = useState(false);
  const [statusFilter, setStatusFilter] = useState('active'); // Default: only open/active interviews

  // PROMPT #87 - Delete confirmation modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [interviewToDelete, setInterviewToDelete] = useState<Interview | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    loadData();
  }, [projectId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [interviewsRes, projectsRes] = await Promise.all([
        interviewsApi.list(),
        projectsApi.list({ limit: 100 }),
      ]);

      // ✅ CRITICAL: Validate data before setting state
      const interviewsData = interviewsRes.data || interviewsRes;
      const projectsData = projectsRes.data || projectsRes;

      let filteredInterviews = Array.isArray(interviewsData) ? interviewsData : [];

      // Filter by project if projectId is provided
      if (projectId) {
        filteredInterviews = filteredInterviews.filter(
          (interview) => interview.project_id === projectId
        );
      }

      setInterviews(filteredInterviews);
      setProjects(Array.isArray(projectsData) ? projectsData : []);
    } catch (error) {
      console.error('Failed to load data:', error);
      // ✅ CRITICAL: Reset to empty arrays on error
      setInterviews([]);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  };

  const getProjectName = (projectId: string): string => {
    const project = projects.find(p => p.id === projectId);
    return project?.name || 'Projeto Desconhecido';
  };

  const handleCreate = async () => {
    // Use the provided projectId or the selected one from the dialog
    const targetProjectId = projectId || selectedProject;

    if (!targetProjectId) {
      showWarning('Selecione um projeto');
      return;
    }

    // PROMPT #137 - Block Epic creation if project has no context
    // Find the target project to check its context
    const targetProject = projectProp || projects.find(p => p.id === targetProjectId);
    if (targetProject && !targetProject.context_locked && !targetProject.context_human) {
      showWarning('Complete a Entrevista de Contexto antes de criar Epics. Va para a página do projeto e clique em "Configurar Contexto".');
      setIsCreateOpen(false);
      return;
    }

    setCreating(true);
    try {
      // PROMPT #97 - First interview with no parent → always meta_prompt
      // Epic creation (first interview) never uses card-focused mode
      // Card-focused is only for hierarchical interviews (Story/Task/Subtask with motivation types)
      const response = await interviewsApi.create({
        project_id: targetProjectId,
        ai_model_used: 'claude-3-sonnet',
        conversation_data: [],
        parent_task_id: null,  // PROMPT #97 - Null = first interview = Epic = meta_prompt
      });

      // Get the created interview ID
      const createdInterview = response.data || response;
      const interviewId = createdInterview.id;

      // Redirect to the interview page (it will auto-start with fixed questions)
      router.push(`/projects/${targetProjectId}/interviews/${interviewId}`);
    } catch (error) {
      console.error('Failed to create interview:', error);
      showError('Falha ao criar entrevista. Tente novamente.');
      setCreating(false);
    }
    // Note: Don't setCreating(false) on success - we're navigating away
  };

  // PROMPT #87 - Delete interview handler
  const handleDeleteClick = (e: React.MouseEvent, interview: Interview) => {
    e.preventDefault(); // Prevent navigation
    e.stopPropagation(); // Stop event bubbling
    setInterviewToDelete(interview);
    setShowDeleteModal(true);
  };

  const handleDeleteConfirm = async () => {
    if (!interviewToDelete) return;

    setIsDeleting(true);
    try {
      await interviewsApi.delete(interviewToDelete.id);
      setShowDeleteModal(false);
      setInterviewToDelete(null);
      await loadData(); // Refresh list
    } catch (error) {
      console.error('Failed to delete interview:', error);
      showError('Falha ao excluir entrevista. Tente novamente.');
    } finally {
      setIsDeleting(false);
    }
  };

  // Filter interviews by status
  const filteredInterviews = statusFilter === 'all'
    ? interviews
    : interviews.filter(interview => interview.status === statusFilter);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="text-gray-600">Carregando entrevistas...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {NotificationComponent}
      {/* Header */}
      {showHeader && (
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Entrevistas</h1>
            <p className="mt-1 text-sm text-gray-500">
              Conduza entrevistas com IA para coletar requisitos
            </p>
          </div>

          {showCreateButton && (
            <Button
              variant="primary"
              onClick={() => setIsCreateOpen(true)}
              leftIcon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              }
            >
              Nova Entrevista
            </Button>
          )}
        </div>
      )}

      {/* Create button when header is hidden but button should be shown */}
      {!showHeader && showCreateButton && (
        <div className="flex justify-end">
          <Button
            variant="primary"
            onClick={() => setIsCreateOpen(true)}
            leftIcon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            }
          >
            Nova Entrevista
          </Button>
        </div>
      )}

      {/* Status Filter */}
      <div className="flex items-center gap-3">
        <label htmlFor="status-filter" className="text-sm font-medium text-gray-700">
          Filtrar por status:
        </label>
        <select
          id="status-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="block w-48 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="active">Entrevistas abertas</option>
          <option value="completed">Entrevistas concluidas</option>
          <option value="all">Todas as entrevistas</option>
        </select>
        <span className="text-sm text-gray-500">
          ({filteredInterviews.length} {filteredInterviews.length === 1 ? 'entrevista' : 'entrevistas'})
        </span>
      </div>

      {/* Interviews Grid */}
      {/* ✅ Safe check with optional chaining */}
      {(filteredInterviews || []).length === 0 ? (
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
                d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
              />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">
              {interviews.length === 0 ? 'Nenhuma entrevista' : `Nenhuma entrevista ${statusFilter === 'all' ? '' : statusFilter}`}
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              {interviews.length === 0
                ? 'Comece criando uma nova sessão de entrevista.'
                : `Nenhuma entrevista com status "${statusFilter}". Tente mudar o filtro ou crie uma nova entrevista.`
              }
            </p>
            <div className="mt-6">
              {interviews.length === 0 ? (
                <Button variant="primary" onClick={() => setIsCreateOpen(true)}>
                  Criar Sua Primeira Entrevista
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setStatusFilter('all')}>
                  Mostrar Todas as Entrevistas
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {(filteredInterviews || []).map((interview) => (
            <Link key={interview.id} href={`/projects/${interview.project_id}/interviews/${interview.id}`}>
              <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
                <CardHeader>
                  {!projectId && (
                    <CardTitle className="text-base font-semibold text-gray-900 mb-2">
                      {getProjectName(interview.project_id)}
                    </CardTitle>
                  )}
                  <div className="flex justify-between items-start">
                    <span className={projectId ? "text-sm text-gray-700 font-bold" : "text-xs text-gray-500"}>
                      {interview.ai_model_used}
                    </span>
                    <span className="text-xs text-gray-400">
                      {interview.conversation_data.length} mensagens
                    </span>
                  </div>
                </CardHeader>

                <CardContent>
                  <p className="text-sm text-gray-600 mb-3 line-clamp-3">
                    {interview.conversation_data.length > 0
                      ? interview.conversation_data[interview.conversation_data.length - 1].content.substring(0, 150) +
                        (interview.conversation_data[interview.conversation_data.length - 1].content.length > 150 ? '...' : '')
                      : 'Nenhuma mensagem. Clique para iniciar a conversa.'}
                  </p>

                  <div className="flex items-center justify-between text-xs text-gray-400 pt-3 border-t border-gray-100">
                    <span>
                      Criado: {new Date(interview.created_at).toLocaleDateString()}
                    </span>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          interview.status === 'active'
                            ? 'success'
                            : interview.status === 'completed'
                            ? 'default'
                            : 'danger'
                        }
                      >
                        {interview.status}
                      </Badge>
                      {/* PROMPT #87 - Delete button */}
                      <button
                        onClick={(e) => handleDeleteClick(e, interview)}
                        className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="Excluir entrevista"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* Create Interview Dialog */}
      <Dialog
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Criar Nova Entrevista"
        description={projectId
          ? "Iniciar nova sessão de entrevista IA para este projeto"
          : "Iniciar nova sessão de entrevista IA para um projeto"
        }
      >
        <div className="space-y-4">
          {/* Only show project selector if projectId is not provided */}
          {!projectId && (
            <>
              <Select
                label="Selecionar Projeto"
                placeholder="-- Selecione um projeto --"
                options={(projects || []).map((p) => ({ value: p.id, label: p.name }))}
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
              />

              {(projects || []).length === 0 && (
                <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded">
                  Nenhum projeto disponível. Crie um projeto primeiro.
                </div>
              )}
            </>
          )}

          {/* Confirmation message when projectId is provided */}
          {projectId && (
            <div className="text-sm text-gray-600 bg-gray-50 p-4 rounded">
              <p className="font-medium mb-1">Pronto para iniciar entrevista</p>
              <p className="text-xs text-gray-500">
                A entrevista sera criada para o projeto atual e iniciara imediatamente.
              </p>
            </div>
          )}

          {/* PROMPT #90 - Context-aware interview type info */}
          {/* Show Context Interview info if project doesn't have context yet */}
          {projectProp && !projectProp.context_locked ? (
            <div className="text-sm text-gray-600 bg-amber-50 p-4 rounded border border-amber-200">
              <p className="font-medium text-gray-900 mb-1">Entrevista de Contexto (Primeiro Passo Obrigatório)</p>
              <p className="text-xs text-gray-600">
                Esta entrevista estabelecera o contexto fundamental do seu projeto.
                Apos concluir, o contexto sera travado e você podera criar Epics.
              </p>
            </div>
          ) : (
            <div className="text-sm text-gray-600 bg-blue-50 p-4 rounded border border-blue-200">
              <p className="font-medium text-gray-900 mb-1">Entrevista de Epic</p>
              <p className="text-xs text-gray-600">
                Esta entrevista criara um Epic para seu projeto.
                Modo focado em cards (com tipos de motivacao) esta disponível para entrevistas hierarquicas
                (Stories, Tasks, Subtasks) criadas a partir deste Epic.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setIsCreateOpen(false);
                setSelectedProject('');
              }}
            >
              Cancelar
            </Button>
            <Button
              variant="primary"
              onClick={handleCreate}
              disabled={(!projectId && !selectedProject) || creating}
              isLoading={creating}
            >
              {creating ? 'Criando...' : 'Criar Entrevista'}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* PROMPT #87 - Delete Confirmation Modal */}
      <Dialog
        open={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setInterviewToDelete(null);
        }}
        title="Excluir Entrevista"
        size="sm"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">
                Excluir esta entrevista?
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Isso excluira permanentemente a entrevista e todas as suas mensagens. Esta ação não pode ser desfeita.
              </p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => {
              setShowDeleteModal(false);
              setInterviewToDelete(null);
            }}
            disabled={isDeleting}
          >
            Cancelar
          </Button>
          <Button
            variant="danger"
            onClick={handleDeleteConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? 'Excluindo...' : 'Excluir'}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

/**
 * New Project Page
 * PROMPT #121 - Project Creation Redesign
 *
 * Simplified flow:
 * 1. Select code folder (FolderPicker)
 * 2. Choose scan depth (quick/normal/deep)
 * 3. Click "Generate" → pipeline runs in background
 * 4. Progress bars show pipeline stages
 * 5. When done, redirect to project page
 */

'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Layout, Breadcrumbs } from '@/components/layout';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FolderPicker } from '@/components/ui/FolderPicker';
import { useNotification, useJobPolling } from '@/hooks';
import { useNotifications } from '@/contexts/NotificationContext';
import { projectsApi, jobsApi } from '@/lib/api';

function NewProjectContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showError, showWarning, NotificationComponent } = useNotification();
  const { addJob } = useNotifications();

  // Form state
  const [codePath, setCodePath] = useState('');
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [scanDepth, setScanDepth] = useState<'quick' | 'normal' | 'deep'>('normal');

  // Pipeline state
  const [processing, setProcessing] = useState(false);
  const [pipelineJobId, setPipelineJobId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // PROMPT #189 - Resume pipeline progress when navigated from projects list
  useEffect(() => {
    const resumeProjectId = searchParams.get('projectId');
    const resumeJobId = searchParams.get('jobId');

    if (resumeProjectId) {
      // Fetch project info and resume progress view
      const resumePipeline = async () => {
        try {
          const project = await projectsApi.get(resumeProjectId);
          const projectData = project.data || project;

          if (projectData.status === 'processing') {
            setProjectId(resumeProjectId);
            setProjectName(projectData.name);
            setCodePath(projectData.code_path || '');
            setProcessing(true);

            // Find the active pipeline job
            if (resumeJobId) {
              setPipelineJobId(resumeJobId);
            } else {
              // Try to find the latest pipeline job for this project
              const jobsRes = await jobsApi.list({
                project_id: resumeProjectId,
                job_type: 'project_pipeline',
                limit: 1,
                sort_by: 'created_at',
                sort_order: 'desc',
              });
              const jobList = jobsRes.jobs || [];
              if (jobList.length > 0 && (jobList[0].status === 'running' || jobList[0].status === 'pending')) {
                setPipelineJobId(jobList[0].id);
              }
            }
          } else {
            // Project is no longer processing, go to its page
            router.push(`/projects/${resumeProjectId}`);
          }
        } catch (error) {
          console.error('Failed to resume pipeline:', error);
          showError('Falha ao carregar progresso do projeto.');
        }
      };
      resumePipeline();
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pipeline job polling
  const handlePipelineComplete = (result: any) => {
    setProcessing(false);
    setPipelineJobId(null);
    if (result?.project_id) {
      router.push(`/projects/${result.project_id}`);
    } else if (projectId) {
      router.push(`/projects/${projectId}`);
    }
  };

  const handlePipelineError = (error: string) => {
    setProcessing(false);
    setPipelineJobId(null);
    showError(`Pipeline falhou: ${error}`);
  };

  const { job: pipelineJob } = useJobPolling(pipelineJobId, {
    enabled: !!pipelineJobId,
    onComplete: handlePipelineComplete,
    onError: handlePipelineError,
  });

  // Handle folder selection
  const handleFolderSelect = (path: string) => {
    setCodePath(path);
    setShowFolderPicker(false);
  };

  // Start pipeline
  const handleGenerate = async () => {
    if (!codePath) {
      showWarning('Selecione uma pasta de codigo primeiro');
      return;
    }

    setProcessing(true);

    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

      const response = await fetch(
        `${API_BASE}/api/v1/projects/create-and-process?code_path=${encodeURIComponent(codePath)}&scan_depth=${scanDepth}`,
        { method: 'POST' }
      );

      if (response.ok) {
        const data = await response.json();
        setProjectId(data.project.id);
        setProjectName(data.project.name);
        setPipelineJobId(data.job_id);

        // Track in notification bell
        const folderName = codePath.split('/').pop() || 'project';
        addJob(data.job_id, 'project_pipeline', `Processando ${folderName}...`, `/projects/${data.project.id}`, true);
      } else {
        const error = await response.json();
        setProcessing(false);
        showError(`Falha ao criar projeto: ${error.detail || 'Erro desconhecido'}`);
      }
    } catch (error) {
      console.error('Create and process failed:', error);
      setProcessing(false);
      showError('Falha ao criar projeto. Tente novamente.');
    }
  };

  // PROMPT #190 - Cancel project creation
  const handleCancelCreation = async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      if (pipelineJobId) {
        try { await jobsApi.cancel(pipelineJobId); } catch { /* job may already be done */ }
      }
      if (projectId) {
        await projectsApi.delete(projectId);
      }
      setProcessing(false);
      setPipelineJobId(null);
      setProjectId(null);
      setProjectName(null);
      router.push('/projects');
    } catch (error) {
      console.error('Error cancelling project creation:', error);
      showError('Falha ao cancelar criacao do projeto.');
    } finally {
      setCancelling(false);
    }
  };

  // Compute progress info from job
  const progressPercent = pipelineJob?.progress_percent || 0;
  const progressMessage = pipelineJob?.progress_message || 'Inicializando...';

  // Determine which pipeline stage is active
  const getStageStatus = (stageStart: number, stageEnd: number) => {
    if (progressPercent >= stageEnd) return 'completed';
    if (progressPercent >= stageStart) return 'active';
    return 'pending';
  };

  // PROMPT #241 - Simplified to 2 stages (context generation moved to watchdog)
  const stages = [
    { label: 'Escaneando codebase', start: 0, end: 85, icon: 'M10 21h7a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v11m0 5l4.879-4.879m0 0a3 3 0 104.243-4.242 3 3 0 00-4.243 4.242z' },
    { label: 'Finalizando projeto', start: 85, end: 100, icon: 'M5 13l4 4L19 7' },
  ];

  return (
    <Layout>
      <Breadcrumbs />
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">
          {processing ? 'Processando Projeto' : 'Novo Projeto'}
        </h1>

        {!processing ? (
          /* --- Selection Form --- */
          <Card>
            <CardHeader>
              <CardTitle>Selecionar Pasta de Codigo</CardTitle>
              <p className="text-sm text-gray-600 mt-1">
                Escolha sua pasta de codigo existente e a profundidade de analise. O ORBIT escaneara o codebase, gerara um contexto rico e preparara seu projeto.
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Folder Picker */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Caminho da Pasta de Codigo *</label>
                <div className="flex gap-2">
                  <input
                    value={codePath}
                    onChange={(e) => setCodePath(e.target.value)}
                    placeholder="/projetos/meu-codigo-existente"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                    autoFocus
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowFolderPicker(true)}
                    title="Navegar pastas"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                  </Button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Selecione o caminho para sua pasta de codigo existente.
                  <strong className="block text-gray-600 mt-1">Este caminho nao pode ser alterado apos a criacao do projeto.</strong>
                </p>

                <FolderPicker
                  open={showFolderPicker}
                  onClose={() => setShowFolderPicker(false)}
                  onSelect={handleFolderSelect}
                  title="Selecionar Pasta de Codigo"
                />
              </div>

              {/* Scan Depth Selector */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Profundidade de Analise</label>
                <p className="text-xs text-gray-500 mb-3">
                  Escolha a profundidade com que a IA deve analisar seu codebase. Analise mais profunda fornece melhores resultados, mas demora mais.
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => setScanDepth('quick')}
                    className={`p-3 rounded-lg border-2 text-left transition-all ${
                      scanDepth === 'quick'
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="font-medium text-sm">Rapida</div>
                    <div className="text-xs text-gray-500 mt-1">30 arquivos, ~2 min</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setScanDepth('normal')}
                    className={`p-3 rounded-lg border-2 text-left transition-all ${
                      scanDepth === 'normal'
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="font-medium text-sm">Normal</div>
                    <div className="text-xs text-gray-500 mt-1">100 arquivos, ~5-10 min</div>
                    <div className="text-xs text-blue-600 font-medium mt-1">Recomendado</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setScanDepth('deep')}
                    className={`p-3 rounded-lg border-2 text-left transition-all ${
                      scanDepth === 'deep'
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="font-medium text-sm">Profunda</div>
                    <div className="text-xs text-gray-500 mt-1">TODOS os arquivos, ~15-30+ min</div>
                  </button>
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={() => router.push('/projects')}
                >
                  Cancelar
                </Button>
                <Button
                  variant="primary"
                  onClick={handleGenerate}
                  disabled={!codePath.trim()}
                >
                  Gerar Projeto
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          /* --- Pipeline Progress View --- */
          <Card>
            <CardHeader>
              <CardTitle>Processando Projeto</CardTitle>
              <p className="text-sm text-gray-600 mt-1">
                {projectName || codePath.split('/').pop() || 'Project'} esta sendo analisado e configurado.
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Overall progress bar */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium text-gray-700">Progresso Geral</span>
                  <span className="text-sm text-gray-500">{Math.round(progressPercent)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div
                    className="bg-blue-600 h-3 rounded-full transition-all duration-500"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">{progressMessage}</p>
              </div>

              {/* Pipeline stages */}
              <div className="space-y-4">
                {stages.map((stage, idx) => {
                  const status = getStageStatus(stage.start, stage.end);
                  const stageProgress = status === 'completed' ? 100 :
                    status === 'active' ? Math.round(((progressPercent - stage.start) / (stage.end - stage.start)) * 100) : 0;

                  return (
                    <div key={idx} className={`flex items-start gap-4 p-3 rounded-lg border ${
                      status === 'active' ? 'border-blue-200 bg-blue-50' :
                      status === 'completed' ? 'border-green-200 bg-green-50' :
                      'border-gray-100 bg-gray-50'
                    }`}>
                      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                        status === 'active' ? 'bg-blue-100' :
                        status === 'completed' ? 'bg-green-100' :
                        'bg-gray-200'
                      }`}>
                        {status === 'completed' ? (
                          <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : status === 'active' ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
                        ) : (
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={stage.icon} />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center">
                          <span className={`text-sm font-medium ${
                            status === 'active' ? 'text-blue-900' :
                            status === 'completed' ? 'text-green-900' :
                            'text-gray-500'
                          }`}>
                            {stage.label}
                          </span>
                          {status === 'active' && (
                            <span className="text-xs text-blue-600">{stageProgress}%</span>
                          )}
                        </div>
                        {status === 'active' && (
                          <div className="w-full bg-blue-100 rounded-full h-1.5 mt-2">
                            <div
                              className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
                              style={{ width: `${stageProgress}%` }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Tip */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-gray-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-sm text-gray-600">
                    Voce pode sair desta pagina. O processamento continuara em segundo plano e voce sera notificado quando estiver completo.
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <Button
                  variant="danger"
                  onClick={handleCancelCreation}
                  disabled={cancelling}
                  isLoading={cancelling}
                >
                  Cancelar Criacao
                </Button>
                <Button
                  variant="outline"
                  onClick={() => router.push('/projects')}
                >
                  Ir para Projetos
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
        {NotificationComponent}
      </div>
    </Layout>
  );
}

// PROMPT #189 - Wrap with Suspense for useSearchParams
export default function NewProjectPage() {
  return (
    <Suspense fallback={
      <Layout>
        <Breadcrumbs />
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </Layout>
    }>
      <NewProjectContent />
    </Suspense>
  );
}

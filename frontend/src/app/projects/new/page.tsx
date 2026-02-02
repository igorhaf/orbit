/**
 * New Project Wizard
 * PROMPT #89 - Context Interview Flow
 * PROMPT #118 - Codebase Memory Scan
 *
 * Multi-step wizard for creating a new project with context interview
 *
 * Flow:
 * 1. Basic Info (folder selection triggers memory scan)
 * 2. Context Interview (establish project foundation)
 * 3. Review Context (preview generated context)
 * 4. Confirm (go to project)
 */

'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Layout, Breadcrumbs } from '@/components/layout';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { FolderPicker } from '@/components/ui/FolderPicker';  // PROMPT #111 - Folder picker
import { AIModelBadge } from '@/components/ui/AIModelBadge';  // PROMPT #127 - AI Model badge
import { projectsApi, interviewsApi } from '@/lib/api';
import { ChatInterface } from '@/components/interview/ChatInterface';
import { useNotification, useJobPolling } from '@/hooks';
import { useNotifications } from '@/contexts/NotificationContext';
import ReactMarkdown from 'react-markdown';

type Step = 'basic' | 'interview' | 'review' | 'confirm';

// PROMPT #118 - Memory scan result interface
interface MemoryScanResult {
  suggested_title: string;
  stack_info: {
    detected_stack?: string;
    confidence?: number;
    description?: string;
  };
  business_rules: string[];
  key_features: string[];
  interview_context: string;
  files_indexed: number;
  scan_summary: {
    total_files: number;
    code_files: number;
    languages: Record<string, number>;
  };
}

// PROMPT #146 - LocalStorage keys for wizard state persistence
const WIZARD_STORAGE_KEY = 'orbit_new_project_wizard';

export default function NewProjectPage() {
  const router = useRouter();
  const { showError, showWarning, showSuccess, NotificationComponent } = useNotification();
  // PROMPT #140 - stopWatching to mark jobs as "not watched" when leaving page
  const { addJob, stopWatching } = useNotifications();
  const [step, setStep] = useState<Step>('basic');
  const [loading, setLoading] = useState(false);
  const [generatingContext, setGeneratingContext] = useState(false);
  // PROMPT #146 - Track if initial restore has been attempted
  const [initializing, setInitializing] = useState(true);

  // PROMPT #118 - Memory scan state
  const [scanning, setScanning] = useState(false);
  const [memoryScanResult, setMemoryScanResult] = useState<MemoryScanResult | null>(null);

  // PROMPT #133 - Background job state for memory scan
  const [memoryScanJobId, setMemoryScanJobId] = useState<string | null>(null);

  // PROMPT #133 - Background job state for context generation
  const [contextJobId, setContextJobId] = useState<string | null>(null);

  // PROMPT #140 - Stop watching jobs when user leaves the page
  useEffect(() => {
    return () => {
      // User is leaving the page - stop watching these jobs
      // If they complete now, user will get notification badge
      if (memoryScanJobId) stopWatching(memoryScanJobId);
      if (contextJobId) stopWatching(contextJobId);
    };
  }, [memoryScanJobId, contextJobId, stopWatching]);

  // Form data
  const [name, setName] = useState('');
  // PROMPT #111 - code_path obrigatório (pasta do código existente)
  const [codePath, setCodePath] = useState('');
  const [showFolderPicker, setShowFolderPicker] = useState(false);  // PROMPT #111 - Folder picker dialog
  const [projectId, setProjectId] = useState<string | null>(null);
  const [interviewId, setInterviewId] = useState<string | null>(null);

  // PROMPT #98 (v2) - Track if wizard was completed to prevent cleanup
  // PROMPT #101 FIX: Use useRef instead of useState because setState is async
  // and the cleanup effect would still see the old value when navigating away
  const wizardCompletedRef = useRef(false);

  // Context data (PROMPT #89)
  const [contextHuman, setContextHuman] = useState<string | null>(null);
  const [contextSemantic, setContextSemantic] = useState<string | null>(null);

  // PROMPT #92 - Suggested epics
  const [suggestedEpics, setSuggestedEpics] = useState<Array<{
    id: string;
    title: string;
    description: string;
    priority: string;
    order: number;
  }>>([]);

  // PROMPT #146 - Restore wizard state from localStorage on mount
  // This allows users to leave and come back to resume their interview
  useEffect(() => {
    const restoreWizardState = async () => {
      try {
        const savedState = localStorage.getItem(WIZARD_STORAGE_KEY);
        if (!savedState) {
          setInitializing(false);
          return;
        }

        const { projectId: savedProjectId, interviewId: savedInterviewId, codePath: savedCodePath, name: savedName } = JSON.parse(savedState);
        console.log('🔄 Restoring wizard state:', { savedProjectId, savedInterviewId, savedCodePath, savedName });

        if (!savedProjectId) {
          setInitializing(false);
          return;
        }

        // Verify project still exists
        try {
          const projectRes = await projectsApi.get(savedProjectId);
          const project = projectRes.data || projectRes;

          if (!project) {
            console.log('📭 Saved project no longer exists, clearing state');
            localStorage.removeItem(WIZARD_STORAGE_KEY);
            setInitializing(false);
            return;
          }

          // Restore project data
          setProjectId(savedProjectId);
          setCodePath(savedCodePath || project.code_path || '');
          setName(savedName || project.name || '');

          // Check if project already has context (wizard was completed)
          if (project.context_locked || project.context_human) {
            console.log('✅ Project already has context, redirecting to project page');
            localStorage.removeItem(WIZARD_STORAGE_KEY);
            router.push(`/projects/${savedProjectId}`);
            return;
          }

          // If we have a saved interview, verify it exists and is active
          if (savedInterviewId) {
            try {
              const interviewRes = await interviewsApi.get(savedInterviewId);
              const interview = interviewRes.data || interviewRes;

              if (interview && interview.status === 'active') {
                console.log('✅ Restoring active interview:', savedInterviewId);
                setInterviewId(savedInterviewId);
                setStep('interview');
                setInitializing(false);
                return;
              }
            } catch (interviewError) {
              console.log('⚠️ Saved interview not found or not active, will check for existing interviews');
            }
          }

          // Check if there's an existing active context interview for this project
          try {
            const interviewsRes = await interviewsApi.list({ project_id: savedProjectId, status: 'active' });
            const interviews = interviewsRes.data || interviewsRes;

            // Find context interview (interview without parent_task_id for new project)
            const contextInterview = interviews?.find((i: any) =>
              !i.parent_task_id && (i.interview_mode === 'context' || !i.interview_mode)
            );

            if (contextInterview) {
              console.log('✅ Found existing context interview:', contextInterview.id);
              setInterviewId(contextInterview.id);
              setStep('interview');
              // Update localStorage with the found interview
              localStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify({
                projectId: savedProjectId,
                interviewId: contextInterview.id,
                codePath: savedCodePath || project.code_path,
                name: savedName || project.name
              }));
            } else {
              // Project exists but no interview yet - stay on basic step
              console.log('📝 Project exists but no active interview, staying on basic step');
              wizardCompletedRef.current = true; // Project already exists
            }
          } catch (listError) {
            console.error('Failed to list interviews:', listError);
          }

        } catch (projectError) {
          console.log('📭 Failed to fetch saved project, clearing state:', projectError);
          localStorage.removeItem(WIZARD_STORAGE_KEY);
        }
      } catch (error) {
        console.error('Failed to restore wizard state:', error);
        localStorage.removeItem(WIZARD_STORAGE_KEY);
      } finally {
        setInitializing(false);
      }
    };

    restoreWizardState();
  }, [router]);

  // PROMPT #133 - Handle memory scan job completion
  // PROMPT #139 - Always update title with AI suggestion (better than folder name)
  const handleMemoryScanComplete = (result: any) => {
    console.log('✅ Memory scan job completed:', result);
    setScanning(false);
    setMemoryScanJobId(null);

    if (result) {
      setMemoryScanResult(result as MemoryScanResult);

      // PROMPT #139 - Always use AI-suggested title (it's better than folder name)
      if (result.suggested_title) {
        setName(result.suggested_title);

        // Also update the project in the database with the better title
        if (projectId) {
          const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
          fetch(`${API_BASE}/api/v1/projects/${projectId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: result.suggested_title })
          }).catch(err => console.error('Failed to update project title:', err));

          // PROMPT #146 - Update localStorage with new name
          const savedState = localStorage.getItem(WIZARD_STORAGE_KEY);
          if (savedState) {
            const state = JSON.parse(savedState);
            state.name = result.suggested_title;
            localStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(state));
          }
        }
      }
    }
  };

  const handleMemoryScanError = (error: string) => {
    console.error('❌ Memory scan job failed:', error);
    setScanning(false);
    setMemoryScanJobId(null);
    showWarning('Could not analyze codebase. You can still proceed manually.');
  };

  // PROMPT #133 - Poll memory scan job status
  const { job: memoryScanJob } = useJobPolling(memoryScanJobId, {
    enabled: !!memoryScanJobId,
    onComplete: handleMemoryScanComplete,
    onError: handleMemoryScanError,
  });

  // PROMPT #133 - Handle context generation job completion
  const handleContextJobComplete = (result: any) => {
    console.log('✅ Context generation job completed:', result);
    setGeneratingContext(false);
    setContextJobId(null);

    if (result && result.success) {
      setContextHuman(result.context_human);
      setContextSemantic(result.context_semantic);
      // PROMPT #92 - Store suggested epics
      if (result.suggested_epics) {
        setSuggestedEpics(result.suggested_epics);
      }
      setStep('review');
    } else {
      showError('Failed to generate context. Please try again.');
    }
  };

  const handleContextJobError = (error: string) => {
    console.error('❌ Context generation job failed:', error);
    setGeneratingContext(false);
    setContextJobId(null);
    showError('Failed to generate context. Please try again.');
  };

  // PROMPT #133 - Poll context generation job status
  const { job: contextJob } = useJobPolling(contextJobId, {
    enabled: !!contextJobId,
    onComplete: handleContextJobComplete,
    onError: handleContextJobError,
  });

  // PROMPT #137 - Create project immediately when folder is selected
  // Project is created as draft, memory scan runs in background
  const handleFolderSelect = async (path: string) => {
    setCodePath(path);
    setShowFolderPicker(false);
    setScanning(true);

    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

      // PROMPT #137 - Call quick-create to create project immediately
      const response = await fetch(
        `${API_BASE}/api/v1/projects/quick-create?code_path=${encodeURIComponent(path)}`,
        { method: 'POST' }
      );

      if (response.ok) {
        const data = await response.json();

        // Project created immediately!
        setProjectId(data.project.id);
        // PROMPT #139 - Don't set name here, wait for AI suggestion from memory scan
        // setName(data.project.name);  // Removed - field stays empty during scan

        // PROMPT #137 - Project exists now, no cleanup needed on abandon
        // User can leave and project will remain as draft
        wizardCompletedRef.current = true;

        // PROMPT #146 - Save wizard state to localStorage for persistence
        localStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify({
          projectId: data.project.id,
          interviewId: null,
          codePath: path,
          name: data.project.name
        }));

        // Track memory scan job for progress/completion
        if (data.job_id) {
          setMemoryScanJobId(data.job_id);

          // PROMPT #140 - Add to notification bell with watching=true
          // Since user is on this page, no notification badge when it completes
          const folderName = path.split('/').pop() || 'pasta';
          addJob(data.job_id, 'memory_scan', `Analisando ${folderName}...`, path, true);
        }

        // PROMPT #138 - Removed showSuccess() modal that was blocking navigation
        // The "Analyzing codebase..." indicator already shows the status
      } else {
        const error = await response.json();
        setScanning(false);
        showError(`Failed to create project: ${error.detail || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Quick create failed:', error);
      setScanning(false);
      showError('Failed to create project. Please try again.');
    }
  };

  const handleBasicSubmit = async () => {
    // PROMPT #137 - Project already created when folder was selected
    // This step now just updates name (if changed) and starts Context Interview

    if (!projectId) {
      showWarning('Please select a code folder first');
      return;
    }

    if (!name.trim()) {
      showWarning('Please enter a project name');
      return;
    }

    setLoading(true);
    try {
      // PROMPT #137 - Update project name if user modified it
      await projectsApi.update(projectId, { name });

      // PROMPT #146 - Check if there's already an active interview for this project
      let existingInterview = null;
      try {
        const interviewsRes = await interviewsApi.list({ project_id: projectId, status: 'active' });
        const interviews = interviewsRes.data || interviewsRes;
        existingInterview = interviews?.find((i: any) =>
          !i.parent_task_id && (i.interview_mode === 'context' || !i.interview_mode)
        );
      } catch (listError) {
        console.log('Could not check existing interviews:', listError);
      }

      let createdInterview;
      if (existingInterview) {
        console.log('✅ Found existing context interview:', existingInterview.id);
        createdInterview = existingInterview;
      } else {
        // Create interview (PROMPT #89 - First interview = context mode)
        const interviewRes = await interviewsApi.create({
          project_id: projectId,
          ai_model_used: 'claude-sonnet-4-20250514',
          parent_task_id: null,  // PROMPT #89 - Null + context_locked=false = context mode
        });

        // Handle both response formats
        createdInterview = interviewRes.data || interviewRes;
        console.log('✅ Created new context interview:', createdInterview.id);
      }

      setInterviewId(createdInterview.id);
      setStep('interview');

      // PROMPT #146 - Save interview ID to localStorage
      localStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify({
        projectId,
        interviewId: createdInterview.id,
        codePath,
        name
      }));
    } catch (error) {
      console.error('Failed to start context interview:', error);
      showError('Failed to start context interview. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // PROMPT #89 - When interview is complete, generate context
  // PROMPT #133 - Now uses background jobs
  const handleInterviewComplete = async () => {
    if (!interviewId) return;

    setGeneratingContext(true);
    try {
      // Generate context from the interview (now async via background job)
      const contextRes = await interviewsApi.generateContext(interviewId);

      // Handle both response formats (with or without .data wrapper)
      const contextData = contextRes.data || contextRes;

      // PROMPT #133 - API now returns job_id for background processing
      if (contextData.job_id) {
        setContextJobId(contextData.job_id);

        // PROMPT #140 - Add to notification bell with watching=true
        addJob(contextData.job_id, 'context_generation', `Gerando contexto para ${name || 'projeto'}...`, undefined, true);
      } else if (contextData.success) {
        // Fallback for old API format (direct result)
        setContextHuman(contextData.context_human);
        setContextSemantic(contextData.context_semantic);
        // PROMPT #92 - Store suggested epics
        if (contextData.suggested_epics) {
          setSuggestedEpics(contextData.suggested_epics);
        }
        setStep('review');
        setGeneratingContext(false);
      } else {
        setGeneratingContext(false);
        showError('Failed to generate context. Please try again.');
      }
    } catch (error) {
      console.error('Failed to generate context:', error);
      setGeneratingContext(false);
      showError('Failed to generate context. Please try again.');
    }
  };

  // PROMPT #137 - No cleanup needed anymore
  // Project is created as draft when folder is selected
  // User can leave wizard and come back later to complete Context Interview
  // Draft projects are intentionally kept for later completion

  const handleConfirm = () => {
    // PROMPT #98 (v2) - Mark wizard as completed before navigating
    // PROMPT #101 FIX: Use ref for synchronous update before navigation
    wizardCompletedRef.current = true;

    // PROMPT #146 - Clear localStorage since wizard is complete
    localStorage.removeItem(WIZARD_STORAGE_KEY);

    if (projectId) {
      router.push(`/projects/${projectId}`);
    }
  };

  // PROMPT #146 - Show loading while restoring wizard state
  if (initializing) {
    return (
      <Layout>
        <Breadcrumbs />
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-col items-center justify-center py-24">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
            <p className="text-gray-600">Checking for existing session...</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <Breadcrumbs />
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">
          Create New Project
        </h1>

        {/* Progress Steps */}
        <div className="flex items-center justify-center mb-8">
          {[
            { id: 'basic', label: '1. Basic Info' },  // PROMPT #111 - Updated label
            { id: 'interview', label: '2. Context Interview' },
            { id: 'review', label: '3. Review' },
            { id: 'confirm', label: '4. Complete' },
          ].map((s, i) => (
            <div key={s.id} className="flex items-center">
              <div
                className={`flex items-center justify-center w-10 h-10 rounded-full ${
                  step === s.id
                    ? 'bg-blue-600 text-white'
                    : step === 'confirm' || (step === 'review' && i < 2) || (step === 'interview' && i === 0)
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-200 text-gray-600'
                }`}
              >
                {step === 'confirm' || (step === 'review' && i < 2) || (step === 'interview' && i === 0) ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              {i < 3 && (
                <div className="w-12 h-0.5 bg-gray-200 mx-2" />
              )}
            </div>
          ))}
        </div>

        {/* Step 1: Basic Info */}
        {step === 'basic' && (
          <Card>
            <CardHeader>
              <CardTitle>Project Information</CardTitle>
              <p className="text-sm text-gray-600 mt-1">
                Enter a name and the path to your existing code folder. You'll define the details in the next step through an AI interview.
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* PROMPT #111 - code_path obrigatório com folder picker (moved above project name) */}
              <div>
                <Label htmlFor="codePath">Code Folder Path *</Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    id="codePath"
                    value={codePath}
                    onChange={(e) => setCodePath(e.target.value)}
                    placeholder="/projects/my-existing-code"
                    className="flex-1"
                    autoFocus
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowFolderPicker(true)}
                    title="Browse folders"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                  </Button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Select or type the path to your existing code folder within <code className="bg-gray-100 px-1 rounded">/projects</code>.
                  <strong className="block text-gray-600 mt-1">This path cannot be changed after project creation.</strong>
                </p>

                {/* Folder Picker Dialog */}
                <FolderPicker
                  open={showFolderPicker}
                  onClose={() => setShowFolderPicker(false)}
                  onSelect={handleFolderSelect}
                  title="Select Code Folder"
                />
              </div>

              {/* PROMPT #139 - Project name disabled during scan, filled by AI */}
              <div>
                <Label htmlFor="name">Project Name *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={scanning ? "Aguardando sugestão da IA..." : "Nome do Projeto"}
                  disabled={scanning}
                  className={`mt-1 ${scanning ? 'bg-gray-100 cursor-wait' : ''}`}
                />
                <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                  {scanning ? (
                    <span className="text-blue-600">A IA está analisando o código para sugerir um nome...</span>
                  ) : (
                    <>
                      {memoryScanResult?.suggested_title && name === memoryScanResult.suggested_title ? (
                        <>
                          <AIModelBadge model="memory-scan" usage_type="memory" />
                          <span className="text-blue-600">(AI suggested - you can edit)</span>
                        </>
                      ) : (
                        'Choose a descriptive name for your project'
                      )}
                    </>
                  )}
                </p>
              </div>

              {/* PROMPT #118 - Scanning overlay */}
              {/* PROMPT #148 - Added skip/cancel options during scan */}
              {scanning && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                      <div>
                        <h4 className="font-medium text-blue-900">Analyzing codebase...</h4>
                        <p className="text-sm text-blue-700 mt-1">
                          Scanning files, detecting technologies, and extracting business rules.
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          // Stop watching the job and clear scanning state
                          if (memoryScanJobId) stopWatching(memoryScanJobId);
                          setScanning(false);
                          setMemoryScanJobId(null);
                        }}
                        className="text-blue-700 hover:text-blue-900"
                      >
                        Skip Scan
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => router.push('/projects')}
                        className="text-gray-500 hover:text-gray-700"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* PROMPT #118 - Memory scan results */}
              {memoryScanResult && !scanning && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-4">
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-green-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-green-900">Codebase Analyzed</h4>
                        {/* PROMPT #128 - Show AI model icon for memory scan */}
                        <AIModelBadge model="memory-scan" usage_type="memory" />
                      </div>
                      <p className="text-sm text-green-700 mt-1">
                        {memoryScanResult.scan_summary.code_files} code files scanned from {memoryScanResult.scan_summary.total_files} total files
                      </p>
                    </div>
                  </div>

                  {/* Stack Info */}
                  {memoryScanResult.stack_info.detected_stack && (
                    <div className="pl-8">
                      <span className="text-xs font-medium text-gray-500">Detected Stack:</span>
                      <span className="ml-2 px-2 py-1 bg-purple-100 text-purple-700 text-xs rounded-full font-medium">
                        {memoryScanResult.stack_info.detected_stack}
                        {memoryScanResult.stack_info.confidence && (
                          <span className="ml-1 text-purple-500">({memoryScanResult.stack_info.confidence}%)</span>
                        )}
                      </span>
                    </div>
                  )}

                  {/* Languages */}
                  {Object.keys(memoryScanResult.scan_summary.languages).length > 0 && (
                    <div className="pl-8">
                      <span className="text-xs font-medium text-gray-500">Languages:</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {Object.entries(memoryScanResult.scan_summary.languages).map(([lang, count]) => (
                          <span key={lang} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">
                            {lang}: {count}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Key Features */}
                  {memoryScanResult.key_features.length > 0 && (
                    <details className="pl-8">
                      <summary className="text-xs font-medium text-gray-500 cursor-pointer hover:text-gray-700">
                        Key Features Detected ({memoryScanResult.key_features.length})
                      </summary>
                      <ul className="mt-2 space-y-1">
                        {memoryScanResult.key_features.slice(0, 5).map((feature, idx) => (
                          <li key={idx} className="text-xs text-gray-600 flex items-start gap-2">
                            <span className="text-green-500">•</span>
                            {feature}
                          </li>
                        ))}
                        {memoryScanResult.key_features.length > 5 && (
                          <li className="text-xs text-gray-400 italic">
                            +{memoryScanResult.key_features.length - 5} more...
                          </li>
                        )}
                      </ul>
                    </details>
                  )}

                  {/* Business Rules */}
                  {memoryScanResult.business_rules.length > 0 && (
                    <details className="pl-8">
                      <summary className="text-xs font-medium text-gray-500 cursor-pointer hover:text-gray-700">
                        Business Rules Extracted ({memoryScanResult.business_rules.length})
                      </summary>
                      <ul className="mt-2 space-y-1">
                        {memoryScanResult.business_rules.slice(0, 5).map((rule, idx) => (
                          <li key={idx} className="text-xs text-gray-600 flex items-start gap-2">
                            <span className="text-blue-500">•</span>
                            {rule}
                          </li>
                        ))}
                        {memoryScanResult.business_rules.length > 5 && (
                          <li className="text-xs text-gray-400 italic">
                            +{memoryScanResult.business_rules.length - 5} more...
                          </li>
                        )}
                      </ul>
                    </details>
                  )}
                </div>
              )}

              <div className="flex justify-between gap-3">
                {/* PROMPT #137 - Skip to Project button (available after project is created) */}
                <div>
                  {projectId && (
                    <Button
                      variant="ghost"
                      onClick={() => router.push(`/projects/${projectId}`)}
                      className="text-gray-500"
                    >
                      Skip to Project →
                    </Button>
                  )}
                </div>

                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    onClick={() => router.push('/projects')}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    onClick={handleBasicSubmit}
                    disabled={loading || !projectId || !name.trim()}
                  >
                    {loading ? 'Starting...' : 'Next: Context Interview'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Context Interview */}
        {step === 'interview' && interviewId && (
          <Card>
            <CardHeader>
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle>Context Interview</CardTitle>
                  <p className="text-sm text-gray-600 mt-1">
                    Tell the AI about your project. This interview will establish the foundational context
                    that guides all future development.
                  </p>
                </div>
                {/* PROMPT #144 - Skip button always visible, even during context generation */}
                {projectId && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      // PROMPT #144 - Stop watching jobs so user gets notification when done
                      if (contextJobId) stopWatching(contextJobId);
                      router.push(`/projects/${projectId}`);
                    }}
                    className="text-gray-500 whitespace-nowrap"
                  >
                    Skip to Project →
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {generatingContext ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
                  <p className="text-gray-600">Generating project context...</p>
                  <p className="text-sm text-gray-500 mt-1">This may take a moment</p>
                  {/* PROMPT #144 - Navigation hint during generation */}
                  <p className="text-xs text-blue-600 mt-4">
                    You can click &quot;Skip to Project&quot; to continue. Context will be generated in background.
                  </p>
                </div>
              ) : (
                <ChatInterface
                  key={interviewId}  // PROMPT #148 - Force re-mount when interviewId changes to ensure fresh state
                  interviewId={interviewId}
                  onComplete={handleInterviewComplete}
                  interviewMode="context"
                />
              )}
            </CardContent>
          </Card>
        )}

        {/* Step 3: Review Context */}
        {step === 'review' && (
          <Card>
            <CardHeader>
              <CardTitle>Review Project Context</CardTitle>
              <p className="text-sm text-gray-600 mt-1">
                Review the generated context for your project. This will be the foundation for all
                future development.
              </p>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {/* Human-readable context */}
                {/* PROMPT #122 - Render markdown properly with ReactMarkdown */}
                <div>
                  <h4 className="font-semibold text-gray-900 mb-2">Project Description</h4>
                  <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                    <div className="prose prose-sm max-w-none">
                      {contextHuman ? (
                        <ReactMarkdown>{contextHuman}</ReactMarkdown>
                      ) : (
                        <p className="text-gray-500 italic">No context generated</p>
                      )}
                    </div>
                    {/* PROMPT #127 - Show AI model icon for context (generated by AI) */}
                    {contextHuman && (
                      <div className="mt-2 flex justify-end">
                        <AIModelBadge model="context-interview" usage_type="context" />
                      </div>
                    )}
                  </div>
                </div>

                {/* PROMPT #122 - Codebase Analysis from Memory Scan */}
                {memoryScanResult && (
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                      <span>🔍 Codebase Analysis</span>
                      <span className="text-sm font-normal text-gray-500">
                        ({memoryScanResult.scan_summary.code_files} files analyzed)
                      </span>
                    </h4>
                    <div className="bg-blue-50 rounded-lg p-4 border border-blue-200 space-y-4">
                      {/* Stack & Languages */}
                      <div className="flex flex-wrap gap-4">
                        {memoryScanResult.stack_info.detected_stack && (
                          <div>
                            <span className="text-xs font-medium text-gray-500 block mb-1">Detected Stack</span>
                            <span className="px-3 py-1 bg-purple-100 text-purple-700 text-sm rounded-full font-medium">
                              {memoryScanResult.stack_info.detected_stack}
                              {memoryScanResult.stack_info.confidence && (
                                <span className="ml-1 text-purple-500">({memoryScanResult.stack_info.confidence}%)</span>
                              )}
                            </span>
                          </div>
                        )}
                        {Object.keys(memoryScanResult.scan_summary.languages).length > 0 && (
                          <div>
                            <span className="text-xs font-medium text-gray-500 block mb-1">Languages</span>
                            <div className="flex flex-wrap gap-1">
                              {Object.entries(memoryScanResult.scan_summary.languages).map(([lang, count]) => (
                                <span key={lang} className="px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded font-medium">
                                  {lang}: {count}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Key Features */}
                      {memoryScanResult.key_features.length > 0 && (
                        <div>
                          <span className="text-xs font-medium text-gray-500 block mb-2">
                            ✨ Key Features Detected ({memoryScanResult.key_features.length})
                          </span>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {memoryScanResult.key_features.map((feature, idx) => (
                              <div key={idx} className="flex items-start gap-2 text-sm text-gray-700 bg-white rounded px-2 py-1">
                                <span className="text-green-500 flex-shrink-0">✓</span>
                                <span>{feature}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Business Rules */}
                      {memoryScanResult.business_rules.length > 0 && (
                        <div>
                          <span className="text-xs font-medium text-gray-500 block mb-2">
                            📋 Business Rules Extracted ({memoryScanResult.business_rules.length})
                          </span>
                          <div className="space-y-1">
                            {memoryScanResult.business_rules.map((rule, idx) => (
                              <div key={idx} className="flex items-start gap-2 text-sm text-gray-700 bg-white rounded px-2 py-1">
                                <span className="text-blue-500 flex-shrink-0 font-mono text-xs">R{idx + 1}</span>
                                <span>{rule}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* PROMPT #92 - Suggested Epics */}
                {suggestedEpics.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                      <span>🎯 Suggested Epics</span>
                      <span className="text-sm font-normal text-gray-500">({suggestedEpics.length} modules)</span>
                      {/* PROMPT #128 - Show AI model icon for suggested epics */}
                      <AIModelBadge model="context" usage_type="context" />
                    </h4>
                    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                      <p className="text-sm text-gray-600 mb-3">
                        These epic suggestions cover the main modules of your project. They are saved as <strong>inactive</strong> (grayed out) in your backlog.
                        Activate them when you're ready to work on each module.
                      </p>
                      <div className="grid gap-2">
                        {suggestedEpics.map((epic, idx) => (
                          <div
                            key={epic.id}
                            className="flex items-start gap-3 p-3 bg-white rounded border border-gray-200 border-dashed opacity-60"
                          >
                            <span className="text-gray-400 font-mono text-sm">{idx + 1}.</span>
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-gray-500 font-medium">{epic.title}</span>
                                <span className={`text-xs px-2 py-0.5 rounded ${
                                  epic.priority === 'critical' ? 'bg-red-100 text-red-600' :
                                  epic.priority === 'high' ? 'bg-orange-100 text-orange-600' :
                                  epic.priority === 'medium' ? 'bg-yellow-100 text-yellow-600' :
                                  'bg-gray-100 text-gray-600'
                                }`}>
                                  {epic.priority}
                                </span>
                              </div>
                              <p className="text-xs text-gray-400 mt-1">{epic.description}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Semantic context (collapsible) */}
                <details className="group">
                  <summary className="cursor-pointer text-sm text-blue-600 hover:text-blue-800 flex items-center gap-2">
                    <svg className="w-4 h-4 transform group-open:rotate-90 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    View Semantic Context (for AI)
                  </summary>
                  <div className="mt-2 bg-gray-900 rounded-lg p-4 border border-gray-700">
                    <pre className="text-xs text-gray-300 whitespace-pre-wrap overflow-x-auto">
                      {contextSemantic || 'No semantic context generated'}
                    </pre>
                  </div>
                </details>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-blue-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <h4 className="font-medium text-blue-900">Context Lock</h4>
                      <p className="text-sm text-blue-800 mt-1">
                        This context will be <strong>locked</strong> when you create your first Epic.
                        After that, it cannot be modified to ensure consistency across all project cards.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-3">
                  <Button
                    variant="outline"
                    onClick={() => setStep('interview')}
                  >
                    Back to Interview
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => setStep('confirm')}
                  >
                    Confirm & Continue
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 4: Confirm */}
        {step === 'confirm' && (
          <Card>
            <CardHeader>
              <CardTitle>Project Created!</CardTitle>
              <p className="text-sm text-gray-600 mt-1">
                Your project context has been established. You're ready to start creating Epics.
              </p>
            </CardHeader>
            <CardContent>
              <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                    <svg
                      className="w-6 h-6 text-green-600"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-green-900">
                      Project Created Successfully
                    </h3>
                    <p className="text-sm text-green-700 mt-1">
                      {name}
                    </p>
                  </div>
                </div>
              </div>

              {/* PROMPT #92 - Show epic count */}
              {suggestedEpics.length > 0 && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🎯</span>
                    <div>
                      <h4 className="font-medium text-gray-900">
                        {suggestedEpics.length} Epic Suggestions Generated
                      </h4>
                      <p className="text-sm text-gray-600 mt-1">
                        Your backlog now contains suggested modules. They appear grayed out until you activate them.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-4">
                <h4 className="font-semibold text-gray-900">Next Steps:</h4>
                <ul className="space-y-2 text-sm text-gray-600">
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">1.</span>
                    <span>Review the suggested Epics in your backlog</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">2.</span>
                    <span>Activate an Epic to start working on it</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">3.</span>
                    <span>Create an Epic Interview to define Stories and Tasks</span>
                  </li>
                </ul>
              </div>

              <div className="flex justify-end gap-3 mt-8">
                <Button
                  variant="outline"
                  onClick={() => router.push('/projects')}
                >
                  View All Projects
                </Button>
                <Button
                  variant="primary"
                  onClick={handleConfirm}
                >
                  Go to Project
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

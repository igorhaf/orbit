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
import { projectsApi, interviewsApi } from '@/lib/api';
import { ChatInterface } from '@/components/interview/ChatInterface';
import { useNotification } from '@/hooks';

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

export default function NewProjectPage() {
  const router = useRouter();
  const { showError, showWarning, showSuccess, NotificationComponent } = useNotification();
  const [step, setStep] = useState<Step>('basic');
  const [loading, setLoading] = useState(false);
  const [generatingContext, setGeneratingContext] = useState(false);

  // PROMPT #118 - Memory scan state
  const [scanning, setScanning] = useState(false);
  const [memoryScanResult, setMemoryScanResult] = useState<MemoryScanResult | null>(null);

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

  // PROMPT #118 - Scan codebase when folder is selected
  const handleFolderSelect = async (path: string) => {
    setCodePath(path);
    setShowFolderPicker(false);

    // Start memory scan
    setScanning(true);
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
      const response = await fetch(
        `${API_BASE}/api/v1/projects/scan-memory?code_path=${encodeURIComponent(path)}`,
        { method: 'POST' }
      );

      if (response.ok) {
        const result: MemoryScanResult = await response.json();
        setMemoryScanResult(result);

        // Suggest title if user hasn't entered one
        if (!name && result.suggested_title) {
          setName(result.suggested_title);
        }

        showSuccess('Codebase analyzed successfully!');
      } else {
        const error = await response.json();
        showWarning(`Scan completed with warnings: ${error.detail || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Memory scan failed:', error);
      showWarning('Could not analyze codebase. You can still proceed manually.');
    } finally {
      setScanning(false);
    }
  };

  const handleBasicSubmit = async () => {
    // PROMPT #89 - Only name is required, description comes from context interview
    if (!name.trim()) {
      showWarning('Please enter a project name');
      return;
    }

    // PROMPT #111 - code_path é obrigatório
    if (!codePath.trim()) {
      showWarning('Please enter the path to your existing code folder');
      return;
    }

    setLoading(true);
    try {
      // Create project with code_path (PROMPT #111) and memory context (PROMPT #118)
      const projectRes = await projectsApi.create({
        name,
        code_path: codePath,  // PROMPT #111 - Obrigatório e imutável
        description: null,  // PROMPT #89 - Description comes from context interview
        // PROMPT #118 - Pass memory scan context to skip Q2/Q3 in context interview
        initial_memory_context: memoryScanResult?.interview_context || null,
      });

      // Handle both response formats (with or without .data wrapper)
      const createdProject = projectRes.data || projectRes;
      setProjectId(createdProject.id);

      // Create interview (PROMPT #89 - First interview = context mode)
      const interviewRes = await interviewsApi.create({
        project_id: createdProject.id,
        ai_model_used: 'claude-sonnet-4-20250514',
        parent_task_id: null,  // PROMPT #89 - Null + context_locked=false = context mode
      });

      // Handle both response formats
      const createdInterview = interviewRes.data || interviewRes;
      setInterviewId(createdInterview.id);
      setStep('interview');
    } catch (error) {
      console.error('Failed to create project:', error);
      showError('Failed to create project. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // PROMPT #89 - When interview is complete, generate context
  const handleInterviewComplete = async () => {
    if (!interviewId) return;

    setGeneratingContext(true);
    try {
      // Generate context from the interview
      const contextRes = await interviewsApi.generateContext(interviewId);

      // Handle both response formats (with or without .data wrapper)
      const contextData = contextRes.data || contextRes;
      if (contextData.success) {
        setContextHuman(contextData.context_human);
        setContextSemantic(contextData.context_semantic);
        // PROMPT #92 - Store suggested epics
        if (contextData.suggested_epics) {
          setSuggestedEpics(contextData.suggested_epics);
        }
        setStep('review');
      } else {
        showError('Failed to generate context. Please try again.');
      }
    } catch (error) {
      console.error('Failed to generate context:', error);
      showError('Failed to generate context. Please try again.');
    } finally {
      setGeneratingContext(false);
    }
  };

  // PROMPT #98 (v2) - Cleanup project if wizard is abandoned
  // PROMPT #101 FIX: Use ref.current for synchronous access to completion state
  useEffect(() => {
    const cleanupProject = async () => {
      if (projectId && !wizardCompletedRef.current) {
        try {
          await projectsApi.delete(projectId);
          console.log('✅ Cleanup: Deleted incomplete project:', projectId);
        } catch (error) {
          console.error('❌ Failed to cleanup project:', error);
        }
      }
    };

    // Cleanup on page unload (browser close, navigation away)
    const handleBeforeUnload = () => {
      if (projectId && !wizardCompletedRef.current) {
        // Synchronous cleanup for beforeunload
        navigator.sendBeacon(`/api/v1/projects/${projectId}`,
          new Blob([JSON.stringify({ method: 'DELETE' })], { type: 'application/json' })
        );
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    // Cleanup on component unmount (router navigation)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      cleanupProject();
    };
  }, [projectId]);

  const handleConfirm = () => {
    // PROMPT #98 (v2) - Mark wizard as completed before navigating
    // PROMPT #101 FIX: Use ref for synchronous update before navigation
    wizardCompletedRef.current = true;
    if (projectId) {
      router.push(`/projects/${projectId}`);
    }
  };

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

              <div>
                <Label htmlFor="name">Project Name *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Awesome Project"
                  className="mt-1"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Choose a descriptive name for your project
                  {memoryScanResult?.suggested_title && name === memoryScanResult.suggested_title && (
                    <span className="text-blue-600 ml-1">(AI suggested)</span>
                  )}
                </p>
              </div>

              {/* PROMPT #118 - Scanning overlay */}
              {scanning && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
                  <div className="flex items-center gap-4">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    <div>
                      <h4 className="font-medium text-blue-900">Analyzing codebase...</h4>
                      <p className="text-sm text-blue-700 mt-1">
                        Scanning files, detecting technologies, and extracting business rules.
                      </p>
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
                      <h4 className="font-medium text-green-900">Codebase Analyzed</h4>
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

              <div className="flex justify-end gap-3">
                <Button
                  variant="outline"
                  onClick={() => router.push('/projects')}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleBasicSubmit}
                  disabled={loading || !name.trim() || !codePath.trim()}
                >
                  {loading ? 'Creating...' : 'Next: Context Interview'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Context Interview */}
        {step === 'interview' && interviewId && (
          <Card>
            <CardHeader>
              <CardTitle>Context Interview</CardTitle>
              <p className="text-sm text-gray-600 mt-1">
                Tell the AI about your project. This interview will establish the foundational context
                that guides all future development.
              </p>
            </CardHeader>
            <CardContent>
              {generatingContext ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
                  <p className="text-gray-600">Generating project context...</p>
                  <p className="text-sm text-gray-500 mt-1">This may take a moment</p>
                </div>
              ) : (
                <ChatInterface
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
                <div>
                  <h4 className="font-semibold text-gray-900 mb-2">Project Description</h4>
                  <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                    <div className="prose prose-sm max-w-none">
                      {contextHuman ? (
                        <div className="whitespace-pre-wrap">{contextHuman}</div>
                      ) : (
                        <p className="text-gray-500 italic">No context generated</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* PROMPT #92 - Suggested Epics */}
                {suggestedEpics.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                      <span>🎯 Suggested Epics</span>
                      <span className="text-sm font-normal text-gray-500">({suggestedEpics.length} modules)</span>
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

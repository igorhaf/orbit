/**
 * New Project Wizard
 * PROMPT #89 - Context Interview Flow
 * Multi-step wizard for creating a new project with context interview
 *
 * Flow:
 * 1. Basic Info (name only)
 * 2. Context Interview (establish project foundation)
 * 3. Review Context (preview generated context)
 * 4. Confirm (go to project)
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Layout, Breadcrumbs } from '@/components/layout';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { projectsApi, interviewsApi } from '@/lib/api';
import { ChatInterface } from '@/components/interview/ChatInterface';

type Step = 'basic' | 'interview' | 'review' | 'confirm';

export default function NewProjectPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('basic');
  const [loading, setLoading] = useState(false);
  const [generatingContext, setGeneratingContext] = useState(false);

  // Form data
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [interviewId, setInterviewId] = useState<string | null>(null);

  // Context data (PROMPT #89)
  const [contextHuman, setContextHuman] = useState<string | null>(null);
  const [contextSemantic, setContextSemantic] = useState<string | null>(null);

  const handleBasicSubmit = async () => {
    // PROMPT #89 - Only name is required, description comes from context interview
    if (!name.trim()) {
      alert('Please enter a project name');
      return;
    }

    setLoading(true);
    try {
      // Create project (no description - will be filled from context)
      const projectRes = await projectsApi.create({
        name,
        description: null,  // PROMPT #89 - Description comes from context interview
      });

      setProjectId(projectRes.data.id);

      // Create interview (PROMPT #89 - First interview = context mode)
      const interviewRes = await interviewsApi.create({
        project_id: projectRes.data.id,
        ai_model_used: 'claude-sonnet-4-20250514',
        parent_task_id: null,  // PROMPT #89 - Null + context_locked=false = context mode
      });

      setInterviewId(interviewRes.data.id);
      setStep('interview');
    } catch (error) {
      console.error('Failed to create project:', error);
      alert('Failed to create project. Please try again.');
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

      if (contextRes.data.success) {
        setContextHuman(contextRes.data.context_human);
        setContextSemantic(contextRes.data.context_semantic);
        setStep('review');
      } else {
        alert('Failed to generate context. Please try again.');
      }
    } catch (error) {
      console.error('Failed to generate context:', error);
      alert('Failed to generate context. Please try again.');
    } finally {
      setGeneratingContext(false);
    }
  };

  const handleConfirm = () => {
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
            { id: 'basic', label: '1. Name' },
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
              <CardTitle>Project Name</CardTitle>
              <p className="text-sm text-gray-600 mt-1">
                Enter a name for your project. You'll define the details in the next step through an AI interview.
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <Label htmlFor="name">Project Name *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Awesome Project"
                  className="mt-1"
                  autoFocus
                />
                <p className="text-xs text-gray-500 mt-1">
                  Choose a descriptive name for your project
                </p>
              </div>

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
                  disabled={loading || !name.trim()}
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

              <div className="space-y-4">
                <h4 className="font-semibold text-gray-900">Next Steps:</h4>
                <ul className="space-y-2 text-sm text-gray-600">
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">1.</span>
                    <span>Start a new interview to create your first Epic</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">2.</span>
                    <span>Break down the Epic into Stories and Tasks</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">3.</span>
                    <span>Execute tasks and generate code</span>
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
      </div>
    </Layout>
  );
}

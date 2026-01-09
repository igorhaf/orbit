/**
 * New Project Wizard
 * Multi-step wizard for creating a new project with interview
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Layout, Breadcrumbs } from '@/components/layout';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Textarea } from '@/components/ui/Textarea';
import { Select } from '@/components/ui/Select';
import { projectsApi, interviewsApi } from '@/lib/api';
import { ChatInterface } from '@/components/interview/ChatInterface';

type Step = 'basic' | 'interview' | 'confirm';

export default function NewProjectPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('basic');
  const [loading, setLoading] = useState(false);

  // Form data
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [interviewId, setInterviewId] = useState<string | null>(null);

  const handleBasicSubmit = async () => {
    if (!name.trim()) {
      alert('Please enter a project name');
      return;
    }

    setLoading(true);
    try {
      // Create project
      const projectRes = await projectsApi.create({
        name,
        description: description || null,
      });

      setProjectId(projectRes.data.id);

      // Create interview (PROMPT #97 - First interview with no parent → meta_prompt)
      const interviewRes = await interviewsApi.create({
        project_id: projectRes.data.id,
        ai_model_used: 'claude-sonnet-4-20250514',
        parent_task_id: null,  // PROMPT #97 - Null = first interview = meta_prompt
      });

      setInterviewId(interviewRes.data.id);

      // Start interview
      await interviewsApi.start(interviewRes.data.id);

      setStep('interview');
    } catch (error) {
      console.error('Failed to create project:', error);
      alert('Failed to create project. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleInterviewComplete = () => {
    setStep('confirm');
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
            { id: 'basic', label: '1. Basic Info' },
            { id: 'interview', label: '2. Interview' },
            { id: 'confirm', label: '3. Confirm' },
          ].map((s, i) => (
            <div key={s.id} className="flex items-center">
              <div
                className={`flex items-center justify-center w-10 h-10 rounded-full ${
                  step === s.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-600'
                }`}
              >
                {i + 1}
              </div>
              {i < 2 && (
                <div className="w-20 h-0.5 bg-gray-200 mx-2" />
              )}
            </div>
          ))}
        </div>

        {/* Step 1: Basic Info */}
        {step === 'basic' && (
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
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
              </div>

              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description of your project (optional)"
                  className="mt-1"
                  rows={4}
                />
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
                  {loading ? 'Creating...' : 'Next: Interview'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Interview */}
        {step === 'interview' && interviewId && (
          <Card>
            <CardHeader>
              <CardTitle>AI Interview</CardTitle>
              <p className="text-sm text-gray-600 mt-1">
                Tell the AI what you want to build. It will ask clarifying questions
                to understand your requirements.
              </p>
            </CardHeader>
            <CardContent>
              <ChatInterface
                interviewId={interviewId}
                onComplete={handleInterviewComplete}
              />
            </CardContent>
          </Card>
        )}

        {/* Step 3: Confirm */}
        {step === 'confirm' && (
          <Card>
            <CardHeader>
              <CardTitle>Interview Complete!</CardTitle>
              <p className="text-sm text-gray-600 mt-1">
                Your project has been created and the interview is complete.
                We'll now generate tasks based on your requirements.
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
                    <span>Review your project details and interview summary</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">2.</span>
                    <span>Generate prompts from the interview</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">3.</span>
                    <span>Create tasks based on the prompts</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">4.</span>
                    <span>Execute tasks and review generated code</span>
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

/**
 * Backlog Generation Wizard Component
 * 3-step wizard: Interview → Epic → Stories → Tasks (AI-powered)
 * JIRA Transformation - PROMPT #62 - Phase 5
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Button, Input } from '@/components/ui';
import { backlogGenerationApi, interviewsApi, projectsApi } from '@/lib/api';
import { Interview, Project, BacklogGenerationSuggestion } from '@/lib/types';

interface GenerationWizardProps {
  projectId?: string;
  onComplete?: () => void;
  onClose: () => void;
}

type WizardStep = 'select-interview' | 'generate-epic' | 'generate-stories' | 'generate-tasks' | 'complete';

export default function GenerationWizard({ projectId: initialProjectId, onComplete, onClose }: GenerationWizardProps) {
  // State
  const [currentStep, setCurrentStep] = useState<WizardStep>('select-interview');
  const [projects, setProjects] = useState<Project[]>([]);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(initialProjectId || '');
  const [selectedInterviewId, setSelectedInterviewId] = useState<string>('');
  const [epicSuggestion, setEpicSuggestion] = useState<BacklogGenerationSuggestion | null>(null);
  const [storiesSuggestions, setStoriesSuggestions] = useState<BacklogGenerationSuggestion[]>([]);
  const [tasksSuggestions, setTasksSuggestions] = useState<BacklogGenerationSuggestion[]>([]);
  const [createdEpicId, setCreatedEpicId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [projectsData, interviewsData] = await Promise.all([
        projectsApi.list(),
        interviewsApi.list()
      ]);

      setProjects(Array.isArray(projectsData.data) ? projectsData.data : projectsData);
      setInterviews(Array.isArray(interviewsData.data) ? interviewsData.data : interviewsData);
    } catch (err) {
      console.error('Error fetching data:', err);
      setError('Failed to load projects and interviews');
    }
  };

  // Step 1: Select Interview
  const handleSelectInterview = () => {
    if (!selectedProjectId || !selectedInterviewId) {
      setError('Please select both project and interview');
      return;
    }
    setError('');
    setCurrentStep('generate-epic');
  };

  // Step 2: Generate Epic
  const handleGenerateEpic = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await backlogGenerationApi.generateEpic(selectedInterviewId, selectedProjectId);
      setEpicSuggestion(response.suggestions[0]);
      setCurrentStep('generate-epic');
    } catch (err: any) {
      console.error('Error generating epic:', err);
      setError(err.message || 'Failed to generate Epic');
    } finally {
      setLoading(false);
    }
  };

  const handleApproveEpic = async () => {
    if (!epicSuggestion) return;

    setLoading(true);
    setError('');

    try {
      const response = await backlogGenerationApi.approveEpic(
        epicSuggestion,
        selectedProjectId,
        selectedInterviewId
      );
      setCreatedEpicId(response.id);
      setCurrentStep('generate-stories');
    } catch (err: any) {
      console.error('Error approving epic:', err);
      setError(err.message || 'Failed to approve Epic');
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Generate Stories
  const handleGenerateStories = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await backlogGenerationApi.generateStories(createdEpicId, selectedProjectId);
      setStoriesSuggestions(response.suggestions);
      setCurrentStep('generate-stories');
    } catch (err: any) {
      console.error('Error generating stories:', err);
      setError(err.message || 'Failed to generate Stories');
    } finally {
      setLoading(false);
    }
  };

  const handleApproveStories = async () => {
    setLoading(true);
    setError('');

    try {
      await backlogGenerationApi.approveStories(storiesSuggestions, selectedProjectId);
      setCurrentStep('complete');

      if (onComplete) {
        setTimeout(() => onComplete(), 1500);
      }
    } catch (err: any) {
      console.error('Error approving stories:', err);
      setError(err.message || 'Failed to approve Stories');
    } finally {
      setLoading(false);
    }
  };

  const getStepNumber = (step: WizardStep): number => {
    const steps: WizardStep[] = ['select-interview', 'generate-epic', 'generate-stories', 'complete'];
    return steps.indexOf(step) + 1;
  };

  const getCurrentStepNumber = () => getStepNumber(currentStep);

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">AI Backlog Generation Wizard</h2>
            <p className="text-sm text-gray-500 mt-1">
              Generate Epics and Stories from your Interview insights
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Progress Steps */}
        <div className="px-6 py-4 border-b bg-gray-50">
          <div className="flex items-center justify-between">
            {/* Step 1 */}
            <div className="flex items-center">
              <div className={`
                w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold
                ${getCurrentStepNumber() >= 1 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}
              `}>
                {getCurrentStepNumber() > 1 ? '✓' : '1'}
              </div>
              <span className={`ml-2 text-sm font-medium ${getCurrentStepNumber() >= 1 ? 'text-gray-900' : 'text-gray-500'}`}>
                Select Interview
              </span>
            </div>

            {/* Connector */}
            <div className={`flex-1 h-0.5 mx-4 ${getCurrentStepNumber() >= 2 ? 'bg-blue-600' : 'bg-gray-200'}`} />

            {/* Step 2 */}
            <div className="flex items-center">
              <div className={`
                w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold
                ${getCurrentStepNumber() >= 2 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}
              `}>
                {getCurrentStepNumber() > 2 ? '✓' : '2'}
              </div>
              <span className={`ml-2 text-sm font-medium ${getCurrentStepNumber() >= 2 ? 'text-gray-900' : 'text-gray-500'}`}>
                Generate Epic
              </span>
            </div>

            {/* Connector */}
            <div className={`flex-1 h-0.5 mx-4 ${getCurrentStepNumber() >= 3 ? 'bg-blue-600' : 'bg-gray-200'}`} />

            {/* Step 3 */}
            <div className="flex items-center">
              <div className={`
                w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold
                ${getCurrentStepNumber() >= 3 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}
              `}>
                {getCurrentStepNumber() > 3 ? '✓' : '3'}
              </div>
              <span className={`ml-2 text-sm font-medium ${getCurrentStepNumber() >= 3 ? 'text-gray-900' : 'text-gray-500'}`}>
                Generate Stories
              </span>
            </div>

            {/* Connector */}
            <div className={`flex-1 h-0.5 mx-4 ${getCurrentStepNumber() >= 4 ? 'bg-blue-600' : 'bg-gray-200'}`} />

            {/* Step 4 */}
            <div className="flex items-center">
              <div className={`
                w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold
                ${getCurrentStepNumber() >= 4 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}
              `}>
                {getCurrentStepNumber() >= 4 ? '✓' : '4'}
              </div>
              <span className={`ml-2 text-sm font-medium ${getCurrentStepNumber() >= 4 ? 'text-gray-900' : 'text-gray-500'}`}>
                Complete
              </span>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Error Message */}
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {/* Step 1: Select Interview */}
          {currentStep === 'select-interview' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Select Project and Interview</h3>
                <p className="text-sm text-gray-600 mb-6">
                  Choose the Interview that contains your project requirements. The AI will analyze the conversation
                  to generate an Epic with User Stories.
                </p>

                {/* Project Selector */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Project</label>
                  <select
                    value={selectedProjectId}
                    onChange={(e) => setSelectedProjectId(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select a project...</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Interview Selector */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Interview</label>
                  <select
                    value={selectedInterviewId}
                    onChange={(e) => setSelectedInterviewId(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select an interview...</option>
                    {interviews
                      .filter(i => i.status === 'completed')
                      .map((interview) => (
                        <option key={interview.id} value={interview.id}>
                          Interview {interview.id.substring(0, 8)} - {new Date(interview.created_at).toLocaleDateString()}
                        </option>
                      ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    Only completed interviews are shown
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Generate Epic */}
          {currentStep === 'generate-epic' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Generate Epic</h3>

                {!epicSuggestion && (
                  <div className="text-center py-12">
                    <div className="mb-4">
                      <svg className="mx-auto h-16 w-16 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                    </div>
                    <p className="text-gray-600 mb-6">
                      Click the button below to let AI analyze your Interview and generate an Epic suggestion.
                    </p>
                    <Button
                      variant="primary"
                      size="lg"
                      onClick={handleGenerateEpic}
                      isLoading={loading}
                    >
                      <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Generate Epic with AI
                    </Button>
                  </div>
                )}

                {epicSuggestion && (
                  <Card variant="bordered">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle>AI-Generated Epic</CardTitle>
                        <span className="px-3 py-1 text-xs rounded-full bg-purple-100 text-purple-700 border border-purple-200">
                          🤖 AI Suggestion
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {/* Title */}
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Title</label>
                          <Input
                            value={epicSuggestion.title}
                            onChange={(e) => setEpicSuggestion({ ...epicSuggestion, title: e.target.value })}
                            className="font-medium"
                          />
                        </div>

                        {/* Description */}
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Description</label>
                          <textarea
                            value={epicSuggestion.description}
                            onChange={(e) => setEpicSuggestion({ ...epicSuggestion, description: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            rows={6}
                          />
                        </div>

                        {/* Metadata Grid */}
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Priority</label>
                            <span className="inline-block px-3 py-1 text-sm rounded border bg-yellow-50 text-yellow-800 border-yellow-200">
                              {epicSuggestion.priority}
                            </span>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Story Points</label>
                            <span className="inline-block px-3 py-1 text-sm rounded border bg-purple-50 text-purple-700 border-purple-200">
                              {epicSuggestion.story_points} pts
                            </span>
                          </div>
                        </div>

                        {/* Acceptance Criteria */}
                        {epicSuggestion.acceptance_criteria && epicSuggestion.acceptance_criteria.length > 0 && (
                          <div>
                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Acceptance Criteria</label>
                            <ul className="space-y-2">
                              {epicSuggestion.acceptance_criteria.map((criterion, idx) => (
                                <li key={idx} className="flex items-start gap-2 text-sm text-gray-700">
                                  <span className="text-blue-600 mt-0.5">✓</span>
                                  {criterion}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Interview Insights */}
                        {epicSuggestion.interview_insights && Object.keys(epicSuggestion.interview_insights).length > 0 && (
                          <div>
                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Interview Insights</label>
                            <div className="bg-green-50 border border-green-200 rounded p-3 text-xs">
                              <pre className="whitespace-pre-wrap">
                                {JSON.stringify(epicSuggestion.interview_insights, null, 2)}
                              </pre>
                            </div>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          )}

          {/* Step 3: Generate Stories */}
          {currentStep === 'generate-stories' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Generate User Stories</h3>

                {storiesSuggestions.length === 0 && (
                  <div className="text-center py-12">
                    <div className="mb-4">
                      <svg className="mx-auto h-16 w-16 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                    </div>
                    <p className="text-gray-600 mb-6">
                      Click the button below to decompose the Epic into User Stories using AI.
                    </p>
                    <Button
                      variant="primary"
                      size="lg"
                      onClick={handleGenerateStories}
                      isLoading={loading}
                    >
                      <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Generate Stories with AI
                    </Button>
                  </div>
                )}

                {storiesSuggestions.length > 0 && (
                  <div className="space-y-4">
                    <p className="text-sm text-gray-600 mb-4">
                      Review the AI-generated User Stories below. You can edit them before approval.
                    </p>

                    {storiesSuggestions.map((story, idx) => (
                      <Card key={idx} variant="bordered">
                        <CardHeader>
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-base">Story {idx + 1}</CardTitle>
                            <span className="px-2 py-1 text-xs rounded-full bg-purple-100 text-purple-700">
                              🤖 AI
                            </span>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-3">
                            <div>
                              <Input
                                value={story.title}
                                onChange={(e) => {
                                  const updated = [...storiesSuggestions];
                                  updated[idx] = { ...story, title: e.target.value };
                                  setStoriesSuggestions(updated);
                                }}
                                className="font-medium"
                              />
                            </div>
                            <div>
                              <textarea
                                value={story.description}
                                onChange={(e) => {
                                  const updated = [...storiesSuggestions];
                                  updated[idx] = { ...story, description: e.target.value };
                                  setStoriesSuggestions(updated);
                                }}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                rows={3}
                              />
                            </div>
                            <div className="flex gap-4 text-xs">
                              <span className="px-2 py-1 rounded bg-yellow-50 text-yellow-800 border border-yellow-200">
                                {story.priority}
                              </span>
                              <span className="px-2 py-1 rounded bg-purple-50 text-purple-700 border border-purple-200">
                                {story.story_points} pts
                              </span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 4: Complete */}
          {currentStep === 'complete' && (
            <div className="text-center py-16">
              <div className="mb-6">
                <div className="mx-auto w-20 h-20 bg-green-100 rounded-full flex items-center justify-center">
                  <svg className="w-12 h-12 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Backlog Generated Successfully!</h3>
              <p className="text-gray-600 mb-8">
                Your Epic and User Stories have been created and added to the backlog.
              </p>
              <div className="space-y-4 max-w-md mx-auto text-left">
                <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-lg">
                  <svg className="w-5 h-5 text-blue-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-blue-900">1 Epic Created</p>
                    <p className="text-xs text-blue-700 mt-1">Parent for all user stories</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-4 bg-green-50 rounded-lg">
                  <svg className="w-5 h-5 text-green-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-green-900">{storiesSuggestions.length} User Stories Created</p>
                    <p className="text-xs text-green-700 mt-1">Ready for planning and estimation</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t bg-gray-50">
          <Button variant="ghost" onClick={onClose}>
            {currentStep === 'complete' ? 'Close' : 'Cancel'}
          </Button>

          <div className="flex gap-2">
            {currentStep === 'select-interview' && (
              <Button
                variant="primary"
                onClick={handleSelectInterview}
                disabled={!selectedProjectId || !selectedInterviewId}
              >
                Next Step
              </Button>
            )}

            {currentStep === 'generate-epic' && epicSuggestion && (
              <Button
                variant="primary"
                onClick={handleApproveEpic}
                isLoading={loading}
              >
                Approve & Generate Stories
              </Button>
            )}

            {currentStep === 'generate-stories' && storiesSuggestions.length > 0 && (
              <Button
                variant="primary"
                onClick={handleApproveStories}
                isLoading={loading}
              >
                Approve Stories
              </Button>
            )}

            {currentStep === 'complete' && (
              <Button
                variant="primary"
                onClick={() => {
                  if (onComplete) onComplete();
                  onClose();
                }}
              >
                View Backlog
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

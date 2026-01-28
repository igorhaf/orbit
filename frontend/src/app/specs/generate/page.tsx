'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Layout, Breadcrumbs } from '@/components/layout';
import { Card, Button, Input, Badge, Checkbox } from '@/components/ui';
import { useNotification } from '@/hooks';

// Types
interface Project {
  id: string;
  name: string;
  description?: string;
  code_path?: string;
}

interface DiscoveredPattern {
  category: string;
  name: string;
  spec_type: string;
  title: string;
  description: string;
  template_content: string;
  language: string;
  confidence_score: number;
  reasoning: string;
  key_characteristics: string[];
  is_framework_worthy: boolean;
  occurrences: number;
  sample_files: string[];
}

interface PatternWithSelection extends DiscoveredPattern {
  selected: boolean;
}

// Steps enum
enum WizardStep {
  SELECT_PROJECT = 1,
  CONFIRM_PATH = 2,
  REVIEW_PATTERNS = 3,
  SAVE = 4,
}

export default function SpecGeneratePage() {
  const router = useRouter();
  const { showError, showWarning, NotificationComponent } = useNotification();

  // Wizard state
  const [currentStep, setCurrentStep] = useState<WizardStep>(WizardStep.SELECT_PROJECT);

  // Step 1: Select Project
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(false);

  // Step 2: Confirm Path
  const [codePath, setCodePath] = useState<string>('');

  // Step 3: Review Patterns
  const [patterns, setPatterns] = useState<PatternWithSelection[]>([]);
  const [loadingPatterns, setLoadingPatterns] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string>('');

  // Step 4: Save
  const [saving, setSaving] = useState(false);
  const [saveResults, setSaveResults] = useState<{
    frameworkCount: number;
    projectCount: number;
    errors: string[];
  }>({ frameworkCount: 0, projectCount: 0, errors: [] });

  // Load projects on mount
  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    setLoadingProjects(true);
    try {
      const response = await fetch('http://localhost:8000/api/v1/projects/');
      const data = await response.json();
      // Handle both array and object with data property
      const projectsList = Array.isArray(data) ? data : data.data || [];
      setProjects(projectsList);
    } catch (error) {
      console.error('Failed to load projects:', error);
    } finally {
      setLoadingProjects(false);
    }
  };

  const handleProjectSelect = (projectId: string) => {
    setSelectedProjectId(projectId);
    const project = projects.find(p => p.id === projectId);
    setSelectedProject(project || null);
    setCodePath(project?.code_path || '');
  };

  const handleNextFromSelectProject = () => {
    if (!selectedProject) return;

    if (!selectedProject.code_path) {
      showWarning('This project does not have a code path configured. Please configure it in project settings first.');
      return;
    }

    setCurrentStep(WizardStep.CONFIRM_PATH);
  };

  const handleNextFromConfirmPath = async () => {
    if (!selectedProject) return;

    setCurrentStep(WizardStep.REVIEW_PATTERNS);

    // Start pattern discovery
    setLoadingPatterns(true);
    setDiscoveryError('');

    try {
      const response = await fetch('http://localhost:8000/api/v1/specs/discover', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          project_id: selectedProject.id,
          max_patterns: 20,
          min_occurrences: 3,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to discover patterns');
      }

      const data = await response.json();

      // Add selection state to each pattern
      const patternsWithSelection = data.patterns.map((p: DiscoveredPattern) => ({
        ...p,
        selected: true, // Select all by default
      }));

      setPatterns(patternsWithSelection);
    } catch (error: any) {
      console.error('Pattern discovery failed:', error);
      setDiscoveryError(error.message || 'Failed to discover patterns');
    } finally {
      setLoadingPatterns(false);
    }
  };

  const handleTogglePattern = (index: number) => {
    setPatterns(prev => {
      const updated = [...prev];
      updated[index].selected = !updated[index].selected;
      return updated;
    });
  };

  const handleSelectAll = () => {
    setPatterns(prev => prev.map(p => ({ ...p, selected: true })));
  };

  const handleDeselectAll = () => {
    setPatterns(prev => prev.map(p => ({ ...p, selected: false })));
  };

  const handleSavePatterns = async () => {
    if (!selectedProject) return;

    const selectedPatterns = patterns.filter(p => p.selected);

    if (selectedPatterns.length === 0) {
      showWarning('Please select at least one pattern to save.');
      return;
    }

    setCurrentStep(WizardStep.SAVE);
    setSaving(true);

    let frameworkCount = 0;
    let projectCount = 0;
    const errors: string[] = [];

    for (const pattern of selectedPatterns) {
      try {
        const response = await fetch('http://localhost:8000/api/v1/specs/save-pattern', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            project_id: selectedProject.id,
            pattern: {
              category: pattern.category,
              name: pattern.name,
              spec_type: pattern.spec_type,
              title: pattern.title,
              description: pattern.description,
              template_content: pattern.template_content,
              language: pattern.language,
              confidence_score: pattern.confidence_score,
              reasoning: pattern.reasoning,
              key_characteristics: pattern.key_characteristics,
              is_framework_worthy: pattern.is_framework_worthy,
              occurrences: pattern.occurrences,
              sample_files: pattern.sample_files,
              discovery_method: pattern.discovery_method || 'ai_pattern_recognition',
            },
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.detail || 'Failed to save pattern');
        }

        const result = await response.json();

        if (result.scope === 'framework') {
          frameworkCount++;
        } else {
          projectCount++;
        }
      } catch (error: any) {
        console.error(`Failed to save pattern ${pattern.title}:`, error);
        errors.push(`${pattern.title}: ${error.message}`);
      }
    }

    setSaveResults({ frameworkCount, projectCount, errors });
    setSaving(false);
  };

  const handleBackToSpecs = () => {
    router.push('/specs');
  };

  const handleStartOver = () => {
    setCurrentStep(WizardStep.SELECT_PROJECT);
    setSelectedProjectId('');
    setSelectedProject(null);
    setCodePath('');
    setPatterns([]);
    setDiscoveryError('');
    setSaveResults({ frameworkCount: 0, projectCount: 0, errors: [] });
  };

  // Stepper component
  const Stepper = () => {
    const steps = [
      { number: 1, title: 'Select Project' },
      { number: 2, title: 'Confirm Path' },
      { number: 3, title: 'Review Patterns' },
      { number: 4, title: 'Save' },
    ];

    return (
      <div className="flex items-center justify-between mb-8">
        {steps.map((step, index) => (
          <React.Fragment key={step.number}>
            <div className="flex flex-col items-center">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold ${
                  currentStep >= step.number
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-500'
                }`}
              >
                {step.number}
              </div>
              <p className="mt-2 text-sm font-medium text-gray-700">{step.title}</p>
            </div>
            {index < steps.length - 1 && (
              <div
                className={`flex-1 h-1 mx-4 ${
                  currentStep > step.number ? 'bg-blue-600' : 'bg-gray-200'
                }`}
              />
            )}
          </React.Fragment>
        ))}
      </div>
    );
  };

  // Step 1: Select Project
  const renderSelectProject = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Select Project</h2>
        <p className="text-gray-500">
          Choose a project to analyze for code patterns. The project must have a code path configured.
        </p>
      </div>

      {loadingProjects ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      ) : (
        <div className="space-y-4">
          {projects.length === 0 ? (
            <Card className="p-6">
              <p className="text-gray-500 text-center">No projects found. Create a project first.</p>
            </Card>
          ) : (
            projects.map(project => (
              <Card
                key={project.id}
                className={`p-6 cursor-pointer transition-all ${
                  selectedProjectId === project.id
                    ? 'border-blue-600 border-2'
                    : 'border-gray-200 hover:border-blue-300'
                }`}
                onClick={() => handleProjectSelect(project.id)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900">{project.name}</h3>
                    {project.description && (
                      <p className="text-sm text-gray-500 mt-1">{project.description}</p>
                    )}
                    <div className="mt-3">
                      {project.code_path ? (
                        <Badge className="bg-green-100 text-green-800">
                          Path: {project.code_path}
                        </Badge>
                      ) : (
                        <Badge className="bg-red-100 text-red-800">
                          No code path configured
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="ml-4">
                    <Checkbox
                      checked={selectedProjectId === project.id}
                      onChange={() => handleProjectSelect(project.id)}
                    />
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      <div className="flex justify-between pt-6">
        <Button onClick={() => router.push('/specs')} className="bg-gray-500 hover:bg-gray-600">
          Cancel
        </Button>
        <Button
          onClick={handleNextFromSelectProject}
          disabled={!selectedProject}
          className="bg-blue-600 hover:bg-blue-700"
        >
          Next: Confirm Path
        </Button>
      </div>
    </div>
  );

  // Step 2: Confirm Path
  const renderConfirmPath = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Confirm Project Path</h2>
        <p className="text-gray-500">
          Verify that the project code path is correct. This path will be analyzed for patterns.
        </p>
      </div>

      <Card className="p-6">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Project Name
            </label>
            <Input
              value={selectedProject?.name || ''}
              disabled
              className="bg-gray-50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Code Path (in Docker container)
            </label>
            <Input
              value={codePath}
              disabled
              className="bg-gray-50"
            />
            <p className="text-xs text-gray-500 mt-1">
              This is the path configured in your project settings. To change it, go to project settings.
            </p>
          </div>

          {selectedProject && (
            <div className="pt-4">
              <Button
                onClick={() => router.push(`/projects/${selectedProject.id}`)}
                className="bg-gray-500 hover:bg-gray-600 text-sm"
              >
                Edit in Project Settings
              </Button>
            </div>
          )}
        </div>
      </Card>

      <div className="flex justify-between pt-6">
        <Button
          onClick={() => setCurrentStep(WizardStep.SELECT_PROJECT)}
          className="bg-gray-500 hover:bg-gray-600"
        >
          Back
        </Button>
        <Button
          onClick={handleNextFromConfirmPath}
          className="bg-blue-600 hover:bg-blue-700"
        >
          Next: Discover Patterns
        </Button>
      </div>
    </div>
  );

  // Step 3: Review Patterns
  const renderReviewPatterns = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Review Discovered Patterns</h2>
        <p className="text-gray-500">
          AI has analyzed your codebase and discovered the following patterns. Select which ones to save as specs.
        </p>
      </div>

      {loadingPatterns ? (
        <div className="flex flex-col items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
          <p className="text-gray-600">Analyzing codebase for patterns...</p>
          <p className="text-sm text-gray-500 mt-2">This may take a minute</p>
        </div>
      ) : discoveryError ? (
        <Card className="p-6 bg-red-50 border-red-200">
          <p className="text-red-800 font-semibold">Error discovering patterns:</p>
          <p className="text-red-600 mt-2">{discoveryError}</p>
          <Button
            onClick={() => setCurrentStep(WizardStep.CONFIRM_PATH)}
            className="mt-4 bg-red-600 hover:bg-red-700"
          >
            Try Again
          </Button>
        </Card>
      ) : patterns.length === 0 ? (
        <Card className="p-6">
          <p className="text-gray-500 text-center">No patterns discovered. Try adjusting your code path or check if the directory contains code files.</p>
        </Card>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">
              Found {patterns.length} pattern{patterns.length !== 1 ? 's' : ''} •{' '}
              {patterns.filter(p => p.selected).length} selected
            </p>
            <div className="space-x-2">
              <Button onClick={handleSelectAll} className="bg-gray-500 hover:bg-gray-600 text-sm">
                Select All
              </Button>
              <Button onClick={handleDeselectAll} className="bg-gray-500 hover:bg-gray-600 text-sm">
                Deselect All
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            {patterns.map((pattern, index) => (
              <Card
                key={index}
                className={`p-6 ${
                  pattern.selected ? 'border-blue-600 border-2' : 'border-gray-200'
                }`}
              >
                <div className="flex items-start">
                  <div className="mr-4 pt-1">
                    <Checkbox
                      checked={pattern.selected}
                      onChange={() => handleTogglePattern(index)}
                    />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">{pattern.title}</h3>
                        <p className="text-sm text-gray-500 mt-1">{pattern.description}</p>
                      </div>
                      <div className="flex items-center space-x-2 ml-4">
                        <Badge
                          className={
                            pattern.is_framework_worthy
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-blue-100 text-blue-800'
                          }
                        >
                          {pattern.is_framework_worthy ? 'Framework' : 'Project-Only'}
                        </Badge>
                        <Badge
                          className={
                            pattern.confidence_score >= 0.8
                              ? 'bg-green-100 text-green-800'
                              : pattern.confidence_score >= 0.6
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-orange-100 text-orange-800'
                          }
                        >
                          {(pattern.confidence_score * 100).toFixed(0)}% confidence
                        </Badge>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-sm mb-3">
                      <div>
                        <span className="font-medium text-gray-700">Category:</span>{' '}
                        <span className="text-gray-600">{pattern.category}</span>
                      </div>
                      <div>
                        <span className="font-medium text-gray-700">Type:</span>{' '}
                        <span className="text-gray-600">{pattern.spec_type}</span>
                      </div>
                      <div>
                        <span className="font-medium text-gray-700">Language:</span>{' '}
                        <span className="text-gray-600">{pattern.language}</span>
                      </div>
                      <div>
                        <span className="font-medium text-gray-700">Occurrences:</span>{' '}
                        <span className="text-gray-600">{pattern.occurrences} file(s)</span>
                      </div>
                    </div>

                    <div className="mb-3">
                      <p className="text-sm font-medium text-gray-700 mb-1">AI Reasoning:</p>
                      <p className="text-sm text-gray-600 italic">{pattern.reasoning}</p>
                    </div>

                    {pattern.key_characteristics.length > 0 && (
                      <div className="mb-3">
                        <p className="text-sm font-medium text-gray-700 mb-2">Key Characteristics:</p>
                        <div className="flex flex-wrap gap-2">
                          {pattern.key_characteristics.map((char, i) => (
                            <Badge key={i} className="bg-gray-100 text-gray-700">
                              {char}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    <details className="mt-4">
                      <summary className="text-sm font-medium text-blue-600 cursor-pointer hover:text-blue-700">
                        View Template ({pattern.template_content.split('\n').length} lines)
                      </summary>
                      <pre className="mt-2 p-4 bg-gray-50 rounded border border-gray-200 text-xs overflow-x-auto">
                        <code>{pattern.template_content}</code>
                      </pre>
                    </details>

                    {pattern.sample_files.length > 0 && (
                      <details className="mt-2">
                        <summary className="text-sm font-medium text-blue-600 cursor-pointer hover:text-blue-700">
                          Sample Files ({pattern.sample_files.length})
                        </summary>
                        <ul className="mt-2 text-xs text-gray-600 space-y-1">
                          {pattern.sample_files.map((file, i) => (
                            <li key={i} className="font-mono">
                              {file}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {!loadingPatterns && !discoveryError && patterns.length > 0 && (
        <div className="flex justify-between pt-6">
          <Button
            onClick={() => setCurrentStep(WizardStep.CONFIRM_PATH)}
            className="bg-gray-500 hover:bg-gray-600"
          >
            Back
          </Button>
          <Button
            onClick={handleSavePatterns}
            disabled={patterns.filter(p => p.selected).length === 0}
            className="bg-blue-600 hover:bg-blue-700"
          >
            Save Selected Patterns ({patterns.filter(p => p.selected).length})
          </Button>
        </div>
      )}
    </div>
  );

  // Step 4: Save Results
  const renderSaveResults = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          {saving ? 'Saving Patterns...' : 'Patterns Saved'}
        </h2>
        <p className="text-gray-500">
          {saving
            ? 'Please wait while we save your selected patterns.'
            : 'Your patterns have been saved successfully.'}
        </p>
      </div>

      {saving ? (
        <div className="flex flex-col items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
          <p className="text-gray-600">Saving patterns...</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="p-6 bg-purple-50 border-purple-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-purple-800">Framework Specs</p>
                  <p className="text-3xl font-bold text-purple-900 mt-2">
                    {saveResults.frameworkCount}
                  </p>
                  <p className="text-xs text-purple-600 mt-1">
                    Added to global framework library
                  </p>
                </div>
                <div className="text-purple-600">
                  <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
            </Card>

            <Card className="p-6 bg-blue-50 border-blue-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-blue-800">Project-Specific Specs</p>
                  <p className="text-3xl font-bold text-blue-900 mt-2">
                    {saveResults.projectCount}
                  </p>
                  <p className="text-xs text-blue-600 mt-1">
                    Saved to project: {selectedProject?.name}
                  </p>
                </div>
                <div className="text-blue-600">
                  <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              </div>
            </Card>
          </div>

          {saveResults.errors.length > 0 && (
            <Card className="p-6 bg-red-50 border-red-200">
              <p className="text-red-800 font-semibold mb-3">
                {saveResults.errors.length} pattern(s) failed to save:
              </p>
              <ul className="space-y-2">
                {saveResults.errors.map((error, index) => (
                  <li key={index} className="text-sm text-red-600">
                    • {error}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className="flex justify-between pt-6">
            <Button onClick={handleStartOver} className="bg-gray-500 hover:bg-gray-600">
              Start Over
            </Button>
            <Button onClick={handleBackToSpecs} className="bg-blue-600 hover:bg-blue-700">
              View All Specs
            </Button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <Layout>
      {NotificationComponent}
      <Breadcrumbs
        items={[
          { label: 'Specs', href: '/specs' },
          { label: 'Generate from Code', href: '/specs/generate' },
        ]}
      />

      <div className="max-w-5xl mx-auto">
        <Stepper />

        {currentStep === WizardStep.SELECT_PROJECT && renderSelectProject()}
        {currentStep === WizardStep.CONFIRM_PATH && renderConfirmPath()}
        {currentStep === WizardStep.REVIEW_PATTERNS && renderReviewPatterns()}
        {currentStep === WizardStep.SAVE && renderSaveResults()}
      </div>
    </Layout>
  );
}

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
import { Button, Badge, Card, CardHeader, CardTitle, CardContent, Dialog, Select } from '@/components/ui';

interface InterviewListProps {
  projectId?: string;
  showHeader?: boolean;
  showCreateButton?: boolean;
}

export function InterviewList({
  projectId,
  showHeader = true,
  showCreateButton = true
}: InterviewListProps) {
  const router = useRouter();
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState('');
  const [creating, setCreating] = useState(false);

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

  const handleCreate = async () => {
    // Use the provided projectId or the selected one from the dialog
    const targetProjectId = projectId || selectedProject;

    if (!targetProjectId) {
      alert('Please select a project');
      return;
    }

    setCreating(true);
    try {
      // PROMPT #56 - Create and redirect to interview
      const response = await interviewsApi.create({
        project_id: targetProjectId,
        ai_model_used: 'claude-3-sonnet',
        conversation_data: [],
      });

      // Get the created interview ID
      const createdInterview = response.data || response;
      const interviewId = createdInterview.id;

      // Redirect to the interview page (it will auto-start with fixed questions)
      router.push(`/interviews/${interviewId}`);
    } catch (error) {
      console.error('Failed to create interview:', error);
      alert('Failed to create interview. Please try again.');
      setCreating(false);
    }
    // Note: Don't setCreating(false) on success - we're navigating away
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="text-gray-600">Loading interviews...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      {showHeader && (
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Interviews</h1>
            <p className="mt-1 text-sm text-gray-500">
              Conduct AI-powered interviews to gather requirements
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
              New Interview
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
            New Interview
          </Button>
        </div>
      )}

      {/* Interviews Grid */}
      {/* ✅ LINE 102 - Safe check with optional chaining */}
      {(interviews || []).length === 0 ? (
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
            <h3 className="mt-2 text-sm font-medium text-gray-900">No interviews</h3>
            <p className="mt-1 text-sm text-gray-500">
              Get started by creating a new interview session.
            </p>
            <div className="mt-6">
              <Button variant="primary" onClick={() => setIsCreateOpen(true)}>
                Create Your First Interview
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {(interviews || []).map((interview) => (
            <Link key={interview.id} href={`/interviews/${interview.id}`}>
              <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
                <CardHeader>
                  <div className="flex justify-between items-start mb-2">
                    <CardTitle className="text-sm text-gray-500">
                      {interview.ai_model_used}
                    </CardTitle>
                    <span className="text-xs text-gray-400">
                      {interview.conversation_data.length} messages
                    </span>
                  </div>
                </CardHeader>

                <CardContent>
                  <p className="text-sm text-gray-600 mb-3 line-clamp-3">
                    {interview.conversation_data.length > 0
                      ? interview.conversation_data[interview.conversation_data.length - 1].content.substring(0, 150) +
                        (interview.conversation_data[interview.conversation_data.length - 1].content.length > 150 ? '...' : '')
                      : 'No messages yet. Click to start the conversation.'}
                  </p>

                  <div className="flex items-center justify-between text-xs text-gray-400 pt-3 border-t border-gray-100">
                    <span>
                      Created: {new Date(interview.created_at).toLocaleDateString()}
                    </span>
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
        title="Create New Interview"
        description="Start a new AI interview session for a project"
      >
        <div className="space-y-4">
          <Select
            label="Select Project"
            placeholder="-- Select a project --"
            options={(projects || []).map((p) => ({ value: p.id, label: p.name }))}
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
          />

          {(projects || []).length === 0 && (
            <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded">
              No projects available. Please create a project first.
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
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleCreate}
              disabled={!selectedProject || creating}
              isLoading={creating}
            >
              Create Interview
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

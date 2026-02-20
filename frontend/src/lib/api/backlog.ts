import { request } from './base';
import { jobsApi } from './jobs';

// Backlog Generation API (JIRA Transformation - PROMPT #62)
// PROMPT #108 - Generate methods now return job_id for polling
export const backlogGenerationApi = {
  // Returns job_id - use jobsApi.poll() to wait for result
  generateEpic: (interviewId: string, projectId: string) =>
    request<{
      job_id: string;
      status: string;
      message: string;
    }>(`/api/v1/backlog/interview/${interviewId}/generate-epic?project_id=${projectId}`, {
      method: 'POST',
    }),

  // PROMPT #108 - Generate with polling (waits for completion)
  generateEpicWithPolling: async (
    interviewId: string,
    projectId: string,
    onProgress?: (percent: number, message: string | null) => void
  ) => {
    const { job_id } = await backlogGenerationApi.generateEpic(interviewId, projectId);
    return jobsApi.poll(job_id, onProgress);
  },

  // Returns job_id - use jobsApi.poll() to wait for result
  generateStories: (epicId: string, projectId: string) =>
    request<{
      job_id: string;
      status: string;
      message: string;
    }>(`/api/v1/backlog/epic/${epicId}/generate-stories?project_id=${projectId}`, {
      method: 'POST',
    }),

  // PROMPT #108 - Generate with polling
  generateStoriesWithPolling: async (
    epicId: string,
    projectId: string,
    onProgress?: (percent: number, message: string | null) => void
  ) => {
    const { job_id } = await backlogGenerationApi.generateStories(epicId, projectId);
    return jobsApi.poll(job_id, onProgress);
  },

  // Returns job_id - use jobsApi.poll() to wait for result
  generateTasks: (storyId: string, projectId: string) =>
    request<{
      job_id: string;
      status: string;
      message: string;
    }>(`/api/v1/backlog/story/${storyId}/generate-tasks?project_id=${projectId}`, {
      method: 'POST',
    }),

  // PROMPT #108 - Generate with polling
  generateTasksWithPolling: async (
    storyId: string,
    projectId: string,
    onProgress?: (percent: number, message: string | null) => void
  ) => {
    const { job_id } = await backlogGenerationApi.generateTasks(storyId, projectId);
    return jobsApi.poll(job_id, onProgress);
  },

  approveEpic: (suggestion: any, projectId: string, interviewId: string) =>
    request<any>(`/api/v1/backlog/approve-epic?project_id=${projectId}&interview_id=${interviewId}`, {
      method: 'POST',
      body: JSON.stringify(suggestion),
    }),

  approveStories: (suggestions: any[], projectId: string) =>
    request<any>(`/api/v1/backlog/approve-stories?project_id=${projectId}`, {
      method: 'POST',
      body: JSON.stringify(suggestions),
    }),

  approveTasks: (suggestions: any[], projectId: string) =>
    request<any>(`/api/v1/backlog/approve-tasks?project_id=${projectId}`, {
      method: 'POST',
      body: JSON.stringify(suggestions),
    }),
};

// PROMPT #80 - Backlog Generation API (Epic → Stories → Tasks)
export const backlogApi = {
  // Generate Epic suggestion from interview (returns suggestion, not created yet)
  generateEpic: (interviewId: string, projectId: string) =>
    request<{
      suggestions: Array<{
        title: string;
        description: string;
        story_points?: number;
        priority: string;
        acceptance_criteria?: string[];
        interview_insights?: {
          key_requirements?: string[];
          business_goals?: string[];
          technical_constraints?: string[];
        };
        interview_question_ids?: number[];
        _metadata?: Record<string, any>;
      }>;
      metadata: Record<string, any>;
    }>(`/api/v1/backlog/interview/${interviewId}/generate-epic?project_id=${projectId}`, {
      method: 'POST',
    }),

  // Approve and create Epic in database
  approveEpic: (suggestion: any, projectId: string, interviewId: string) =>
    request<any>(`/api/v1/backlog/approve-epic?project_id=${projectId}&interview_id=${interviewId}`, {
      method: 'POST',
      body: JSON.stringify(suggestion),
    }),

  // Generate Stories from Epic
  generateStories: (epicId: string, projectId: string) =>
    request<any>(`/api/v1/backlog/epic/${epicId}/generate-stories?project_id=${projectId}`, {
      method: 'POST',
    }),

  // Approve and create Stories
  approveStories: (suggestions: any[], projectId: string) =>
    request<any>(`/api/v1/backlog/approve-stories?project_id=${projectId}`, {
      method: 'POST',
      body: JSON.stringify(suggestions),
    }),

  // Generate Tasks from Story
  generateTasks: (storyId: string, projectId: string) =>
    request<any>(`/api/v1/backlog/story/${storyId}/generate-tasks?project_id=${projectId}`, {
      method: 'POST',
    }),

  // Approve and create Tasks
  approveTasks: (suggestions: any[], projectId: string) =>
    request<any>(`/api/v1/backlog/approve-tasks?project_id=${projectId}`, {
      method: 'POST',
      body: JSON.stringify(suggestions),
    }),
};

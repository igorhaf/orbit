/**
 * API Client for ORBIT Backend - Barrel re-export
 * Domain modules are in ./api/
 */

export { API_URL, request } from './base';
export { projectsApi } from './projects';
export { tasksApi } from './tasks';
export { backlogGenerationApi, backlogApi } from './backlog';
export { interviewsApi } from './interviews';
export { promptsApi } from './prompts';
export { aiModelsApi, aiFlowApi, aiExecutionsApi } from './ai';
export type { JobStatus } from './jobs';
export type { JobResponse } from './jobs';
export { jobsApi } from './jobs';
export { knowledgeApi, ragApi } from './knowledge';
export { wikiApi } from './wiki';
export { commitsApi } from './commits';
export { settingsApi, analyzersApi, chatSessionsApi, promptQueueApi, projectChatsApi } from './misc';

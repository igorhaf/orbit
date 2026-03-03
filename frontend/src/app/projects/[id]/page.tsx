/**
 * Project Details Page
 * Shows project overview, Kanban board, tasks list, and actions
 */

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';  // PROMPT #151 - Restored useRouter for redirect
import Link from 'next/link';
import { Layout, Breadcrumbs } from '@/components/layout';
import { Button, Badge, Dialog, DialogFooter } from '@/components/ui';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';
import BacklogListView from '@/components/backlog/BacklogListView';
import { BacklogFilters, ItemDetailPanel } from '@/components/backlog';
// PROMPT #131 - Removed InterviewTree, interviews now shown below backlog items
import { GitCommitsList } from '@/components/commits';  // PROMPT #113 - Git Integration
import { ProjectSpecsList } from '@/components/specs';  // PROMPT #197 - Specs tab
import PromptQueuePanel from '@/components/backlog/PromptQueuePanel';  // PROMPT #215 - Prompt Queue
import WikiPanel from '@/components/wiki/WikiPanel';  // PROMPT #272 - Wiki as project tab
import { ProjectChatPanel } from '@/components/chat/ProjectChatPanel';  // PROMPT #282 - RAG Chat
import RagTab from './RagTab';  // PROMPT #232 - Extracted tab sub-component
import AnalyticsTab from './AnalyticsTab';  // PROMPT #232 - Extracted tab sub-component
import OverviewTab from './OverviewTab';  // PROMPT #232 - Extracted tab sub-component
import PipelineMonitor from '@/components/pipeline/PipelineMonitor';  // PROMPT #237 - Pipeline telemetry
import { projectsApi, tasksApi, ragApi, knowledgeApi } from '@/lib/api';
import { Project, Task, BacklogFilters as IBacklogFilters, BacklogItem, RagStats, CodeIndexingStats, BlockingAnalytics } from '@/lib/types';
import { useNotification, useJobPolling } from '@/hooks';
import { useNotifications } from '@/contexts/NotificationContext';

type Tab = 'overview' | 'backlog' | 'kanban' | 'queue' | 'wiki' | 'chat' | 'specs' | 'commits' | 'rag' | 'analytics';
type OverviewSubTab = 'description' | 'statistics' | 'settings';

export default function ProjectDetailsPage() {
  const params = useParams();
  const router = useRouter();  // PROMPT #151 - Restored for redirect to wizard
  const projectId = params.id as string;
  const { showError, showSuccess, NotificationComponent } = useNotification();
  const { addJob } = useNotifications();

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [overviewSubTab, setOverviewSubTab] = useState<OverviewSubTab>('description');
  const [loading, setLoading] = useState(true);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editedDescription, setEditedDescription] = useState('');
  const [isFormattingDescription, setIsFormattingDescription] = useState(false);
  const [isSavingDescription, setIsSavingDescription] = useState(false);

  // Title inline editing
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [isSavingTitle, setIsSavingTitle] = useState(false);

  // PROMPT #240 - AI auto-generate title/description
  const [generatingTitle, setGeneratingTitle] = useState(false);
  const [generatingDescription, setGeneratingDescription] = useState(false);
  // PROMPT #241 - Expand/Summarize description (via job queue)
  const [expandingDescription, setExpandingDescription] = useState(false);
  const [summarizingDescription, setSummarizingDescription] = useState(false);
  const [rephrasingDescription, setRephrasingDescription] = useState(false);
  const [descriptionJobId, setDescriptionJobId] = useState<string | null>(null);

  // Refs for inline editing
  const descriptionEditorRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const skipAutoFormatRef = useRef(false);  // PROMPT #241 fix - skip auto-format after AI operations
  const pinnedFragmentsRef = useRef<string[]>([]);  // PROMPT #243 fix - track pinned fragments for rapid successive saves

  // Backlog states
  const [backlogFilters, setBacklogFilters] = useState<IBacklogFilters>({});
  const [showBacklogFilters, setShowBacklogFilters] = useState(true);
  const [selectedBacklogItem, setSelectedBacklogItem] = useState<BacklogItem | null>(null);
  const [backlogRefreshKey, setBacklogRefreshKey] = useState(0);  // PROMPT #96 - Trigger backlog refresh
  // PROMPT #123 - Available filter options from backlog
  const [availableLabels, setAvailableLabels] = useState<string[]>([]);
  // PROMPT #131 - Selected interview to open in ItemDetailPanel
  const [selectedInterviewId, setSelectedInterviewId] = useState<string | null>(null);
  // PROMPT #131 - Bulk selection for mass actions
  const [selectedBacklogIds, setSelectedBacklogIds] = useState<Set<string>>(new Set());

  // RAG states (PROMPT #90)
  const [ragStats, setRagStats] = useState<RagStats | null>(null);
  const [codeStats, setCodeStats] = useState<CodeIndexingStats | null>(null);
  const [loadingRag, setLoadingRag] = useState(false);

  // PROMPT #172 - Knowledge/Document Storage stats for project
  const [knowledgeStats, setKnowledgeStats] = useState<{
    total_documents: number;
    business_rules_count: number;
    interview_answers_count: number;
    code_files_count: number;
    documents_count: number;
    by_category: Record<string, number>;
    by_source: Record<string, number>;
  } | null>(null);

  // Analytics states (PROMPT #97)
  const [analyticsData, setAnalyticsData] = useState<BlockingAnalytics | null>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [analyticsDays, setAnalyticsDays] = useState<number>(30);

  // PROMPT #239 - Enrichment status for living wiki
  const [isEnriching, setIsEnriching] = useState(false);
  const prevEnrichingRef = useRef(false);

  // PROMPT #237 - RAG completion status
  const [hasEpics, setHasEpics] = useState(false);
  const [generatingHierarchy, setGeneratingHierarchy] = useState(false);

  // PROMPT #242 - Track initial_scan_complete for RAG → Cards ordering
  const [initialScanComplete, setInitialScanComplete] = useState(false);

  // PROMPT #251 - Manual RAG scan state (hasCompletedScan used by polling)
  const [hasCompletedScan, setHasCompletedScan] = useState(false);

  // PROMPT #252 - Pipeline wizard state (4 phases)
  const [pipelinePhase1, setPipelinePhase1] = useState<'pending' | 'running' | 'completed' | 'failed'>('pending');
  const [pipelinePhase2, setPipelinePhase2] = useState<'pending' | 'running' | 'completed' | 'failed'>('pending');
  const [pipelinePhase3, setPipelinePhase3] = useState<'pending' | 'running' | 'completed' | 'failed'>('pending');
  const [pipelinePhase4, setPipelinePhase4] = useState<'pending' | 'running' | 'completed' | 'failed'>('pending');
  const [hasIndexedFiles, setHasIndexedFiles] = useState(false);
  const [hasBusinessRules, setHasBusinessRules] = useState(false);
  const [hasCards, setHasCards] = useState(false);
  const [hasWiki, setHasWiki] = useState(false);
  // Track when phases are locally triggered to prevent stale poll overrides
  const phaseTriggeredAt = useRef<Record<string, number>>({});

  // PROMPT #260 - Deep Pipeline (7-phase via Claudio)
  const [deepPipelineRunning, setDeepPipelineRunning] = useState(false);
  const [deepPipelineCompleted, setDeepPipelineCompleted] = useState(false);
  const [deepPipelineProgress, setDeepPipelineProgress] = useState<string | null>(null);
  const [deepPipelineScore, setDeepPipelineScore] = useState<string | null>(null);
  // PROMPT #263 - Pipeline profile selector
  const [pipelineProfiles, setPipelineProfiles] = useState<any[]>([]);
  const [selectedPipelineProfile, setSelectedPipelineProfile] = useState<string>('');

  // Epic count dialog states
  const [showEpicCountDialog, setShowEpicCountDialog] = useState(false);
  const [epicCount, setEpicCount] = useState(10);

  const loadProjectData = useCallback(async () => {
    console.log('📋 Loading project data for ID:', projectId);
    try {
      // PROMPT #277 - Use Promise.allSettled to prevent tasks failure from blocking project load
      const [projectResult, tasksResult] = await Promise.allSettled([
        projectsApi.get(projectId),
        tasksApi.list({ project_id: projectId }),
      ]);

      if (projectResult.status === 'fulfilled') {
        const projectData = projectResult.value.data || projectResult.value;
        setProject(projectData);
        // PROMPT #243 fix - sync ref with server data
        pinnedFragmentsRef.current = projectData.pinned_fragments || [];
      } else {
        console.error('❌ Failed to load project:', projectResult.reason);
      }

      if (tasksResult.status === 'fulfilled') {
        const tasksData = tasksResult.value.data || tasksResult.value;
        setTasks(Array.isArray(tasksData) ? tasksData : []);
      } else {
        console.error('❌ Failed to load tasks:', tasksResult.reason);
        setTasks([]);
      }
    } catch (error) {
      console.error('❌ Failed to load project data:', error);
    } finally {
      setLoading(false);
    }
  }, [projectId, router]);

  // PROMPT #241 - Poll description generation/expand/summarize job
  useJobPolling(descriptionJobId, {
    enabled: !!descriptionJobId,
    onComplete: (result: any) => {
      const desc = result?.description;
      if (desc) {
        skipAutoFormatRef.current = true;
        setEditedDescription(desc);
        loadProjectData();
      }
      setGeneratingDescription(false);
      setExpandingDescription(false);
      setSummarizingDescription(false);
      setRephrasingDescription(false);
      setDescriptionJobId(null);
    },
    onError: (error: string) => {
      showError(error || 'Falha na operação de descrição');
      setGeneratingDescription(false);
      setExpandingDescription(false);
      setSummarizingDescription(false);
      setRephrasingDescription(false);
      setDescriptionJobId(null);
    },
  });

  useEffect(() => {
    loadProjectData();
  }, [loadProjectData]);

  // PROMPT #263 - Load pipeline profiles
  useEffect(() => {
    ragApi.pipelineProfiles().then((data) => {
      const list = Array.isArray(data) ? data : [];
      setPipelineProfiles(list);
      const defaultP = list.find((p: any) => p.is_default) || list[0];
      if (defaultP) setSelectedPipelineProfile(defaultP.name);
    }).catch(() => {});
  }, []);

  // PROMPT #301 - Poll enrichment status and auto-refresh project data while enriching
  // This covers initial scan, wiki enrichment, card generation, and watchdog
  // PROMPT #234 RT-3: Added cancelled flag to prevent setState after unmount
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    let cancelled = false;

    const checkEnrichment = async () => {
      try {
        const status = await ragApi.enrichmentStatus(projectId);
        if (cancelled) return;
        const wasEnriching = prevEnrichingRef.current;
        setIsEnriching(status.is_enriching);

        // PROMPT #237 - Track RAG completion
        setHasEpics(status.has_epics || false);
        // PROMPT #242 - Track initial_scan_complete for RAG → Cards ordering
        setInitialScanComplete(status.initial_scan_complete || false);
        // PROMPT #251 - Track if at least one RAG scan has been completed
        setHasCompletedScan(status.has_completed_scan || false);

        // PROMPT #252 - Pipeline wizard state
        setHasIndexedFiles(status.has_indexed_files || false);
        setHasBusinessRules(status.has_business_rules || false);
        setHasCards(status.has_cards || false);
        setHasWiki(status.has_wiki || false);
        // Update pipeline phases with stale-poll protection:
        // When a phase is locally triggered ('running'), don't let a stale poll
        // override it back to 'completed'/'pending' for 15s (cooldown).
        // Once the backend returns 'running', the cooldown is cleared.
        const COOLDOWN_MS = 15000;
        const now = Date.now();
        const phaseUpdates: [string, (v: any) => void, string | undefined][] = [
          ['phase_1', setPipelinePhase1, status.pipeline_phase_1],
          ['phase_2', setPipelinePhase2, status.pipeline_phase_2],
          ['phase_3', setPipelinePhase3, status.pipeline_phase_3],
          ['phase_4', setPipelinePhase4, status.pipeline_phase_4],
        ];
        for (const [key, setter, pollValue] of phaseUpdates) {
          if (!pollValue) continue;
          const triggeredAt = phaseTriggeredAt.current[key] || 0;
          if (triggeredAt && now - triggeredAt < COOLDOWN_MS && pollValue !== 'running') {
            continue; // Skip stale poll within cooldown — keep local 'running'
          }
          if (pollValue === 'running' && triggeredAt) {
            delete phaseTriggeredAt.current[key]; // Backend confirmed, clear cooldown
          }
          setter(pollValue);
        }

        // PROMPT #260 - Deep Pipeline state from enrichment status
        setDeepPipelineRunning(status.deep_pipeline_running || false);
        setDeepPipelineCompleted(status.deep_pipeline_completed || false);
        setDeepPipelineScore(status.deep_pipeline_quality_score || null);
        if (status.deep_pipeline_progress) {
          setDeepPipelineProgress(status.deep_pipeline_progress.message || null);
        } else if (!status.deep_pipeline_running) {
          setDeepPipelineProgress(null);
        }

        // Reset generatingHierarchy when epics appear or enrichment finishes
        if ((status.has_epics || false) && !status.is_enriching) {
          setGeneratingHierarchy(false);
        }

        // While enriching, refresh project data every poll (catches title/description updates)
        if (status.is_enriching) {
          loadProjectData();
        }

        // When enrichment transitions from active to done, do a final refresh
        if (wasEnriching && !status.is_enriching) {
          loadProjectData();
        }
        prevEnrichingRef.current = status.is_enriching;
      } catch {
        // Ignore errors
      }
    };

    checkEnrichment();
    interval = setInterval(checkEnrichment, 5000); // Poll every 5s for faster updates

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [projectId, loadProjectData]);

  // PROMPT #155 - Listen for incremental epic batch creation events
  useEffect(() => {
    const handleEpicsBatch = (event: CustomEvent) => {
      const { projectId: eventProjectId, epics, batchNumber, totalBatches } = event.detail;

      // Only update if this event is for the current project
      if (eventProjectId !== projectId) return;

      console.log(`📦 Received epic batch ${batchNumber}/${totalBatches}: ${epics?.length || 0} epics`);

      // Add new epics to tasks state incrementally
      if (epics && Array.isArray(epics)) {
        setTasks(prevTasks => {
          // Filter out any duplicates by ID
          const existingIds = new Set(prevTasks.map(t => t.id));
          const newEpics = epics.filter((e: any) => !existingIds.has(e.id));

          if (newEpics.length === 0) return prevTasks;

          // Add new epics with proper structure
          const formattedEpics = newEpics.map((epic: any) => ({
            ...epic,
            item_type: epic.item_type || 'epic',
            workflow_state: epic.workflow_state || 'draft',
            labels: epic.labels || ['suggested'],
            status: epic.status || 'todo'
          }));

          return [...prevTasks, ...formattedEpics];
        });

        // Also trigger backlog refresh for any UI that needs it
        setBacklogRefreshKey(prev => prev + 1);
      }
    };

    window.addEventListener('epicsBatchCreated', handleEpicsBatch as EventListener);
    return () => window.removeEventListener('epicsBatchCreated', handleEpicsBatch as EventListener);
  }, [projectId]);

  const handleTasksUpdate = () => {
    loadProjectData();
    // PROMPT #96 - Trigger backlog refresh to update selected item
    setBacklogRefreshKey(prev => prev + 1);
  };

  // Load RAG stats (PROMPT #90)
  // PROMPT #172 - Also load knowledge/document storage stats
  const loadRagStats = useCallback(async () => {
    if (activeTab !== 'rag') return;

    setLoadingRag(true);
    try {
      const [rag, code, knowledge] = await Promise.all([
        ragApi.stats(),
        ragApi.codeStats(projectId),
        knowledgeApi.getFullStats(projectId)
      ]);
      setRagStats(rag);
      setCodeStats(code);
      setKnowledgeStats(knowledge);
    } catch (error) {
      console.error('Failed to load RAG stats:', error);
    } finally {
      setLoadingRag(false);
    }
  }, [projectId, activeTab]);

  // Load RAG stats when tab becomes active
  useEffect(() => {
    if (activeTab === 'rag') {
      loadRagStats();
    }
  }, [activeTab, loadRagStats]);

  // PROMPT #96 - Removed direct sync here, now handled by BacklogListView
  // via refreshKey and selectedItemId props

  // Load Analytics data (PROMPT #97)
  const loadAnalyticsData = useCallback(async () => {
    if (activeTab !== 'analytics') return;

    setLoadingAnalytics(true);
    try {
      const analytics = await tasksApi.getBlockingAnalytics(projectId, analyticsDays);
      setAnalyticsData(analytics.data || analytics);
    } catch (error) {
      console.error('Failed to load blocking analytics:', error);
    } finally {
      setLoadingAnalytics(false);
    }
  }, [projectId, activeTab, analyticsDays]);

  // Load Analytics when tab becomes active or days filter changes
  useEffect(() => {
    if (activeTab === 'analytics') {
      loadAnalyticsData();
    }
  }, [activeTab, loadAnalyticsData]);

  // Check if text is already in Markdown format
  const checkIfMarkdown = useCallback((text: string): boolean => {
    const markdownPatterns = [
      /^#{1,6}\s/m,           // Headers
      /\*\*.*\*\*/,            // Bold
      /\*.*\*/,                // Italic
      /\[.*\]\(.*\)/,          // Links
      /^[-*+]\s/m,             // Lists
      /^\d+\.\s/m,             // Numbered lists
      /```[\s\S]*```/,         // Code blocks
      /^>\s/m,                 // Blockquotes
    ];

    return markdownPatterns.some(pattern => pattern.test(text));
  }, []);

  // Format plain text to Markdown using AI
  const formatDescriptionToMarkdown = useCallback(async (text: string) => {
    console.log('🚀 Starting markdown formatting...');
    setIsFormattingDescription(true);
    try {
      const response = await fetch('/api/format-markdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (response.ok) {
        const data = await response.json();
        console.log('✅ Formatting successful, saving to database...');
        setEditedDescription(data.markdown);

        // Auto-save formatted description
        await projectsApi.update(projectId, {
          description: data.markdown,
        });

        console.log('✅ Saved to database, reloading project data...');
        // Reload project data
        await loadProjectData();
      } else {
        console.error('❌ Formatting API returned error:', response.status);
        // Fallback: use original text
        setEditedDescription(text);
      }
    } catch (error) {
      console.error('❌ Error formatting to Markdown:', error);
      setEditedDescription(text);
    } finally {
      setIsFormattingDescription(false);
    }
  }, [projectId, loadProjectData]);

  // Format description to Markdown if needed
  useEffect(() => {
    console.log('🔄 Format effect running...', {
      hasDescription: !!project?.description,
      isFormatting: isFormattingDescription,
      hasEdited: !!editedDescription,
      isEditing: isEditingDescription,
      skipAutoFormat: skipAutoFormatRef.current,
    });

    // PROMPT #241 fix - Skip auto-format when description was just set by AI operation
    if (skipAutoFormatRef.current) {
      console.log('⏭️ Skipping auto-format (AI operation just completed)');
      skipAutoFormatRef.current = false;
      return;
    }

    // Don't auto-format while user is manually editing
    if (project?.description && !isFormattingDescription && !editedDescription && !isEditingDescription) {
      const isMarkdown = checkIfMarkdown(project.description);
      console.log('🔍 Checking if description is Markdown:', isMarkdown);

      if (!isMarkdown) {
        console.log('📝 Description is plain text, formatting to Markdown...');
        formatDescriptionToMarkdown(project.description);
      } else {
        console.log('✅ Description is already Markdown');
        setEditedDescription(project.description);
      }
    }
  }, [project?.description, isFormattingDescription, editedDescription, isEditingDescription, checkIfMarkdown, formatDescriptionToMarkdown]);

  // Click outside handler for description auto-save
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isEditingDescription &&
          descriptionEditorRef.current &&
          !descriptionEditorRef.current.contains(event.target as Node)) {
        handleSaveDescription();
      }
    };

    if (isEditingDescription) {
      setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 100);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isEditingDescription, editedDescription]);

  // Double-click to edit description
  const handleDescriptionDoubleClick = () => {
    setEditedDescription(project?.description || '');
    setIsEditingDescription(true);
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  };

  const handleSaveDescription = async () => {
    if (editedDescription === project?.description) {
      setIsEditingDescription(false);
      return;
    }

    setIsSavingDescription(true);
    try {
      await projectsApi.update(projectId, {
        description: editedDescription,
      });

      setIsEditingDescription(false);
      setEditedDescription('');
      await loadProjectData();
    } catch (error) {
      console.error('Error saving description:', error);
      showError('Falha ao salvar descrição. Tente novamente.');
    } finally {
      setIsSavingDescription(false);
    }
  };

  const handleCancelDescriptionEdit = () => {
    setEditedDescription(project?.description || '');
    setIsEditingDescription(false);
  };

  // Double-click to edit title
  const handleTitleDoubleClick = () => {
    setIsEditingTitle(true);
    setEditedTitle(project?.name || '');
    setTimeout(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }, 0);
  };

  const handleSaveTitle = async () => {
    const trimmed = editedTitle.trim();
    if (!trimmed || trimmed === project?.name) {
      setIsEditingTitle(false);
      setEditedTitle(project?.name || '');
      return;
    }

    setIsSavingTitle(true);
    try {
      await projectsApi.update(projectId, { name: trimmed });
      setIsEditingTitle(false);
      await loadProjectData();
    } catch (error) {
      console.error('Error saving title:', error);
      showError('Falha ao salvar título. Tente novamente.');
    } finally {
      setIsSavingTitle(false);
    }
  };

  const handleCancelTitleEdit = () => {
    setEditedTitle(project?.name || '');
    setIsEditingTitle(false);
  };

  // PROMPT #240 - AI auto-generate title from description
  const handleGenerateTitle = useCallback(async () => {
    if (!project?.description?.trim()) return;
    setGeneratingTitle(true);
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
      const resp = await fetch(`${API_BASE}/api/v1/projects/generate-title`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: project.description.trim(),
          current_title: project.name?.trim() || undefined,
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.title) {
          await projectsApi.update(projectId, { name: data.title });
          await loadProjectData();
        }
      } else {
        showError('Falha ao gerar título');
      }
    } catch {
      showError('Erro ao conectar com o servidor');
    } finally {
      setGeneratingTitle(false);
    }
  }, [project, projectId, showError, loadProjectData]);

  // PROMPT #240 - AI auto-generate description from title
  // PROMPT #241 - Description generation via job queue (generate/expand/summarize)
  const startDescriptionJob = useCallback(async (
    endpoint: string,
    body: Record<string, any>,
    notificationTitle: string,
  ) => {
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
      const resp = await fetch(`${API_BASE}/api/v1/projects/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, project_id: projectId }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.job_id) {
          setDescriptionJobId(data.job_id);
          addJob(data.job_id, 'description_generation', notificationTitle, undefined, true);
        }
      } else {
        throw new Error('Endpoint retornou erro');
      }
    } catch {
      showError('Erro ao conectar com o servidor');
      setGeneratingDescription(false);
      setExpandingDescription(false);
      setSummarizingDescription(false);
      setRephrasingDescription(false);
    }
  }, [projectId, showError, addJob]);

  const handleGenerateDescription = useCallback(async () => {
    if (!project?.name?.trim()) return;
    setGeneratingDescription(true);
    await startDescriptionJob('generate-description', { title: project.name.trim() }, `Gerando descrição — '${project.name}'`);
  }, [project, startDescriptionJob]);

  // PROMPT #241 - Expand (detalhar) description
  const handleExpandDescription = useCallback(async () => {
    if (!project?.description?.trim() || !project?.name?.trim()) return;
    setExpandingDescription(true);
    await startDescriptionJob('expand-description', {
      title: project.name.trim(),
      current_description: project.description.trim(),
      pinned_fragments: project.pinned_fragments || [],
    }, `Detalhando descrição — '${project.name}'`);
  }, [project, startDescriptionJob]);

  // PROMPT #241 - Summarize (resumir) description
  const handleSummarizeDescription = useCallback(async () => {
    if (!project?.description?.trim() || !project?.name?.trim()) return;
    setSummarizingDescription(true);
    await startDescriptionJob('summarize-description', {
      title: project.name.trim(),
      current_description: project.description.trim(),
      pinned_fragments: project.pinned_fragments || [],
    }, `Resumindo descrição — '${project.name}'`);
  }, [project, startDescriptionJob]);

  // PROMPT #244 - Rephrase (reformular) description
  const handleRephraseDescription = useCallback(async () => {
    if (!project?.description?.trim() || !project?.name?.trim()) return;
    setRephrasingDescription(true);
    await startDescriptionJob('rephrase-description', {
      title: project.name.trim(),
      current_description: project.description.trim(),
      pinned_fragments: project.pinned_fragments || [],
    }, `Reformulando descrição — '${project.name}'`);
  }, [project, startDescriptionJob]);

  // Markdown formatting helpers
  const insertMarkdown = (before: string, after: string = '') => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = editedDescription.substring(start, end);
    const newText = editedDescription.substring(0, start) + before + selectedText + after + editedDescription.substring(end);

    setEditedDescription(newText);

    setTimeout(() => {
      textarea.focus();
      const newCursorPos = start + before.length + selectedText.length + after.length;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  const formatBold = () => insertMarkdown('**', '**');
  const formatItalic = () => insertMarkdown('*', '*');
  const formatCode = () => insertMarkdown('`', '`');
  const formatCodeBlock = () => insertMarkdown('\n```\n', '\n```\n');
  const formatHeading1 = () => insertMarkdown('# ');
  const formatHeading2 = () => insertMarkdown('## ');
  const formatHeading3 = () => insertMarkdown('### ');
  const formatBulletList = () => insertMarkdown('- ');
  const formatNumberedList = () => insertMarkdown('1. ');
  const formatLink = () => insertMarkdown('[', '](url)');
  const formatQuote = () => insertMarkdown('> ');
  const formatTable = () => insertMarkdown('\n| Header 1 | Header 2 |\n|----------|----------|\n| Cell 1 | Cell 2 |\n');

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </Layout>
    );
  }

  if (!project) {
    return (
      <Layout>
        <div className="text-center py-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Projeto Não Encontrado
          </h2>
          <p className="text-gray-600 mb-4">
            O projeto que você esta procurando não existe.
          </p>
          <Link href="/projects">
            <Button variant="primary">Voltar para Projetos</Button>
          </Link>
        </div>
      </Layout>
    );
  }

  const tasksByStatus = {
    backlog: tasks.filter((t) => t.status === 'backlog'),
    todo: tasks.filter((t) => t.status === 'todo'),
    in_progress: tasks.filter((t) => t.status === 'in_progress'),
    review: tasks.filter((t) => t.status === 'review'),
    done: tasks.filter((t) => t.status === 'done'),
  };

  return (
    <Layout>
      {/* Breadcrumb */}
      <div className="mb-6">
        <Breadcrumbs />
      </div>

      {/* PROMPT #237 - Pipeline Monitor (auto-hides when idle) */}
      <PipelineMonitor projectId={projectId} />

      <div className="space-y-6">
        {/* Header with action buttons on title line */}
        <div className="flex justify-between items-start">
          <div className="flex-1">
            {isEditingTitle ? (
              <div className="flex items-center gap-2">
                <input
                  ref={titleInputRef}
                  type="text"
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  className="text-3xl font-bold text-gray-900 bg-transparent border-b-2 border-blue-500 focus:outline-none w-full"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSaveTitle();
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      handleCancelTitleEdit();
                    }
                  }}
                  onBlur={handleSaveTitle}
                  disabled={isSavingTitle}
                />
                {isSavingTitle && (
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" />
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h1
                  className="text-3xl font-bold text-gray-900 cursor-pointer hover:bg-gray-50 rounded px-1 -mx-1 transition-colors"
                  onDoubleClick={handleTitleDoubleClick}
                  title="Clique duplo para editar"
                >
                  {project.name}
                </h1>
                {/* PROMPT #240 - Auto-generate title button */}
                <button
                  type="button"
                  onClick={handleGenerateTitle}
                  disabled={!project.description?.trim() || generatingTitle}
                  title={project.description?.trim() ? 'Reformular título via IA' : 'Adicione uma descrição primeiro'}
                  className="flex items-center justify-center w-8 h-8 shrink-0 rounded-md border border-gray-300 bg-white text-gray-400 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {generatingTitle ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  )}
                </button>
              </div>
            )}

            {/* Stack Configuration Badges (PROMPT #46 - Phase 1) */}
            {(project.stack_backend || project.stack_database || project.stack_frontend || project.stack_css) && (
              <div className="mt-3 flex flex-wrap gap-2">
              {project.stack_backend && (
                <Badge variant="info">
                  <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
                  </svg>
                  Backend: {project.stack_backend}
                </Badge>
              )}
              {project.stack_database && (
                <Badge variant="info">
                  <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                  </svg>
                  Database: {project.stack_database}
                </Badge>
              )}
              {project.stack_frontend && (
                <Badge variant="info">
                  <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  Frontend: {project.stack_frontend}
                </Badge>
              )}
              {project.stack_css && (
                <Badge variant="info">
                  <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                  </svg>
                  CSS: {project.stack_css}
                </Badge>
              )}
            </div>
          )}
          </div>

        </div>

        {/* PROMPT #260/#263 - Deep Pipeline button + AI Studio links */}
        {!loading && (
          <div className="bg-white border border-gray-200 rounded-lg px-6 py-5">
            {/* PROMPT #260 - Deep Pipeline (7-phase via Claudio) */}
            {/* PROMPT #263 - Profile selector + AI Studio links */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    disabled={deepPipelineRunning}
                    onClick={async () => {
                      try {
                        setDeepPipelineRunning(true);
                        setDeepPipelineProgress('Iniciando...');
                        await ragApi.deepPipeline(projectId, selectedPipelineProfile || undefined);
                        showSuccess(`Deep Pipeline iniciado (perfil: ${selectedPipelineProfile || 'default'})`);
                      } catch (err: any) {
                        setDeepPipelineRunning(false);
                        setDeepPipelineProgress(null);
                        showError(err?.message || 'Erro ao iniciar Deep Pipeline');
                      }
                    }}
                    className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                      deepPipelineRunning
                        ? 'bg-purple-50 text-purple-600 border border-purple-200 cursor-wait'
                        : deepPipelineCompleted
                        ? 'bg-purple-50 text-purple-700 border border-purple-300 hover:bg-purple-100'
                        : 'bg-purple-600 text-white hover:bg-purple-700'
                    }`}
                    title="Executa pipeline completo de 7 fases usando Claudio"
                  >
                    {deepPipelineRunning ? (
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    )}
                    {deepPipelineRunning ? 'Pipeline em execucao...' : deepPipelineCompleted ? 'Re-executar Pipeline' : 'Deep Pipeline'}
                  </button>
                  {pipelineProfiles.length > 0 && (
                    <select
                      value={selectedPipelineProfile}
                      onChange={(e) => setSelectedPipelineProfile(e.target.value)}
                      disabled={deepPipelineRunning}
                      className="text-xs border border-gray-300 rounded-md px-2 py-1.5 focus:ring-1 focus:ring-purple-500 focus:border-purple-500 disabled:opacity-50"
                    >
                      {pipelineProfiles.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.name.charAt(0).toUpperCase() + p.name.slice(1)}
                          {p.is_default ? ' (padrão)' : ''}
                        </option>
                      ))}
                    </select>
                  )}
                  {deepPipelineProgress && (
                    <span className="text-xs text-purple-600 max-w-[300px] truncate">{deepPipelineProgress}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {deepPipelineScore && (
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full ${
                      parseInt(deepPipelineScore) >= 75 ? 'bg-green-100 text-green-700' :
                      parseInt(deepPipelineScore) >= 50 ? 'bg-yellow-100 text-yellow-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      Score: {deepPipelineScore}/100
                    </span>
                  )}
                  {deepPipelineCompleted && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-700">
                      v2
                    </span>
                  )}
                </div>
              </div>
              {/* AI Studio links */}
              <div className="flex items-center gap-3 text-xs">
                <a
                  href={`/ai-flow?tab=pipeline&project=${projectId}`}
                  className="text-purple-600 hover:text-purple-800 hover:underline inline-flex items-center gap-1"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Configurar no AI Studio
                </a>
                <span className="text-gray-300">|</span>
                <a
                  href={`/ai-flow?tab=pipeline&project=${projectId}`}
                  className="text-purple-600 hover:text-purple-800 hover:underline inline-flex items-center gap-1"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Ver historico completo
                </a>
              </div>
            </div>
          </div>
        )}

        {/* PROMPT #273 - Grouped Tabs with Icons */}
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex items-center">
            {[
              {
                tabs: [
                  { id: 'overview', label: 'Visão Geral', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg> },
                ],
              },
              {
                tabs: [
                  { id: 'backlog', label: 'Backlog', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg> },
                  { id: 'kanban', label: 'Kanban', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" /></svg> },
                  { id: 'queue', label: 'Fila', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg> },
                ],
              },
              {
                tabs: [
                  { id: 'wiki', label: 'Wiki', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg> },
                  { id: 'chat', label: 'Chat', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg> },
                  { id: 'specs', label: 'Especificações', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg> },
                ],
              },
              {
                tabs: [
                  { id: 'commits', label: 'Commits', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg> },
                  { id: 'rag', label: 'RAG', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg> },
                  { id: 'analytics', label: 'Bloqueio', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg> },
                ],
              },
            ].map((group, groupIdx) => (
              <div key={groupIdx} className={`flex items-center ${groupIdx > 0 ? 'ml-2 pl-2 border-l border-gray-200' : ''}`}>
                {group.tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as Tab)}
                    className={`
                      flex items-center gap-1.5 pb-3 px-2.5 border-b-2 font-medium text-sm whitespace-nowrap transition-colors
                      ${
                        activeTab === tab.id
                          ? 'border-blue-500 text-blue-600'
                          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                      }
                    `}
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        {activeTab === 'backlog' && (
          <div className="space-y-6">
            {/* Backlog Header */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">
                  Visao hierárquica de Epicos, Stories, Tasks e Bugs
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowBacklogFilters(!showBacklogFilters)}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
                {showBacklogFilters ? 'Ocultar Filtros' : 'Mostrar Filtros'}
              </Button>
            </div>

            {/* Backlog Content */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              {/* Filters Sidebar */}
              {showBacklogFilters && (
                <div className="lg:col-span-1">
                  <BacklogFilters
                    filters={backlogFilters}
                    onFiltersChange={setBacklogFilters}
                    onClearFilters={() => setBacklogFilters({})}
                    availableLabels={availableLabels}
                  />
                </div>
              )}

              {/* Backlog List */}
              <div className={showBacklogFilters ? 'lg:col-span-3' : 'lg:col-span-4'}>
                <BacklogListView
                  projectId={projectId}
                  filters={backlogFilters}
                  onItemSelect={(item) => {
                    setSelectedBacklogItem(item);
                    setSelectedInterviewId(null);  // Clear interview when selecting item normally
                  }}
                  refreshKey={backlogRefreshKey}
                  selectedItemId={selectedBacklogItem?.id}
                  onFilterOptionsChange={(options) => {
                    setAvailableLabels(options.labels);
                  }}
                  onInterviewClick={(item, interviewId) => {
                    // PROMPT #131 - Open card with interview tab and specific interview
                    setSelectedBacklogItem(item);
                    setSelectedInterviewId(interviewId);
                  }}
                  selectedIds={selectedBacklogIds}
                  onSelectionChange={setSelectedBacklogIds}
                  onGenerateEpics={project?.initial_memory_context ? () => setShowEpicCountDialog(true) : undefined}
                />
              </div>
            </div>

            {/* Item Detail Panel */}
            {selectedBacklogItem && (
              <ItemDetailPanel
                item={selectedBacklogItem}
                onClose={() => {
                  setSelectedBacklogItem(null);
                  setSelectedInterviewId(null);
                }}
                onUpdate={handleTasksUpdate}
                onNavigateToItem={(item) => setSelectedBacklogItem(item)}
                initialInterviewId={selectedInterviewId}  // PROMPT #131 - Open specific interview
              />
            )}
          </div>
        )}

        {activeTab === 'kanban' && (
          <div>
            <KanbanBoard projectId={projectId} />
          </div>
        )}

        {/* Git Commits Tab (PROMPT #113) */}
        {activeTab === 'commits' && (
          <div>
            <GitCommitsList projectId={projectId} />
          </div>
        )}

        {/* Specs Tab (PROMPT #197) */}
        {activeTab === 'specs' && (
          <div>
            <ProjectSpecsList projectId={projectId} />
          </div>
        )}

        {/* Wiki Tab (PROMPT #272) */}
        {activeTab === 'wiki' && (
          <div>
            <WikiPanel projectId={projectId} />
          </div>
        )}

        {/* PROMPT #282 - RAG Chat Tab */}
        {activeTab === 'chat' && (
          <div>
            <ProjectChatPanel projectId={projectId} />
          </div>
        )}

        {/* PROMPT #215 - Prompt Queue Tab */}
        {activeTab === 'queue' && (
          <div>
            <PromptQueuePanel projectId={projectId} />
          </div>
        )}

        {/* RAG Analytics Tab (PROMPT #90) */}
        {/* PROMPT #136 - Fixed: CodeIndexingPanel always visible */}
        {/* PROMPT #232 - Extracted to RagTab sub-component */}
        {activeTab === 'rag' && (
          <RagTab
            projectId={projectId}
            loadingRag={loadingRag}
            ragStats={ragStats}
            knowledgeStats={knowledgeStats}
            codeStats={codeStats}
            loadRagStats={loadRagStats}
          />
        )}

        {/* Blocking Analytics Tab (PROMPT #97) */}
        {/* PROMPT #232 - Extracted to AnalyticsTab sub-component */}
        {activeTab === 'analytics' && (
          <AnalyticsTab
            loadingAnalytics={loadingAnalytics}
            analyticsData={analyticsData}
            analyticsDays={analyticsDays}
            setAnalyticsDays={setAnalyticsDays}
          />
        )}

        {/* PROMPT #232 - Extracted to OverviewTab sub-component */}
        {activeTab === 'overview' && (
          <OverviewTab
            project={project}
            tasks={tasks}
            tasksByStatus={tasksByStatus}
            overviewSubTab={overviewSubTab}
            setOverviewSubTab={setOverviewSubTab}
            onProjectUpdate={(updated) => setProject(updated)}
            isEditingDescription={isEditingDescription}
            editedDescription={editedDescription}
            setEditedDescription={setEditedDescription}
            isFormattingDescription={isFormattingDescription}
            isSavingDescription={isSavingDescription}
            descriptionEditorRef={descriptionEditorRef}
            textareaRef={textareaRef}
            handleDescriptionDoubleClick={handleDescriptionDoubleClick}
            handleSaveDescription={handleSaveDescription}
            handleCancelDescriptionEdit={handleCancelDescriptionEdit}
            formatBold={formatBold}
            formatItalic={formatItalic}
            formatCode={formatCode}
            formatCodeBlock={formatCodeBlock}
            formatHeading1={formatHeading1}
            formatHeading2={formatHeading2}
            formatHeading3={formatHeading3}
            formatBulletList={formatBulletList}
            formatNumberedList={formatNumberedList}
            formatLink={formatLink}
            formatQuote={formatQuote}
            formatTable={formatTable}
            generatingDescription={generatingDescription}
            onGenerateDescription={handleGenerateDescription}
            expandingDescription={expandingDescription}
            onExpandDescription={handleExpandDescription}
            summarizingDescription={summarizingDescription}
            onSummarizeDescription={handleSummarizeDescription}
            rephrasingDescription={rephrasingDescription}
            onRephraseDescription={handleRephraseDescription}
            onPersistSelection={async (text) => {
              // PROMPT #243 - Persist selected text fragment
              // Use ref for cumulative state to handle rapid successive selections
              const current = pinnedFragmentsRef.current;
              if (current.some((f: string) => f === text)) return;
              const updated = [...current, text];
              pinnedFragmentsRef.current = updated;
              // Save to backend, then reload to show highlights.
              // We intentionally do NOT call setProject() here to avoid
              // re-rendering ReactMarkdown while the user may still be interacting.
              try {
                await projectsApi.update(projectId, { pinned_fragments: updated } as any);
                loadProjectData();
              } catch (err) {
                console.error('Failed to persist fragment:', err);
                pinnedFragmentsRef.current = current;
              }
            }}
            pinnedFragments={project?.pinned_fragments || []}
            onUnpinFragment={async (fragment) => {
              // PROMPT #243 - Remove a pinned fragment
              const current = pinnedFragmentsRef.current;
              const updated = current.filter((f: string) => f !== fragment);
              pinnedFragmentsRef.current = updated;
              // Optimistic UI update
              if (project) {
                setProject({ ...project, pinned_fragments: updated });
              }
              try {
                await projectsApi.update(projectId, { pinned_fragments: updated } as any);
                loadProjectData();
              } catch (err) {
                console.error('Failed to unpin fragment:', err);
                pinnedFragmentsRef.current = current;
                if (project) setProject({ ...project, pinned_fragments: current });
              }
            }}
          />
        )}
      </div>
      {/* Epic Count Dialog */}
      <Dialog
        open={showEpicCountDialog}
        onClose={() => setShowEpicCountDialog(false)}
        title="Gerar Epicos"
        description="Escolha quantos epicos você quer gerar para este projeto."
        size="sm"
      >
        <div className="py-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Número de Epicos
          </label>
          <input
            type="number"
            min={1}
            max={30}
            value={epicCount}
            onChange={(e) => {
              const val = parseInt(e.target.value) || 1;
              setEpicCount(Math.max(1, Math.min(30, val)));
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
          />
          <p className="mt-1 text-xs text-gray-500">Min: 1, Max: 30</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowEpicCountDialog(false)}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              setShowEpicCountDialog(false);
              try {
                const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
                const res = await fetch(`${API_BASE}/api/v1/projects/${projectId}/generate-cards`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ epic_count: epicCount }),
                });
                if (res.ok) {
                  const data = await res.json();
                  if (data.job_id) {
                    showSuccess(`Geração de ${epicCount} epicos iniciada em segundo plano. Verifique a página de Jobs para acompanhar o progresso.`, 'Epicos');
                  }
                } else {
                  const err = await res.json();
                  showError(err.detail || 'Falha ao gerar epicos');
                }
              } catch (e) {
                showError('Falha ao iniciar geração de epic');
              }
            }}
          >
            Gerar
          </Button>
        </DialogFooter>
      </Dialog>

      {NotificationComponent}
    </Layout>
  );
}

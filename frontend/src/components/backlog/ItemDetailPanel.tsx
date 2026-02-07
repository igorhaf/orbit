/**
 * Item Detail Panel Component
 * Comprehensive detail view with 8 sections for backlog items
 * JIRA Transformation - PROMPT #62 - Phase 4
 * PROMPT #128 - Background Job Notifications
 */

'use client';

import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Dialog, DialogFooter } from '@/components/ui';
import { AIModelBadge } from '@/components/ui/AIModelBadge';
import { ChatInterface } from '@/components/interview';  // PROMPT #131 - Restored for modal view
import { tasksApi, interviewsApi } from '@/lib/api';
import { useNotification } from '@/hooks';
import { useNotifications } from '@/contexts/NotificationContext';
import WorkflowActions from './WorkflowActions';
import InlineCardCreator from './InlineCardCreator'; // PROMPT #187
import { IconTarget, IconBook, IconCheck, IconCircle, IconBug, IconClipboard, IconTree, IconLink, IconChat, IconChart, IconCpu, IconMicrophone, IconPencil, IconCheckCircle } from '@/components/icons';
import {
  BacklogItem,
  ItemType,
  PriorityLevel,
  TaskRelationship,
  TaskComment,
  StatusTransition,
  CommentType,
  RelationshipType,
  Interview,  // PROMPT #130
} from '@/lib/types';

interface ItemDetailPanelProps {
  item: BacklogItem;
  onClose: () => void;
  onUpdate?: () => void;
  onNavigateToItem?: (item: BacklogItem) => void;
  initialInterviewId?: string | null;  // PROMPT #131 - Open specific interview
}

export default function ItemDetailPanel({ item, onClose, onUpdate, onNavigateToItem, initialInterviewId }: ItemDetailPanelProps) {
  const { showError, showSuccess, NotificationComponent } = useNotification();
  const { addJob, activeJobs } = useNotifications(); // PROMPT #128 - Background notifications
  const [activeTab, setActiveTab] = useState<string>('overview');
  // PROMPT #131 - Selected interview for ChatInterface display
  const [selectedInterviewId, setSelectedInterviewId] = useState<string | null>(initialInterviewId || null);
  const [relationships, setRelationships] = useState<TaskRelationship[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [transitions, setTransitions] = useState<StatusTransition[]>([]);
  const [children, setChildren] = useState<BacklogItem[]>([]);
  const [parent, setParent] = useState<BacklogItem | null>(null);
  const [loading, setLoading] = useState(false);

  // New comment state
  const [newComment, setNewComment] = useState('');
  const [isAddingComment, setIsAddingComment] = useState(false);

  // AI Suggestions state (PROMPT #97)
  const [acceptingSubtasks, setAcceptingSubtasks] = useState(false);
  const [creatingInterview, setCreatingInterview] = useState(false);
  const [showSubtaskDetails, setShowSubtaskDetails] = useState<{ [key: number]: boolean }>({});

  // PROMPT #87 - Delete confirmation modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // PROMPT #96 - Approve/Reject suggested item state
  // PROMPT #173 - isApproving derived from activeJobs for persistence across navigation
  const activationTypes = ['epic_activation', 'story_activation', 'task_activation', 'subtask_activation'];
  const isApproving = activeJobs.some(
    j => activationTypes.includes(j.job_type) && j.task_id === item.id && (j.status === 'pending' || j.status === 'running')
  );
  // PROMPT #176 - isGeneratingChildren derived from activeJobs for persistence across navigation
  const isGeneratingChildren = activeJobs.some(
    j => j.job_type === 'children_generation' && j.task_id === item.id && (j.status === 'pending' || j.status === 'running')
  );
  const [isRejecting, setIsRejecting] = useState(false);

  // PROMPT #97 - Inline description editing state
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editedDescription, setEditedDescription] = useState(item.description || '');
  const [isSavingDescription, setIsSavingDescription] = useState(false);
  const descriptionEditorRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Check if item is a suggested/draft item
  const isSuggestedItem = (item.labels?.includes('suggested')) || item.workflow_state === 'draft';

  // PROMPT #127 - Generate children dialog state
  const [showGenerateChildrenDialog, setShowGenerateChildrenDialog] = useState(false);
  const [childrenCount, setChildrenCount] = useState(10);

  // PROMPT #187 - Manual child card creation
  const [isAddingChild, setIsAddingChild] = useState(false);
  const childTypeMap: Record<string, ItemType> = {
    epic: ItemType.STORY,
    story: ItemType.TASK,
    task: ItemType.SUBTASK,
  };
  const childType = childTypeMap[item.item_type];
  const childTypeLabelMap: Record<string, string> = {
    epic: 'Story',
    story: 'Task',
    task: 'Subtask',
  };
  const childTypeLabel = childTypeLabelMap[item.item_type];

  // PROMPT #131 - Card interviews state (list instead of single)
  const [cardInterviews, setCardInterviews] = useState<Interview[]>([]);
  const [loadingInterview, setLoadingInterview] = useState(false);
  const [creatingCardInterview, setCreatingCardInterview] = useState(false);

  // PROMPT #131 - Interview completion/cancellation state
  const [completingInterview, setCompletingInterview] = useState(false);
  const [cancellingInterview, setCancellingInterview] = useState(false);

  useEffect(() => {
    fetchItemDetails();
    setIsAddingChild(false); // PROMPT #187 - Reset when item changes
  }, [item.id]);

  // PROMPT #177 - Refresh item data when activation or generation job completes
  // When isApproving/isGeneratingChildren transitions from true → false, the job finished.
  // Call onUpdate() so the parent refreshes the backlog and syncs selectedBacklogItem.
  const prevIsApprovingRef = useRef(isApproving);
  const prevIsGeneratingRef = useRef(isGeneratingChildren);
  useEffect(() => {
    if (prevIsApprovingRef.current && !isApproving) {
      // Activation job completed - refresh to show generated content
      if (onUpdate) onUpdate();
    }
    if (prevIsGeneratingRef.current && !isGeneratingChildren) {
      // Children generation job completed - refresh to show new children
      if (onUpdate) onUpdate();
    }
    prevIsApprovingRef.current = isApproving;
    prevIsGeneratingRef.current = isGeneratingChildren;
  }, [isApproving, isGeneratingChildren]);

  // PROMPT #97 - Sync edited description when item changes
  useEffect(() => {
    setEditedDescription(item.description || '');
    setIsEditingDescription(false);
  }, [item.id, item.description]);

  // PROMPT #131 - Switch to interview tab when initialInterviewId is set
  useEffect(() => {
    if (initialInterviewId) {
      setSelectedInterviewId(initialInterviewId);
      setActiveTab('interview');
    }
  }, [initialInterviewId]);

  const fetchItemDetails = async () => {
    setLoading(true);
    try {
      // Fetch relationships
      const relData = await tasksApi.getRelationships(item.id);
      setRelationships(relData || []);

      // Fetch comments
      const commentsData = await tasksApi.getComments(item.id);
      setComments(commentsData || []);

      // Fetch transitions
      const transData = await tasksApi.getTransitions(item.id);
      setTransitions(transData || []);

      // Fetch children
      const childrenData = await tasksApi.getChildren(item.id);
      setChildren(childrenData || []);

      // Fetch parent if exists
      if (item.parent_id) {
        const parentData = await tasksApi.get(item.parent_id);
        setParent(parentData);
      }

      // PROMPT #130 - Fetch card interview if exists
      await fetchCardInterview();
    } catch (error) {
      console.error('Error fetching item details:', error);
    } finally {
      setLoading(false);
    }
  };

  // PROMPT #131 - Fetch ALL interviews for this card (list)
  const fetchCardInterview = async () => {
    setLoadingInterview(true);
    try {
      const interviewsRes = await interviewsApi.list();
      const interviews = interviewsRes.data || interviewsRes;
      // Find ALL interviews with parent_task_id = this item's id
      const cardInts = Array.isArray(interviews)
        ? interviews.filter((i: Interview) => i.parent_task_id === item.id)
        : [];
      setCardInterviews(cardInts);
    } catch (error) {
      console.error('Error fetching card interviews:', error);
      setCardInterviews([]);
    } finally {
      setLoadingInterview(false);
    }
  };

  // PROMPT #132 - Create new interview for this card and show in panel (not navigate)
  const handleCreateCardInterview = async () => {
    setCreatingCardInterview(true);
    try {
      const response = await interviewsApi.create({
        project_id: item.project_id,
        ai_model_used: 'claude-3-sonnet',
        conversation_data: [],
        parent_task_id: item.id,
        use_card_focused: true,
      });
      const newInterview = response.data || response;
      // Refresh interview list and select the new interview to show in panel
      await fetchCardInterview();
      setSelectedInterviewId(newInterview.id);
    } catch (error) {
      console.error('Failed to create card interview:', error);
      showError('Failed to create interview');
    } finally {
      setCreatingCardInterview(false);
    }
  };

  // PROMPT #131 - Complete interview and run card inference
  const handleCompleteInterview = async () => {
    if (!selectedInterviewId) return;
    setCompletingInterview(true);
    try {
      // Run card inference first
      const currentInterview = cardInterviews.find(i => i.id === selectedInterviewId);
      if (currentInterview?.interview_mode === 'card_inference') {
        console.log('🔄 Running card inference for task:', item.id);
        try {
          await tasksApi.runCardInference(item.id, selectedInterviewId);
          console.log('✅ Card inference completed');
        } catch (inferenceError) {
          console.error('⚠️ Card inference failed, continuing with completion:', inferenceError);
        }
      }
      // Then complete the interview
      await interviewsApi.updateStatus(selectedInterviewId, 'completed');
      await fetchCardInterview();
      onUpdate?.();
      showSuccess('Interview completed successfully');
    } catch (error) {
      console.error('Failed to complete interview:', error);
      showError('Failed to complete interview');
    } finally {
      setCompletingInterview(false);
    }
  };

  // PROMPT #131 - Cancel interview
  const handleCancelInterview = async () => {
    if (!selectedInterviewId) return;
    setCancellingInterview(true);
    try {
      await interviewsApi.updateStatus(selectedInterviewId, 'cancelled');
      await fetchCardInterview();
      setSelectedInterviewId(null);
      onUpdate?.();
      showSuccess('Interview cancelled');
    } catch (error) {
      console.error('Failed to cancel interview:', error);
      showError('Failed to cancel interview');
    } finally {
      setCancellingInterview(false);
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;

    setIsAddingComment(true);
    try {
      await tasksApi.createComment(item.id, {
        task_id: item.id,
        author: 'current_user', // TODO: Get from auth context
        content: newComment,
        comment_type: CommentType.COMMENT,
      });

      setNewComment('');
      await fetchItemDetails(); // Refresh comments
      if (onUpdate) onUpdate();
    } catch (error) {
      console.error('Error adding comment:', error);
    } finally {
      setIsAddingComment(false);
    }
  };

  // PROMPT #87 - Delete item handler
  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await tasksApi.delete(item.id);
      setShowDeleteModal(false);
      onClose();
      if (onUpdate) onUpdate();
    } catch (error) {
      console.error('Error deleting item:', error);
      showError('Failed to delete item. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  // PROMPT #96 - Approve suggested item handler
  // PROMPT #102 - Extended to show children generated feedback
  // PROMPT #128 - Registers job in notification system for background tracking
  // PROMPT #173 - isApproving now derived from activeJobs (no more setIsApproving)
  const handleApprove = async () => {
    try {
      const result = await tasksApi.activateSuggestedEpic(item.id);
      console.log('✅ Item activation started:', item.title);

      // PROMPT #128 - Register job in notification system
      if (result.job_id) {
        const jobType = item.item_type === 'epic' ? 'epic_activation' :
                        item.item_type === 'story' ? 'story_activation' :
                        item.item_type === 'task' ? 'task_activation' : 'subtask_activation';
        addJob(
          result.job_id,
          jobType,
          `Ativando ${item.item_type}: ${item.title.substring(0, 30)}...`,
          item.title,
          false,
          item.id // task_id for persistent loading state
        );
        showSuccess('Ativação iniciada! Acompanhe o progresso no sininho de notificações.');
        return;
      } else {
        // Legacy flow (synchronous response)
        const childrenCount = result.children_generated || 0;
        if (childrenCount > 0) {
          const childType = item.item_type === 'epic' ? 'stories' :
                            item.item_type === 'story' ? 'tasks' :
                            item.item_type === 'task' ? 'subtasks' : 'items';
          console.log(`📝 Generated ${childrenCount} draft ${childType}`);
          showSuccess(`Item ativado! ${childrenCount} ${childType} foram geradas como drafts.`);
        }
      }

      if (onUpdate) onUpdate();
    } catch (error: any) {
      console.error('❌ Failed to approve item:', error);
      showError(`Failed to approve item: ${error.message || 'Unknown error'}`);
    }
  };

  // PROMPT #96 - Reject suggested item handler
  const handleReject = async () => {
    setIsRejecting(true);
    try {
      await tasksApi.rejectSuggestedEpic(item.id);
      console.log('✅ Item rejected and deleted:', item.title);
      onClose();
      if (onUpdate) onUpdate();
    } catch (error: any) {
      console.error('❌ Failed to reject item:', error);
      showError(`Failed to reject item: ${error.message || 'Unknown error'}`);
    } finally {
      setIsRejecting(false);
    }
  };

  // PROMPT #127 - Generate children handler
  const handleGenerateChildren = async (count: number) => {
    setShowGenerateChildrenDialog(false);
    try {
      const result = await tasksApi.generateChildren(item.id, count);
      if (result.job_id) {
        const childType = item.item_type === 'epic' ? 'stories' :
                          item.item_type === 'story' ? 'tasks' : 'subtasks';
        addJob(
          result.job_id,
          'children_generation',
          `Gerando ${count} ${childType} para: ${item.title.substring(0, 30)}...`,
          item.title,
          false,
          item.id // PROMPT #176 - Track which task is generating children for persistent loading
        );
        showSuccess(`Geração de ${count} ${childType} iniciada! Acompanhe no sininho.`);
      }
      if (onUpdate) onUpdate();
    } catch (error: any) {
      console.error('❌ Failed to generate children:', error);
      showError(`Failed to generate children: ${error.message || 'Unknown error'}`);
    }
  };

  // PROMPT #97 - Inline description editing handlers
  const handleDescriptionDoubleClick = () => {
    setIsEditingDescription(true);
    setEditedDescription(item.description || '');
    // Focus textarea after state update
    setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    }, 0);
  };

  const handleSaveDescription = async () => {
    if (editedDescription === item.description) {
      setIsEditingDescription(false);
      return;
    }

    setIsSavingDescription(true);
    try {
      await tasksApi.update(item.id, { description: editedDescription });
      console.log('✅ Description saved:', item.title);
      setIsEditingDescription(false);
      if (onUpdate) onUpdate();
    } catch (error: any) {
      console.error('❌ Failed to save description:', error);
      showError(`Failed to save description: ${error.message || 'Unknown error'}`);
    } finally {
      setIsSavingDescription(false);
    }
  };

  const handleCancelEdit = () => {
    setEditedDescription(item.description || '');
    setIsEditingDescription(false);
  };

  // PROMPT #97 - Markdown formatting helpers
  const insertMarkdown = (before: string, after: string = '') => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = editedDescription.substring(start, end);
    const newText = editedDescription.substring(0, start) + before + selectedText + after + editedDescription.substring(end);

    setEditedDescription(newText);

    // Restore cursor position
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

  // PROMPT #97 - Click outside handler
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isEditingDescription &&
          descriptionEditorRef.current &&
          !descriptionEditorRef.current.contains(event.target as Node)) {
        handleSaveDescription();
      }
    };

    if (isEditingDescription) {
      // Add small delay to prevent immediate trigger
      setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 100);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isEditingDescription, editedDescription]);

  // PROMPT #97 - AI Suggestions handlers
  const handleAcceptSubtasks = async () => {
    if (!item.subtask_suggestions || item.subtask_suggestions.length === 0) return;

    setAcceptingSubtasks(true);
    try {
      // Create subtasks
      for (const suggestion of item.subtask_suggestions) {
        await tasksApi.create({
          project_id: item.project_id,
          parent_id: item.id,
          item_type: ItemType.SUBTASK,
          title: suggestion.title,
          description: suggestion.description,
          story_points: suggestion.story_points,
          priority: item.priority || PriorityLevel.MEDIUM,
          status: 'backlog',
          workflow_state: 'open',
          labels: item.labels || [],
        });
      }

      // Clear suggestions from task
      await tasksApi.update(item.id, { subtask_suggestions: [] });

      console.log('✅ Accepted all subtasks');
      await fetchItemDetails(); // Refresh to show new children
      if (onUpdate) onUpdate();
    } catch (error: any) {
      console.error('❌ Failed to accept subtasks:', error);
      showError(`Failed to accept subtasks: ${error.message}`);
    } finally {
      setAcceptingSubtasks(false);
    }
  };

  const handleCreateSubInterview = async () => {
    setCreatingInterview(true);
    try {
      const interview = await tasksApi.createInterview(item.id);
      console.log('✅ Created sub-interview:', interview);

      // Navigate to interview page
      window.location.href = `/projects/${item.project_id}/interviews/${interview.id}`;
    } catch (error: any) {
      console.error('❌ Failed to create sub-interview:', error);
      showError(`Failed to create sub-interview: ${error.message}`);
    } finally {
      setCreatingInterview(false);
    }
  };

  const getItemTypeIcon = (type: ItemType): React.ReactNode => {
    switch (type) {
      case ItemType.EPIC: return <IconTarget className="w-5 h-5" />;
      case ItemType.STORY: return <IconBook className="w-5 h-5" />;
      case ItemType.TASK: return <IconCheck className="w-5 h-5" />;
      case ItemType.SUBTASK: return <IconCircle className="w-5 h-5" />;
      case ItemType.BUG: return <IconBug className="w-5 h-5" />;
      default: return <IconCircle className="w-5 h-5" />;
    }
  };

  const getPriorityColor = (priority: PriorityLevel) => {
    switch (priority) {
      case PriorityLevel.CRITICAL: return 'bg-red-100 text-red-800 border-red-200';
      case PriorityLevel.HIGH: return 'bg-orange-100 text-orange-800 border-orange-200';
      case PriorityLevel.MEDIUM: return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case PriorityLevel.LOW: return 'bg-blue-100 text-blue-800 border-blue-200';
      case PriorityLevel.TRIVIAL: return 'bg-gray-100 text-gray-800 border-gray-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  // PROMPT #131 - Removed AI Suggestions tab (now handled by card interviews)
  const tabs: Array<{ id: string; label: string; icon: React.ReactNode; count?: number; hasPrompt?: boolean }> = [
    { id: 'overview', label: 'Overview', icon: <IconClipboard className="w-4 h-4" /> },
    { id: 'hierarchy', label: 'Hierarchy', icon: <IconTree className="w-4 h-4" /> },
    { id: 'relationships', label: 'Links', icon: <IconLink className="w-4 h-4" /> },
    { id: 'comments', label: 'Comments', icon: <IconChat className="w-4 h-4" />, count: comments.length },
    { id: 'transitions', label: 'History', icon: <IconChart className="w-4 h-4" />, count: transitions.length },
    { id: 'ai-config', label: 'AI Config', icon: <IconCpu className="w-4 h-4" /> },
    { id: 'interview', label: 'Interview', icon: <IconMicrophone className="w-4 h-4" />, count: cardInterviews.length },
    { id: 'prompt', label: 'Prompt', icon: <IconPencil className="w-4 h-4" />, hasPrompt: !!item.generated_prompt },
    { id: 'acceptance', label: 'Criteria', icon: <IconCheckCircle className="w-4 h-4" />, count: item.acceptance_criteria?.length || 0 },
  ];

  // PROMPT #131 - Check if we're in interview chat mode (needs flex layout)
  const isInInterviewChat = activeTab === 'interview' && selectedInterviewId;

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className={`bg-white rounded-lg shadow-2xl w-full max-w-[90%] h-[90vh] flex flex-col ${isInInterviewChat ? '' : 'overflow-y-auto'}`}>
        {/* Header - PROMPT #131 - Flex shrink to not grow */}
        <div className="flex items-start justify-between px-6 py-3 border-b flex-shrink-0">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1">
              <span className="flex items-center text-gray-600">{getItemTypeIcon(item.item_type)}</span>
              <span className="px-2 py-1 text-xs font-medium rounded bg-gray-100 text-gray-700">
                {item.item_type}
              </span>
              <span className={`px-2 py-1 text-xs font-medium rounded border ${getPriorityColor(item.priority)}`}>
                {item.priority}
              </span>
              {item.story_points && (
                <span className="px-2 py-1 text-xs font-medium rounded bg-purple-50 text-purple-700 border border-purple-200">
                  {item.story_points} pts
                </span>
              )}
              {/* PROMPT #96 - Show draft/suggested badge */}
              {isSuggestedItem && (
                <span className="px-2 py-1 text-xs font-medium rounded bg-amber-100 text-amber-800 border border-amber-200">
                  <IconPencil className="w-3 h-3 inline" /> Rascunho
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold text-gray-900">{item.title}</h2>
              <span className="text-sm text-gray-400">{item.id}</span>
            </div>

            {/* PROMPT #96 - Approve/Reject buttons for suggested items */}
            {isSuggestedItem && (
              <div className="flex gap-2 mt-3">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleApprove}
                  disabled={isApproving || isRejecting}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {isApproving ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Ativando...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Aprovar
                    </>
                  )}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleReject}
                  disabled={isApproving || isRejecting}
                >
                  {isRejecting ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Rejeitando...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      Rejeitar
                    </>
                  )}
                </Button>
              </div>
            )}
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

        {/* Tabs - PROMPT #131 - Flex shrink to not grow */}
        <div className="flex gap-1 px-6 pt-2 border-b overflow-x-auto flex-shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                px-4 py-2 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap
                ${activeTab === tab.id
                  ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-700'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }
              `}
            >
              <span className="mr-1 inline-flex items-center">{tab.icon}</span>
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="ml-2 px-1.5 py-0.5 text-xs rounded-full bg-gray-200 text-gray-700">
                  {tab.count}
                </span>
              )}
              {('hasPrompt' in tab) && tab.hasPrompt && (
                <span className="ml-2 w-2 h-2 rounded-full bg-green-500"></span>
              )}
            </button>
          ))}
        </div>

        {/* Content - PROMPT #131 - Flex-1 when in interview chat mode, reduced padding for interview */}
        <div className={`${isInInterviewChat ? 'p-4 pt-2 flex-1 flex flex-col overflow-hidden' : 'p-6'}`}>
          {loading && (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          )}

          {!loading && (
            <>
              {/* Overview Tab */}
              {activeTab === 'overview' && (
                <div className="space-y-6">
                  {/* Description - PROMPT #97: Inline editable with Markdown toolbar */}
                  <div ref={descriptionEditorRef}>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-semibold text-gray-900">Description</h3>
                      {!isEditingDescription && (
                        <span className="text-xs text-gray-400">Double-click to edit</span>
                      )}
                    </div>

                    {isEditingDescription ? (
                      <div className="border border-blue-300 rounded-lg overflow-hidden shadow-sm">
                        {/* Markdown Toolbar */}
                        <div className="flex flex-wrap items-center gap-1 p-2 bg-gray-50 border-b border-gray-200">
                          {/* Text Formatting */}
                          <div className="flex items-center gap-1 pr-2 border-r border-gray-300">
                            <button
                              type="button"
                              onClick={formatBold}
                              className="p-1.5 rounded hover:bg-gray-200 text-gray-700 font-bold text-sm"
                              title="Bold (Ctrl+B)"
                            >
                              B
                            </button>
                            <button
                              type="button"
                              onClick={formatItalic}
                              className="p-1.5 rounded hover:bg-gray-200 text-gray-700 italic text-sm"
                              title="Italic (Ctrl+I)"
                            >
                              I
                            </button>
                            <button
                              type="button"
                              onClick={formatCode}
                              className="p-1.5 rounded hover:bg-gray-200 text-gray-700 font-mono text-sm"
                              title="Inline Code"
                            >
                              {'</>'}
                            </button>
                          </div>

                          {/* Headings */}
                          <div className="flex items-center gap-1 pr-2 border-r border-gray-300">
                            <button
                              type="button"
                              onClick={formatHeading1}
                              className="p-1.5 rounded hover:bg-gray-200 text-gray-700 text-sm font-bold"
                              title="Heading 1"
                            >
                              H1
                            </button>
                            <button
                              type="button"
                              onClick={formatHeading2}
                              className="p-1.5 rounded hover:bg-gray-200 text-gray-700 text-sm font-bold"
                              title="Heading 2"
                            >
                              H2
                            </button>
                            <button
                              type="button"
                              onClick={formatHeading3}
                              className="p-1.5 rounded hover:bg-gray-200 text-gray-700 text-sm font-bold"
                              title="Heading 3"
                            >
                              H3
                            </button>
                          </div>

                          {/* Lists */}
                          <div className="flex items-center gap-1 pr-2 border-r border-gray-300">
                            <button
                              type="button"
                              onClick={formatBulletList}
                              className="p-1.5 rounded hover:bg-gray-200 text-gray-700 text-sm"
                              title="Bullet List"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={formatNumberedList}
                              className="p-1.5 rounded hover:bg-gray-200 text-gray-700 text-sm"
                              title="Numbered List"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h10M7 16h10M3 8h.01M3 12h.01M3 16h.01" />
                              </svg>
                            </button>
                          </div>

                          {/* Blocks */}
                          <div className="flex items-center gap-1 pr-2 border-r border-gray-300">
                            <button
                              type="button"
                              onClick={formatQuote}
                              className="p-1.5 rounded hover:bg-gray-200 text-gray-700 text-sm"
                              title="Quote"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={formatCodeBlock}
                              className="p-1.5 rounded hover:bg-gray-200 text-gray-700 text-sm font-mono"
                              title="Code Block"
                            >
                              {'```'}
                            </button>
                            <button
                              type="button"
                              onClick={formatTable}
                              className="p-1.5 rounded hover:bg-gray-200 text-gray-700 text-sm"
                              title="Table"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M9 10v8m6-8v8M3 6h18v12H3V6z" />
                              </svg>
                            </button>
                          </div>

                          {/* Link */}
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={formatLink}
                              className="p-1.5 rounded hover:bg-gray-200 text-gray-700 text-sm"
                              title="Link"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        {/* Textarea */}
                        <textarea
                          ref={textareaRef}
                          value={editedDescription}
                          onChange={(e) => setEditedDescription(e.target.value)}
                          className="w-full p-4 min-h-[300px] text-sm text-gray-900 font-mono focus:outline-none resize-y"
                          placeholder="Enter description using Markdown..."
                          onKeyDown={(e) => {
                            // Ctrl+B for bold
                            if (e.ctrlKey && e.key === 'b') {
                              e.preventDefault();
                              formatBold();
                            }
                            // Ctrl+I for italic
                            if (e.ctrlKey && e.key === 'i') {
                              e.preventDefault();
                              formatItalic();
                            }
                            // Escape to cancel
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              handleCancelEdit();
                            }
                            // Ctrl+Enter to save
                            if (e.ctrlKey && e.key === 'Enter') {
                              e.preventDefault();
                              handleSaveDescription();
                            }
                          }}
                        />

                        {/* Action Buttons */}
                        <div className="flex items-center justify-between p-3 bg-gray-50 border-t border-gray-200">
                          <span className="text-xs text-gray-500">
                            Press <kbd className="px-1 py-0.5 bg-gray-200 rounded text-xs">Ctrl+Enter</kbd> to save, <kbd className="px-1 py-0.5 bg-gray-200 rounded text-xs">Esc</kbd> to cancel
                          </span>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={handleCancelEdit}
                              disabled={isSavingDescription}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={handleSaveDescription}
                              disabled={isSavingDescription}
                            >
                              {isSavingDescription ? (
                                <>
                                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-2"></div>
                                  Saving...
                                </>
                              ) : (
                                'Save'
                              )}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div
                        onDoubleClick={handleDescriptionDoubleClick}
                        className="cursor-pointer hover:bg-gray-50 rounded-lg p-3 -m-3 transition-colors group"
                        title="Double-click to edit"
                      >
                        {item.description ? (
                          <div className="prose prose-sm max-w-none text-gray-700 group-hover:bg-gray-50">
                            <ReactMarkdown>
                              {item.description}
                            </ReactMarkdown>
                          </div>
                        ) : (
                          <p className="text-sm text-gray-400 italic py-4 text-center border-2 border-dashed border-gray-200 rounded-lg">
                            Click twice to add a description...
                          </p>
                        )}
                        {/* PROMPT #127 - Show AI model icon if content was generated by AI */}
                        {item.created_by_ai_model && (
                          <div className="mt-2 flex justify-end">
                            <AIModelBadge model={item.created_by_ai_model} usage_type="prompt_generation" />
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Metadata Grid */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-xs font-semibold text-gray-500 uppercase">Status</span>
                      <p className="text-sm text-gray-900 mt-1">{item.workflow_state}</p>
                    </div>
                    <div>
                      <span className="text-xs font-semibold text-gray-500 uppercase">Priority</span>
                      <p className="text-sm text-gray-900 mt-1">{item.priority}</p>
                    </div>
                    {item.assignee && (
                      <div>
                        <span className="text-xs font-semibold text-gray-500 uppercase">Assignee</span>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center">
                            {item.assignee.charAt(0).toUpperCase()}
                          </div>
                          <p className="text-sm text-gray-900">{item.assignee}</p>
                        </div>
                      </div>
                    )}
                    {item.reporter && (
                      <div>
                        <span className="text-xs font-semibold text-gray-500 uppercase">Reporter</span>
                        <p className="text-sm text-gray-900 mt-1">{item.reporter}</p>
                      </div>
                    )}
                    <div>
                      <span className="text-xs font-semibold text-gray-500 uppercase">Created</span>
                      <p className="text-sm text-gray-900 mt-1">
                        {new Date(item.created_at).toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs font-semibold text-gray-500 uppercase">Updated</span>
                      <p className="text-sm text-gray-900 mt-1">
                        {new Date(item.updated_at).toLocaleString()}
                      </p>
                    </div>
                  </div>

                  {/* Labels */}
                  {item.labels && item.labels.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 mb-2">Labels</h3>
                      <div className="flex flex-wrap gap-2">
                        {item.labels.map((label, idx) => (
                          <span key={idx} className="px-2 py-1 text-xs rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                            {label}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Components */}
                  {item.components && item.components.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 mb-2">Components</h3>
                      <div className="flex flex-wrap gap-2">
                        {item.components.map((component, idx) => (
                          <span key={idx} className="px-2 py-1 text-xs rounded bg-gray-100 text-gray-700">
                            {component}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Hierarchy Tab */}
              {activeTab === 'hierarchy' && (
                <div className="space-y-6">
                  {/* Parent */}
                  {parent && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 mb-3">Parent</h3>
                      <div
                        className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors"
                        onClick={() => onNavigateToItem?.(parent)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="flex items-center text-gray-600">{getItemTypeIcon(parent.item_type)}</span>
                          <span className="text-sm font-medium text-gray-900">{parent.title}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Children */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-gray-900">
                        Children ({children.length})
                      </h3>
                      {/* PROMPT #187 - Add child + Generate children buttons */}
                      {!isSuggestedItem && item.item_type !== 'subtask' && (
                        <div className="flex items-center gap-2">
                          {/* PROMPT #187 - Manual add child button */}
                          {childType && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isAddingChild}
                              onClick={() => setIsAddingChild(true)}
                            >
                              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                              </svg>
                              Add {childTypeLabel}
                            </Button>
                          )}
                          {/* PROMPT #127 - Generate children button */}
                          {/* PROMPT #176 - Persistent loading state during generation */}
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={isGeneratingChildren}
                            onClick={() => {
                              const defaults: Record<string, number> = { epic: 10, story: 8, task: 5 };
                              setChildrenCount(defaults[item.item_type] || 10);
                              setShowGenerateChildrenDialog(true);
                            }}
                          >
                            {isGeneratingChildren ? (
                              <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-1"></div>
                                Gerando...
                              </>
                            ) : (
                              <>
                                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                {item.item_type === 'epic' ? 'Gerar Stories' :
                                 item.item_type === 'story' ? 'Gerar Tasks' :
                                 item.item_type === 'task' ? 'Gerar Subtasks' : 'Gerar'}
                              </>
                            )}
                          </Button>
                        </div>
                      )}
                    </div>
                    {children.length === 0 && !isAddingChild ? (
                      <p className="text-sm text-gray-500 italic">No child items</p>
                    ) : (
                      <div className="space-y-2">
                        {children.map((child) => (
                          <div
                            key={child.id}
                            className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors"
                            onClick={() => onNavigateToItem?.(child)}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="flex items-center text-gray-600">{getItemTypeIcon(child.item_type)}</span>
                                <span className="text-sm font-medium text-gray-900">{child.title}</span>
                              </div>
                              <span className={`px-2 py-0.5 text-xs font-medium rounded border ${getPriorityColor(child.priority)}`}>
                                {child.priority}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* PROMPT #187 - Inline child card creator */}
                    {isAddingChild && childType && (
                      <div className="mt-2">
                        <InlineCardCreator
                          itemType={childType}
                          projectId={item.project_id}
                          parentId={item.id}
                          onCreated={() => {
                            setIsAddingChild(false);
                            fetchItemDetails();
                            if (onUpdate) onUpdate();
                          }}
                          onCancel={() => setIsAddingChild(false)}
                          variant="hierarchy-card"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Relationships Tab */}
              {activeTab === 'relationships' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-900">
                      Relationships ({relationships.length})
                    </h3>
                    <Button size="sm" variant="outline">
                      <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Add Link
                    </Button>
                  </div>

                  {relationships.length === 0 ? (
                    <p className="text-sm text-gray-500 italic">No relationships defined</p>
                  ) : (
                    <div className="space-y-2">
                      {relationships.map((rel) => (
                        <div key={rel.id} className="border border-gray-200 rounded-lg p-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-xs font-semibold text-gray-500 uppercase">
                                {rel.relationship_type.replace('_', ' ')}
                              </span>
                              <p className="text-sm text-gray-900 mt-1">
                                Task ID: {rel.target_task_id}
                              </p>
                            </div>
                            <button className="text-red-600 hover:text-red-700 text-sm">Remove</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Comments Tab */}
              {activeTab === 'comments' && (
                <div className="space-y-4">
                  {/* Add Comment */}
                  <div className="border border-gray-200 rounded-lg p-4">
                    <textarea
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      placeholder="Add a comment..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                      rows={3}
                    />
                    <div className="flex justify-end gap-2 mt-2">
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={handleAddComment}
                        isLoading={isAddingComment}
                        disabled={!newComment.trim()}
                      >
                        Add Comment
                      </Button>
                    </div>
                  </div>

                  {/* Comments List */}
                  <div className="space-y-3">
                    {comments.length === 0 ? (
                      <p className="text-sm text-gray-500 italic text-center py-8">
                        No comments yet. Be the first to comment!
                      </p>
                    ) : (
                      comments.map((comment) => (
                        <div key={comment.id} className="border border-gray-200 rounded-lg p-4">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center">
                                {comment.author.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <p className="text-sm font-semibold text-gray-900">{comment.author}</p>
                                <p className="text-xs text-gray-500">
                                  {new Date(comment.created_at).toLocaleString()}
                                </p>
                              </div>
                            </div>
                            {comment.comment_type === CommentType.AI_INSIGHT && (
                              <span className="px-2 py-0.5 text-xs rounded bg-purple-100 text-purple-700">
                                AI Insight
                              </span>
                            )}
                            {comment.comment_type === CommentType.SYSTEM && (
                              <span className="px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-700">
                                System
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-700 whitespace-pre-wrap">{comment.content}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Transitions Tab */}
              {activeTab === 'transitions' && (
                <div className="space-y-6">
                  {/* Workflow Actions */}
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">
                      Transition Status
                    </h3>
                    <WorkflowActions
                      item={item}
                      onTransition={() => {
                        fetchItemDetails();
                        if (onUpdate) onUpdate();
                      }}
                    />
                  </div>

                  {/* Status History */}
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">
                      Status History ({transitions.length})
                    </h3>

                    {transitions.length === 0 ? (
                      <p className="text-sm text-gray-500 italic">No status transitions yet</p>
                    ) : (
                      <div className="space-y-2">
                        {transitions.map((transition, idx) => (
                          <div key={transition.id} className="border-l-4 border-blue-500 bg-blue-50 p-4 rounded">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-gray-700">
                                  {transition.from_status}
                                </span>
                                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                                </svg>
                                <span className="text-sm font-medium text-blue-700">
                                  {transition.to_status}
                                </span>
                              </div>
                              <span className="text-xs text-gray-500">
                                {new Date(transition.created_at).toLocaleString()}
                              </span>
                            </div>
                            {transition.transitioned_by && (
                              <p className="text-xs text-gray-600">by {transition.transitioned_by}</p>
                            )}
                            {transition.transition_reason && (
                              <p className="text-sm text-gray-700 mt-2">{transition.transition_reason}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* AI Config Tab */}
              {activeTab === 'ai-config' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">AI Orchestration Settings</h3>
                    <div className="space-y-4">
                      <div>
                        <span className="text-xs font-semibold text-gray-500 uppercase">Target AI Model</span>
                        <p className="text-sm text-gray-900 mt-1">
                          {item.target_ai_model_id || 'Not set (will auto-select)'}
                        </p>
                      </div>
                      <div>
                        <span className="text-xs font-semibold text-gray-500 uppercase">Token Budget</span>
                        <p className="text-sm text-gray-900 mt-1">
                          {item.token_budget ? `${item.token_budget.toLocaleString()} tokens` : 'Not set'}
                        </p>
                      </div>
                      {item.actual_tokens_used && (
                        <div>
                          <span className="text-xs font-semibold text-gray-500 uppercase">Tokens Used</span>
                          <p className="text-sm text-gray-900 mt-1">
                            {item.actual_tokens_used.toLocaleString()} tokens
                            {item.token_budget && (
                              <span className="text-xs text-gray-500 ml-2">
                                ({Math.round((item.actual_tokens_used / item.token_budget) * 100)}% of budget)
                              </span>
                            )}
                          </p>
                        </div>
                      )}
                      <div>
                        <span className="text-xs font-semibold text-gray-500 uppercase">Prompt Template</span>
                        <p className="text-sm text-gray-900 mt-1">
                          {item.prompt_template_id || 'Default template'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Generation Context */}
                  {item.generation_context && Object.keys(item.generation_context).length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 mb-2">Generation Context</h3>
                      <pre className="text-xs bg-gray-50 p-3 rounded border border-gray-200 overflow-x-auto">
                        {JSON.stringify(item.generation_context, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {/* Interview Tab - PROMPT #131 - List view or ChatInterface */}
              {activeTab === 'interview' && (
                <div className={selectedInterviewId ? 'flex flex-col flex-1 min-h-0' : 'space-y-4'}>
                  {/* PROMPT #131 - Show ChatInterface when interview is selected */}
                  {selectedInterviewId ? (
                    <div className="flex flex-col flex-1 min-h-0 gap-2">
                      {/* Header with title, back link, and action buttons */}
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <IconChat className="w-5 h-5 text-blue-600" />
                        <h3 className="text-sm font-semibold text-gray-900">
                          {cardInterviews.find(i => i.id === selectedInterviewId)?.interview_mode === 'card_inference' ? 'Card Interview' : 'Interview'}
                        </h3>
                        <span className={`px-2 py-0.5 text-xs rounded-full ${
                          cardInterviews.find(i => i.id === selectedInterviewId)?.status === 'completed'
                            ? 'bg-green-100 text-green-700'
                            : cardInterviews.find(i => i.id === selectedInterviewId)?.status === 'cancelled'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}>
                          {cardInterviews.find(i => i.id === selectedInterviewId)?.status?.toUpperCase()}
                        </span>

                        {/* Spacer */}
                        <div className="flex-1" />

                        {/* Action buttons for active interviews */}
                        {cardInterviews.find(i => i.id === selectedInterviewId)?.status === 'active' && (
                          <div className="flex items-center gap-2">
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={handleCompleteInterview}
                              disabled={completingInterview || cancellingInterview}
                            >
                              {completingInterview ? (
                                <>
                                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-1"></div>
                                  Completing...
                                </>
                              ) : (
                                <>
                                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                  Complete
                                </>
                              )}
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={handleCancelInterview}
                              disabled={completingInterview || cancellingInterview}
                            >
                              {cancellingInterview ? 'Cancelling...' : 'Cancel'}
                            </Button>
                          </div>
                        )}

                        {/* Back to list link */}
                        <button
                          onClick={() => setSelectedInterviewId(null)}
                          className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                          </svg>
                          Back to list
                        </button>
                      </div>

                      {/* ChatInterface - fills remaining space, with header hidden */}
                      <div className="border border-gray-200 rounded-lg overflow-hidden flex-1 min-h-0">
                        <ChatInterface
                          interviewId={selectedInterviewId}
                          interviewMode="card_inference"
                          onStatusChange={() => {
                            fetchCardInterview();
                            onUpdate?.();
                          }}
                          embedded={true}
                          parentTaskId={item.id}
                          hideHeader={true}
                        />
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Header with count and add button */}
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-gray-900">
                          Interviews ({cardInterviews.length})
                        </h3>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleCreateCardInterview}
                          disabled={creatingCardInterview}
                        >
                          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          {creatingCardInterview ? 'Creating...' : 'New Interview'}
                        </Button>
                      </div>

                      {/* Interview List - Similar to Criteria */}
                      {loadingInterview ? (
                        <div className="flex items-center justify-center py-8">
                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                        </div>
                      ) : cardInterviews.length === 0 ? (
                        /* PROMPT #131 - Empty state with AI Suggestions call-to-action */
                        <div className="text-center py-8 border border-dashed border-gray-300 rounded-lg bg-gray-50">
                          <span className="mb-3 block"><IconCpu className="w-10 h-10 mx-auto text-gray-400" /></span>
                          <p className="text-sm text-gray-700 font-medium mb-2">AI Suggestions</p>
                          <p className="text-xs text-gray-500 mb-4 max-w-sm mx-auto">
                            Start a card interview to get AI-powered suggestions for improving this card,
                            decomposing it into subtasks, or refining acceptance criteria.
                          </p>
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={handleCreateCardInterview}
                            disabled={creatingCardInterview}
                          >
                            {creatingCardInterview ? (
                              <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                Creating...
                              </>
                            ) : (
                              <>
                                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                </svg>
                                Start AI Interview
                              </>
                            )}
                          </Button>
                        </div>
                      ) : (
                        <ul className="space-y-2">
                          {cardInterviews.map((interview) => (
                            <li
                              key={interview.id}
                              onClick={() => setSelectedInterviewId(interview.id)}
                              className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:bg-blue-50 hover:border-blue-300 cursor-pointer transition-colors"
                            >
                              {/* Interview icon */}
                              <IconChat className="w-5 h-5 text-blue-600" />

                              {/* Interview info */}
                              <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium text-blue-700">
                                  {interview.interview_mode === 'context' ? 'Context Interview' :
                                   interview.interview_mode === 'meta_prompt' ? 'Epic Interview' :
                                   interview.interview_mode === 'card_inference' ? 'Card Interview' :
                                   interview.interview_mode === 'task_focused' ? 'Task Interview' :
                                   'Interview'}
                                </span>
                                <span className="text-xs text-gray-500 ml-2">
                                  {interview.conversation_data?.length || 0} messages
                                </span>
                              </div>

                              {/* Status badge */}
                              <span className={`px-2 py-0.5 text-xs rounded-full ${
                                interview.status === 'completed'
                                  ? 'bg-green-100 text-green-700 border border-green-200'
                                  : interview.status === 'active'
                                  ? 'bg-blue-100 text-blue-700 border border-blue-200'
                                  : 'bg-gray-100 text-gray-700 border border-gray-200'
                              }`}>
                                {interview.status}
                              </span>

                              {/* Arrow icon */}
                              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            </li>
                          ))}
                        </ul>
                      )}

                      {/* Interview Traceability (from original interview that created this card) */}
                      {(item.interview_question_ids?.length > 0 || (item.interview_insights && Object.keys(item.interview_insights).length > 0)) && (
                        <div className="pt-4 border-t border-gray-200">
                          <h3 className="text-sm font-semibold text-gray-900 mb-3">Interview Traceability</h3>

                          {/* Question IDs */}
                          {item.interview_question_ids && item.interview_question_ids.length > 0 && (
                            <div className="mb-4">
                              <span className="text-xs font-semibold text-gray-500 uppercase">Referenced Questions</span>
                              <div className="flex flex-wrap gap-2 mt-2">
                                {item.interview_question_ids.map((qid) => (
                                  <span key={qid} className="px-2 py-1 text-xs rounded bg-green-100 text-green-700 border border-green-200">
                                    Q{qid}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Interview Insights */}
                          {item.interview_insights && Object.keys(item.interview_insights).length > 0 && (
                            <div>
                              <span className="text-xs font-semibold text-gray-500 uppercase">Insights</span>
                              <pre className="text-xs bg-gray-50 p-3 rounded border border-gray-200 overflow-x-auto mt-2">
                                {JSON.stringify(item.interview_insights, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Prompt Tab */}
              {activeTab === 'prompt' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">Generated Prompt</h3>

                    {item.generated_prompt ? (
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs font-semibold text-gray-500 uppercase">Atomic Prompt</span>
                          <div className="flex items-center gap-2">
                            {/* PROMPT #127 - Show AI model icon if prompt was generated by AI */}
                            {item.created_by_ai_model && (
                              <AIModelBadge model={item.created_by_ai_model} usage_type="prompt_generation" />
                            )}
                            <button
                              onClick={() => navigator.clipboard.writeText(item.generated_prompt || '')}
                              className="px-2 py-1 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors"
                            >
                              <span className="inline-flex items-center gap-1"><IconClipboard className="w-3 h-3" /> Copy</span>
                            </button>
                          </div>
                        </div>
                        <pre className="text-sm text-gray-900 whitespace-pre-wrap font-mono leading-relaxed">
                          {item.generated_prompt}
                        </pre>
                      </div>
                    ) : (
                      <div className="text-center py-12 border border-dashed border-gray-300 rounded-lg bg-gray-50">
                        <span className="mb-3 block"><IconPencil className="w-10 h-10 mx-auto text-gray-400" /></span>
                        <p className="text-sm text-gray-500 mb-2">No prompt generated yet</p>
                        <p className="text-xs text-gray-400">
                          Prompt will be generated from meta prompt interview or can be created manually
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Prompt Metadata */}
                  {item.generated_prompt && (
                    <div className="border-t border-gray-200 pt-6">
                      <h3 className="text-sm font-semibold text-gray-900 mb-3">Prompt Details</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <span className="text-xs font-semibold text-gray-500 uppercase">Token Budget</span>
                          <p className="text-sm text-gray-900 mt-1">
                            {item.token_budget ? `${item.token_budget.toLocaleString()} tokens` : 'Not set'}
                          </p>
                        </div>
                        {item.actual_tokens_used && (
                          <div>
                            <span className="text-xs font-semibold text-gray-500 uppercase">Tokens Used</span>
                            <p className="text-sm text-gray-900 mt-1">
                              {item.actual_tokens_used.toLocaleString()} tokens
                              {item.token_budget && (
                                <span className="text-xs text-gray-500 ml-2">
                                  ({Math.round((item.actual_tokens_used / item.token_budget) * 100)}%)
                                </span>
                              )}
                            </p>
                          </div>
                        )}
                        <div>
                          <span className="text-xs font-semibold text-gray-500 uppercase">Item Type</span>
                          <p className="text-sm text-gray-900 mt-1">{item.item_type}</p>
                        </div>
                        <div>
                          <span className="text-xs font-semibold text-gray-500 uppercase">Target AI Model</span>
                          <p className="text-sm text-gray-900 mt-1">
                            {item.target_ai_model_id || 'Auto-select'}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Acceptance Criteria Tab */}
              {activeTab === 'acceptance' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-900">
                      Acceptance Criteria ({item.acceptance_criteria?.length || 0})
                    </h3>
                    <Button size="sm" variant="outline">
                      <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Add Criterion
                    </Button>
                  </div>

                  {!item.acceptance_criteria || item.acceptance_criteria.length === 0 ? (
                    <p className="text-sm text-gray-500 italic">No acceptance criteria defined</p>
                  ) : (
                    <ul className="space-y-2">
                      {item.acceptance_criteria.map((criterion, idx) => (
                        <li key={idx} className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
                          <input
                            type="checkbox"
                            className="mt-1 w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                          />
                          <span className="flex-1 text-sm text-gray-900">{criterion}</span>
                          <button className="text-gray-400 hover:text-red-600">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* PROMPT #131 - Removed AI Suggestions Tab - now handled by card interviews */}
            </>
          )}
        </div>

      </div>

      {/* PROMPT #87 - Delete Confirmation Modal */}
      <Dialog
        open={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Delete Item"
        size="sm"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">
                Delete "{item.title}"?
              </p>
              <p className="text-xs text-gray-500 mt-1">
                This will permanently delete this {item.item_type} and all related interviews. This action cannot be undone.
              </p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => setShowDeleteModal(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handleDelete}
            disabled={isDeleting}
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* PROMPT #127 - Generate Children Count Dialog */}
      <Dialog
        open={showGenerateChildrenDialog}
        onClose={() => setShowGenerateChildrenDialog(false)}
        title={
          item.item_type === 'epic' ? 'Gerar Stories' :
          item.item_type === 'story' ? 'Gerar Tasks' :
          item.item_type === 'task' ? 'Gerar Subtasks' : 'Gerar'
        }
        description={`Defina quantos itens deseja gerar para "${item.title}".`}
        size="sm"
      >
        <div className="py-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Quantidade
          </label>
          <input
            type="number"
            min={1}
            max={30}
            value={childrenCount}
            onChange={(e) => {
              const val = parseInt(e.target.value) || 1;
              setChildrenCount(Math.max(1, Math.min(30, val)));
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
          />
          <p className="mt-1 text-xs text-gray-500">Min: 1, Max: 30</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowGenerateChildrenDialog(false)}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={() => handleGenerateChildren(childrenCount)}
          >
            Gerar
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

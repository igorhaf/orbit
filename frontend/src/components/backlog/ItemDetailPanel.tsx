/**
 * Item Detail Panel Component
 * Comprehensive detail view with 8 sections for backlog items
 * JIRA Transformation - PROMPT #62 - Phase 4
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Dialog, DialogFooter } from '@/components/ui';
import { tasksApi } from '@/lib/api';
import WorkflowActions from './WorkflowActions';
import {
  BacklogItem,
  ItemType,
  PriorityLevel,
  TaskRelationship,
  TaskComment,
  StatusTransition,
  CommentType,
  RelationshipType,
} from '@/lib/types';

interface ItemDetailPanelProps {
  item: BacklogItem;
  onClose: () => void;
  onUpdate?: () => void;
  onNavigateToItem?: (item: BacklogItem) => void;
}

export default function ItemDetailPanel({ item, onClose, onUpdate, onNavigateToItem }: ItemDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<string>('overview');
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

  useEffect(() => {
    fetchItemDetails();
  }, [item.id]);

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
    } catch (error) {
      console.error('Error fetching item details:', error);
    } finally {
      setLoading(false);
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
      alert('Failed to delete item. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

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
      alert(`Failed to accept subtasks: ${error.message}`);
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
      alert(`Failed to create sub-interview: ${error.message}`);
    } finally {
      setCreatingInterview(false);
    }
  };

  const getItemTypeIcon = (type: ItemType) => {
    switch (type) {
      case ItemType.EPIC: return '🎯';
      case ItemType.STORY: return '📖';
      case ItemType.TASK: return '✓';
      case ItemType.SUBTASK: return '◦';
      case ItemType.BUG: return '🐛';
      default: return '•';
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

  const tabs = [
    { id: 'overview', label: 'Overview', icon: '📋' },
    { id: 'hierarchy', label: 'Hierarchy', icon: '🌳' },
    { id: 'relationships', label: 'Links', icon: '🔗' },
    { id: 'comments', label: 'Comments', icon: '💬', count: comments.length },
    { id: 'transitions', label: 'History', icon: '📊', count: transitions.length },
    { id: 'ai-config', label: 'AI Config', icon: '🤖' },
    { id: 'ai-suggestions', label: 'AI Suggestions', icon: '🤖', count: item.subtask_suggestions?.length || 0 },
    { id: 'interview', label: 'Interview', icon: '🎤' },
    { id: 'prompt', label: 'Prompt', icon: '📝', hasPrompt: !!item.generated_prompt },
    { id: 'acceptance', label: 'Criteria', icon: '✅', count: item.acceptance_criteria?.length || 0 },
  ];

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-[90%] h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">{getItemTypeIcon(item.item_type)}</span>
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
            </div>
            <h2 className="text-2xl font-bold text-gray-900">{item.title}</h2>
            <p className="text-sm text-gray-500 mt-1">ID: {item.id}</p>
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

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-4 border-b overflow-x-auto">
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
              <span className="mr-1">{tab.icon}</span>
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

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
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
                  {/* Description */}
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 mb-2">Description</h3>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">
                      {item.description || 'No description provided.'}
                    </p>
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
                          <span className="text-lg">{getItemTypeIcon(parent.item_type)}</span>
                          <span className="text-sm font-medium text-gray-900">{parent.title}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Children */}
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">
                      Children ({children.length})
                    </h3>
                    {children.length === 0 ? (
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
                                <span className="text-lg">{getItemTypeIcon(child.item_type)}</span>
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

              {/* Interview Tab */}
              {activeTab === 'interview' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">Interview Traceability</h3>

                    {/* Question IDs */}
                    {item.interview_question_ids && item.interview_question_ids.length > 0 ? (
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
                    ) : (
                      <p className="text-sm text-gray-500 italic mb-4">Not linked to any interview questions</p>
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
                          <button
                            onClick={() => navigator.clipboard.writeText(item.generated_prompt || '')}
                            className="px-2 py-1 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors"
                          >
                            📋 Copy
                          </button>
                        </div>
                        <pre className="text-sm text-gray-900 whitespace-pre-wrap font-mono leading-relaxed">
                          {item.generated_prompt}
                        </pre>
                      </div>
                    ) : (
                      <div className="text-center py-12 border border-dashed border-gray-300 rounded-lg bg-gray-50">
                        <span className="text-4xl mb-3 block">📝</span>
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

              {/* AI Suggestions Tab - PROMPT #97 */}
              {activeTab === 'ai-suggestions' && (
                <div className="space-y-6">
                  {!item.subtask_suggestions || item.subtask_suggestions.length === 0 ? (
                    <div className="text-center py-12 border border-dashed border-gray-300 rounded-lg bg-gray-50">
                      <span className="text-4xl mb-3 block">🤖</span>
                      <p className="text-sm text-gray-500 mb-2">No AI suggestions yet</p>
                      <p className="text-xs text-gray-400 mb-4">
                        AI can suggest subtasks to help decompose this item into smaller, actionable pieces.
                      </p>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={handleCreateSubInterview}
                        isLoading={creatingInterview}
                      >
                        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                        Generate Suggestions via Interview
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-gray-900">
                          🤖 AI-Suggested Subtasks ({item.subtask_suggestions.length})
                        </h3>
                      </div>

                      {/* Subtasks List */}
                      <div className="space-y-3">
                        {item.subtask_suggestions.map((suggestion, idx) => (
                          <div
                            key={idx}
                            className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg p-4 border border-purple-200 hover:shadow-md transition-shadow"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="text-sm font-semibold text-purple-700">
                                    {idx + 1}.
                                  </span>
                                  <h4 className="text-sm font-semibold text-gray-900 flex-1">
                                    {suggestion.title}
                                  </h4>
                                  {suggestion.story_points && (
                                    <span className="px-2 py-0.5 text-xs font-medium rounded bg-purple-100 text-purple-700 border border-purple-200">
                                      {suggestion.story_points} pts
                                    </span>
                                  )}
                                </div>
                                {suggestion.description && (
                                  <button
                                    onClick={() => setShowSubtaskDetails(prev => ({ ...prev, [idx]: !prev[idx] }))}
                                    className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 mb-2"
                                  >
                                    {showSubtaskDetails[idx] ? (
                                      <>
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                        Hide details
                                      </>
                                    ) : (
                                      <>
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                        </svg>
                                        Show details
                                      </>
                                    )}
                                  </button>
                                )}
                                {showSubtaskDetails[idx] && suggestion.description && (
                                  <p className="text-xs text-gray-700 pl-4 border-l-2 border-purple-300 bg-white bg-opacity-50 p-2 rounded">
                                    {suggestion.description}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Action Buttons */}
                      <div className="flex gap-3 pt-4 border-t border-gray-200">
                        <Button
                          variant="primary"
                          onClick={handleAcceptSubtasks}
                          isLoading={acceptingSubtasks}
                          className="flex-1 bg-green-600 hover:bg-green-700"
                        >
                          {acceptingSubtasks ? (
                            <>
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                              Accepting...
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              Accept All Subtasks
                            </>
                          )}
                        </Button>

                        <Button
                          variant="outline"
                          onClick={handleCreateSubInterview}
                          isLoading={creatingInterview}
                          className="flex-1"
                        >
                          {creatingInterview ? (
                            <>
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
                              Creating...
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                              </svg>
                              Refine via Interview
                            </>
                          )}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t bg-gray-50">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <div className="flex gap-2">
            <Button variant="outline">
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit
            </Button>
            <Button variant="danger" onClick={() => setShowDeleteModal(true)}>
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete
            </Button>
          </div>
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
    </div>
  );
}

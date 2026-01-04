/**
 * Item Detail Panel Component
 * Comprehensive detail view with 8 sections for backlog items
 * JIRA Transformation - PROMPT #62 - Phase 4
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Button, Input } from '@/components/ui';
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
}

export default function ItemDetailPanel({ item, onClose, onUpdate }: ItemDetailPanelProps) {
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
    { id: 'interview', label: 'Interview', icon: '🎤' },
    { id: 'acceptance', label: 'Criteria', icon: '✅', count: item.acceptance_criteria?.length || 0 },
  ];

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col">
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
                      <div className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer">
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
                          <div key={child.id} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer">
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
            <Button variant="danger">
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

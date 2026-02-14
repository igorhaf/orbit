/**
 * ProjectChatPanel - RAG-based project knowledge chat
 * PROMPT #282 - Replaces Interview tab with a ChatGPT-like interface
 *
 * Users ask questions about their project, AI answers using RAG knowledge base.
 * Uses async job system for non-blocking AI calls.
 */

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { projectChatsApi, jobsApi } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import ReactMarkdown from 'react-markdown';

interface ChatSession {
  id: string;
  project_id: string;
  title: string;
  messages: ChatMessage[];
  message_count: number;
  created_at: string;
  updated_at: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  model?: string;
}

interface Props {
  projectId: string;
}

export function ProjectChatPanel({ projectId }: Props) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load sessions list
  const loadSessions = useCallback(async (autoSelect = false) => {
    try {
      const res = await projectChatsApi.list(projectId);
      const data = res.data || res;
      const list = Array.isArray(data) ? data : [];
      setSessions(list);
      // Auto-select most recent session on initial load
      if (autoSelect && list.length > 0 && !activeSessionId) {
        setActiveSessionId(list[0].id);
      }
    } catch (error) {
      console.error('Failed to load chat sessions:', error);
    } finally {
      setLoading(false);
    }
  }, [projectId, activeSessionId]);

  // Load a specific session with messages
  const loadSession = useCallback(async (chatId: string) => {
    try {
      const res = await projectChatsApi.get(projectId, chatId);
      const data = res.data || res;
      setActiveSession(data);
    } catch (error) {
      console.error('Failed to load chat session:', error);
    }
  }, [projectId]);

  useEffect(() => {
    loadSessions(true);
  }, [loadSessions]);

  // Load session when selected
  useEffect(() => {
    if (activeSessionId) {
      loadSession(activeSessionId);
    } else {
      setActiveSession(null);
    }
  }, [activeSessionId, loadSession]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession?.messages, sending]);

  // Create new chat
  const handleNewChat = async () => {
    try {
      const res = await projectChatsApi.create(projectId);
      const data = res.data || res;
      setActiveSessionId(data.id);
      await loadSessions();
      // Focus textarea
      setTimeout(() => textareaRef.current?.focus(), 100);
    } catch (error) {
      console.error('Failed to create chat:', error);
    }
  };

  // Send message (async job pattern)
  const handleSend = async () => {
    if (!message.trim() || !activeSessionId || sending) return;

    const userMessage = message.trim();
    setMessage('');
    setSending(true);
    setProgressMessage(null);

    // Optimistically add user message
    if (activeSession) {
      const optimisticMsg: ChatMessage = {
        role: 'user',
        content: userMessage,
        timestamp: new Date().toISOString(),
      };
      setActiveSession({
        ...activeSession,
        messages: [...(activeSession.messages || []), optimisticMsg],
      });
    }

    try {
      // 1. Send message -> returns job_id (HTTP 202)
      const res = await projectChatsApi.sendMessage(projectId, activeSessionId, userMessage);
      const jobData = res.data || res;
      const jobId = jobData.job_id;

      if (!jobId) {
        throw new Error('No job_id returned from server');
      }

      // 2. Poll for job completion with progress updates
      await jobsApi.poll(
        jobId,
        (_percent: number, msg: string | null) => {
          setProgressMessage(msg || 'Processing...');
        },
        1500,   // poll interval
        300000  // 5 min timeout
      );

      // 3. Job completed - reload session to get AI response
      await loadSession(activeSessionId);
      await loadSessions();

    } catch (error: any) {
      console.error('Failed to send message:', error);
      // Reload session to show current state (user message was already saved)
      if (activeSessionId) {
        await loadSession(activeSessionId);
      }
    } finally {
      setSending(false);
      setProgressMessage(null);
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  };

  // Delete session
  const handleDelete = async (chatId: string) => {
    try {
      await projectChatsApi.delete(projectId, chatId);
      if (activeSessionId === chatId) {
        setActiveSessionId(null);
        setActiveSession(null);
      }
      setDeleteConfirm(null);
      await loadSessions();
    } catch (error) {
      console.error('Failed to delete chat:', error);
    }
  };

  // Handle Enter to send, Shift+Enter for newline
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-280px)] min-h-[400px] border border-gray-200 rounded-lg overflow-hidden bg-white">
      {/* Left sidebar - Sessions list */}
      <div className="w-64 border-r border-gray-200 flex flex-col bg-gray-50">
        <div className="p-3 border-b border-gray-200">
          <Button
            variant="primary"
            className="w-full text-sm"
            onClick={handleNewChat}
          >
            <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Chat
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {sessions.length === 0 ? (
            <div className="p-4 text-sm text-gray-400 text-center">
              No conversations yet
            </div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                className={`
                  group flex items-center px-3 py-2.5 cursor-pointer border-b border-gray-100 transition-colors
                  ${activeSessionId === session.id ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-gray-100'}
                `}
                onClick={() => setActiveSessionId(session.id)}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {session.title}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {session.message_count || 0} messages
                  </p>
                </div>

                {/* Delete button */}
                {deleteConfirm === session.id ? (
                  <div className="flex gap-1 ml-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(session.id); }}
                      className="text-red-500 hover:text-red-700 text-xs font-medium"
                    >
                      Yes
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteConfirm(null); }}
                      className="text-gray-400 hover:text-gray-600 text-xs"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteConfirm(session.id); }}
                    className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 ml-2 transition-opacity"
                    title="Delete"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right area - Chat messages */}
      <div className="flex-1 flex flex-col">
        {!activeSession ? (
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
            <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            <p className="text-lg font-medium mb-1">Ask anything about your project</p>
            <p className="text-sm">Start a new chat to query the project knowledge base</p>
          </div>
        ) : (
          <>
            {/* Messages area */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {(!activeSession.messages || activeSession.messages.length === 0) ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                  <svg className="w-12 h-12 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <p className="text-sm">Ask a question about your project...</p>
                </div>
              ) : (
                activeSession.messages.map((msg, idx) => (
                  <MessageItem key={idx} message={msg} />
                ))
              )}

              {/* Sending indicator */}
              {sending && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 rounded-lg px-4 py-3 max-w-[75%]">
                    <div className="flex items-center gap-2 text-gray-500 text-sm">
                      <div className="flex gap-1">
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                      </div>
                      <span>{progressMessage || 'Thinking...'}</span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input area */}
            <div className="border-t border-gray-200 p-3 bg-white">
              <div className="flex gap-2">
                <textarea
                  ref={textareaRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about your project... (Shift+Enter for new line)"
                  className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  rows={2}
                  disabled={sending}
                />
                <Button
                  variant="primary"
                  onClick={handleSend}
                  disabled={!message.trim() || sending}
                  className="self-end"
                >
                  {sending ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Message Item Component
// ──────────────────────────────────────────────

function MessageItem({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`
          rounded-lg px-4 py-3 max-w-[75%] text-sm
          ${isUser
            ? 'bg-blue-600 text-white'
            : 'bg-gray-100 text-gray-900'
          }
        `}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2 prose-pre:my-2">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}

        {/* Timestamp and model */}
        <div className={`flex items-center gap-2 mt-1.5 text-xs ${isUser ? 'text-blue-200' : 'text-gray-400'}`}>
          <span>
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          {message.model && message.model !== 'error' && (
            <span className={`${isUser ? 'text-blue-200' : 'text-gray-400'}`}>
              {message.model}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * AI Flow Constants
 * PROMPT #122 - Visual Fallback Chain Configuration
 * PROMPT #204 - Utility Node Colors & Icons
 *
 * Pure data constants used across the AI Flow components.
 */

export const USAGE_TYPE_OPTIONS = [
  { value: 'interview', label: 'Entrevista' },
  { value: 'task_execution', label: 'Execucao de Tarefas' },
  { value: 'prompt_generation', label: 'Geracao de Prompts' },
  { value: 'commit_generation', label: 'Geracao de Commits' },
  { value: 'pattern_discovery', label: 'Descoberta de Padroes' },
  { value: 'memory', label: 'Memoria (Scan de Codebase)' },
  { value: 'queue_orchestration', label: 'Orquestração de Fila' },
  { value: 'content_generation', label: 'Geração de Conteúdo (Wiki/Cards)' },
  { value: 'rag_extraction', label: 'Extração RAG (Regras de Negócio)' },
  { value: 'general', label: 'Geral' },
];

export const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#9333ea',
  openai: '#16a34a',
  google: '#2563eb',
  ollama: '#ea580c',
  cohere: '#e11d48',
  claudio: '#0891b2',
};

export const PROVIDER_BG: Record<string, string> = {
  anthropic: 'bg-purple-50 border-purple-200',
  openai: 'bg-green-50 border-green-200',
  google: 'bg-blue-50 border-blue-200',
  ollama: 'bg-orange-50 border-orange-200',
  cohere: 'bg-rose-50 border-rose-200',
  claudio: 'bg-cyan-50 border-cyan-200',
};

// ---------------------------------------------------------------------------
// PROMPT #204 - Utility Node Colors & Icons
// ---------------------------------------------------------------------------

export const UTILITY_NODE_COLORS: Record<string, string> = {
  cache: '#8b5cf6',
  rag_context: '#06b6d4',
  prompt_transformer: '#f59e0b',
  router: '#10b981',
  retry: '#3b82f6',
  validator: '#22c55e',
  cost_guard: '#ef4444',
  rate_limiter: '#ec4899',
  timeout: '#f97316',
  prompt_node: '#6366f1',
};

export const UTILITY_NODE_BG: Record<string, string> = {
  cache: 'bg-violet-50 border-violet-200',
  rag_context: 'bg-cyan-50 border-cyan-200',
  prompt_transformer: 'bg-amber-50 border-amber-200',
  router: 'bg-emerald-50 border-emerald-200',
  retry: 'bg-blue-50 border-blue-200',
  validator: 'bg-green-50 border-green-200',
  cost_guard: 'bg-red-50 border-red-200',
  rate_limiter: 'bg-pink-50 border-pink-200',
  timeout: 'bg-orange-50 border-orange-200',
  prompt_node: 'bg-indigo-50 border-indigo-200',
};

// Map utility node type string to ReactFlow node type string
export const UTILITY_TYPE_TO_NODE_TYPE: Record<string, string> = {
  cache: 'cacheNode',
  rag_context: 'ragContextNode',
  prompt_transformer: 'promptTransformerNode',
  router: 'routerNode',
  retry: 'retryNode',
  validator: 'validatorNode',
  cost_guard: 'costGuardNode',
  rate_limiter: 'rateLimiterNode',
  timeout: 'timeoutNode',
  prompt_node: 'promptNodeNode',
};

// PROMPT #225 - Pipeline classification
// Utility nodes that execute BEFORE the AI model call
export const PRE_PROCESS_TYPES = ['cache', 'rag_context', 'prompt_transformer', 'router', 'rate_limiter', 'timeout', 'prompt_node'];
// Utility nodes that execute AFTER the AI model call
export const POST_PROCESS_TYPES = ['retry', 'validator', 'cost_guard'];

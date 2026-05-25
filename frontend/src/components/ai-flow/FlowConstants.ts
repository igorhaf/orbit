/**
 * AI Flow Constants
 * PROMPT #122 - Visual Fallback Chain Configuration
 * PROMPT #204 - Utility Node Colors & Icons
 *
 * Pure data constants used across the AI Flow components.
 */

export const USAGE_TYPE_OPTIONS = [
  { value: 'interview', label: 'Entrevista' },
  { value: 'task_execution', label: 'Execução de Tarefas' },
  { value: 'prompt_generation', label: 'Geração de Prompts' },
  { value: 'commit_generation', label: 'Geração de Commits' },
  { value: 'pattern_discovery', label: 'Descoberta de Padrões' },
  { value: 'memory', label: 'Memória (Scan de Codebase)' },
  { value: 'content_generation', label: 'Geração de Conteúdo (Wiki/Cards)' },
  { value: 'rag_extraction', label: 'Extração RAG (Regras de Negócio)' },
  { value: 'general', label: 'Geral' },
];

// v2.5: claudius-only lockdown
export const PROVIDER_COLORS: Record<string, string> = {
  claudius: '#0891b2',
};

export const PROVIDER_BG: Record<string, string> = {
  claudius: 'bg-cyan-50 border-cyan-200',
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
  contract_node: '#0d9488',  // PROMPT #257 - Contract nodes (teal)
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
  contract_node: 'bg-teal-50 border-teal-200',  // PROMPT #257
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

// ---------------------------------------------------------------------------
// v3.0 — Unified Canvas: typed connections + port colors + node categories
// ---------------------------------------------------------------------------

/** High-level node categories used by the unified canvas. */
export type CanvasNodeCategory = 'model' | 'utility' | 'pipeline_phase' | 'subflow' | 'io';

/**
 * Allowed connections matrix.
 * For each source category, list which destination categories are accepted.
 * Used by useConnectionValidator on every onConnect to reject invalid wires.
 *
 * v3.4: utility and io nodes are now first-class flow members. A utility can
 * feed any other node (model/utility/io) because they're general-purpose
 * processing blocks (Discovery scanners, Storage writers, AI callers, etc).
 */
export const ALLOWED_CONNECTIONS: Record<CanvasNodeCategory, CanvasNodeCategory[]> = {
  pipeline_phase: ['model', 'utility'],
  model:          ['utility', 'model', 'io'],
  utility:        ['model', 'utility', 'io'],
  subflow:        ['model', 'pipeline_phase', 'subflow'],
  io:             ['model', 'utility', 'io'],
};

/** Edge color per source→destination port type. */
export const PORT_TYPE_COLORS: Record<string, string> = {
  'pipeline_phase->model': '#3b82f6',  // blue (configures phase)
  'model->utility':        '#6b7280',  // gray (pre/post-process)
  'model->model':          '#f97316',  // orange (fallback chain)
  'utility->model':        '#6b7280',
  'subflow->model':        '#0891b2',
  'subflow->pipeline_phase':'#0891b2',
  default:                 '#94a3b8',
};

/** Map ReactFlow node type → canvas category. Single source of truth. */
export const NODE_TYPE_TO_CATEGORY: Record<string, CanvasNodeCategory> = {
  modelNode: 'model',
  pipelinePhaseNode: 'pipeline_phase',
  subflowNode: 'subflow',
  // legacy utility types
  cacheNode: 'utility',
  ragContextNode: 'utility',
  promptTransformerNode: 'utility',
  routerNode: 'utility',
  retryNode: 'utility',
  validatorNode: 'utility',
  costGuardNode: 'utility',
  rateLimiterNode: 'utility',
  timeoutNode: 'utility',
  promptNodeNode: 'utility',
  contractNode: 'utility',
  // v3.3 + v3.4
  ioNode: 'io',
  utilityNode: 'utility',
};

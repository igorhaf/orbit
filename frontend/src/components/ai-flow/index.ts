/**
 * AI Flow Components - Barrel Export
 *
 * v3.0: unified canvas. Obsolete tabs/dialogs were removed.
 */

// Constants
export {
  USAGE_TYPE_OPTIONS,
  PROVIDER_COLORS,
  PROVIDER_BG,
  UTILITY_NODE_COLORS,
  UTILITY_NODE_BG,
  UTILITY_TYPE_TO_NODE_TYPE,
  PRE_PROCESS_TYPES,
  POST_PROCESS_TYPES,
  ALLOWED_CONNECTIONS,
  NODE_TYPE_TO_CATEGORY,
  PORT_TYPE_COLORS,
} from './FlowConstants';
export type { CanvasNodeCategory } from './FlowConstants';

// Icons
export { UtilityNodeIcon, ProviderIcon } from './FlowIcons';

// Node components and nodeTypes registry
export {
  ModelNode,
  CacheNode,
  RAGContextNode,
  PromptTransformerNode,
  RouterNode,
  RetryNode,
  ValidatorNode,
  CostGuardNode,
  RateLimiterNode,
  TimeoutNode,
  // v3.0
  PipelinePhaseNode,
  SubflowNode,
  nodeTypes,
} from './FlowNodes';
export type { NodeAnimationState } from './FlowNodes';

// Panels (kept)
export { default as AnalyticsPanel } from './AnalyticsPanel';
export type { AnalyticsPanelProps } from './AnalyticsPanel';

export { default as OptimizeDialog } from './OptimizeDialog';
export type { OptimizeDialogProps } from './OptimizeDialog';

// Custom edge (default export)
export { default as SmartEdge } from './SmartEdge';
export { default as SmartEdgeDefault } from './SmartEdge';

// v3.0 canvas building blocks
export { NodeCatalogToolbar } from './NodeCatalogToolbar';
export { NodeInspector } from './NodeInspector';
export { DebugPanel } from './DebugPanel';
export type { DebugEvent } from './DebugPanel';
export { SubflowBreadcrumbs } from './SubflowBreadcrumbs';

// Utility functions
export { buildFlowFromChain, computeEdgeProps, validateConnection, categoryOf } from './flowUtils';
export type { EdgeProps, ModelOverrides, ConnectionValidation } from './flowUtils';

/**
 * AI Flow Components - Barrel Export
 *
 * Re-exports all sub-components extracted from the monolithic ai-flow/page.tsx.
 */

// Constants (pure data)
export {
  USAGE_TYPE_OPTIONS,
  PROVIDER_COLORS,
  PROVIDER_BG,
  UTILITY_NODE_COLORS,
  UTILITY_NODE_BG,
  UTILITY_TYPE_TO_NODE_TYPE,
  PRE_PROCESS_TYPES,
  POST_PROCESS_TYPES,
} from './FlowConstants';

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
  ContractsListNode,
  nodeTypes,
} from './FlowNodes';
export type { NodeAnimationState } from './FlowNodes';

// Dialogs
export { default as EditUtilityNodeDialog } from './EditUtilityNodeDialog';
export type { EditUtilityNodeDialogProps } from './EditUtilityNodeDialog';

export { default as EditModelNodeDialog } from './EditModelNodeDialog';
export type { ModelOverrides, EditModelNodeDialogProps } from './EditModelNodeDialog';

// Panels
export { default as AnalyticsPanel } from './AnalyticsPanel';
export type { AnalyticsPanelProps } from './AnalyticsPanel';

export { default as OptimizeDialog } from './OptimizeDialog';
export type { OptimizeDialogProps } from './OptimizeDialog';

// Custom edge with collision avoidance
export { default as SmartEdge } from './SmartEdge';

// Utility functions
export { buildFlowFromChain, computeEdgeProps } from './flowUtils';
export type { EdgeProps, FlowContract } from './flowUtils';

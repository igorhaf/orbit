/**
 * Chat Interface Package
 * PROMPT #72 - Refactor ChatInterface.tsx (Package Structure)
 *
 * This package will contain modularized chat interface components.
 * For now, imports from ChatInterface.old.tsx for backwards compatibility.
 *
 * Future structure:
 * - useChatState.ts: State management hook
 * - useJobPolling.ts: Job polling logic
 * - ChatMessages.tsx: Message list rendering
 * - ChatInput.tsx: Input area with question handling
 * - ChatHeader.tsx: Header with actions
 * - ErrorBanner.tsx: AI error display
 * - ProvisioningCard.tsx: Provisioning status
 */

// For now, re-export from old file to maintain compatibility
export { ChatInterface } from '../ChatInterface.old';

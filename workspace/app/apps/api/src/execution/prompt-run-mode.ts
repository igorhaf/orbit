export type PromptRunModeInput = {
  multiple_agents?: unknown;
};

export type PromptRunModeResume = {
  multiple_agents?: boolean;
};

/** Resolve the execution mode from the submitted input or its persisted snapshot. */
export function promptRunMultipleAgents(
  body: PromptRunModeInput = {},
  commentReply?: object,
  resume?: PromptRunModeResume,
): boolean {
  if (resume !== undefined) return resume.multiple_agents === true;
  if (commentReply !== undefined) return false;
  return body.multiple_agents !== false;
}

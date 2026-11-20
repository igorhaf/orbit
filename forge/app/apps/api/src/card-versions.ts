/** Base card demand revision. This does not version related records or project context. */
export type CardRevision = number;
export type RevisionFreshness = 'pending' | 'current' | 'stale' | 'unversioned';
export type FinishedRevisionFreshness = Exclude<RevisionFreshness, 'pending'>;
export const cardRevisionFields = [
  'title', 'description', 'kind', 'target_board_id', 'link_url',
  'ai_project_id', 'ai_model', 'ai_effort', 'ai_execution_mode',
  'start_date', 'due_date', 'reminder_minutes', 'recurrence',
  'schedule_start_at', 'schedule_end_at', 'schedule_all_day', 'schedule_time_zone',
] as const;

export function isCardRevision(value: unknown): value is CardRevision {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2_147_483_647;
}

export class CardRevisionConflict extends Error {
  readonly code = 'CARD_REVISION_CONFLICT';
  constructor(readonly captured: unknown, readonly current: unknown) {
    super('O cartão mudou durante a preparação da execução. Recarregue o cartão e execute novamente.');
    this.name = 'CardRevisionConflict';
  }
}

/** Use the revision of the card snapshot used to construct the input, never a later revision. */
export function assertCardRevision(captured: unknown, current: unknown): asserts captured is CardRevision {
  if (!isCardRevision(captured) || !isCardRevision(current) || captured !== current) {
    throw new CardRevisionConflict(captured, current);
  }
}

export function revisionFreshness(captured: unknown, current: unknown, status?: string): RevisionFreshness {
  if (!isCardRevision(captured) || !isCardRevision(current)) return 'unversioned';
  if (captured !== current) return 'stale';
  return status && ['queued', 'running', 'waiting_answer'].includes(status) ? 'pending' : 'current';
}

/** SQL aliases come from source code; refuse unsafe interpolation even there. */
export function cardRevisionFreshnessSql(runAlias = 'r', cardAlias = 'c'): string {
  for (const alias of [runAlias, cardAlias]) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(alias)) throw new Error('Alias SQL de revisão inválido.');
  }
  return `CASE WHEN ${runAlias}.card_revision IS NULL OR ${cardAlias}.card_revision IS NULL THEN 'unversioned' WHEN ${runAlias}.card_revision <> ${cardAlias}.card_revision THEN 'stale' WHEN ${runAlias}.status IN ('queued','running','waiting_answer') THEN 'pending' ELSE 'current' END`;
}

/** Revision observed transactionally at completion, independent of later card edits. */
export function finishedRevisionFreshness(captured: unknown, finished: unknown): FinishedRevisionFreshness {
  return revisionFreshness(captured, finished) as FinishedRevisionFreshness;
}

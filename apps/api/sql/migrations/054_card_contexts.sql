CREATE TABLE IF NOT EXISTS card_contexts (
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  context_card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  PRIMARY KEY (card_id, context_card_id),
  CHECK (card_id <> context_card_id)
);
CREATE INDEX IF NOT EXISTS card_contexts_reference_idx ON card_contexts(context_card_id);

CREATE TABLE ai_checklist_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  text varchar(300) NOT NULL,
  normalized_text text NOT NULL,
  excluded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_checklist_history_card_idx ON ai_checklist_history(card_id);

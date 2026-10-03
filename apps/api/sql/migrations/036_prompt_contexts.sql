CREATE TABLE prompt_contexts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  prompt text NOT NULL CHECK (char_length(prompt) BETWEEN 1 AND 20000),
  project_id uuid REFERENCES ai_projects(id) ON DELETE CASCADE,
  board_id uuid REFERENCES boards(id) ON DELETE CASCADE,
  card_id uuid REFERENCES cards(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(project_id, board_id, card_id) <= 1)
);
CREATE INDEX prompt_contexts_scope ON prompt_contexts(owner_id, project_id, board_id, card_id);
CREATE TABLE card_prompt_contexts (
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  context_id uuid NOT NULL REFERENCES prompt_contexts(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  PRIMARY KEY(card_id, context_id)
);

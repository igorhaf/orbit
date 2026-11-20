-- Owned by the structured-view plugin; context references remain independent.
CREATE TABLE structured_view_parents (
 card_id uuid PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
 parent_card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(card_id<>parent_card_id)
);
CREATE INDEX structured_view_parents_parent_idx ON structured_view_parents(parent_card_id);

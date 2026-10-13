CREATE TABLE board_view_preferences (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  view_id text NOT NULL DEFAULT 'board',
  saved_filters jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,board_id)
);

-- Preserve the existing visual board access without authorizing the new view implicitly.
UPDATE access_roles SET permissions=array_append(permissions,'views.board.use')
WHERE 'boards.read'=ANY(permissions) AND NOT 'views.board.use'=ANY(permissions);
UPDATE access_groups SET permissions=array_append(permissions,'views.board.use')
WHERE 'boards.read'=ANY(permissions) AND NOT 'views.board.use'=ANY(permissions);
INSERT INTO access_user_exceptions(user_id,permission_id,effect)
SELECT user_id,'views.board.use','allow' FROM access_user_exceptions
WHERE permission_id='boards.read' AND effect='allow'
ON CONFLICT DO NOTHING;
UPDATE access_roles SET permissions=array_append(permissions,'views.structured.use')
WHERE id IN ('administrator','platform_admin') AND NOT 'views.structured.use'=ANY(permissions);

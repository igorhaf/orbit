ALTER TABLE git_card_commits
  ADD COLUMN IF NOT EXISTS action varchar(12) NOT NULL DEFAULT 'commit',
  ADD COLUMN IF NOT EXISTS target_sha varchar(40);

ALTER TABLE git_card_commits
  ADD CONSTRAINT git_card_commits_action_check CHECK (action IN ('commit', 'undo', 'redo'));

CREATE INDEX IF NOT EXISTS git_card_commits_target_idx
  ON git_card_commits(card_id, repository_id, target_sha, created_at DESC);

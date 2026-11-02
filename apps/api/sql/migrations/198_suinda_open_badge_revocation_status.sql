CREATE TABLE IF NOT EXISTS suinda_open_badge_status_counters (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE RESTRICT,
  next_index bigint NOT NULL DEFAULT 0 CHECK (next_index >= 0)
);

ALTER TABLE suinda_open_badge_credential_refs
  ADD COLUMN IF NOT EXISTS status_list_number integer,
  ADD COLUMN IF NOT EXISTS status_list_index integer;

WITH ranked AS (
  SELECT certificate_id,
         row_number() OVER (PARTITION BY workspace_id ORDER BY created_at,certificate_id)-1 AS allocated_index
  FROM suinda_open_badge_credential_refs
)
UPDATE suinda_open_badge_credential_refs refs
SET status_list_number=(ranked.allocated_index/131072)::integer,
    status_list_index=(ranked.allocated_index%131072)::integer
FROM ranked WHERE ranked.certificate_id=refs.certificate_id
  AND (refs.status_list_number IS NULL OR refs.status_list_index IS NULL);

ALTER TABLE suinda_open_badge_credential_refs
  ALTER COLUMN status_list_number SET NOT NULL,
  ALTER COLUMN status_list_index SET NOT NULL;

ALTER TABLE suinda_open_badge_credential_refs
  DROP CONSTRAINT IF EXISTS suinda_open_badge_status_list_number_check,
  DROP CONSTRAINT IF EXISTS suinda_open_badge_status_list_index_check,
  DROP CONSTRAINT IF EXISTS suinda_open_badge_status_list_position_unique,
  DROP CONSTRAINT IF EXISTS suinda_open_badge_credential_refs_status_list_number_check,
  DROP CONSTRAINT IF EXISTS suinda_open_badge_credential_refs_status_list_index_check,
  DROP CONSTRAINT IF EXISTS suinda_open_badge_credential_refs_workspace_id_status_list_number_status_list_index_key;

ALTER TABLE suinda_open_badge_credential_refs
  ADD CONSTRAINT suinda_open_badge_status_list_number_check CHECK (status_list_number >= 0),
  ADD CONSTRAINT suinda_open_badge_status_list_index_check CHECK (status_list_index BETWEEN 0 AND 131071),
  ADD CONSTRAINT suinda_open_badge_status_list_position_unique UNIQUE(workspace_id,status_list_number,status_list_index);

INSERT INTO suinda_open_badge_status_counters(workspace_id,next_index)
SELECT workspace_id,MAX(status_list_number::bigint*131072+status_list_index+1)
FROM suinda_open_badge_credential_refs GROUP BY workspace_id
ON CONFLICT(workspace_id) DO UPDATE SET next_index=GREATEST(suinda_open_badge_status_counters.next_index,excluded.next_index);

CREATE INDEX IF NOT EXISTS suinda_open_badge_status_lookup_idx
  ON suinda_open_badge_credential_refs(workspace_id,status_list_number,status_list_index);

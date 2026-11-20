ALTER TABLE automation_events ADD COLUMN IF NOT EXISTS source_plugin varchar(100);
ALTER TABLE automation_events ADD COLUMN IF NOT EXISTS operation_id varchar(200);
CREATE UNIQUE INDEX IF NOT EXISTS automation_events_operation_idx
  ON automation_events(operation_id) WHERE operation_id IS NOT NULL;

ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS started_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS finished_at timestamptz;

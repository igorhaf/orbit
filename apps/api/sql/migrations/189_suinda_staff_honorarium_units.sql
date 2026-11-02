ALTER TABLE suinda_staff_honorarium_ledger
  ADD COLUMN IF NOT EXISTS institution_unit_record_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='suinda_staff_honorarium_unit_workspace_fk'
  ) THEN
    ALTER TABLE suinda_staff_honorarium_ledger
      ADD CONSTRAINT suinda_staff_honorarium_unit_workspace_fk
      FOREIGN KEY (institution_unit_record_id,workspace_id)
      REFERENCES extension_records(id,workspace_id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS suinda_staff_honorarium_unit_period_idx
  ON suinda_staff_honorarium_ledger(workspace_id,institution_unit_record_id,period_end DESC,created_at DESC);

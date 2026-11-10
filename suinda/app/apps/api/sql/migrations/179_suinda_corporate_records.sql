-- A company can have only one active price contract per course and a learning cohort can
-- be assigned to only one corporate contract in a workspace. Records remain versioned
-- in the shared extension_records ledger.
CREATE UNIQUE INDEX IF NOT EXISTS suinda_corporate_active_company_course_unique
  ON extension_records(workspace_id,(payload->>'company_record_id'),(payload->>'course_record_id'))
  WHERE plugin_id='suinda-corporate' AND kind='corporate_course' AND state='active';

CREATE UNIQUE INDEX IF NOT EXISTS suinda_corporate_cohort_assignment_unique
  ON extension_records(workspace_id,(payload->>'cohort_record_id'))
  WHERE plugin_id='suinda-corporate' AND kind='corporate_cohort' AND state IN ('active','closed');

CREATE INDEX IF NOT EXISTS suinda_corporate_enrollment_cohort_idx
  ON extension_records(workspace_id,(payload->>'cohort_record_id'),state)
  WHERE plugin_id='suinda-learning' AND kind='enrollment';

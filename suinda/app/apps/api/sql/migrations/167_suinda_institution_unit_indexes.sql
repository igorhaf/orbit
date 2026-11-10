-- Unit codes are human-facing identifiers and should not differ only by case.
CREATE UNIQUE INDEX extension_suinda_institution_unit_code_ci_uq
  ON extension_records (workspace_id, lower(payload->>'unit_code'))
  WHERE plugin_id='suinda-learning' AND kind='institution_unit' AND payload->>'unit_code' IS NOT NULL;

CREATE INDEX extension_suinda_course_institution_unit_idx
  ON extension_records (workspace_id, (payload->>'institution_unit_record_id'))
  WHERE plugin_id='suinda-learning' AND kind='course' AND payload->>'institution_unit_record_id' IS NOT NULL;

CREATE INDEX extension_suinda_cohort_institution_unit_idx
  ON extension_records (workspace_id, (payload->>'institution_unit_record_id'))
  WHERE plugin_id='suinda-learning' AND kind='cohort' AND payload->>'institution_unit_record_id' IS NOT NULL;

CREATE INDEX extension_suinda_enrollment_institution_unit_idx
  ON extension_records (workspace_id, (payload->>'institution_unit_record_id'))
  WHERE plugin_id='suinda-learning' AND kind='enrollment' AND payload->>'institution_unit_record_id' IS NOT NULL;

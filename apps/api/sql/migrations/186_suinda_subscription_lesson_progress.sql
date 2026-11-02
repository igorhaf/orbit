ALTER TABLE suinda_subscriptions
  ADD CONSTRAINT suinda_subscriptions_id_workspace_user_unique UNIQUE(id,workspace_id,user_id);

CREATE TABLE IF NOT EXISTS suinda_subscription_lesson_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  course_record_id uuid NOT NULL,
  course_version integer NOT NULL CHECK (course_version > 0),
  lesson_record_id uuid NOT NULL,
  operation_key uuid NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(subscription_id,workspace_id,user_id)
    REFERENCES suinda_subscriptions(id,workspace_id,user_id) ON DELETE RESTRICT,
  FOREIGN KEY(course_record_id,workspace_id)
    REFERENCES extension_records(id,workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY(lesson_record_id,workspace_id)
    REFERENCES extension_records(id,workspace_id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,user_id,course_record_id,course_version,lesson_record_id),
  UNIQUE(subscription_id,operation_key)
);
CREATE INDEX IF NOT EXISTS suinda_subscription_lesson_progress_lookup_idx
  ON suinda_subscription_lesson_progress(workspace_id,user_id,course_record_id,course_version);

CREATE OR REPLACE FUNCTION prevent_suinda_subscription_progress_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Suindá subscription lesson progress is immutable'; END;
$$;
CREATE TRIGGER suinda_subscription_lesson_progress_immutable
  BEFORE UPDATE OR DELETE ON suinda_subscription_lesson_progress
  FOR EACH ROW EXECUTE FUNCTION prevent_suinda_subscription_progress_mutation();

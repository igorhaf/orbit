CREATE TABLE IF NOT EXISTS notification_email_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL UNIQUE REFERENCES notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','cancelled')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  available_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notification_email_deliveries_pending_idx
  ON notification_email_deliveries(available_at,created_at)
  WHERE status IN ('pending','sending');

CREATE OR REPLACE FUNCTION queue_notification_email_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO notification_email_deliveries(notification_id,user_id)
  SELECT NEW.id, u.id FROM users u
  WHERE u.id=NEW.user_id AND u.disabled=false AND u.email_verified=true
    AND COALESCE((u.preferences->>'notifications')::boolean,true)
    AND COALESCE((u.preferences->>'emailNotifications')::boolean,false)
  ON CONFLICT(notification_id) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS queue_notification_email_delivery_trigger ON notifications;
CREATE TRIGGER queue_notification_email_delivery_trigger
  AFTER INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION queue_notification_email_delivery();

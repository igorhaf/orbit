CREATE TABLE IF NOT EXISTS notification_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE CHECK (length(endpoint) <= 2048 AND endpoint ~ '^https://'),
  p256dh varchar(200) NOT NULL CHECK (p256dh ~ '^[A-Za-z0-9_-]+$'),
  auth varchar(100) NOT NULL CHECK (auth ~ '^[A-Za-z0-9_-]+$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notification_push_subscriptions_user_idx ON notification_push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS notification_push_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES notification_push_subscriptions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','cancelled')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(notification_id,subscription_id)
);
CREATE INDEX IF NOT EXISTS notification_push_deliveries_pending_idx
  ON notification_push_deliveries(available_at,created_at) WHERE status IN ('pending','sending');

CREATE OR REPLACE FUNCTION queue_notification_push_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO notification_push_deliveries(notification_id,subscription_id,user_id)
  SELECT NEW.id,s.id,s.user_id
  FROM notification_push_subscriptions s JOIN users u ON u.id=s.user_id
  WHERE s.user_id=NEW.user_id AND u.disabled=false
    AND COALESCE((u.preferences->>'notifications')::boolean,true)
  ON CONFLICT(notification_id,subscription_id) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS queue_notification_push_delivery_trigger ON notifications;
CREATE TRIGGER queue_notification_push_delivery_trigger
  AFTER INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION queue_notification_push_delivery();

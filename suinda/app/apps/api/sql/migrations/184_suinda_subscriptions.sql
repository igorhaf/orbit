CREATE TABLE IF NOT EXISTS suinda_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_record_id uuid NOT NULL REFERENCES extension_records(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (state IN ('pending_payment','active','past_due','canceled','expired')),
  billing_interval text NOT NULL CHECK (billing_interval IN ('month','quarter','year')),
  price_amount numeric(12,2) NOT NULL CHECK (price_amount > 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  external_payment_reference varchar(200),
  operation_key uuid NOT NULL,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state <> 'active') OR (starts_at IS NOT NULL AND ends_at IS NOT NULL)),
  UNIQUE(workspace_id,user_id,operation_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS suinda_subscriptions_single_active_idx
  ON suinda_subscriptions(workspace_id,plan_record_id,user_id) WHERE state='active';
CREATE INDEX IF NOT EXISTS suinda_subscriptions_user_idx
  ON suinda_subscriptions(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS suinda_subscriptions_workspace_idx
  ON suinda_subscriptions(workspace_id,state,ends_at);

CREATE TABLE IF NOT EXISTS suinda_subscription_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES suinda_subscriptions(id) ON DELETE RESTRICT,
  sequence integer NOT NULL CHECK (sequence > 0),
  event_type text NOT NULL CHECK (event_type IN ('requested','manual_payment_confirmed','canceled_by_subscriber','expired_by_term')),
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation_key uuid NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subscription_id,sequence),
  UNIQUE(subscription_id,operation_key)
);
CREATE INDEX IF NOT EXISTS suinda_subscription_events_timeline_idx
  ON suinda_subscription_events(subscription_id,sequence);

CREATE OR REPLACE FUNCTION prevent_suinda_subscription_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Suindá subscription events are immutable'; END;
$$;
DROP TRIGGER IF EXISTS suinda_subscription_events_immutable ON suinda_subscription_events;
CREATE TRIGGER suinda_subscription_events_immutable
  BEFORE UPDATE OR DELETE ON suinda_subscription_events
  FOR EACH ROW EXECUTE FUNCTION prevent_suinda_subscription_event_mutation();

CREATE OR REPLACE FUNCTION prevent_suinda_subscription_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workspace_id<>OLD.workspace_id OR NEW.plan_record_id<>OLD.plan_record_id OR NEW.user_id<>OLD.user_id
    OR NEW.billing_interval<>OLD.billing_interval OR NEW.price_amount<>OLD.price_amount OR NEW.currency<>OLD.currency
    OR NEW.operation_key<>OLD.operation_key THEN RAISE EXCEPTION 'Suindá subscription terms are immutable'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS suinda_subscription_snapshot_immutable ON suinda_subscriptions;
CREATE TRIGGER suinda_subscription_snapshot_immutable
  BEFORE UPDATE ON suinda_subscriptions
  FOR EACH ROW EXECUTE FUNCTION prevent_suinda_subscription_snapshot_mutation();

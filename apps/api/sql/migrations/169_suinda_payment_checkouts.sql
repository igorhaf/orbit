CREATE TABLE IF NOT EXISTS suinda_payment_checkouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  enrollment_id uuid NOT NULL,
  learner_user_id uuid NOT NULL,
  operation_key uuid NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  preference_id text,
  checkout_url text,
  provider_payment_id text,
  provider_status text,
  status text NOT NULL DEFAULT 'creating'
    CHECK (status IN ('creating','pending','approved','rejected','cancelled','refunded','failed','review_required')),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, enrollment_id, operation_key),
  UNIQUE (provider_payment_id)
);

CREATE INDEX IF NOT EXISTS suinda_payment_checkouts_enrollment
  ON suinda_payment_checkouts (workspace_id, enrollment_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS suinda_payment_checkouts_one_open_enrollment
  ON suinda_payment_checkouts (workspace_id, enrollment_id)
  WHERE status IN ('creating','pending');

CREATE TABLE IF NOT EXISTS suinda_payment_checkout_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_id uuid NOT NULL REFERENCES suinda_payment_checkouts(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL,
  provider_payment_id text NOT NULL,
  provider_status text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (checkout_id, provider_payment_id, provider_status)
);

ALTER TABLE webhook_subscriptions
  DROP CONSTRAINT IF EXISTS webhook_subscriptions_event_types_check;
ALTER TABLE webhook_subscriptions
  ADD CONSTRAINT webhook_subscriptions_event_types_check CHECK (
    cardinality(event_types)>0 AND event_types <@ ARRAY[
      'record.created','record.updated',
      'suinda.enrollment.completed','suinda.payment.recorded','suinda.payment.refunded',
      'suinda.certificate.issued','suinda.certificate.revoked'
    ]::text[]
  );

ALTER TABLE webhook_events
  DROP CONSTRAINT IF EXISTS webhook_events_event_type_check;
ALTER TABLE webhook_events
  ADD CONSTRAINT webhook_events_event_type_check CHECK (event_type IN (
    'record.created','record.updated',
    'suinda.enrollment.completed','suinda.payment.recorded','suinda.payment.refunded',
    'suinda.certificate.issued','suinda.certificate.revoked'
  ));
ALTER TABLE webhook_events
  ADD COLUMN IF NOT EXISTS event_version integer NOT NULL DEFAULT 1;
ALTER TABLE webhook_events
  DROP CONSTRAINT IF EXISTS webhook_events_event_version_check;
ALTER TABLE webhook_events
  ADD CONSTRAINT webhook_events_event_version_check CHECK (event_version>0);

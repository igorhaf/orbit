ALTER TABLE webhook_subscriptions
  DROP CONSTRAINT IF EXISTS webhook_subscriptions_event_types_check;
ALTER TABLE webhook_subscriptions
  ADD CONSTRAINT webhook_subscriptions_event_types_check CHECK (
    cardinality(event_types)>0
    AND array_to_string(event_types,',') ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+(,[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+)*$'
  );

ALTER TABLE webhook_events
  DROP CONSTRAINT IF EXISTS webhook_events_event_type_check;
ALTER TABLE webhook_events
  ADD CONSTRAINT webhook_events_event_type_check CHECK (
    event_type ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$'
  );

# Webhooks de workspace

Orbit can deliver record lifecycle events and versioned domain events declared by plugins to HTTPS endpoints owned by the workspace.

## Configuration

Set `ORBIT_WEBHOOK_ENCRYPTION_KEY` on the API host to a stable random value with at least 32 characters. Generate one with `openssl rand -hex 32`; store it separately from database, backup, vault and JWT keys. Orbit encrypts each signing secret at rest with AES-256-GCM. Losing or changing this key makes existing subscription secrets unreadable; recreate affected subscriptions after a deliberate key change.

Apply the webhook migrations before enabling subscriptions: `153_orbit_webhooks.sql`, `154_plugin_webhook_events.sql` and `155_webhook_event_types_reject_nulls.sql`. The workspace detail page shows the Webhooks panel to workspace managers.

## Event and delivery contract

The generic events are `record.created` and `record.updated`. A plugin may declare namespaced events through the Orbit plugin contract. A single SQL statement materializes the active subscriptions matching the event, inserts the event only when that set is non-empty, and creates delivery rows from that same set. This prevents orphan event rows and keeps the event/outbox atomic with the source record snapshot. Idempotency is keyed by workspace, record, revision and event type.

Payloads contain only event ID/type, workspace ID, record ID, plugin ID, record kind/state/revision and timestamp (domain events use the declared event version and minimal resource metadata). They never include a record title, body or payload fields. Each request carries `X-Orbit-Signature-256: sha256=<hex>` computed as HMAC-SHA256 over the exact JSON body using the subscription secret, shown once when the subscription is created.

Destinations must use HTTPS on port 443 and resolve only to public IP addresses. Orbit rejects loopback, private, link-local, reserved and mixed public/private DNS answers, then pins the selected public address for the request. The receiver must respond with HTTP 2xx within eight seconds; response bodies are discarded and capped at 8 KB.

Failures retry with exponential delay, capped at six hours, for up to eight attempts. Timeouts and transient responses such as 408/429 retry; unsafe destinations and permanent 3xx/4xx responses go to dead letter. Delivery history stores status, attempt count and a short error code; it does not retain response bodies or the event payload. Deleting a subscription removes its pending delivery rows.

## Local checks

`apps/api/src/plugins/webhooks.spec.ts` covers minimal event envelopes, HMAC/HTTPS delivery guards, SSRF rejection, retry/dead-letter rules and plugin event registration. `npm run build` checks API lint/types and the Web application.

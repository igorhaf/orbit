# Orbit Web Push notifications

Orbit can deliver an existing notification to browser subscriptions using Web Push and VAPID. This is optional: leave `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, and `WEB_PUSH_VAPID_SUBJECT` unset to disable delivery. Generate a key pair directly into the API environment file with:

```sh
npm run web-push:keys -w apps/api -- --config-path ../data/config/api.env --subject mailto:suporte@example.org
```

Use a contact address controlled by the institution, or provide a public HTTPS contact URL. The command writes the file with mode `0600`, never prints key values, and refuses to replace any populated VAPID setting. Store the API environment file in the deployment's secret configuration area; do not commit or share it. Restart the API after changing these values.

Authenticated API contract:

Users opt in or out for the current browser under **Profile → Configurações → Notificações push**. Turning push off removes only that browser's subscription; it does not change the separate global notification preference. An existing subscription can still be removed after VAPID is disabled.

- `GET /notifications/push/config` returns `{ enabled, public_key, subscribed }`. `subscribed` describes whether the account has at least one device subscription; it does not describe this browser's local service worker state.
- `PUT /notifications/push/subscription` accepts the browser's `PushSubscription.toJSON()` value. The endpoint must use HTTPS on the default port and resolve exclusively to public IPv4/IPv6 addresses; loopback, private, link-local, reserved, documentation and mixed public/private DNS answers are rejected. The API pins the accepted DNS result on every send to prevent rebinding. Encryption keys are bounded and validated. Creating the subscription itself is the Web Push opt-in; `browserNotifications` remains the separate preference for in-app browser notifications. The global `notifications` preference independently gates notification creation, queueing, and sending, so subscribing does not toggle that preference.
- `DELETE /notifications/push/subscription` accepts `{ "endpoint": "https://…" }` and removes only that endpoint belonging to the authenticated account.

On notification creation, a database trigger queues one delivery per currently subscribed device only when the account's global notifications preference is enabled. A unique constraint prevents duplicate queue rows. The worker rechecks account status and the global preference before sending, retries network/429/5xx errors up to five times with bounded exponential delay, marks other permanent errors failed, and removes a subscription when the push service returns 404 or 410. A `sending` row left stale for five minutes at the retry ceiling is finalized as failed. Turning off global notifications transactionally cancels pending e-mail and push rows; turning off e-mail notifications cancels pending e-mail rows only. With VAPID disabled, pending push rows are cancelled and no send is attempted; the API still permits subscription removal. Existing browser in-app notifications and email delivery remain independent.

Endpoints, key material, and message content are never written to application logs. The queue stores only notification and subscription references plus delivery state. Payload content is capped before encryption and delivery.

# Microsoft 365 integration

Microsoft 365 is a shared Orbit connection. `outlook_calendar`, `outlook_mail`, and `microsoft_teams` consume the same encrypted connection and central `MicrosoftGraphClient`; they do not implement separate OAuth stacks.

## Microsoft Entra registration

Create a Microsoft Entra app registration and enable the account types required by the installation. The default tenant value `common` permits work, school, and personal Microsoft accounts where the selected Graph capability supports them. Configure this web redirect URI exactly:

```text
https://your-api.example.com/calendar/microsoft/oauth/callback
```

Set `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT`, `MICROSOFT_REDIRECT_URI`, and `MICROSOFT_GRAPH_WEBHOOK_URL`. `MICROSOFT_GRAPH_WEBHOOK_URL` must be a public HTTPS URL ending in `/calendar/microsoft/webhook`; localhost cannot receive Graph notifications.

The backend uses OAuth 2.0 authorization code flow with state, PKCE, offline access, one-time state records, encrypted refresh tokens, and server-side refresh. Tokens are never returned to the browser, written into Cards, or logged.

## Delegated permissions

Calendar consent requests OpenID profile scopes, `offline_access`, `User.Read`, `Calendars.ReadWrite`, and `Calendars.ReadWrite.Shared`. Teams is incremental: the calendar remains usable without Teams consent, and activating Teams requests `OnlineMeetings.ReadWrite`. Outlook Mail consent is also incremental and requests `Mail.ReadWrite` and `Mail.Send`. The shared connection keeps encrypted token sets per capability so later consent does not invalidate Calendar, Mail, or Teams access already granted. Standalone Teams online meetings require a work or school account; Microsoft personal accounts continue to use Outlook Calendar where Graph supports it.

Use the least permission set compatible with the desired capability. Do not grant application permissions or configure an application access policy unless a future server-to-server capability explicitly requires them.

## Calendar provider

`OutlookCalendarPlugin` implements the generic `CalendarSourceProvider` contract. It discovers all calendars from `/me/calendars`, stores normalized `calendar_sources`, and renders through the existing Month, Week, Day, Agenda, and Timeline views. Multiple Microsoft connections and any number of selected calendars can coexist with Google sources and scheduled Orbit Cards.

Selected sources are mirrored into `calendar_items`. The first synchronization uses `calendarView/delta` over a persisted bounded window, follows pagination, and stores the returned delta link. Later runs consume only the delta link. A provider `410` clears only that source cursor and performs a controlled full synchronization. The adapter normalizes timed/all-day events, recurrence, attendees, categories, sensitivity, locations, response status, online meetings, and timezones while retaining unsupported provider fields in metadata.

CRUD writes through Graph and then updates the local mirror. Setting the generic `conference` flag creates an Outlook event with `isOnlineMeeting=true` and `onlineMeetingProvider=teamsForBusiness`; this is preferred over a standalone meeting because it remains calendar-backed. Drag/resize uses the same generic Calendar mutation path with ETag conflict protection and reconciliation.

## Cards, ExternalResource, and automations

Outlook events use generic `ExternalResource` records. Event-to-Card, link-existing-Card, unlink, optional automatic mirror, linked-field ownership, cancellation behavior, and recurring-series strategy are the existing Calendar Workspace features, not Microsoft-specific Card logic.

The plugin registers normalized `outlook_calendar.*` actions and `calendar.event.*` triggers. Agents and automations discover them through the Plugin Registry. Provider payloads are normalized before they reach the Event Bus or Automation Engine, and operation IDs plus ETags prevent feedback loops.

## Teams

`MicrosoftTeamsPlugin` shares the Microsoft connection and Graph client. Calendar-backed Teams meetings are created by the Outlook action. Explicit standalone requests use `/me/onlineMeetings/createOrGet` with an idempotent external ID and create a generic `online_meeting` ExternalResource. The plugin also supports reading and updating standalone meetings. It does not implement chat, channels, telephony, recordings, transcripts, or a Teams client.

## Availability and timezones

Availability uses the stable Graph `getSchedule` endpoint and returns the same normalized `{sourceId, busy[]}` model used by other providers. The adapter converts common Windows timezone identifiers to IANA for Orbit and back to Windows identifiers for Graph requests. Unknown valid IANA zones remain usable; invalid values fall back to UTC.

## Change notifications

For each selected calendar, Orbit creates a Graph subscription with a random encrypted `clientState`. The webhook responds to Graph's `validationToken` handshake as plain text, validates connection tenant and `clientState`, deduplicates notifications, and schedules delta sync. Notification bodies are only change signals; they are not treated as complete events.

Outlook event subscriptions expire in under seven days. Orbit persists expiration, renews before expiry, stops subscriptions for deselected/disconnected sources, and recreates them when renewal fails. Configure production ingress to answer validation quickly and return 2xx within Graph's delivery window.

## Troubleshooting

- `needs_reauth`: the refresh token was revoked or expired; reconnect the account.
- `CONSENT_REQUIRED`: activate the missing capability from Calendar connections.
- no push updates: verify the HTTPS webhook is publicly reachable and matches the Entra/Orbit environment.
- throttling: Orbit honors `Retry-After` and uses bounded exponential retry; repeated failures remain visible in sync state.
- missing shared calendar: confirm `Calendars.ReadWrite.Shared` consent and rerun discovery.

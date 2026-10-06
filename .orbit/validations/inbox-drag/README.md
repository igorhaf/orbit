# Inbox drag validation

Run against an already running local Orbit instance:

```sh
node .orbit/validations/inbox-drag/inbox-drag.selenium.mjs
```

Uses `ORBIT_SELENIUM_BASE_URL`, then `WEB_ORIGIN` from `apps/api/.env`, then `http://localhost:3000`. Requires Chrome, the configured database and `JWT_SECRET`.

Uses the configured account and its Inbox, creates a temporary board and cards, and removes the fixtures after the checks. Verifies repeated drops onto the Inbox panel, its input, an existing card and the Inbox tab, including with Collections open, after horizontal scrolling and with the sidebar collapsed. Also checks movement between board lists and visual feedback during the drag.

# Collection drag validation

Run against an already running local Orbit instance:

```sh
node .orbit/validations/collection-drag/collection-drag.selenium.mjs
```

Uses `ORBIT_SELENIUM_BASE_URL`, then `WEB_ORIGIN` from `apps/api/.env`, then `http://localhost:3000`. Requires Chrome, the configured database, `JWT_SECRET`, and an account with Collections.

Creates temporary source lists, cards and collection categories, and removes the fixtures after the checks. Verifies drops onto closed and open categories, an existing collection item, subcategories, categories with duplicate names, multiple selected cards and movement after horizontal scrolling. Checks visual feedback, persisted destinations and updates to both panels.

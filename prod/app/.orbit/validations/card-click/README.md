# Card click validation (Selenium)

Runs against an already running Orbit web app and its configured database. The suite creates a temporary board and two cards, opens a short lived browser session, and removes the fixture board when it exits.

```sh
npm run test:selenium:card-click
```

It uses `ORBIT_SELENIUM_BASE_URL`, then `WEB_ORIGIN` from `apps/api/.env`, then `http://localhost:3000`. Selenium Manager resolves ChromeDriver for the installed Chrome browser on the first run.

The suite checks that a single click opens the card without starting inline title editing, and that a double click starts inline title editing without opening the card dialog.

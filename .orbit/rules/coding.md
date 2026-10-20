# Coding rules

Preserve the existing architecture, IDs, data, and user changes. Avoid unrelated
rewrites. Validate inputs and membership at the API boundary. Use parameterized
SQL. Load only explicitly relevant context, and never read or expose secrets.

Before ad hoc SQL against Orbit, inspect `information_schema.columns`; boards and
lists use `title`, and `ai_projects` has no generic `config` column. Run API
scripts from the monorepo/workspace root or use the root `node_modules/.bin`
from `apps/api`. Host-side PostgreSQL integration tests may set
`ORBIT_TEST_DB_HOST` to the existing DEV container address; this does not start
or restart services and does not require Selenium. Before moving a card, query
the current board lists and require `archived_at IS NULL`; a historical list ID
can still exist while being unavailable to the move API. Use the exact stored
list title and board ID, including accents; never infer a list name from memory
or from another board. Cards do not carry `board_id` directly; obtain it by
joining their current list before querying a target list.

For focused TypeScript tests, invoke the root `node_modules/.bin/tsx` from the
monorepo root and pass the API tsconfig path relative to that root; if running
inside `apps/api`, use the local `tsconfig.json` path. When the DEV source
watcher detects API changes, let its build/reload finish before making API
writes. Confirm the API is responding again, then read current records before
retrying a write that may have overlapped the reload.

Before ordering checklist read-backs, inspect the schema: `checklists` has
`position` but no `created_at`; checklist items also use `position` for order.

For long, ordered board programs, process one demand at a time and persist a resumable checkpoint in `.orbit/planning/<program>/progress.json` after each completed demand or blocking finding. The checkpoint must name the active card, completed cards with verification evidence, unresolved blockers, and the single next action. Mirror material progress and blockers in the source card's comments/checklist. Never infer completion from an assistant/tool process ending; read back the card, checklist, and verification result before advancing. On a command/tool failure, capture its exact output, classify it as product, test harness, or operator setup, fix the smallest cause, create one focused correction/retry pair for actionable failures, and rerun the original failing verification before resuming. Do not create duplicate pairs for the same root cause. Keep commands bounded and report progress at each card boundary so interrupted work resumes from the checkpoint rather than restarting or silently stalling.

When invoking `checkpoint.mjs` with structured JSON from a shell, pipe a quoted heredoc to stdin rather than placing JSON in a shell argument; this avoids shell quoting corruption before `JSON.parse`.

If an `apply_patch` call reports a context/verification error, inspect the target files and `git diff` before retrying: a multi-file patch can have applied some hunks before reporting the failure. For compact one-line files, prefer a focused exact change with a uniqueness assertion, then reread the changed lines.

On every resumed turn, read the checkpoint first and reconcile it against the live card, checklist, runtime, and any outstanding tool session before waiting or repeating work. Record an `execution_checkpoint` object with `recorded_at`, `phase`, `status` (`ready`, `running`, `blocked`, or `complete`), `last_command`, `result`, `blocker`, and exactly one `next_action`. The next action must be executable now and bounded. Never leave it as “wait until service recovers” when lifecycle actions are prohibited: mark that service issue as a separate blocker, then continue independent work or name the exact external gate that prevents all remaining work. If a task is blocked, state the specific dependency, its owner/source card, and the evidence needed to unblock it; do not keep polling an unchanged condition.

Before advancing to another demand in a numbered program, run `.orbit/planning/<program>/reconcile-sequence.mjs`. Its live inventory is authoritative for the earliest incomplete item; do not select work from the prior assistant summary alone. Recheck the new card's listed prerequisites by capability evidence. If an earlier demand is incomplete, return to it and persist the reason before opening a later demand. Do not count checklist rows by joining comments directly; aggregate them per card independently.

The sequence reconciler must derive each card's explicit prerequisite IDs from its
“Pré-requisitos de implementação” section and compare them with live checklist
and completion status. A manually maintained blocker list alone cannot make a
card executable while any declared prerequisite is incomplete.

When a tool returns a live session identifier, keep polling that same session until it exits and record its final exit code; do not launch a duplicate build/test because output was truncated or delayed. If the execution session is genuinely lost, record that fact in the checkpoint and rerun only the interrupted verification once, after confirming no child process from the original command remains.

Bound every long-running shell command with an explicit timeout appropriate to the check (for example, 3 minutes for focused tests and 10 minutes for a full build). Poll a live session at least every 30 seconds and send a short progress update at each card boundary or when a check runs longer than a minute. Before starting another long check, record the current phase and command in the checkpoint. On timeout, capture the tail of that command's log, verify whether its process is still alive, save the result, and only then decide whether one controlled retry is justified. Never leave a card marked in progress without a specific next action and a persisted checkpoint.

When recording security-test evidence on cards or comments, describe the assertion and result without copying synthetic credential-shaped test strings; keep exact markers in test code/output only. This avoids false-positive rejection by the card text secret guard.

The card secret guard also treats text matching a bearer-credential example as a secret. Describe bearer authentication as a request-header mechanism without writing the word `Bearer` followed by a value or placeholder; avoid putting credential field names next to `:` or `=` in evidence.

Orbit board links may include a UUID used only to select a card after board authorization; it is not an access credential. The secret-text validator exempts only this exact internal `/board/<uuid>?card=<uuid>&token=<uuid>` URL shape. Never exempt arbitrary `token=` text or external URLs. For status-only card movement, prefer `POST /cards/move` with the active target list ID; `PATCH /cards/:id` is the content update route and legacy text validation can reject existing content.

When applying database migrations from the host, do not print or pass `DATABASE_URL` on a command line. If its Docker-only host alias is unresolved, load it from `apps/api/.env` in a wrapper, replace only the hostname with the current `orbit-db-dev` container IP, and set `ORBIT_BACKUP_DIR` to the repository's ignored persistent `backups/` folder when `/data/backups` is inaccessible on the host. Run the normal migration entry point so its pre-migration backup and post-migration seeding remain intact.

Keep Next.js development and production build artifacts isolated. `next dev` must use `.next-dev`, while `next build`/`next start` use `.next`; preserve the `ORBIT_NEXT_DIST_DIR` override. This prevents a host build from replacing manifests read by the running development server.

When embedding a shell heredoc in `functions.exec`, put the complete shell command in one JavaScript template literal and close the heredoc before closing the tool argument. If the wrapper parser rejects the call, assume no shell command ran, retry the smallest read-only check, and verify no partial mutation occurred.

For multiline work that records board evidence or JSON, save an idempotent `.mjs` script and invoke it with a short single-line `node path/to/script.mjs` command. Do not embed multiline shell bodies in `functions.exec` double-quoted strings; after a wrapper parse failure, use the saved-script path rather than repeating the inline form.

Never embed Markdown backticks or `${...}` examples in a JavaScript template literal passed to `functions.exec`; they are parsed as interpolation before the shell runs. Prefer the saved `.mjs` script path for checkpoint/progress updates so the payload is ordinary JavaScript data and independent of wrapper quoting.

For Docker environment verification, model networks by service role: the web tier should not join a database network unless the architecture explicitly requires it. Host and executor repository paths may differ; prove equivalence through the actual bind mount (`Source` = host checkout, `Destination` = executor path) and verify each database has a distinct persistent volume. Never infer a bad path from string inequality alone or rewrite runtime paths before checking the mount mapping. Report absent staging/homologation as a gap instead of treating a customer instance as staging.

Before writing an operational verifier, inspect the registered API routes and the response shape used by existing callers. Before querying live SQL tables, inspect `information_schema.columns` and use only confirmed columns. If either check fails, record one focused Orbit correction card and one retest card; correct the verifier, rerun it, and read back the evidence before closing the pair. Do not guess endpoint paths or database columns in one-off commands.

Before running a host-side database migration, map container-only paths such as `/data/backups` to the verified host mount in the command environment; do not alter the shared `.env` just for a one-off host process. Treat a configured Google connection as insufficient proof of access: require the migration's newly generated backup to have a successful cloud-copy status before accepting the migration. If upload fails, stop before applying schema and retain the encrypted local backup for recovery.

Use `.orbit/planning/<program>/plan.json` to map a demand code to its card ID; never transcribe UUIDs from progress notes. If a board mutation returns 404, resolve the ID again from the plan and exact live title, read `/cards/:id/details` through the same API, then retry once only after that read succeeds. Confirm the comment/checklist after writing so an ID typo or transient API visibility delay cannot create duplicate work or false failure reports.

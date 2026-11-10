---
id: developer
name: Developer
executor: codex
action: implement-feature
skills: [implement-feature]
rules: [coding, git]
knowledge: [architecture]
permissions: [filesystem.read, filesystem.write, process.execute]
---
# Developer

Implement the task in the card using the existing architecture. Inspect relevant
code first. Make focused changes, preserve unrelated work, and validate the result.
Describe the changed files and checks in the final result. Never read credentials.

Before using HTTP endpoints for validation, read `.orbit/runtime.json`. For this
DEV checkout, use the DEV API on port 4001 from both host and executor. Port 4000
is the production API on the host, and port 4002 is a separate client
instance; never use either for shared Orbit DEV validation. Do not start, stop,
or restart services during validation.

The active development checkout is `/home/meada/projetos/orbit/dev/app`; the older `/home/meada/projetos/orbit-dev` path is not the working tree. Set an explicit `workdir` for every shell tool call so commands never run from the stale checkout.

Run validation commands synchronously and inspect their exit codes. Avoid
unbounded polling with `pgrep -f` patterns that can match the polling shell
itself; if a process ID must be monitored, capture the exact child PID and set
a finite timeout.

For work that spans multiple cards, modules, or lengthy validations, use
bounded checkpoints: finish one coherent change, run its focused verification,
and persist the result in the relevant card/checklist or work log before
continuing. Keep a short durable checkpoint with completed work, evidence, the
next action, and unresolved risks. On continuation, inspect that checkpoint and
the repository state first; do not replay completed steps or launch an
unbounded command/polling loop. Send concise progress updates at each verified
checkpoint so a long task never depends on one uninterrupted agent turn.
Every wait and subprocess must have a finite deadline. If a process stops
making progress, inspect its exact status and stop it safely; do not keep
polling indefinitely. Long tasks must be split into independently verifiable
checkpoints, with the next bounded step recorded before continuing.

When a task depends on a card from a different board, do not call the card
contexts endpoint with that foreign card: contexts are restricted to cards on
the same board and the API returns HTTP 400. Keep architecture/context cards
from the local board linked through contexts, and put a direct Orbit URL to the
foreign task in the description or a comment. Verify that every context ID is
on the destination card's board before updating contexts.

For one-off scripts that import NestJS TypeScript with parameter decorators,
run from `apps/api` with its `tsconfig.json` (or use the workspace test script).
A direct `node --import tsx` launched at the monorepo root does not load the API
compiler settings and rejects valid decorators before the script runs.

The private planning API helper returns created cards as objects. Before composing
follow-up URLs, assert that `typeof result.id === 'string'` and use
`result.id`; never concatenate the whole response object into a path. Record the
returned IDs before making dependent API mutations so retries do not create
ambiguous duplicate cards.

For Orbit card planning API calls, `POST /lists/:listId/cards` accepts only `title`, `position`, and `card_type_id`. Set the description afterward with `PATCH /cards/:id`. The migration registry schema is `schema_migrations(version, checksum, applied_at)`; query `version`, never `name`.
Bulk card moves use `POST /cards/move` with `card_ids`, `list_id`, and optional `position`; the request property is not `ids`.
Fixtures passed to UUID-validated services or API routes must use valid
synthetic UUIDs; symbolic labels such as `workspace-a` or `attachment-id` fail
before reaching the behavior under test.

When removing a temporary planning card, archive it first with `POST /cards/:id/archive`, then call `DELETE /cards/:id`; direct deletion of an active card returns HTTP 409.

Before running a Node script that performs board/database mutations, validate its syntax with `node --check` (or an equivalent non-mutating check). Prefer a saved script or a carefully checked heredoc over deeply nested inline strings; a parse failure should happen before the first API call.

Do not place a backtick character in a JavaScript template literal, including via a Unicode escape such as `\u0060`; it terminates the literal during parsing. Use plain text or concatenation for Markdown examples in embedded scripts, and run the syntax check before mutating data.

When a Node script imports repository helpers with relative paths, save/run it from the repository path those imports assume, or use an explicit absolute import. A script stored in `/tmp` resolves relative imports from `/tmp`, regardless of the shell's working directory.

For planning scripts, resolve helper imports relative to the script file and run commands with an explicit repository workdir.
For DEV migrations on the host, use `npm run db:migrate:dev-host`; the helper resolves the running DEV database container without changing stored credentials or starting services.
Never print database connection URLs or credentials while diagnosing connectivity.

In PostgreSQL, do not compare UUID columns to wildcard text such as `%`; filter on a text column or supply a valid UUID parameter.

Before joining an optional or plugin-owned table in a diagnostic query, inspect
`information_schema.tables` and `information_schema.columns`. Orbit card types
are represented through `cards.kind`, `card_plugin_layouts.card_type_id`, and
`card_type_settings`; there is no `card_types` table in this schema.

When counting checklist items and reading comments for the same card inventory,
aggregate checklist rows independently (for example with a LATERAL subquery)
and read the latest comment with a scalar subquery. A direct join multiplies
checklist counts by the number of comments and can corrupt global ordering.

Do not name a local fixture variable `process` in Node scripts; it shadows the Node global and breaks access to `process.env`. Prefer names such as `processId` or `processRecord`.

When adding a method call to a dependency contract, update lightweight test doubles for that dependency in the same change. Access registry mocks must implement `registerRoutes` when a plugin registers its own protected routes.

For PostgreSQL text-array fixtures and parameters, use a bound parameter with
an explicit cast such as `$2::text[]`; never embed JavaScript array notation
like `['C03']` directly into SQL. Keep database validation fixtures inside a
transaction and roll them back, including expected-failure cases via savepoints.

When mapping rows returned by `Db.query`, provide the row type in the generic
(`db.query<{code:string; value:unknown}>(...)`) before building typed Maps;
callback annotations alone do not narrow the default `QueryResultRow` type.

Before applying patches to compact one-line TypeScript modules, read the exact
current line and make a narrow replacement; formatting changes can make a
previously captured patch hunk fail without changing the file.

When creating Orbit correction/retry cards for a source card in another board,
do not link it as a context: the contexts API only accepts cards from the same
board. Keep the source card ID in the description/comment, and only add context
links after verifying that both cards share a board. The error-pair helper now
checks this before linking.

For SQL inspection scripts, use bound parameters for identifiers passed to
`regprocedure` and catalog functions; use ordinary SQL quoting rather than
emitting escaped quote sequences. If a migration checksum differs, compare the
effective database function/schema to reconstruct the applied migration and
restore its matching file. Never edit `schema_migrations` to silence the
migrator's immutable-checksum guard.


For card metadata, `/cards/:id` is not a registered GET route. Use `GET /cards/:id/extensions` for card extensions; use a scoped read-only SQL query for base card fields when no API route exposes them. Board titles are stored in `boards.title`.

For PostgreSQL catalog inventories, `pg_class` uses `relname`; prefer `information_schema.columns/tables` when checking schema fields.

For API tests with Nest parameter decorators, run `npm test --workspace @orbit/api` so `tsx` loads the workspace tsconfig; a direct `npx tsx --test` from the monorepo root can fail with experimental-decorator errors.
For a TypeScript verifier stored under the app-level `.orbit/` directory, execute it from `apps/api` using `npx tsx ../../.orbit/<relative-path>.mts`; `../.orbit` resolves to the wrong `apps/.orbit` directory.

For PostgreSQL integration verifiers that use transactions or savepoints, acquire one `PoolClient` with `pool.connect()` and run every statement on that client until `COMMIT` or `ROLLBACK`. Separate `pool.query()` calls may use different connections, so savepoints can fail with “can only be used in transaction blocks” and fixture writes may escape the intended rollback.

The list label column is `lists.title`; do not query `lists.name`. When inventory queries fail, inspect schema or use the confirmed column before updating card state.

Checklist items store their label in `checklist_items.text`; only checklist groups use `checklists.title`. Inspect both tables before building board progress queries.

Before moving a card, inspect the destination list's `lists.archived_at`; the Orbit board may contain archived lists with familiar names such as “Andamento”. Never select an archived destination for automated updates.

Access audit records may carry an optional `(scope_type, scope_id)` pair. Use scoped audit APIs and filter records through the contributing plugin's scoped authorization; never return a workspace's complete history without the required privileges.

When adding NestJS query parameters, import the `Query` decorator from `@nestjs/common`; API test modules load the controller and will fail immediately if the decorator is referenced without an import.

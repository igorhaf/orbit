# Orbit account authentication

## Existing behavior before account lifecycle support

- `POST /auth/login` looked up an account by normalized email, checked its bcrypt password hash, rejected disabled accounts, and issued a 14-day JWT carrying the current `session_version`.
- `AccessService.authenticate` reloaded the account for each request and rejected disabled accounts or a stale session version. Administrative password changes already incremented the version; ROOT was excluded from account updates and remained an unconditional authorization bypass.
- `POST /auth/register` deliberately returned 403. Accounts were created by an authorized administrator with a password and optional delegable roles.
- Migrations 065–078 defined the account/RBAC state, including `is_root`, `disabled`, and `session_version`; there was no email verification or lifecycle-token storage.
- Gmail and Outlook mail plugins handled user-connected mailbox operations. SMTP settings existed, but there was no core account-message sender.

## Invitation decision

Public registration remains disabled. An actor with `access.manage` can invite an account with only roles that `AccessService.validateRoles` permits that actor to delegate. The new account remains unverified until the invitation token is completed with a password. Existing accounts remain verified by migration default, preserving their current login behavior. Verification does not grant roles; ROOT cannot be invited or recovered through this flow.

## Lifecycle guarantees

Invitation and recovery links use cryptographically random one-time tokens. Only SHA-256 token digests are stored, tokens expire after 30 minutes, and completion updates the password, marks the address verified, consumes outstanding tokens, and increments `session_version` in one transaction. Recovery responses are identical for unknown, disabled, limited, and eligible addresses. Requests are limited per normalized email digest so one address does not consume another account's allowance. Mail is delivered through SMTP configuration; missing or failed delivery invalidates the token and returns operational guidance without exposing token contents.

## Login abuse protection

Login attempts use shared PostgreSQL buckets so parallel API instances enforce the same limits. The account bucket allows five unresolved attempts per fifteen-minute window; the network-origin bucket allows twenty. Both identifiers are HMAC digests keyed with the server JWT secret, so raw e-mail and IP values are not stored. PostgreSQL advisory locks make reservations atomic under concurrency. A successful login releases only its own reservations, preserving earlier failures; expired rows are cleaned after 24 hours. Unknown accounts use the same bcrypt comparison path and response as invalid credentials for existing accounts. The API uses the connection-derived request IP and does not trust forwarded headers unless proxy trust is explicitly configured.

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

Administrators with `access.manage` can update a non-ROOT account's display name, global roles, disabled state, or password through `PATCH /access/users/:id`. Unknown fields are rejected. Each update runs transactionally, increments `session_version`, revokes the active session, and writes an audit event. E-mail changes and account deletion are not exposed by this general account-update endpoint.

## Self-service verified e-mail change

A signed-in user can request an e-mail change from the account profile. The request requires the current password, validates the normalized target address, applies rate limits, and leaves the active address untouched until a one-time 30-minute token sent to the new mailbox is confirmed. The database stores only the token digest and target address. Confirmation locks the token and account, checks uniqueness again, updates the verified e-mail and increments `session_version` atomically; outstanding account tokens are consumed and the previous session is revoked. E-mail-change tokens cannot be used with the password recovery/completion endpoint. The audit records request and completion without storing the target address as an audit detail.

An administrator with `access.manage` can request a verified e-mail change for a non-ROOT account through `POST /access/users/:id/email-change`. The service sends a one-time link to the target address, retains the current address until confirmation, rejects disabled/ROOT accounts, and writes an audit event without putting the new address in audit details. The account-management UI uses this separate flow instead of directly editing the address.

## Login and account security history

Successful logins create a per-account entry in `auth_login_history`. Only a coarse browser/platform label is retained; raw User-Agent and IP are not stored. `GET /account/login-history` returns at most 100 entries from the last 180 days. Login writes also prune rows older than 180 days and rows beyond 1,000 per account. `GET /account/security-activity` returns only allowlisted labels and timestamps for relevant account changes, never audit payloads or targets. Profile changes, password setup/recovery, and administrative password resets write their event in the same transaction as the related state change. Both histories are shown under the profile's Activity tab.

## Social sign-in and multi-factor authentication

Optional OpenID Connect providers are listed by `GET /auth/social/providers` and enabled by `ORBIT_SOCIAL_PROVIDERS` plus the provider client ID, client secret, and HTTPS issuer. Register `API_PUBLIC_URL/auth/social/<provider>/callback` at the provider. Authorization uses state, nonce, and PKCE (S256); signed ID-token claims are verified against the issuer JWKS. Social sign-in links only to an existing, active, verified Orbit account with the same normalized e-mail. It never creates an account. Apple form-post callbacks are parsed with a bounded URL-encoded body parser.

Users can enable e-mail MFA from Profile → Configurações. Enabling or disabling requires the current password and a one-time six-digit code sent to the verified address. MFA login codes expire after ten minutes, are stored only as keyed digests, are single-use, and are invalidated after five incorrect attempts, session-version changes, or expiration. Social login applies the same MFA challenge before issuing a session. SMTP must be configured for MFA delivery. Relevant changes are written to the account security audit and displayed in the profile's security activity.

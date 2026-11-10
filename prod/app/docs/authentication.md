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

## User-visible access and account security history

Successful logins append a row to `auth_login_history` through migration `156_auth_login_history.sql`. The server stores only a coarse browser/platform label; it does not persist the raw User-Agent or IP. `GET /account/login-history` returns at most 100 entries for the authenticated account, limited to 180 days. On each successful login, rows older than 180 days and rows beyond the newest 1,000 per account are removed. Failed attempts are not shown in this history.

`GET /account/security-activity` returns labels for an explicit allowlist of relevant account events from the previous 180 days. It does not expose audit targets or event details. Profile changes and password setup/recovery are recorded in `access_audit` atomically with the corresponding account change. Both histories appear in the profile's activity view.

## Optional OIDC login

The sign-in page lists only the OIDC providers configured through `ORBIT_SOCIAL_PROVIDERS` and the matching `ORBIT_OAUTH_<PROVIDER>_CLIENT_ID`, `CLIENT_SECRET`, and `ISSUER` settings. The issuer must publish HTTPS OpenID Connect metadata, and `API_PUBLIC_URL` must be the public API origin used to register `/auth/social/<provider>/callback`. The API uses authorization code with PKCE (S256), one-time state and nonce values, verifies the signed ID token against provider JWKS, and accepts only verified e-mail addresses that match an existing verified Orbit account. Social login does not create accounts or grant roles. Apple uses `form_post`; the API parses that content type only on `/auth/social` and enforces a 16 KiB body limit.

The callback returns session material in the browser URL fragment, removes it from the address bar immediately, and stores it through the same session helper as password login. Fragments are not sent in HTTP requests or referrer headers. If the account has MFA enabled, social login issues the same one-time e-mail challenge as password login and does not issue a session until that challenge succeeds.

## E-mail MFA

Users can enable or disable the second factor in the account profile. A change requires the current password and a six-digit code sent to the account's verified e-mail. Login codes expire after ten minutes, are stored only as HMAC digests, are bound to the current session version, allow at most five failed attempts, and are consumed exactly once. Code issuance is serialized and capped at five per account, purpose, and rolling hour; committed challenges count even when SMTP delivery fails. Social login follows the same MFA step. Migrations `157_auth_mfa.sql` and `158_auth_mfa_session_version.sql` add the challenge store and account flag; the flow requires working SMTP delivery. Requests and confirmations are rate limited by account and request origin.

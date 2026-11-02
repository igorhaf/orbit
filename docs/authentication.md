# Orbit account authentication

## Optional email second factor

Users can enable or disable a second login factor from their profile after re-entering the current password. The change is confirmed with a six-digit code sent to the verified account email. Once enabled, a correct password starts a short-lived login challenge; the API returns no access token until the email code is confirmed. Challenges are single use, expire after ten minutes, keep only a server-keyed digest of the code, allow at most five guesses, and are invalidated by a session-version change. At most five codes per account and purpose can be issued in a rolling hour; issuance is serialized in PostgreSQL and failed mail sends count toward the cap. Only one unconsumed challenge per account/purpose remains valid, even for concurrent requests. Requests and confirmations use the shared identity/origin rate limiter. Login history is recorded only after both factors succeed. The account setting is stored in `users.mfa_enabled`; disablement requires the current password and a fresh email code.

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

## Successful login history

Successful password, MFA, and social logins append to `auth_login_history`, scoped to the account. Migration `146_auth_login_history.sql` creates the table and index. The server stores a coarse browser/operating-system label derived from the User-Agent and does not persist the IP address or the raw User-Agent. `GET /account/login-history` returns only the authenticated account's 100 most recent entries. Rows older than 180 days and entries beyond the 1,000-row per-account cap are pruned on login. Failed attempts remain represented by the privacy-preserving rate-limit buckets rather than a user-readable access history.

The profile also shows `GET /account/security-activity`, a minimized view of the authenticated account's relevant security events from the last 180 days. It allowlists profile/access changes, password setup/change/reset, self-service e-mail changes, MFA changes, and social identity linking; it returns only localized labels and timestamps, never audit targets or payloads. Self-service profile updates, password setup/change, and administrator access/password changes write their audit events in the same transaction as the underlying change.

Administrators with `access.manage` can update a non-ROOT account's display name, global roles, disabled state, or password through `PATCH /access/users/:id`. Unknown fields are rejected. Each update runs transactionally, increments `session_version`, revokes the active session, and writes an audit event. E-mail changes and account deletion are not exposed by this general account-update endpoint.

## Self-service verified e-mail change

A signed-in user can request an e-mail change from the account profile. The request requires the current password, validates the normalized target address, applies rate limits, and leaves the active address untouched until a one-time 30-minute token sent to the new mailbox is confirmed. The database stores only the token digest and target address. Confirmation locks the token and account, checks uniqueness again, updates the verified e-mail and increments `session_version` atomically; outstanding account tokens are consumed and the previous session is revoked. E-mail-change tokens cannot be used with the password recovery/completion endpoint. The audit records request and completion without storing the target address as an audit detail.

An administrator with `access.manage` can request a verified e-mail change for a non-ROOT account through `POST /access/users/:id/email-change`. The service sends a one-time link to the target address, retains the current address until confirmation, rejects disabled/ROOT accounts, and writes an audit event without putting the new address in audit details. The account-management UI uses this separate flow instead of directly editing the address.

## OpenID Connect social sign-in

`POST /auth/social/:provider/start` initiates an OpenID Connect Authorization Code flow. Providers are allowlisted with `ORBIT_SOCIAL_PROVIDERS`; each uses `ORBIT_OAUTH_<PROVIDER>_CLIENT_ID`, `CLIENT_SECRET`, and `ISSUER`. The API reads discovery metadata from the configured HTTPS issuer, uses a single registered callback derived from `API_PUBLIC_URL`, and requires HTTPS outside localhost. It creates a one-use, ten-minute state record and transaction-specific nonce and PKCE verifier; only the state digest is stored. Token exchange uses the verifier, and the ID token is checked against the issuer's JWKS with RS256, issuer, audience/authorized party, expiry, issued-at, nonce, subject, and `email_verified` claims. The callback accepts query responses over GET and bounded `application/x-www-form-urlencoded` POST responses for providers such as Apple; its parser is scoped to the social callback path and limited to 16 KiB.

Social sign-in does not create or elevate Orbit accounts. On first sign-in, the verified provider email must exactly match an already verified Orbit account; the provider subject is then linked to that account and audited. Subsequent sign-ins use the linked issuer/subject, so an email change at the provider cannot silently relink the identity. Disabled or unverified Orbit accounts are rejected. An Orbit account with e-mail MFA enabled must complete its existing one-time e-mail challenge before a session is issued. Login history is recorded only after the MFA step succeeds.

For Google, register `{API_PUBLIC_URL}/auth/social/google/callback`, set `ORBIT_SOCIAL_PROVIDERS=google`, and provide the client ID/secret and issuer `https://accounts.google.com`. Microsoft Entra can use a tenant-specific issuer such as `https://login.microsoftonline.com/{tenant-id}/v2.0`; register the corresponding provider callback. `GET /auth/social/providers` returns only providers whose required configuration is present. The login screen hides social buttons when none are configured. OAuth state, verifier, nonce and subject bindings are persisted in `auth_social_states` and `auth_social_identities` by migration `154_auth_social_login.sql`.

Apple Sign in can also be enabled as `apple` with issuer `https://appleid.apple.com` and its Services ID as the client ID. Supply the current Apple client-secret JWT as `ORBIT_OAUTH_APPLE_CLIENT_SECRET`; Apple requires operators to rotate that signed client secret before its expiry. The verifier accepts the provider's ES256 signatures and string-form `email_verified` claim as well as RS256 and boolean claims used by other OIDC providers.

## OpenID Connect references

The implementation follows the OAuth security baseline in [RFC 9700](https://datatracker.ietf.org/doc/rfc9700/), Google's [OpenID Connect documentation](https://developers.google.com/identity/openid-connect/openid-connect), Microsoft's [OIDC protocol documentation](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc), and Apple's [Sign in with Apple platform integration](https://developer.apple.com/documentation/signinwithapple/incorporating-sign-in-with-apple-into-other-platforms?changes=_6) and [client-secret JWT guidance](https://developer.apple.com/documentation/accountorganizationaldatasharing/creating-a-client-secret?changes=__3_10).

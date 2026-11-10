# Orbit security controls validated in DEV

## Authentication and request origin

- Login uses parameterized account lookup, the same password-comparison path for unknown accounts, and shared PostgreSQL failure buckets keyed by HMAC. The account and network-origin limits are reserved atomically so concurrent API instances cannot exceed them.
- API sessions are bearer JWTs in the `Authorization` header. `AccessService` reloads the account and checks the server-side `session_version` on every authenticated request. The API CORS allowlist is the configured `WEB_ORIGIN`; it does not authorize a caller or replace resource-level permission checks.
- The limiter uses the connection-derived request IP. Do not trust forwarded headers unless a specific trusted proxy is configured.
- Login, recovery, credential-link completion, invitations, card/comment attachment uploads, search queries, and Alexa requests use operation-specific PostgreSQL rate-limit buckets. Identity and origin scopes are independent; rejected requests return HTTP 429 and `Retry-After`, except recovery keeps its uniform success response to avoid account enumeration. Defaults can be adjusted with the `ORBIT_RATE_LIMIT_*` settings.
- Forwarded client addresses are ignored by default. `ORBIT_TRUSTED_PROXY_CIDRS` accepts only explicitly trusted proxy networks; direct clients cannot evade an origin limit by supplying a forwarded-address header. A trusted proxy must overwrite or append its verified client address to the forwarded chain. Configure only the actual proxy CIDRs before enabling it, then restart the API through the normal deployment workflow.
- Request buckets store HMAC digests rather than raw email addresses, user IDs, or IP addresses; old buckets are removed in small batches after 24 hours. Each operation has separate scopes, so exhausting one identity or endpoint does not block unrelated actors or operations.

## User-supplied HTML

- Notebook and vault rich text is sanitized before persistence with `sanitize-html` and explicit tag, attribute, style, and URL-scheme allowlists. Active SVG/HTML, event attributes, executable URL schemes, protocol-relative URLs, and unsafe CSS are discarded.
- Keep the allowlist narrow. Any new rich-text feature needs a regression test for both its safe format and its active-content variants.

## Generic document uploads

- The independent `documents` plugin validates PDF, PNG, JPEG, UTF-8 text, DOCX and XLSX, with an 8 MB limit, safe names, format signatures and SHA-256 hashes.
- Private versioned bytes remain in the database; downloads recheck workspace permission and use private `no-store` responses.
- Malware scanning is optional and configured in the plugin through `ORBIT_DOCUMENT_SCANNER_BIN`; when configured, errors, timeouts and unavailable scanners fail closed, and unconfigured scans are explicitly marked `not_configured`.
- Anonymized variants reference the original version and require independent review before publication.
- A malware scan does not establish the correctness or trustworthiness of a document.

## Alexa request verification

- Alexa requests retain their exact raw body for signature verification. The endpoint checks the configured skill/user identity, the 150-second timestamp window, the certificate URL allowlist, the certificate SAN/validity/trust chain, and the SHA-256 RSA signature using Node's native crypto.
- Certificate downloads reject redirects, are time-limited and size-limited, and are cached only until the earlier of one hour or certificate expiry. No signature-verification bypass is allowed in production.

## Dependency audit scope

- `npm audit --omit=dev` must pass before a security-sensitive release.
- At this checkpoint, production dependencies have no known audit findings. The full development dependency audit still reports five high-severity findings in the ESLint/fast-glob/braces chain; npm's proposed fix requires a breaking downgrade of `eslint-config-next`, so do not apply `npm audit fix --force` without a dedicated compatibility change and test run.

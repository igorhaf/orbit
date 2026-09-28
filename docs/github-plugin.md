# GitHub plugin

GitHub is an account-scoped Orbit plugin. Cards remain provider-neutral and relate to repositories, issues, pull requests, branches, and commits through `ExternalResource` records.

## Authentication decision

Orbit uses a GitHub App rather than a classic OAuth App or personal access token. A GitHub App provides repository-level installation access, short-lived installation tokens, granular permissions, and signed webhooks. User-to-server tokens are used for actions performed on behalf of a person; installation tokens are used for app automations when an `installationId` is present on the connection. Both token types are encrypted by `SecretVault` and never sent to the browser or logs.

Configure `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `GITHUB_WEBHOOK_SECRET`. The callback URL is `${API_PUBLIC_URL}/github/oauth/callback` and the webhook URL is `${API_PUBLIC_URL}/github/webhook`.

Grant only the repositories needed by Orbit. The feature set uses these repository permissions:

- Metadata: read
- Contents: read/write for branches and Git-backed execution
- Issues: read/write
- Pull requests: read/write
- Checks: read

Subscribe to Issues, Pull request, Pull request review, and Check suite/run events. Orbit verifies `X-Hub-Signature-256`, deduplicates `X-GitHub-Delivery`, normalizes the payload, updates linked resources, and publishes only normalized events to the existing Event Bus.

## Capabilities

The plugin publishes repository, issue, branch, and pull-request actions through the Plugin Registry. Agents and executable Cards discover those actions from the same catalog used by every other plugin. Explicit execution permissions are required for reads and writes.

Card-to-Issue and Card-to-Pull-Request operations create an `ExternalResource`; linking an existing Issue or Pull Request does the same without duplicating either side. Webhooks refresh status, merge state, and review metadata without adding GitHub-specific columns to Cards.

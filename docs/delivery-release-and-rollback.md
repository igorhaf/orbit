# Release gates and rollback for Delivery Pipelines

Orbit Delivery coordinates configured project repositories, branches, environments, checks, approvals, and provider runs. A run in normal mode executes steps in order; a failed step with the `stop` policy marks the run failed and leaves later deploy/promotion steps pending. A deployment begins only when its step is reached. The pipeline history records each step and approval.

## Prepare a release

1. Select only repositories and branches already configured for the project. Configure separate targets for development, staging, and production; each target must name its environment, repository, remote, permitted branch, build commands, and health checks.
2. In the pipeline, run static checks and tests first. Add a schema compatibility check and image build check as `test.run` or `command.execute` steps. Keep migrations backward compatible with the currently deployed image.
3. Run the verified backup step before any migration. Confirm the manifest, checksum, and required cloud delivery. A local-only backup is not sufficient for loss of the host.
4. Apply additive migrations, deploy to the next environment, then run its health checks. Require a separate approval step before promotion to the next environment.
5. Store provider credentials in the credential vault by reference. Never put secrets in step configuration, command output, or logs.

## Roll back safely

- If a check fails before deployment, stop the run; the later deployment step must remain pending. Fix the release and run it again.
- If code is deployed but the schema change is additive, roll back to the last known-good configured revision and retain the compatible schema.
- If a migration has changed or removed data, do not delete migration history or restore over a live database. Prefer a forward-fix. Test any data recovery in a new, isolated `orbit_restore_*` database, verify it, and only then plan an explicitly approved cutover.
- Do not use a branch outside project configuration. Do not run a production promotion or restart without an explicit operator approval recorded in the pipeline.

## Demo boundary and current limits

The isolated integration suite verifies Git, deploy, tests, approvals, promotion, provider status adapters, retries, and that a failing test prevents the following deployment step. The suite uses temporary local repositories and test databases without publishing or restarting an Orbit instance. GitHub Actions, GitLab CI/CD, and Bamboo adapters were exercised with mocked responses. Schema/image compatibility remains an explicit pipeline check supplied by the project; Orbit does not infer database compatibility from arbitrary migrations. A production rollback and a remote provider run have not been exercised.

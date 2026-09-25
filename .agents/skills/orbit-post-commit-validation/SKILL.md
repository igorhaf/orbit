---
name: orbit-post-commit-validation
description: Validate Orbit after every user-requested commit by rebuilding, restarting the application, and running unit tests; repair failures and repeat until verification passes.
---

# Orbit post-commit validation

Use this skill after every commit the user explicitly requests in this repository. It does not authorize creating a commit, staging files, or changing branches. Follow `../orbit-git-conventions/SKILL.md` for authorized Git actions.

## Validation loop

1. Run `npm run build` from the repository root. Fix build failures and rebuild.
2. Restart the application instances managed for this task so the running processes use the current code. For development, the repository command is `npm run dev`; for a compiled run, start the API and web workspaces with their `start` scripts. Do not stop unrelated processes. Check that the servers start, and check the API at `GET /health` when it is reachable.
3. Run the unit test command configured by the repository, including both workspaces when applicable. Check the exit status and investigate failures; do not treat an absent test script or an empty suite as a passing test run.
4. If any build, startup, health check, or unit test fails, fix the cause and repeat the build, restart, and test cycle. Verify the final code state, including any fixes made after the commit.

The repository currently has no unit test script in its package manifests. If that is still true when this skill runs, report that unit tests could not be verified. Add a test setup only when it is within the user's requested work; never claim the full validation passed without executing real unit tests.

If an external prerequisite such as PostgreSQL, environment variables, or a required service is unavailable, report the exact blocked check and evidence. Do not report success for a check that did not run. If post-commit fixes are needed, keep them within the user's requested scope and follow the repository's explicit commit authorization rule before staging or committing them.

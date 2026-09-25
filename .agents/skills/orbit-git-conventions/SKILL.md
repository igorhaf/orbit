---
name: orbit-git-conventions
description: Apply Orbit's English branch naming and Conventional Commits rules when the user explicitly requests a branch or commit in this repository.
---

# Orbit Git conventions

Use this skill only for Git branch and commit work in the Orbit repository.

## Authorization

- Create or rename a branch only when the user explicitly asks for that action.
- Stage files and create a commit only when the user explicitly asks for a commit. A request to create a branch does not authorize a commit, and a request to implement a change does not authorize either action.
- If a requested Git action needs a name or message and none was provided, choose one from the actual work using the rules below. If a suggested name or message does not match the convention, adapt it while preserving its meaning and report the final value.

## Branch names

- Use a lowercase English name in the form `<prefix>/<short-kebab-case-description>`.
- Choose the prefix that describes the work: `feature/`, `fix/`, `hotfix/`, `docs/`, `refactor/`, `test/`, `chore/`, `build/`, `ci/`, or `perf/`.
- Keep the description concise and specific. Example: `feature/add-card-labels`.

## Commit messages

- Use Conventional Commits in the form `<type>: <short description>`.
- Write exactly one line in English, with a lowercase imperative description and no trailing period or body.
- Choose the type that describes the change: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `build`, `ci`, or `perf`. Example: `feat: add card labels`.

## Pull requests

- Write pull request titles in English using the same Conventional Commits format as commit messages: `<type>: <short description>`.
- Every pull request must include a short description in English summarizing the change. Start the description with the matching conventional type, such as `feat:` or `fix:`.
- Start any agent-authored pull request comment with the matching conventional type, such as `feat:` or `fix:`. Keep descriptions and comments concise and focused on the change.

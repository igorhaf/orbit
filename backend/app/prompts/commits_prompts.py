"""
Prompt constants for commits domain.
Auto-generated from YAML files in backend/app/prompts/commits/
"""

# ---------------------------------------------------------------------------
# commits/commit_message.yaml
# ---------------------------------------------------------------------------

COMMIT_MESSAGE_SYSTEM = """REGRA GERAL: NUNCA use emojis ou símbolos especiais nas respostas.
"""

COMMIT_MESSAGE_USER = """Generate a professional git commit message following Conventional Commits specification.

TASK INFORMATION:
Title: {{ task_title }}
Description: {{ task_description | default('No description') }}
Status: {{ task_status }}

CHANGES MADE:
{{ changes }}

CONVENTIONAL COMMIT TYPES:
- feat: New feature
- fix: Bug fix
- docs: Documentation only
- style: Code style/formatting (no logic change)
- refactor: Code refactoring
- test: Adding tests
- chore: Maintenance, dependencies
- perf: Performance improvement

FORMAT:
type(scope): subject

RULES:
1. Subject in lowercase
2. No period at end
3. Maximum 72 characters
4. Be specific and clear
5. Use English
6. Use imperative mood (e.g., "add" not "added")

EXAMPLES:
- feat(auth): implement JWT authentication
- fix(api): resolve database connection timeout
- docs(readme): update installation guide
- refactor(user): simplify profile update logic
- perf(query): optimize database indexes

RESPONSE FORMAT (JSON):
{
  "type": "feat",
  "scope": "auth",
  "subject": "implement JWT authentication",
  "description": "Brief explanation of what was done"
}

Generate the commit message based on the task and changes above.
Return ONLY the JSON, no markdown or extra text.
"""

# ---------------------------------------------------------------------------
# PROMPTS registry
# ---------------------------------------------------------------------------

PROMPTS = {
    "commits/commit_message": {
        "system": COMMIT_MESSAGE_SYSTEM,
        "user": COMMIT_MESSAGE_USER,
        "usage_type": "commit_generation",
    },
}

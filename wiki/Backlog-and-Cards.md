# Backlog & Cards

Cards represent work items in a hierarchical structure: **Epic > Story > Task > Bug**.

## Card Types

| Type | Description | Typical Points |
|------|-------------|---------------|
| Epic | High-level feature or domain | 13-21 |
| Story | User-facing functionality | 3-8 |
| Task | Technical implementation unit | 1-5 |
| Bug | Defect or issue | 1-3 |

## Card Fields

| Field | Type | Description |
|-------|------|-------------|
| title | Text | Card title (AI-suggestible) |
| description | Text | Markdown description (AI-editable) |
| item_type | Enum | epic, story, task, bug |
| status | Enum | backlog, todo, in_progress, review, done, blocked |
| priority | Enum | critical, high, medium, low, trivial |
| complexity | Enum | low (Haiku), medium (Sonnet), high (Opus) |
| story_points | Integer | Fibonacci scale |
| acceptance_criteria | JSON[] | List of criteria |
| labels | JSON[] | Tags/categories |
| parent_id | UUID | Parent card (hierarchy) |
| generated_prompt | Text | AI-generated execution prompt |
| created_by_ai_model | Text | Which AI model generated content |

## AI Operations on Cards

All card content is editable only through AI:

| Operation | Endpoint | Description |
|-----------|----------|-------------|
| Generate Description | `POST /tasks/{id}/generate-description` | Create description from title |
| Expand (Detalhar) | `POST /tasks/{id}/expand-description` | Add more detail |
| Summarize (Resumir) | `POST /tasks/{id}/summarize-description` | Condense text |
| Rephrase (Reformular) | `POST /tasks/{id}/rephrase-description` | Different wording |
| Suggest Title | `POST /tasks/suggest-title` | AI-improved title |
| Generate Prompt | `POST /tasks/{id}/generate-semantic-prompt` | Execution prompt |

## Card Generation Sources

Cards are created from:
1. **Deep Pipeline** (Phase 4) — Automated from codebase analysis
2. **Interviews** — From conversation insights
3. **Manual** — User creates directly
4. **Hierarchy Generation** — AI decomposes parent into children

## Workflow States

```
backlog → todo → in_progress → review → done
                                      → blocked (with reason)
```

## Human Data Protection (REGRA #0)

If a human manually edits a card's description or prompt:
- `description_edited_by` is set to `"human"`
- AI operations will **not** overwrite the field
- AI can still be used explicitly via UI buttons

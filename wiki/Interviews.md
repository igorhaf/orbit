# Interview System

The interview system is a conversational AI that captures project requirements through structured Q&A sessions.

## How It Works

1. **Create Interview** — Linked to a project, optionally to a specific card
2. **Fixed Questions** — System asks pre-defined stack/architecture questions
3. **Dynamic Questions** — AI generates follow-up questions based on answers
4. **Card-Focused Questions** — Deep-dive into specific card requirements
5. **Hierarchy Generation** — Transform interview into Epic > Story > Task cards

## Interview Modes

| Mode | Purpose |
|------|---------|
| `open` | Free-form conversation |
| `card_focused` | Deep-dive into a specific card |
| `context` | Project context gathering |
| `task_orchestrated` | Task-specific requirements |

## Question Types

- **Fixed Questions**: Pre-defined questions about project type, stack, modules, architecture
- **Dynamic Questions**: AI-generated based on previous answers and project context
- **Options**: Multiple-choice answers with AI-suggested options
- **Free Text**: Open-ended responses

## Context Building

Each AI question is enriched with:
- Project description and stack info
- Previous interview answers
- RAG search results (business rules, code patterns)
- Parent card context (for card-focused interviews)

## Card Generation

After completing an interview, cards are generated:
1. Interview insights extracted
2. Hierarchy generated: Epics → Stories → Tasks
3. Acceptance criteria created per card
4. Cards linked back to interview source

## API Endpoints

```
POST /api/v1/interviews                    — Create interview
GET  /api/v1/interviews/{id}               — Get interview
POST /api/v1/interviews/{id}/messages      — Send message
POST /api/v1/interviews/{id}/generate-hierarchy — Generate cards
```

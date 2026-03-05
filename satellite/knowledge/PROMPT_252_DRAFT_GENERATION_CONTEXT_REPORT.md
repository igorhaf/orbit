# PROMPT #252 - Draft Generation Full Context (Dedup + Hierarchy + Wiki)

## Objective
Fix draft card generation to avoid duplicates by passing existing children, full hierarchy, and wiki context to the AI when generating new suggested cards.

## Problem
When generating draft tasks for a story (e.g., "Chain Fallback & Error Recovery"), the AI had no awareness of:
1. **Existing children** - Generated duplicates of already-existing closed tasks
2. **Full hierarchy** - No Epic → Story chain context
3. **Wiki knowledge** - Relevant wiki pages not passed to the AI

This caused 10 generic/duplicate draft cards across 2 stories.

## What Was Implemented

### 1. Three New Context Builders (`draft_generator.py`)
- `_build_existing_children_text()`: Queries existing children of a card, formats as dedup list
- `_build_full_hierarchy_text()`: Walks up the parent chain to build full hierarchy
- `_build_wiki_context_text()`: Searches wiki pages by keyword overlap, returns top 3 relevant pages

### 2. Updated YAML Prompts
Both `stories_from_epic.yaml` and `tasks_from_story.yaml` now accept:
- `existing_children_text`: List of existing children with status and description
- `full_hierarchy_text`: Full hierarchy from project root to current card
- `wiki_context_text`: Relevant wiki page content for domain context

### 3. Prompt Instructions
Added explicit dedup instructions:
- "NÃO gere Stories/Tasks similares ou duplicadas"
- "Gere APENAS Stories/Tasks NOVAS que complementem as existentes"
- Wiki context instruction: "Use este contexto da wiki para gerar cards mais relevantes"

### 4. Database Cleanup
- Deleted 5 duplicate draft tasks under "Chain Fallback & Error Recovery"
- Deleted 5 generic draft tasks under "AIOrchestrator Core Engine"
- Total: 10 garbage draft cards removed

## Files Modified

| File | Change |
|------|--------|
| `backend/app/services/context_generator/draft_generator.py` | Added 3 context builder functions, integrated into both story and task generation |
| `backend/app/prompts/backlog/stories_from_epic.yaml` | Added 3 optional variables + dedup/wiki sections in user_prompt |
| `backend/app/prompts/backlog/tasks_from_story.yaml` | Added 3 optional variables + dedup/wiki sections in user_prompt |

## How It Works Now

When generating children for a story like "Chain Fallback & Error Recovery":

1. **Query existing children**:
   ```
   - [CLOSED] GPU OOM detection e provider skip: Implementar deteccao de erros...
   - [CLOSED] Rate limiter sliding window: Implementar o rate limiter...
   - [CLOSED] Implementar chain fallback resolution: Implementar resolucao...
   ```

2. **Build full hierarchy**:
   ```
   - [EPIC] Orquestração Multi-Provider de IA
     - [STORY] Chain Fallback & Error Recovery (ATUAL)
   ```

3. **Find relevant wiki pages**:
   ```
   ### Wiki: orquestracao-ia
   [content about AI orchestration...]

   ### Wiki: rate-limiting
   [content about rate limiting...]
   ```

4. **AI receives all context** and generates only NEW, non-duplicate tasks.

## Testing Results
- Backend restarted successfully with new code
- Hierarchy endpoint returns 3 correct closed tasks (no duplicates)
- Zero draft cards remaining in database

## Status
COMPLETED - Draft generation now has full context awareness.

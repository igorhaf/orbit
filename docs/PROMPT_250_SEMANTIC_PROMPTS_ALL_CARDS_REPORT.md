# PROMPT #250 - Semantic Prompts & Acceptance Criteria for All 138 Cards

## Objective
Generate rich, structured semantic prompts and acceptance criteria (Given/When/Then) for ALL 138 cards in the ORBIT project, and update the system to extract and persist ACs from generated prompts.

## What Was Implemented

### 1. YAML Contract Update (card_semantic_prompt.yaml)
- Added CRITERIOS DE ACEITACAO section with mandatory Given/When/Then format
- Minimum 3, maximum 8 criteria per card
- Criteria must be concrete and verifiable

### 2. AC Extraction in orbit_integration.py
- Added logic to parse acceptance criteria from generated prompt text
- Extracts Given/When/Then formatted lines from the CRITERIOS section
- Saves extracted ACs to `task.acceptance_criteria` column (JSON array)
- Respects REGRA #0: only fills if no human-edited criteria exist

### 3. Semantic Prompts for All 138 Cards
All prompts generated directly by Claude Code with consistent structure:

| Section | Description |
|---------|-------------|
| OBJETIVO | 1-3 sentences: what to do and why |
| CONTEXTO | Where it fits in the system, parent references |
| REQUISITOS TECNICOS | Numbered list of technical requirements |
| ARQUIVOS E COMPONENTES | Files/components to create or modify |
| STACK E PADROES | Technologies and patterns to follow |
| CRITERIOS DE ACEITACAO | 3-5 Given/When/Then criteria |

### Card Breakdown
| Type | Count | Avg Prompt Length | ACs Generated |
|------|-------|-------------------|---------------|
| Epic | 14 | ~2,487 chars | 14 (100%) |
| Story | 33 | ~1,613 chars | 33 (100%) |
| Task | 91 | ~1,552 chars | 91 (100%) |
| **Total** | **138** | **~1,680 chars** | **138 (100%)** |

### 4. Model Configuration
- Reverted semantic prompt model to qwen3:14b (per user directive)
- Increased Ollama timeout from 300s to 600s
- Increased connect timeout from 15s to 30s
- Reduced batch size from 3 to 2 for stability

## Files Modified
| File | Change |
|------|--------|
| `backend/app/contracts/pipeline/card_semantic_prompt.yaml` | Added Given/When/Then AC section |
| `backend/app/api/routes/tasks/orbit_integration.py` | Added AC extraction, reverted to qwen3:14b |
| `scripts/generate_all_semantic_prompts.py` | Updated batch size and timeouts |

## Database Updates
- 138 cards: `generated_prompt` populated with structured prompt
- 138 cards: `acceptance_criteria` populated with Given/When/Then criteria (JSON array)
- All updates set `prompt_edited_by = 'ai'`

## Testing Results
- Tested with card "Orquestração Multi-Provider de IA" — prompt + ACs generated correctly
- Verified AcceptanceTab.tsx displays extracted ACs properly
- All 138 cards verified: 0 missing prompts, 0 missing ACs

## Status
COMPLETED - All 138 cards have rich semantic prompts and acceptance criteria.

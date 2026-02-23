# PROMPT #258 - Corrigir Fluxos AI Flow + Externalizar Prompts Hardcoded

## Objective

Fix the AI Flow diagram so each operation shows the correct contracts, remove phantom operations, and externalize 7 hardcoded prompts from Python code into YAML contracts in the database.

## What Was Implemented

### Step 1: Remove Phantom Operation
- Removed `queue_orchestration` from `USAGE_TYPE_OPTIONS` in FlowConstants.ts (no backend code uses it, no contracts exist)

### Step 2: Add Missing UsageTypes to Backend
- Added `rag_extraction` and `content_generation` to the `UsageType` Literal in `satellite_logger.py`
- These were already used at runtime by `rag_pipeline.py` but not declared in the type

### Step 3: Fix usage_type of 17 Existing YAML Contracts

**3a. Corrected wrong mappings (4 files):**
- `memory/pattern_discovery.yaml`: `prompt_generation` -> `pattern_discovery`
- `pipeline/card_hierarchy.yaml`: `memory` -> `content_generation`
- `pipeline/context_merge.yaml`: `memory` -> `content_generation`
- `pipeline/wiki_page.yaml`: `memory` -> `content_generation`

**3b. Data config contracts isolated (13 files):**
- 8x `business/*.yaml`: `business_rule` -> `_config`
- 3x `execution/*.yaml`: `business_rule` -> `_config`
- `validation/response_rules.yaml`: `business_rule` -> `_config`
- `pipeline/validation_rules.yaml`: `validation` -> `_config`

### Step 4: Created 7 New YAML Contracts from Hardcoded Prompts

**From rag_pipeline.py (5 contracts):**
1. `pipeline/rag_rules_extraction.yaml` - Phase 2 business rules extraction (usage_type: `rag_extraction`)
2. `pipeline/cards_epic_generation.yaml` - Phase 3 epic generation (usage_type: `content_generation`)
3. `pipeline/cards_detail_generation.yaml` - Phase 3 stories/tasks generation (usage_type: `content_generation`)
4. `pipeline/wiki_overview_generation.yaml` - Phase 4 wiki overview (usage_type: `content_generation`)
5. `pipeline/wiki_domain_generation.yaml` - Phase 4 wiki domain pages (usage_type: `content_generation`)

**From backlog_generator.py (2 contracts):**
6. `generation/stories_decomposition.yaml` - Epic->Stories decomposition (usage_type: `prompt_generation`)
7. `generation/tasks_decomposition.yaml` - Story->Tasks decomposition (usage_type: `prompt_generation`)

### Step 5: Updated rag_pipeline.py to Use ContractLoader
- Added `ContractLoader` import and initialization in `__init__`
- Added `_load_contract_prompt()` helper with graceful fallback
- Replaced 5 hardcoded prompt references with ContractLoader calls (with fallback to class constants)

### Step 6: Updated backlog_generator.py to Use ContractLoader
- Added `ContractLoader` import and initialization in `__init__`
- Replaced 2 hardcoded system_prompt definitions with ContractLoader calls (with fallback)

### Step 7: Re-ran Seed Script
- All 80 contracts in database (7 new + 73 updated)
- usage_type distribution verified correct

## Files Modified/Created

### Created
- `backend/app/contracts/pipeline/rag_rules_extraction.yaml`
- `backend/app/contracts/pipeline/cards_epic_generation.yaml`
- `backend/app/contracts/pipeline/cards_detail_generation.yaml`
- `backend/app/contracts/pipeline/wiki_overview_generation.yaml`
- `backend/app/contracts/pipeline/wiki_domain_generation.yaml`
- `backend/app/contracts/generation/stories_decomposition.yaml`
- `backend/app/contracts/generation/tasks_decomposition.yaml`

### Modified
- `frontend/src/components/ai-flow/FlowConstants.ts` - Removed queue_orchestration
- `backend/app/services/ai_orchestrator/satellite_logger.py` - Added rag_extraction, content_generation to UsageType
- `backend/app/contracts/memory/pattern_discovery.yaml` - Fixed usage_type
- `backend/app/contracts/pipeline/card_hierarchy.yaml` - Fixed usage_type
- `backend/app/contracts/pipeline/context_merge.yaml` - Fixed usage_type
- `backend/app/contracts/pipeline/wiki_page.yaml` - Fixed usage_type
- `backend/app/contracts/pipeline/validation_rules.yaml` - Fixed usage_type
- `backend/app/contracts/validation/response_rules.yaml` - Fixed usage_type
- 8x `backend/app/contracts/business/*.yaml` - Changed to _config
- 3x `backend/app/contracts/execution/*.yaml` - Changed to _config
- `backend/app/services/rag_pipeline.py` - ContractLoader integration (5 prompts)
- `backend/app/services/backlog_generator.py` - ContractLoader integration (2 prompts)

## Testing Results

- Backend: Loads successfully without errors
- TypeScript: No new errors (all pre-existing)
- Seed: 80 contracts in database (7 created, 73 updated)
- Usage type distribution verified:
  - _config: 13 | commit_generation: 1 | content_generation: 7
  - general: 3 | interview: 27 | memory: 5
  - pattern_discovery: 1 | prompt_generation: 22 | rag_extraction: 1

## Status

**COMPLETED** - All 8 steps implemented successfully.

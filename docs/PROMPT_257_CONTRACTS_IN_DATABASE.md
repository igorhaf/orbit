# PROMPT #257 - Contracts in Database + Visual Nodes in AI Flow

## Objective

Migrate all 73 YAML-based contracts (prompts, business rules, configs) from disk files to PostgreSQL, display them as visual nodes in the AI Flow diagram, and eliminate the separate /contracts page.

## What Was Implemented

### Etapa 1: SQLAlchemy Contract Model + Migration
- Created `backend/app/models/contract.py` with full Contract model (UUID PK, name unique, version, domain, category, usage_type, description, system_prompt, user_prompt, semantic_map, variables, governance, rules, validators, execution, data, components, tags, is_active, timestamps)
- Registered in `backend/app/models/__init__.py`
- Created Alembic migration `backend/alembic/versions/p257_contracts_table.py`

### Etapa 2: Seed Script
- Created `backend/scripts/seed_contracts.py` to read all 73 YAML files and insert into DB
- Supports upsert (updates existing by name)
- Fixed YAML syntax issues in `commits/commit_message.yaml` and `memory/pattern_discovery.yaml`
- All 73 contracts migrated successfully

### Etapa 3: ContractLoader Reads from DB
- Completely rewrote `backend/app/contracts/loader.py` to query PostgreSQL instead of reading YAML files
- Maintains exact same public API for backward compatibility (10+ services work without changes)
- Added `list_by_usage_type(usage_type)` method for AI Flow integration
- Creates its own DB session if none provided (backward compatible)

### Etapa 4: API CRUD for DB
- Rewrote `backend/app/api/routes/contracts.py` for database-backed operations
- New endpoint: `GET /api/v1/contracts/by-usage-type/{usage_type}` for AI Flow
- Soft-delete (is_active=False) instead of hard delete
- Removed obsolete versions/restore endpoints

### Etapa 5: Contract Nodes in AI Flow (Frontend)
- Added `contract_node` color (#0d9488 teal) and bg to FlowConstants.ts
- Created `ContractNode` component in FlowNodes.tsx with domain badge, version, description
- Added `contract_node` icon to FlowIcons.tsx
- Modified `flowUtils.ts` - contracts appear as column to the left of start node with edges connecting to it
- Added `contractsApi.byUsageType()` to frontend API lib
- Page.tsx fetches contracts when operation changes and passes to buildFlowFromChain
- Counter in controls bar shows contract count

### Etapa 6: Eliminate /contracts Page
- Replaced contracts page with redirect to /ai-flow
- Removed "Contratos" entry from sidebar navigation

## Files Modified/Created

### Created
- `backend/app/models/contract.py` - SQLAlchemy Contract model
- `backend/alembic/versions/p257_contracts_table.py` - Migration
- `backend/scripts/seed_contracts.py` - Seed script (73 YAMLs → DB)
- `backend/app/services/context_generator/content_formatter.py` - Content formatter

### Modified
- `backend/app/models/__init__.py` - Added Contract import
- `backend/app/contracts/loader.py` - Complete rewrite (YAML → DB)
- `backend/app/api/routes/contracts.py` - Complete rewrite (file ops → DB CRUD)
- `backend/app/contracts/commits/commit_message.yaml` - Fixed YAML syntax
- `backend/app/contracts/memory/pattern_discovery.yaml` - Fixed YAML syntax
- `frontend/src/components/ai-flow/FlowConstants.ts` - Added contract_node color/bg
- `frontend/src/components/ai-flow/FlowNodes.tsx` - Added ContractNode + registered in nodeTypes
- `frontend/src/components/ai-flow/FlowIcons.tsx` - Added contract_node icon
- `frontend/src/components/ai-flow/flowUtils.ts` - Contract positioning + edges
- `frontend/src/components/ai-flow/index.ts` - Exported ContractNode + FlowContract type
- `frontend/src/lib/api/ai.ts` - Added contractsApi
- `frontend/src/lib/api/index.ts` - Exported contractsApi
- `frontend/src/app/ai-flow/page.tsx` - Fetch contracts, pass to flow, show count
- `frontend/src/app/contracts/page.tsx` - Replaced with redirect to /ai-flow
- `frontend/src/components/layout/Sidebar.tsx` - Removed Contratos nav item

## Testing Results

- Backend: 296 routes load successfully
- TypeScript: No new errors introduced (all pre-existing)
- Seed: All 73 contracts migrated to PostgreSQL
- ContractLoader: All methods work correctly with DB backend
- API: by-usage-type endpoint returns contracts filtered by usage_type

## Status

**COMPLETED** - All 6 steps implemented successfully.

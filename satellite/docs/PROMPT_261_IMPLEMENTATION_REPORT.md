# PROMPT #261 - Fix Pipeline RAG: Epics Ricos, Regras por Dominio, Descricoes Markdown

## Objective

Fix critical bugs and enrich the RAG pipeline (4 phases) to produce rich, project-specific results:
- Epics representing REAL system modules (not generic standardized ones)
- Rules grouped by domain with entity/evidence metadata
- Rich Markdown descriptions with real code references
- Wiki pages citing actual entities, files and services

## What Was Implemented

### Bug Fix #1: Entity/Evidence/Domain Never Stored
- `store_business_rule()` in `rag_service.py` was discarding `entity`, `evidence`, and `domain` fields
- Added 3 new optional parameters and metadata storage
- Now Phase 3/4 can group rules by actual domain instead of "Geral"

### Bug Fix #2: Epic Generation Never Saw Rules
- Phase 3 Pass 1 only sent summary counts ("Geral: 247 regras") to AI
- AI generated epics by imagination, not based on actual project rules
- Rewrote to send actual rule content grouped by domain (up to 15 rules per domain)

### Phase 2 Enrichment (Rule Extraction)
- Reduced batch size: 30→15 files, 80K→50K chars (deeper analysis per batch)
- Enriched system prompt to demand: domain, entity, functional_context, related_entities, evidence
- Minimum rule_text raised from 15→30 chars
- Domain derivation from file path as fallback

### Phase 3 Enrichment (Card Generation)
- Pass 1: Epics now based on real system modules, with 500+ char Markdown descriptions
  - Required sections: Objetivo, Regras de Negocio, Entidades, Componentes Tecnicos
  - Prohibited generic epics ("Configuracao do Sistema", etc.)
- Pass 2: Stories are conceptual (user perspective), Tasks are technical (code references)
  - Epic descriptions included in context (not just titles)
  - Stories require: Contexto, Funcionalidade, Regras Envolvidas, Cenarios de Uso

### Phase 4 Enrichment (Wiki Generation)
- Overview: Now includes actual rule examples per domain (5 per domain, not just counts)
- Domain: Requires citing real entities, files, endpoints from rules
- Evidence: Code snippets included in wiki when available
- Grouping: Uses `domain` field first, falls back to `entity`

### YAML Contracts Updated (5 files)
- `rag_rules_extraction.yaml` v2: domain/entity/evidence/functional_context
- `cards_epic_generation.yaml` v2: module-based epics with Markdown sections
- `cards_detail_generation.yaml` v2: conceptual Stories + technical Tasks
- `wiki_overview_generation.yaml` v2: real references required
- `wiki_domain_generation.yaml` v2: code evidence required

## Files Modified

| File | Change |
|------|--------|
| `backend/app/services/rag_service.py` | Added entity/evidence/domain params to store_business_rule() |
| `backend/app/services/rag_pipeline.py` | Fixed _store_rules, rewrote Phase 2/3/4 prompts, fixed grouping |
| `backend/app/contracts/pipeline/rag_rules_extraction.yaml` | v2 with domain/entity/evidence |
| `backend/app/contracts/pipeline/cards_epic_generation.yaml` | v2 module-based epics |
| `backend/app/contracts/pipeline/cards_detail_generation.yaml` | v2 rich Stories/Tasks |
| `backend/app/contracts/pipeline/wiki_overview_generation.yaml` | v2 real references |
| `backend/app/contracts/pipeline/wiki_domain_generation.yaml` | v2 code evidence |

## Testing

- Contracts re-seeded: 91 contracts updated successfully
- Full pipeline test pending (requires running against a real project)

## Status

COMPLETED

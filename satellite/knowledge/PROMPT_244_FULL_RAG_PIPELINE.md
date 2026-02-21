# PROMPT #244 - Full RAG Pipeline via Claude Code (v2)
## Complete Codebase Analysis, Business Rule Extraction & Hierarchical Card Generation

**Date:** February 21, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** Populated entire ORBIT knowledge base with 748 tracked files, 259 business rules across 40 domains, and 499 hierarchical cards

---

## Objective

Run the complete ORBIT RAG pipeline (scan files, extract business rules, generate hierarchical cards) entirely through Claude Code analysis rather than local Ollama models. V2 performs a comprehensive deep-dive extracting 2.6x more rules than v1.

**Key Requirements:**
1. Follow the same procedures as the ORBIT RAG pipeline
2. Do NOT use local Ollama models - Claude Code does all analysis
3. Maintain data format compatibility with existing services
4. Generate proper 384-dim embeddings for semantic search
5. V2: Comprehensive deep-dive covering ALL backend services, validators, and pipelines

---

## What Was Implemented

### Phase 1: File Scanning (rag_file_state)

- Scanned entire `/home/igorhaf/orbit` codebase
- Excluded vendor directories (node_modules, .next, __pycache__, .git, etc.)
- Computed SHA-256 hashes for change detection
- Classified files into semantic layers: SCHEMA, ROUTES, LOGIC, PRESENTATION, CONFIG
- ON CONFLICT DO UPDATE for changed files
- **Result: 748 files tracked**

### Phase 2: Business Rule Extraction (rag_documents)

Claude Code analyzed the entire codebase in two passes and extracted **259 business rules** across **40 domains**:

#### Original 12 Domains (98 rules):

| Domain | Rules |
|--------|-------|
| AI Orchestration | 14 |
| RAG Pipeline | 13 |
| Project Lifecycle | 9 |
| Card Hierarchy | 8 |
| Card Activation | 7 |
| Interview System | 6 |
| Data Protection | 8 |
| Job Queue | 6 |
| Wiki & Knowledge | 6 |
| Frontend Architecture | 8 |
| Cost & Analytics | 5 |
| Data Model | 8 |

#### NEW 28 Domains from v2 Deep-Dive (161 rules):

| Domain | Rules | Description |
|--------|-------|-------------|
| Rate Limiting & Provider Backoff | 5 | Redis sliding window, fail-open, provider backoff |
| Error Classification & Retry | 3 | Permanent/transient/OOM classification |
| Workflow State Machine | 4 | Per-type states, terminal states, audit |
| Pipeline Validation & Anti-Hallucination | 8 | Wiki sections, anti-shrink, functional language |
| Similarity Detection & Deduplication | 6 | Tiered thresholds, question dedup, cleaning |
| Modification Approval Workflow | 4 | Blocked tasks, approve/reject, status history |
| Token Budget Management | 4 | SP-based budgets, type budgets, over-budget alerts |
| Prompt Structure & Compression | 6 | 4-section structure, parent summarization, delta maps |
| AI Response Validation | 5 | Confidence scoring, truncation, language mix |
| Utility Node Pipeline | 7 | Pre/post process order, cost guard, JSON repair |
| Query Classification | 4 | Zero-latency scoring, tier thresholds, token estimates |
| File Upload & Archive Security | 7 | Whitelist, MIME, zip bomb, path traversal |
| Codebase Scanning & Indexing | 8 | Scan depths, ignore sets, global blocklist |
| Knowledge Graph & Static Analysis | 8 | God objects, hub nodes, shared ratio |
| Staged Pattern Discovery | 5 | 4-stage pipeline, AI-only-when-needed |
| Backlog Generation & Decomposition | 9 | Epic/Story decomposition, similarity blocking |
| Task Hierarchy Rules | 5 | Valid parents, cycle prevention, cascade |
| Card Activation & Lifecycle | 10 | FOR UPDATE lock, context lock, draft generation |
| Business Rule Card Generation | 9 | Chunked classification, flat fallback |
| Project Protection & Configuration | 6 | Protected flag, ignore patterns, spec limits |
| Symbol Extraction & Code Analysis | 3 | 9-language regex, 4 symbol types |
| Watchdog Operational Rules | 10 | Cycle cooldowns, bootstrap cleanup, retry limits |
| Pipeline Card Generation | 5 | Batch limits, similarity dedup, stack-agnostic |
| Pipeline Wiki Generation | 3 | Batch limit, retry+fallback, skeleton sections |
| Batch Execution & Dependencies | 3 | Topological sort, circular resolution |
| Interview Model Rules | 5 | Modes, statuses, cascade deletes |
| Pricing & Cost Calculation | 3 | Default pricing, partial match, 4 providers |
| Configuration & System Limits | 6 | Upload limits, feature flags, CORS |

Each rule inserted with:
- 384-dimensional embedding (all-MiniLM-L6-v2 via sentence-transformers)
- JSONB metadata (type, source, source_file, rule_type, priority, domain)
- **Result: 259 business rules + 40 epic card documents = 299 RAG documents**

### Phase 3: Hierarchical Card Generation (tasks)

Created complete card hierarchy:

```
40 Epics (13 SP each)
  83 Stories (8 SP each)
    117 Tasks (3 SP each, grouping ~3 rules)
      259 Subtasks (1 SP each, 1 rule per subtask)
```

**Result: 499 cards total**

---

## Files Modified

### Modified:
1. **backend/scripts/claude_full_pipeline.py** - V2 with 261 rules across 33+ domains
   - Lines: ~850
   - 259 business rules (v1 had 98)
   - 40 domains (v1 had 12)
   - Dynamic hierarchy generation from rules
   - ON CONFLICT DO UPDATE for file scanning

---

## Testing Results

### Verification:

```bash
Files tracked (rag_file_state): 748
RAG Documents total: 299
Business rules: 259
Epic card documents: 40
Epics: 40
Stories: 83
Tasks: 117
Subtasks: 259
Total cards: 499
All embeddings: 384 dimensions
Domains: 40
```

---

## V1 vs V2 Comparison

| Metric | V1 | V2 | Growth |
|--------|----|----|--------|
| Business Rules | 98 | 259 | +164% |
| Domains | 12 | 40 | +233% |
| RAG Documents | 110 | 299 | +172% |
| Epics | 12 | 40 | +233% |
| Stories | 39 | 83 | +113% |
| Tasks | 39 | 117 | +200% |
| Subtasks | 98 | 259 | +164% |
| Total Cards | 188 | 499 | +165% |

---

## Key Insights

### 1. Deep-Dive Reveals Hidden Business Logic
V1 covered the main services. V2's deep-dive into validators, pipelines, watchdog, and utility services revealed 161 additional rules that govern critical system behavior (rate limiting, error classification, anti-hallucination validation).

### 2. Dynamic Hierarchy Generation
V2 uses dynamic hierarchy generation from rules rather than hand-crafted domain mappings, making it easier to maintain as new rules are added.

### 3. Comprehensive Coverage
40 domains now cover virtually every aspect of ORBIT's business logic, from high-level AI orchestration down to low-level watchdog cooldowns and file security.

---

## Status: COMPLETE

**Key Achievements:**
- 259 business rules across 40 domains (2.6x v1)
- 499 hierarchical cards (2.7x v1)
- Complete coverage of validators, pipelines, watchdog, and security layers
- Compatible with existing ORBIT RAG search and card management

**Impact:**
- ORBIT's self-knowledge base is now comprehensive
- Semantic search covers all system domains
- Cards provide full architectural visibility
- Foundation for automated quality assurance and gap analysis

---

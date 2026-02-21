# PROMPT #193 - Hierarchical Business Rule Cards
## Business Rules with Epic > Story > Task > Subtask Structure

**Date:** February 8, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Enhancement
**Impact:** Business rules from codebase scan now create proper hierarchical cards grouped by domain

---

## Objective

When a project is created, the Memory Scan extracts business rules from existing code and creates closed cards. Previously, these were flat: 1 generic Epic + N Stories. Now, AI classifies rules into a proper hierarchy:

- **Epic** = Business domain/module (e.g., "User Management", "Payment Processing")
- **Story** = Business rule (e.g., "Email/password authentication")
- **Task** = Technical aspect (e.g., "Bcrypt password hashing")
- **Subtask** = Implementation detail (e.g., "Unique salt per user")

---

## What Was Implemented

### 1. AI Classification Prompt
New contract YAML `backend/app/contracts/memory/business_rules_hierarchy.yaml` instructs the AI to:
- Group rules by business domain (each domain = 1 Epic)
- Create Stories for each main rule
- Create Tasks for technical aspects
- Create Subtasks for specific details
- Depth is flexible (not all rules need 4 levels)

### 2. Hierarchical Card Generation
Replaced `generate_business_rule_cards()` in `context_generator.py` with:
- `_classify_rules_hierarchy()`: Calls AI to classify rules into hierarchy JSON
- `_create_hierarchy_cards()`: Recursively creates cards from the hierarchy tree, mapping depth to item_type
- `_create_flat_business_rule_cards()`: Fallback to original flat structure if AI fails

### 3. Graceful Fallback
If the AI classification fails (network error, invalid response, etc.), the system falls back to the original flat structure (1 Epic + N Stories), ensuring no regression.

---

## Files Created/Modified

### Created:
1. **backend/app/contracts/memory/business_rules_hierarchy.yaml** - AI prompt for hierarchical classification

### Modified:
1. **backend/app/services/context_generator.py** - Replaced flat generation with hierarchical AI classification + recursive card creation

---

## Testing Results

```bash
Python syntax check: OK
Backend restart: Uvicorn running successfully
WebSocket connections: Active
```

---

## Status: COMPLETE

**Key Achievements:**
- Business rules now organized by domain in proper Epic > Story > Task > Subtask hierarchy
- AI decides the appropriate depth for each rule (not forced to 4 levels)
- Fallback to flat structure if AI classification fails
- No frontend changes needed (hierarchy already supported by ItemDetailPanel)

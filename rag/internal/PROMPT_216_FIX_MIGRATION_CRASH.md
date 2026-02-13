# PROMPT #216 - Fix Alembic Migration Crash (Backend Restart Loop)
## PostgreSQL Enum Value Transaction Safety

**Date:** February 10, 2026
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Bug Fix
**Impact:** Backend was in a restart loop, causing all API endpoints (including /cache/stats) to return ERR_EMPTY_RESPONSE

---

## 🎯 Objective

Fix backend crash-loop caused by Alembic migration failures, which manifested as `ERR_EMPTY_RESPONSE` errors on the frontend for `/api/v1/cache/stats` and all other endpoints.

**Key Requirements:**
1. Fix PostgreSQL "unsafe use of new enum value" error in migration `20260127100000`
2. Fix duplicate enum type creation error in migration `20260209_create_prompt_queue`
3. Ensure backend starts cleanly and serves API requests

---

## 🔍 Root Cause Analysis

### Error Chain:
1. **PostgreSQL container crashed** (exit code 127), causing backend to lose DB connection
2. When PostgreSQL was restarted, backend tried to run pending Alembic migrations
3. **Migration `20260127100000`** failed with: `unsafe use of new value "pattern_discovery" of enum type ai_model_usage_type`
4. This caused a perpetual restart loop, making ALL endpoints unreachable

### Root Cause 1: Enum Value Transaction Safety
PostgreSQL does not allow using a newly added enum value within the same transaction where `ALTER TYPE ADD VALUE` was executed. Migration `ff42c2846a70` added the `pattern_discovery` enum value, and `20260127100000` tried to use it. Alembic wrapped all migrations in a single transaction (via `context.begin_transaction()` in `env.py`), making the new enum value unavailable.

### Root Cause 2: Duplicate Enum Type Creation
Migration `20260209_create_prompt_queue` used `sa.Enum()` (generic SQLAlchemy) which doesn't support `create_type=False`. When creating a table with an enum column, SQLAlchemy attempted to auto-create the enum type even though it was already explicitly created earlier in the same migration.

---

## ✅ What Was Implemented

### 1. Transaction-per-Migration in Alembic (`env.py`)
Added `transaction_per_migration=True` to `context.configure()` so each migration runs in its own transaction. This ensures `ALTER TYPE ADD VALUE` commits before subsequent migrations try to use the new value.

### 2. Migration `20260127100000` - Updated Comments
Updated the docstring to reflect the fix approach. The migration now correctly uses the `pattern_discovery` enum value because the enum addition in `ff42c2846a70` is committed in a separate transaction.

### 3. Migration `20260209_create_prompt_queue` - Enum Handling Fix
- Replaced `sa.Enum().create()` with raw SQL `DO $$ BEGIN CREATE TYPE ... EXCEPTION WHEN duplicate_object THEN NULL; END $$` for idempotent enum creation
- Used `postgresql.ENUM()` with `create_type=False` for the column definition to prevent SQLAlchemy from auto-creating the type during table creation

---

## 📁 Files Modified

### Modified:
1. **backend/alembic/env.py** - Added `transaction_per_migration=True`
   - Lines changed: 3
2. **backend/alembic/versions/20260127100000_seed_pattern_discovery_model.py** - Updated docstring
   - Lines changed: 5
3. **backend/alembic/versions/20260209_create_prompt_queue.py** - Fixed enum creation pattern
   - Lines changed: 12

---

## 🧪 Testing Results

### Verification:

```bash
✅ PostgreSQL container: healthy
✅ Backend container: healthy (no longer in restart loop)
✅ GET /api/v1/cache/stats: 200 OK with full cache statistics JSON
✅ Redis cache: connected and operational
✅ RAG service: initialized
✅ AI providers: initialized (AsyncAnthropic)
✅ Rate limiter: connected to Redis
✅ All migrations: completed successfully
```

---

## 🎯 Success Metrics

✅ **Backend stability:** No more restart loops
✅ **Cache stats endpoint:** Returns valid JSON with Redis-backed statistics
✅ **Frontend errors:** `ERR_EMPTY_RESPONSE` errors resolved

---

## 💡 Key Insights

### 1. PostgreSQL Enum Limitations
`ALTER TYPE ADD VALUE` cannot be used within the same transaction as statements that reference the new value. This is a well-known PostgreSQL limitation. The fix is `transaction_per_migration=True` in Alembic, which ensures each migration commits independently.

### 2. SQLAlchemy Enum Auto-Creation
When using `sa.Enum()` (generic), SQLAlchemy doesn't support `create_type=False`. You must use `postgresql.ENUM()` from `sqlalchemy.dialects.postgresql` to prevent auto-creation during table creation.

### 3. Cascading Failures
A seemingly unrelated PostgreSQL crash (exit code 127) exposed latent migration bugs that had been masked because the migrations had already run on the production database. When the database was recreated, the migration issues surfaced.

---

## 🎉 Status: COMPLETE

Backend is healthy, all API endpoints are functional, and the frontend cache statistics are loading correctly.

**Key Achievements:**
- ✅ Fixed backend restart loop
- ✅ Fixed PostgreSQL enum transaction safety issue
- ✅ Fixed duplicate enum type creation
- ✅ Cache/stats endpoint returns valid data

**Impact:**
- All ORBIT API endpoints are accessible again
- Frontend cache statistics display works
- Future migrations with enum additions will be handled safely via `transaction_per_migration=True`

---

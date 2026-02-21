# PROMPT #224 - Fix /jobs/stats Internal Database Error
## Missing PostgreSQL Enum Values + Query Optimization

**Date:** 2026-02-12
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Bug Fix / Performance
**Impact:** Jobs dashboard (/jobs page) was completely broken with "An internal database error occurred". Now responds instantly.

---

## Objective

Fix the `/api/v1/jobs/stats` endpoint that was returning a 500 error with "An internal database error occurred", causing the frontend Jobs page to fail loading.

---

## Root Cause Analysis

### Issue 1: Missing PostgreSQL Enum Values
The Python `JobType` enum had 20 values, but the PostgreSQL `jobtype` enum only had 15. Five values were added to Python code but never got a corresponding Alembic migration:

- `epic_activation` (PROMPT #108)
- `story_activation` (PROMPT #108)
- `task_activation` (PROMPT #108)
- `subtask_activation` (PROMPT #108)
- `cards_from_memory` (PROMPT #153)

When `/jobs/stats` iterated over all Python enum values and queried the DB, PostgreSQL rejected `epic_activation` as an invalid enum value:
```
psycopg2.errors.InvalidTextRepresentation: invalid input value for enum jobtype: "epic_activation"
```

### Issue 2: Query Performance (52+ queries per request)
The stats endpoint executed individual COUNT queries for each job type (20), each status (5), each hour (24), plus additional queries. Total: 52+ queries per single request. With background Ollama tasks holding DB connections, this caused connection pool starvation and timeouts.

---

## What Was Implemented

### 1. Alembic Migration for Missing Enum Values
**File:** `backend/alembic/versions/20260212_add_missing_jobtype_values.py`

Added 5 missing values to the PostgreSQL `jobtype` enum using `ALTER TYPE ... ADD VALUE IF NOT EXISTS`.

### 2. Query Optimization (52 queries -> 5)
**File:** `backend/app/api/routes/jobs.py`

Rewrote the `get_job_stats()` endpoint to use aggregated SQL:
- **Status counts**: Single `GROUP BY status` query (was 5 individual queries)
- **Type counts**: Single `GROUP BY job_type` query (was 20 individual queries)
- **Avg duration**: Single `AVG(extract(epoch))` query (was loading ALL completed jobs into Python)
- **Jobs per hour**: Single `GROUP BY date_trunc('hour')` query (was 24 individual queries)
- **Recent errors**: Single query with LIMIT (unchanged)

### 3. Database Pool Size Increase
**File:** `backend/app/database.py`

Increased connection pool from defaults (5/10) to explicit (10/20):
```python
pool_size=10,
max_overflow=20,
```

This prevents background Ollama tasks from starving API request handlers.

---

## Files Modified/Created

### Created:
1. **backend/alembic/versions/20260212_add_missing_jobtype_values.py** - Migration adding 5 enum values

### Modified:
1. **backend/app/api/routes/jobs.py** - Rewrote stats endpoint from 52 queries to 5
2. **backend/app/database.py** - Increased pool_size to 10, max_overflow to 20

---

## Verification

```
curl /api/v1/jobs/stats?hours=24    -> 200 OK (was 500)
curl /api/v1/jobs/types             -> 200 OK (20 types listed)
curl /api/v1/jobs/statuses          -> 200 OK
```

Response time: < 1 second (was timing out at 60+ seconds)

---

## Status: COMPLETE

**Key Achievements:**
- Fixed 500 error on /jobs/stats by adding 5 missing PostgreSQL enum values
- Reduced queries from 52+ to 5 per stats request
- Increased DB pool to prevent connection starvation from background tasks
- Response time from timeout (60s+) to near-instant (< 1s)

# PROMPT #251 - Resilient DB Connections for Background Jobs
## Prevent watchdog/batch crashes on transient PostgreSQL failures

**Date:** February 12, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Bug Fix / Reliability
**Impact:** Background jobs (watchdog, batch processing) no longer crash permanently when PostgreSQL restarts or has transient connectivity issues

---

## Objective

Make the watchdog and batch processing background services resilient to transient PostgreSQL connection failures. Previously, if PostgreSQL restarted while a cycle was running, the single `SessionLocal()` created at the start of the cycle would become invalid, causing `psycopg2.OperationalError: connection refused` errors that crashed the entire cycle and could prevent re-queuing.

**Key Requirements:**
1. Retry DB connection on session creation with backoff
2. Properly close failed sessions to avoid connection pool leaks
3. Use fresh sessions for error-path re-queuing (since the original session may be dead)
4. Extra resilience for bootstrap (runs at startup when PostgreSQL may still be starting)

---

## What Was Implemented

### 1. `_get_resilient_session()` Helper
- Creates a DB session with retry logic (default: 3 retries, 5s delay)
- Validates connection with `SELECT 1` before returning
- Properly closes failed sessions to prevent connection pool exhaustion
- Uses `sqlalchemy.text()` for SQLAlchemy 2.x compatibility
- Bootstrap uses extended retries (5 retries, 10s delay) since PostgreSQL may still be starting

### 2. `_safe_db_call()` Helper
- Wraps DB operations with automatic rollback on `OperationalError`
- Prevents a single failed query from poisoning the entire session

### 3. Updated `watchdog_cycle`
- Replaced `SessionLocal()` with `_get_resilient_session()`
- Error handler creates a fresh session for re-queuing instead of reusing the potentially dead session
- Logs warning if re-queuing fails due to DB unavailability

### 4. Updated `batch_processing_cycle`
- Replaced `SessionLocal()` with `_get_resilient_session()`
- Same fresh-session pattern in error handler for re-queuing

### 5. Updated `bootstrap_watchdog`
- Replaced `next(get_db_gen())` with `_get_resilient_session(max_retries=5, delay=10.0)`
- More retries and longer delay because PostgreSQL may still be starting when the app boots

---

## Files Modified

1. **backend/app/services/watchdog.py** - All changes in this file
   - `_get_resilient_session()`: Fixed `sql_text` usage, added session cleanup on failure
   - `watchdog_cycle`: Uses resilient session, fresh session for error re-queuing
   - `batch_processing_cycle`: Uses resilient session, fresh session for error re-queuing
   - `bootstrap_watchdog`: Uses resilient session with extended retries

---

## Testing Results

### Verification:

```
- _get_resilient_session uses sqlalchemy.text() for SELECT 1
- Failed sessions are properly closed (db.close() in except)
- Error handlers create fresh requeue_db sessions
- requeue_db is always closed in finally block
- bootstrap_watchdog uses 5 retries / 10s delay for startup resilience
- All 3 entry points (watchdog_cycle, batch_processing_cycle, bootstrap_watchdog) use resilient sessions
```

---

## Key Insights

### 1. Session Lifecycle in Background Jobs
Background jobs that run for minutes with a single session are vulnerable to mid-cycle PostgreSQL restarts. The `pool_pre_ping=True` setting only helps at connection checkout time, not for already-checked-out sessions.

### 2. Error-Path Re-queuing
When the main cycle fails with a DB error, the original session is likely dead. Using it to re-queue the next cycle would also fail silently, causing the background job to stop permanently. Creating a fresh session in the error handler ensures the self-healing loop continues.

### 3. Bootstrap Timing
At application startup, PostgreSQL may still be initializing (especially in Docker Compose). Extended retries (5x with 10s delay = up to 50s wait) give it enough time to become available.

---

## Status: COMPLETE

**Key Achievements:**
- All 3 background job entry points use resilient DB sessions
- Fresh sessions for error-path re-queuing prevents permanent job death
- Bootstrap tolerates slow PostgreSQL startup
- Connection pool leaks prevented by closing failed sessions
- SQLAlchemy 2.x compatible

**Impact:**
- Watchdog/batch cycles survive transient PostgreSQL restarts
- Self-healing loop continues even after DB connectivity failures
- No more permanent job stoppage from `OperationalError: connection refused`

---

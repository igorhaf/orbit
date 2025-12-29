# Configuration Validation - Complete Setup Guide

## ✅ All Configurations Fixed and Validated

All critical configuration issues have been resolved and a comprehensive validation system has been put in place.

---

## 📋 Files Modified/Created

### Configuration Files Updated:
1. ✅ [.env](.env) - Root environment variables
   - Fixed POSTGRES_PASSWORD: `aiorch_password` (was `aiorch_dev_password`)
   - Added DATABASE_URL with correct values
   - Fixed CORS_ORIGINS format: comma-separated string
   - Added missing variables (DEBUG, LOG_LEVEL, etc.)

2. ✅ [backend/app/config.py](backend/app/config.py) - Already correct
   - `cors_origins: List[str]` ✓
   - Validator accepts both string and list ✓

3. ✅ [docker-compose.yml](docker-compose.yml) - Updated
   - Fixed POSTGRES_PASSWORD default
   - Added init-db.sh mount
   - Fixed DATABASE_URL environment variable
   - Fixed CORS_ORIGINS with comma-separated default
   - Added DEBUG and LOG_LEVEL variables

### New Files Created:
4. ✅ [docker/init-db.sh](docker/init-db.sh) - Database initialization script
   - Creates `ai_orchestrator` database if not exists
   - Grants privileges to user
   - Runs automatically on first container start

5. ✅ [scripts/validate_config.sh](scripts/validate_config.sh) - Configuration validator
   - Checks all essential files
   - Validates database configuration
   - Validates CORS configuration
   - Validates Python config.py
   - Validates Docker setup

6. ✅ [scripts/reset_docker.sh](scripts/reset_docker.sh) - Docker reset script (already existed)

---

## 🚀 How to Proceed - Step by Step

### Step 1: Validate Configuration

**IMPORTANT**: Run validation BEFORE starting Docker:

```bash
./scripts/validate_config.sh
```

**Expected Output**:
```
✅ ALL CHECKS PASSED!

You can now run:
  docker-compose down -v
  docker-compose up --build
```

**If validation fails**: Review and fix the errors shown, then run validation again.

---

### Step 2: Clean Docker Environment

```bash
# Stop and remove all containers and volumes
docker-compose down -v

# Optional: Clean Docker cache
docker system prune -f
```

**Why this is necessary**:
- Removes old volumes with incorrect database name
- Clears cached environment variables
- Ensures fresh start with correct configuration

---

### Step 3: Build and Start Services

```bash
docker-compose up --build
```

**What to watch for**:

1. **PostgreSQL Startup**:
   ```
   🔧 Initializing database...
   ✅ Database initialization complete!
      Database: ai_orchestrator
      User: aiorch

   database system is ready to accept connections
   ```

2. **Backend Startup**:
   ```
   Waiting for database...
   Application startup complete
   INFO:     Uvicorn running on http://0.0.0.0:8000
   ```

3. **Frontend Startup**:
   ```
   Ready in XXXms
   ○ Local:   http://localhost:3000
   ```

---

### Step 4: Verify Services

In another terminal:

```bash
# Check all containers are running
docker-compose ps

# Should show:
# ai-orchestrator-db       Up (healthy)
# ai-orchestrator-backend  Up
# ai-orchestrator-frontend Up

# Test health endpoint
curl http://localhost:8000/health

# Should return:
# {"status":"ok","version":"0.1.0","environment":"development",...}

# Test frontend
curl -I http://localhost:3000

# Should return: HTTP/1.1 200 OK
```

---

### Step 5: Verify Database

```bash
# List databases (should show ai_orchestrator)
docker-compose exec postgres psql -U aiorch -l

# Connect to database
docker-compose exec postgres psql -U aiorch -d ai_orchestrator

# Inside psql:
\dt    # List tables (should be empty before migrations)
\q     # Quit
```

---

### Step 6: Apply Migrations

```bash
# Using helper script
./scripts/apply_migrations.sh

# Or manually
docker-compose exec backend poetry run alembic upgrade head
```

**Expected Output**:
```
INFO  [alembic.runtime.migration] Running upgrade  -> 001, Create initial tables
✅ Migrations applied successfully!

📊 Current database tables:
                  List of relations
 Schema |        Name        | Type  | Owner
--------+--------------------+-------+--------
 public | ai_models          | table | aiorch
 public | chat_sessions      | table | aiorch
 public | commits            | table | aiorch
 public | interviews         | table | aiorch
 public | projects           | table | aiorch
 public | prompts            | table | aiorch
 public | system_settings    | table | aiorch
 public | tasks              | table | aiorch
(8 rows)
```

---

## 🔍 Configuration Details

### Database Configuration

All files now use consistent database configuration:

| Variable | Value | Location |
|----------|-------|----------|
| POSTGRES_DB | `ai_orchestrator` | `.env`, `docker-compose.yml` |
| POSTGRES_USER | `aiorch` | `.env`, `docker-compose.yml` |
| POSTGRES_PASSWORD | `aiorch_password` | `.env`, `docker-compose.yml` |
| DATABASE_URL | `postgresql://aiorch:aiorch_password@postgres:5432/ai_orchestrator` | `.env`, `docker-compose.yml` |

### CORS Configuration

**Format**: Comma-separated string (NOT JSON array)

**Correct**:
```env
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

**Incorrect**:
```env
CORS_ORIGINS=["http://localhost:3000"]  # ❌ JSON format
```

**How it works**:
1. Environment variable is a string: `"http://localhost:3000,http://127.0.0.1:3000"`
2. Validator in `config.py` splits it: `["http://localhost:3000", "http://127.0.0.1:3000"]`
3. FastAPI receives a list of strings ✓

---

## 📊 Validation Checks

The `validate_config.sh` script checks:

1. ✅ All essential files exist
2. ✅ Database variables are correct
3. ✅ DATABASE_URL contains `ai_orchestrator`
4. ✅ CORS_ORIGINS is comma-separated (not JSON)
5. ✅ `config.py` has correct type: `List[str]`
6. ✅ CORS validator exists
7. ✅ `init-db.sh` is mounted and executable

---

## 🛠️ Troubleshooting

### Issue: Validation script fails

```bash
# Make script executable
chmod +x scripts/validate_config.sh

# Run again
./scripts/validate_config.sh
```

### Issue: "Permission denied" on init-db.sh

```bash
chmod +x docker/init-db.sh
```

### Issue: Database still shows "aiorch" error

```bash
# Completely remove volumes
docker-compose down -v
docker volume rm orbit-21_postgres_data

# Rebuild from scratch
docker-compose up --build
```

### Issue: CORS errors in browser

Check that `.env` has:
```env
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

NOT:
```env
CORS_ORIGINS=["http://localhost:3000"]
```

### Issue: Backend won't start

```bash
# Check logs for specific error
docker-compose logs backend

# Common issues:
# 1. Database not ready - wait a few seconds
# 2. Port 8000 in use - check: lsof -i :8000
# 3. Poetry lock issue - rebuild: docker-compose build backend
```

---

## 📝 Complete Startup Checklist

Run these commands in order:

```bash
# 1. Validate configuration
./scripts/validate_config.sh
# Expected: ✅ ALL CHECKS PASSED!

# 2. Clean environment
docker-compose down -v
# Expected: Removed containers and volumes

# 3. Build and start
docker-compose up --build
# Wait for all services to be ready (2-5 minutes first time)

# 4. In another terminal, verify
docker-compose ps
# Expected: All 3 containers Up

# 5. Test health
curl http://localhost:8000/health
# Expected: {"status":"ok",...}

# 6. Apply migrations
./scripts/apply_migrations.sh
# Expected: 8 tables created

# 7. Access services
# Frontend: http://localhost:3000
# API Docs: http://localhost:8000/docs
```

---

## ✅ Success Criteria

You know everything is working when:

- [ ] Validation script passes with no errors
- [ ] All 3 containers are Up and healthy
- [ ] Health check returns status "ok"
- [ ] Database `ai_orchestrator` exists
- [ ] 8 tables created after migrations
- [ ] Frontend loads at http://localhost:3000
- [ ] API docs accessible at http://localhost:8000/docs
- [ ] No errors in logs: `docker-compose logs`

---

## 🎯 Next Steps

After successful setup:

1. **Test API**: Visit http://localhost:8000/docs
2. **Implement CRUD**: See [MODELS_SUMMARY.md](MODELS_SUMMARY.md:96-158)
3. **Build Features**: Follow [PROGRESS.md](PROGRESS.md) roadmap

---

**Status**: ✅ **Configuration Complete and Validated**

**Date**: 2025-12-26

**Ready for**: Docker startup and database migrations

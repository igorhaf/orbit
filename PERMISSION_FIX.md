# Permission Fix - Database Initialization Script

## 🐛 Problem Identified

Database initialization failed with permission error:

```
/bin/bash: /docker-entrypoint-initdb.d/init-db.sh: Permission denied
```

## 🔍 Root Cause

**Issue**: Alpine Linux (used by `postgres:16-alpine`) doesn't have `/bin/bash`

**Details**:
- Script used shebang: `#!/bin/bash`
- Alpine only has: `/bin/sh`
- Even with +x permissions, bash shebang fails in Alpine

## ✅ Solution Applied

### 1. Changed Shebang
```bash
# BEFORE:
#!/bin/bash

# AFTER:
#!/bin/sh
```

**Why**: Alpine Linux uses BusyBox shell (`/bin/sh`), not bash

### 2. Fixed Permissions
```bash
chmod 755 docker/init-db.sh
```

**Permissions**: `-rwxr-xr-x` (755)
- Owner: Read, Write, Execute
- Group: Read, Execute
- Others: Read, Execute

## 📁 File: docker/init-db.sh

**Final version**:
```bash
#!/bin/sh
# Database initialization script for PostgreSQL
# This script runs automatically when the container is first created

set -e

echo "🔧 Initializing database..."

# Wait a moment for PostgreSQL to be fully ready
sleep 2

# The database is automatically created by POSTGRES_DB environment variable
# This script is just for additional setup if needed

# Create database if it doesn't exist (redundant but safe)
psql -v ON_ERROR_STOP=0 --username "$POSTGRES_USER" --dbname "postgres" <<-EOSQL
    SELECT 'CREATE DATABASE ai_orchestrator'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ai_orchestrator')\gexec
EOSQL

# Grant privileges
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "postgres" <<-EOSQL
    GRANT ALL PRIVILEGES ON DATABASE ai_orchestrator TO $POSTGRES_USER;
EOSQL

echo "✅ Database initialization complete!"
echo "   Database: ai_orchestrator"
echo "   User: $POSTGRES_USER"
```

## ✅ Verification

```bash
# Check file permissions
ls -la docker/init-db.sh
# Expected: -rwxr-xr-x (755)

# Check shebang
head -1 docker/init-db.sh
# Expected: #!/bin/sh

# Verify file type
file docker/init-db.sh
# Expected: POSIX shell script, UTF-8 text executable
```

## 🚀 Next Steps

The script is now fixed and ready. Proceed with:

```bash
# 1. Clean Docker environment
docker-compose down -v

# 2. Rebuild and start
docker-compose up --build
```

**Expected Output from PostgreSQL**:
```
🔧 Initializing database...
✅ Database initialization complete!
   Database: ai_orchestrator
   User: aiorch
database system is ready to accept connections
```

## 📊 Compatibility

| Shell | Alpine Linux | Debian/Ubuntu | Status |
|-------|-------------|---------------|--------|
| `/bin/sh` | ✅ Yes | ✅ Yes | Works everywhere |
| `/bin/bash` | ❌ No | ✅ Yes | Only Debian-based |

**Recommendation**: Always use `#!/bin/sh` for Alpine-based images

## 🔧 Troubleshooting

### If permission error persists:

```bash
# Verify permissions are correct
stat docker/init-db.sh

# Should show:
# Access: (0755/-rwxr-xr-x)

# Force permissions update
chmod 755 docker/init-db.sh

# Verify shebang
head -1 docker/init-db.sh
# Must be: #!/bin/sh (not #!/bin/bash)
```

### If init script doesn't run:

```bash
# Check Docker volume mount
docker-compose config | grep -A 2 "init-db.sh"

# Should show:
# - ./docker/init-db.sh:/docker-entrypoint-initdb.d/init-db.sh:ro
```

---

**Status**: ✅ **FIXED**

**Changes**:
1. Shebang changed from `bash` to `sh`
2. Permissions set to `755`

**Ready for**: Docker rebuild

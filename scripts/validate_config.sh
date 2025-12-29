#!/bin/bash
# Configuration Validation Script
# Run this BEFORE docker-compose up to ensure all configs are correct

set -e

echo "🔍 Validating AI Orchestrator Configuration..."
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ERRORS=0
WARNINGS=0

# Function to check if file exists
check_file() {
    if [ -f "$1" ]; then
        echo -e "${GREEN}✓${NC} $1 exists"
        return 0
    else
        echo -e "${RED}✗${NC} $1 NOT FOUND"
        ERRORS=$((ERRORS + 1))
        return 1
    fi
}

# Function to check environment variable in file
check_env_var() {
    local file=$1
    local var=$2
    local expected=$3

    if grep -q "^${var}=" "$file"; then
        local value=$(grep "^${var}=" "$file" | cut -d'=' -f2-)
        if [ -n "$expected" ] && [ "$value" != "$expected" ]; then
            echo -e "${YELLOW}⚠${NC}  $var in $file: $value (expected: $expected)"
            WARNINGS=$((WARNINGS + 1))
        else
            echo -e "${GREEN}✓${NC} $var in $file: $value"
        fi
        return 0
    else
        echo -e "${RED}✗${NC} $var NOT FOUND in $file"
        ERRORS=$((ERRORS + 1))
        return 1
    fi
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1. Checking Essential Files"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
check_file ".env"
check_file "backend/.env"
check_file "frontend/.env.local"
check_file "docker-compose.yml"
check_file "backend/app/config.py"
check_file "docker/init-db.sh"
check_file "backend/poetry.lock"
check_file "frontend/package-lock.json"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "2. Validating Database Configuration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
check_env_var ".env" "POSTGRES_DB" "ai_orchestrator"
check_env_var ".env" "POSTGRES_USER" "aiorch"
check_env_var ".env" "POSTGRES_PASSWORD"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "3. Validating DATABASE_URL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
check_env_var ".env" "DATABASE_URL"

# Check if DATABASE_URL contains correct database name
if grep -q "DATABASE_URL.*ai_orchestrator" ".env"; then
    echo -e "${GREEN}✓${NC} DATABASE_URL contains correct database name (ai_orchestrator)"
else
    echo -e "${RED}✗${NC} DATABASE_URL does not contain 'ai_orchestrator'"
    ERRORS=$((ERRORS + 1))
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "4. Validating CORS Configuration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
check_env_var ".env" "CORS_ORIGINS"

# Check CORS format (should be comma-separated string, not JSON)
if grep -q 'CORS_ORIGINS=\[' ".env"; then
    echo -e "${RED}✗${NC} CORS_ORIGINS is in JSON format (should be comma-separated string)"
    ERRORS=$((ERRORS + 1))
elif grep -q 'CORS_ORIGINS=.*,' ".env"; then
    echo -e "${GREEN}✓${NC} CORS_ORIGINS is comma-separated string (correct format)"
else
    echo -e "${YELLOW}⚠${NC}  CORS_ORIGINS has single value (ok, but usually should have multiple)"
    WARNINGS=$((WARNINGS + 1))
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "5. Checking Python Configuration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if grep -q "cors_origins: List\[str\]" "backend/app/config.py"; then
    echo -e "${GREEN}✓${NC} cors_origins type is List[str] in config.py"
else
    echo -e "${RED}✗${NC} cors_origins type is NOT List[str] in config.py"
    ERRORS=$((ERRORS + 1))
fi

if grep -q '@validator("cors_origins"' "backend/app/config.py"; then
    echo -e "${GREEN}✓${NC} CORS validator found in config.py"
else
    echo -e "${YELLOW}⚠${NC}  CORS validator not found in config.py"
    WARNINGS=$((WARNINGS + 1))
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "6. Checking Docker Configuration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if grep -q "init-db.sh:/docker-entrypoint-initdb.d/init-db.sh" "docker-compose.yml"; then
    echo -e "${GREEN}✓${NC} init-db.sh is mounted in docker-compose.yml"
else
    echo -e "${RED}✗${NC} init-db.sh is NOT mounted in docker-compose.yml"
    ERRORS=$((ERRORS + 1))
fi

if [ -x "docker/init-db.sh" ]; then
    echo -e "${GREEN}✓${NC} init-db.sh is executable"
else
    echo -e "${YELLOW}⚠${NC}  init-db.sh is not executable (will fix automatically)"
    chmod +x docker/init-db.sh
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "7. Validation Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✅ ALL CHECKS PASSED!${NC}"
    echo ""
    echo "You can now run:"
    echo "  docker-compose down -v"
    echo "  docker-compose up --build"
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}⚠️  VALIDATION PASSED WITH WARNINGS${NC}"
    echo "   Warnings: $WARNINGS"
    echo ""
    echo "You can proceed, but review the warnings above."
    echo ""
    echo "To continue:"
    echo "  docker-compose down -v"
    echo "  docker-compose up --build"
    exit 0
else
    echo -e "${RED}❌ VALIDATION FAILED${NC}"
    echo "   Errors: $ERRORS"
    echo "   Warnings: $WARNINGS"
    echo ""
    echo "Please fix the errors above before running docker-compose."
    exit 1
fi

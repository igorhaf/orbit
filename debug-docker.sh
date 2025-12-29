#!/bin/bash

echo "🔍 ORBIT Docker Diagnostic Tool"
echo "================================"
echo ""

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 1. Docker está rodando?
echo "1️⃣  Checking Docker..."
if docker info > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Docker is running${NC}"
else
    echo -e "${RED}❌ Docker is NOT running!${NC}"
    echo "   Please start Docker Desktop"
    exit 1
fi

# 2. Containers status
echo ""
echo "2️⃣  Checking containers..."
BACKEND_STATUS=$(docker inspect -f '{{.State.Status}}' ai-orchestrator-backend 2>/dev/null)
FRONTEND_STATUS=$(docker inspect -f '{{.State.Status}}' ai-orchestrator-frontend 2>/dev/null)
DB_STATUS=$(docker inspect -f '{{.State.Status}}' ai-orchestrator-db 2>/dev/null)

if [ "$BACKEND_STATUS" = "running" ]; then
    BACKEND_HEALTH=$(docker inspect -f '{{.State.Health.Status}}' ai-orchestrator-backend 2>/dev/null)
    echo -e "${GREEN}✅ Backend container: running ($BACKEND_HEALTH)${NC}"
else
    echo -e "${RED}❌ Backend container: ${BACKEND_STATUS:-not found}${NC}"
fi

if [ "$FRONTEND_STATUS" = "running" ]; then
    echo -e "${GREEN}✅ Frontend container: running${NC}"
else
    echo -e "${RED}❌ Frontend container: ${FRONTEND_STATUS:-not found}${NC}"
fi

if [ "$DB_STATUS" = "running" ]; then
    DB_HEALTH=$(docker inspect -f '{{.State.Health.Status}}' ai-orchestrator-db 2>/dev/null)
    echo -e "${GREEN}✅ Database container: running ($DB_HEALTH)${NC}"
else
    echo -e "${RED}❌ Database container: ${DB_STATUS:-not found}${NC}"
fi

# 3. Port mapping
echo ""
echo "3️⃣  Checking port mappings..."
docker ps --format "table {{.Names}}\t{{.Ports}}" | grep ai-orchestrator

# 4. Backend health
echo ""
echo "4️⃣  Testing backend health..."
HEALTH=$(curl -s http://localhost:8000/health)
if echo "$HEALTH" | grep -q '"status":"ok"'; then
    echo -e "${GREEN}✅ Backend is healthy${NC}"
    echo "   Response: $HEALTH"
else
    echo -e "${RED}❌ Backend not responding${NC}"
    echo "   Response: $HEALTH"
fi

# 5. API test
echo ""
echo "5️⃣  Testing API endpoints..."
PROJECTS=$(curl -s http://localhost:8000/api/v1/projects/)
if echo "$PROJECTS" | grep -q '\['; then
    echo -e "${GREEN}✅ Projects API responding${NC}"
else
    echo -e "${YELLOW}⚠️  Projects API returned: $PROJECTS${NC}"
fi

# 6. Recent logs
echo ""
echo "6️⃣  Recent backend logs (last 20 lines):"
echo "─────────────────────────────────────────"
docker-compose logs --tail=20 backend 2>/dev/null || docker logs ai-orchestrator-backend --tail=20

echo ""
echo "================================"
echo "Diagnostic complete!"
echo ""
echo "💡 Next steps:"
if [ "$BACKEND_STATUS" != "running" ] || [ "$FRONTEND_STATUS" != "running" ] || [ "$DB_STATUS" != "running" ]; then
    echo "   - Containers not running: docker-compose up -d"
elif echo "$HEALTH" | grep -q '"status":"ok"'; then
    echo -e "   ${GREEN}✅ All systems operational!${NC}"
    echo "   - Frontend: http://localhost:3000"
    echo "   - Backend API: http://localhost:8000/docs"
    echo "   - Debug console: http://localhost:3000/debug"
else
    echo "   - Backend not healthy: docker-compose logs backend"
    echo "   - Try rebuilding: docker-compose build backend"
    echo "   - Or restart: docker-compose restart backend"
fi
echo ""

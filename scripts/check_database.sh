#!/bin/bash
# Script to check database tables and schema

set -e

echo "📊 Checking database schema..."
echo ""

# Check tables
echo "=== Database Tables ==="
docker-compose exec -T postgres psql -U aiorch -d ai_orchestrator -c "\dt"

echo ""
echo "=== Custom Types ==="
docker-compose exec -T postgres psql -U aiorch -d ai_orchestrator -c "\dT+"

echo ""
echo "=== Projects Table Schema ==="
docker-compose exec -T postgres psql -U aiorch -d ai_orchestrator -c "\d projects"

echo ""
echo "=== Tasks Table Schema ==="
docker-compose exec -T postgres psql -U aiorch -d ai_orchestrator -c "\d tasks"

echo ""
echo "✅ Database check complete!"

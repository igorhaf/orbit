#!/bin/bash
# Script to apply Alembic migrations

set -e

echo "🔄 Applying Alembic migrations..."

# Check if Docker is running
if ! docker-compose ps | grep -q "ai-orchestrator-backend"; then
    echo "⚠️  Backend container is not running"
    echo "Starting Docker containers..."
    docker-compose up -d
    echo "Waiting for backend to be ready..."
    sleep 10
fi

# Apply migrations
echo "Running alembic upgrade head..."
docker-compose exec -T backend poetry run alembic upgrade head

echo "✅ Migrations applied successfully!"

# Show current database state
echo ""
echo "📊 Current database tables:"
docker-compose exec -T postgres psql -U aiorch -d ai_orchestrator -c "\dt"

echo ""
echo "🎉 Database is ready!"

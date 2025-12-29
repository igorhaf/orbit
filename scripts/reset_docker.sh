#!/bin/bash
# Script to reset Docker environment and fix database issues

set -e

echo "🔄 Resetting Docker environment..."
echo ""

# Stop all containers
echo "1. Stopping containers..."
docker-compose down

# Remove volumes (this will delete all database data)
echo "2. Removing volumes..."
docker-compose down -v

# Remove any dangling images
echo "3. Cleaning up Docker..."
docker system prune -f

echo ""
echo "✅ Docker environment reset complete!"
echo ""
echo "Now you can rebuild and start fresh:"
echo "  docker-compose up --build"
echo ""

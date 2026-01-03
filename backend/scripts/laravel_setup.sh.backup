#!/bin/bash
# Laravel Backend Provisioning Script
# Uses Docker to create complete Laravel installation
# PROMPT #51 - Fixed: Complete Laravel Installation

set -e  # Exit on error

PROJECT_NAME="$1"

if [ -z "$PROJECT_NAME" ]; then
    echo "Error: Project name required"
    echo "Usage: $0 <project-name>"
    exit 1
fi

PROJECT_PATH="/projects/$PROJECT_NAME"
BACKEND_PATH="$PROJECT_PATH/backend"

echo "=========================================="
echo "Laravel Backend Provisioning"
echo "=========================================="
echo "Project: $PROJECT_NAME"
echo "Backend Path: $BACKEND_PATH"
echo ""

# Ensure project root exists
if [ ! -d "$PROJECT_PATH" ]; then
    echo "Error: Project directory not found: $PROJECT_PATH"
    exit 1
fi

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "Error: Docker not found. Using fallback method..."
    # Fallback: create basic structure only
    mkdir -p "$BACKEND_PATH"
    echo "Created basic backend structure (Docker not available for full installation)"
    exit 0
fi

echo "Installing Laravel using Docker Composer..."

# Create Laravel project using official Composer Docker image
# This ensures complete Laravel installation with all files
docker run --rm -v "$PROJECT_PATH:/app" -w /app \
    composer:latest \
    create-project --prefer-dist laravel/laravel backend

echo "Configuring Laravel environment..."

# Configure .env file for PostgreSQL
cd "$BACKEND_PATH"

# Update .env with project-specific settings
cat > .env << EOF
APP_NAME="${PROJECT_NAME//-/_}"
APP_ENV=local
APP_KEY=
APP_DEBUG=true
APP_URL=http://localhost:8000

LOG_CHANNEL=stack
LOG_LEVEL=debug

DB_CONNECTION=pgsql
DB_HOST=database
DB_PORT=5432
DB_DATABASE=${PROJECT_NAME//-/_}_db
DB_USERNAME=orbit_user
DB_PASSWORD=orbit_password

BROADCAST_DRIVER=log
CACHE_DRIVER=file
FILESYSTEM_DISK=local
QUEUE_CONNECTION=sync
SESSION_DRIVER=file
SESSION_LIFETIME=120

MEMCACHED_HOST=127.0.0.1

REDIS_HOST=127.0.0.1
REDIS_PASSWORD=null
REDIS_PORT=6379

MAIL_MAILER=smtp
MAIL_HOST=mailpit
MAIL_PORT=1025
MAIL_USERNAME=null
MAIL_PASSWORD=null
MAIL_ENCRYPTION=null
MAIL_FROM_ADDRESS="hello@example.com"
MAIL_FROM_NAME="\${APP_NAME}"
EOF

# Install Sanctum for API authentication
echo "Installing Laravel Sanctum..."
docker run --rm -v "$BACKEND_PATH:/app" -w /app \
    composer:latest \
    require laravel/sanctum

echo ""
echo "✅ Laravel backend provisioned successfully!"
echo ""
echo "Database Configuration:"
echo "  Database: ${PROJECT_NAME//-/_}_db"
echo "  Username: orbit_user"
echo "  Password: orbit_password"
echo "  Host: database"
echo "  Port: 5432"
echo ""
echo "Laravel installation complete with:"
echo "  - Full Laravel framework structure"
echo "  - All Composer dependencies installed"
echo "  - Sanctum for API authentication"
echo "  - PostgreSQL configuration"
echo ""

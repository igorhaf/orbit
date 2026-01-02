#!/bin/bash
# Laravel Backend Provisioning Script
# Creates backend/ folder structure with configuration files
# PROMPT #51 - New Architecture Implementation (Simplified)

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

# Create backend directory structure
echo "Creating backend directory structure..."
mkdir -p "$BACKEND_PATH"
mkdir -p "$BACKEND_PATH/app/Http/Controllers"
mkdir -p "$BACKEND_PATH/app/Models"
mkdir -p "$BACKEND_PATH/database/migrations"
mkdir -p "$BACKEND_PATH/routes"
mkdir -p "$BACKEND_PATH/config"

# Create .env file
echo "Creating Laravel environment configuration..."
cat > "$BACKEND_PATH/.env" << EOF
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

CACHE_DRIVER=file
QUEUE_CONNECTION=sync
SESSION_DRIVER=file
SESSION_LIFETIME=120
EOF

# Create composer.json
echo "Creating composer.json..."
cat > "$BACKEND_PATH/composer.json" << EOF
{
    "name": "${PROJECT_NAME}/backend",
    "type": "project",
    "description": "Laravel backend for $PROJECT_NAME",
    "require": {
        "php": "^8.2",
        "laravel/framework": "^11.0",
        "laravel/sanctum": "^4.0"
    },
    "require-dev": {
        "laravel/pint": "^1.0"
    },
    "autoload": {
        "psr-4": {
            "App\\\\": "app/",
            "Database\\\\Factories\\\\": "database/factories/",
            "Database\\\\Seeders\\\\": "database/seeders/"
        }
    },
    "scripts": {
        "post-root-package-install": [
            "@php -r \\"file_exists('.env') || copy('.env.example', '.env');\\"
        ],
        "post-create-project-cmd": [
            "@php artisan key:generate --ansi"
        ]
    },
    "config": {
        "optimize-autoloader": true,
        "preferred-install": "dist",
        "sort-packages": true
    },
    "minimum-stability": "stable",
    "prefer-stable": true
}
EOF

# Create setup instructions
cat > "$BACKEND_PATH/README.md" << EOF
# Laravel Backend - $PROJECT_NAME

## Setup

This Laravel backend will be installed automatically by Docker.

### Manual Setup (if needed)

\`\`\`bash
composer install
php artisan key:generate
php artisan migrate
php artisan serve
\`\`\`

## Database Configuration

- **Database:** ${PROJECT_NAME//-/_}_db
- **Username:** orbit_user
- **Password:** orbit_password
- **Host:** database (Docker service)
- **Port:** 5432

## API Endpoints

API will be available at: http://localhost:8000/api

EOF

echo ""
echo "✅ Laravel backend structure created successfully!"
echo ""
echo "Database Configuration:"
echo "  Database: ${PROJECT_NAME//-/_}_db"
echo "  Username: orbit_user"
echo "  Password: orbit_password"
echo "  Host: database"
echo "  Port: 5432"
echo ""

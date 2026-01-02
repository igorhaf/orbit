#!/bin/bash
# Laravel Backend Provisioning Script
# Creates backend/ folder with Laravel installation
# PROMPT #51 - New Architecture Implementation

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

# Create backend directory
echo "Creating backend directory..."
mkdir -p "$BACKEND_PATH"

# Install Laravel using Composer
echo "Installing Laravel..."
cd "$PROJECT_PATH"

# Use Laravel installer or Composer create-project
composer create-project --prefer-dist laravel/laravel backend

cd "$BACKEND_PATH"

# Configure environment
echo "Configuring Laravel environment..."
cp .env.example .env

# Generate application key
php artisan key:generate

# Configure database connection for PostgreSQL
echo "Configuring PostgreSQL database..."
sed -i 's/DB_CONNECTION=.*/DB_CONNECTION=pgsql/' .env
sed -i "s/DB_DATABASE=.*/DB_DATABASE=${PROJECT_NAME//-/_}_db/" .env
sed -i 's/DB_USERNAME=.*/DB_USERNAME=orbit_user/' .env
sed -i 's/DB_PASSWORD=.*/DB_PASSWORD=orbit_password/' .env
sed -i 's/DB_HOST=.*/DB_HOST=database/' .env  # Docker service name
sed -i 's/DB_PORT=.*/DB_PORT=5432/' .env

# Install additional packages
echo "Installing additional Laravel packages..."
composer require laravel/sanctum
composer require --dev laravel/pint

# Publish Sanctum configuration
php artisan vendor:publish --provider="Laravel\Sanctum\SanctumServiceProvider"

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
echo "Next Steps:"
echo "  1. cd projects/$PROJECT_NAME/backend"
echo "  2. php artisan migrate"
echo "  3. php artisan serve"
echo ""

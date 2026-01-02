#!/bin/bash
# Docker Configuration Provisioning Script
# Creates devops/ folder and docker-compose.yml at project root
# PROMPT #51 - New Architecture Implementation

set -e  # Exit on error

PROJECT_NAME="$1"

if [ -z "$PROJECT_NAME" ]; then
    echo "Error: Project name required"
    echo "Usage: $0 <project-name>"
    exit 1
fi

PROJECT_PATH="/projects/$PROJECT_NAME"
DEVOPS_PATH="$PROJECT_PATH/devops"
DATABASE_PATH="$PROJECT_PATH/database"

echo "=========================================="
echo "Docker Configuration Provisioning"
echo "=========================================="
echo "Project: $PROJECT_NAME"
echo "DevOps Path: $DEVOPS_PATH"
echo ""

# Ensure project root exists
if [ ! -d "$PROJECT_PATH" ]; then
    echo "Error: Project directory not found: $PROJECT_PATH"
    exit 1
fi

# Create devops directory structure
echo "Creating DevOps directory structure..."
mkdir -p "$DEVOPS_PATH/nginx"
mkdir -p "$DEVOPS_PATH/php"
mkdir -p "$DATABASE_PATH/init"

# Create Dockerfile for Laravel backend
echo "Creating Laravel Dockerfile..."
cat > "$DEVOPS_PATH/php/Dockerfile" << 'EOF'
FROM php:8.2-fpm

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    libpng-dev \
    libonig-dev \
    libxml2-dev \
    libpq-dev \
    zip \
    unzip

# Clear cache
RUN apt-get clean && rm -rf /var/lib/apt/lists/*

# Install PHP extensions
RUN docker-php-ext-install pdo_pgsql pgsql mbstring exif pcntl bcmath gd

# Install Composer
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

# Set working directory
WORKDIR /var/www

# Copy application files
COPY ./backend /var/www

# Install dependencies
RUN composer install --no-interaction --optimize-autoloader --no-dev

# Set permissions
RUN chown -R www-data:www-data /var/www

EXPOSE 9000
CMD ["php-fpm"]
EOF

# Create Nginx configuration
echo "Creating Nginx configuration..."
cat > "$DEVOPS_PATH/nginx/default.conf" << 'EOF'
server {
    listen 80;
    server_name localhost;
    root /var/www/public;

    index index.php index.html;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        fastcgi_pass backend:9000;
        fastcgi_index index.php;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;
    }

    location ~ /\.ht {
        deny all;
    }
}
EOF

# Create PostgreSQL initialization script
echo "Creating PostgreSQL initialization script..."
cat > "$DATABASE_PATH/init/01-create-database.sql" << EOF
-- Create database for project
CREATE DATABASE ${PROJECT_NAME//-/_}_db;
CREATE USER orbit_user WITH PASSWORD 'orbit_password';
GRANT ALL PRIVILEGES ON DATABASE ${PROJECT_NAME//-/_}_db TO orbit_user;
EOF

# Create docker-compose.yml at project root
echo "Creating docker-compose.yml..."
cat > "$PROJECT_PATH/docker-compose.yml" << EOF
version: '3.8'

services:
  # PostgreSQL Database
  database:
    image: postgres:15-alpine
    container_name: ${PROJECT_NAME}_database
    environment:
      POSTGRES_DB: ${PROJECT_NAME//-/_}_db
      POSTGRES_USER: orbit_user
      POSTGRES_PASSWORD: orbit_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./database/init:/docker-entrypoint-initdb.d
    ports:
      - "5432:5432"
    networks:
      - ${PROJECT_NAME}_network

  # Laravel Backend
  backend:
    build:
      context: .
      dockerfile: ./devops/php/Dockerfile
    container_name: ${PROJECT_NAME}_backend
    volumes:
      - ./backend:/var/www
    environment:
      DB_CONNECTION: pgsql
      DB_HOST: database
      DB_PORT: 5432
      DB_DATABASE: ${PROJECT_NAME//-/_}_db
      DB_USERNAME: orbit_user
      DB_PASSWORD: orbit_password
    depends_on:
      - database
    networks:
      - ${PROJECT_NAME}_network

  # Nginx Web Server
  nginx:
    image: nginx:alpine
    container_name: ${PROJECT_NAME}_nginx
    ports:
      - "8000:80"
    volumes:
      - ./backend:/var/www
      - ./devops/nginx/default.conf:/etc/nginx/conf.d/default.conf
    depends_on:
      - backend
    networks:
      - ${PROJECT_NAME}_network

  # Next.js Frontend
  frontend:
    image: node:18-alpine
    container_name: ${PROJECT_NAME}_frontend
    working_dir: /app
    volumes:
      - ./frontend:/app
      - /app/node_modules
    ports:
      - "3000:3000"
    command: sh -c "npm install && npm run dev"
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:8000/api
    depends_on:
      - nginx
    networks:
      - ${PROJECT_NAME}_network

networks:
  ${PROJECT_NAME}_network:
    driver: bridge

volumes:
  postgres_data:
EOF

# Create .dockerignore
echo "Creating .dockerignore..."
cat > "$PROJECT_PATH/.dockerignore" << 'EOF'
node_modules
.next
.git
.env.local
.env.*.local
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.DS_Store
EOF

# Create README with instructions
echo "Creating setup README..."
cat > "$PROJECT_PATH/README.md" << EOF
# $PROJECT_NAME

Auto-provisioned by ORBIT

## Architecture

\`\`\`
$PROJECT_NAME/
├── backend/           # Laravel API
├── frontend/          # Next.js + Tailwind
├── database/          # PostgreSQL configs
├── devops/            # Docker configs
└── docker-compose.yml # Main orchestration
\`\`\`

## Tech Stack

- **Backend:** Laravel + PostgreSQL
- **Frontend:** Next.js + TypeScript + Tailwind CSS
- **Database:** PostgreSQL 15
- **Containers:** Docker + Docker Compose

## Quick Start

\`\`\`bash
# Start all services
docker-compose up -d

# Run Laravel migrations
docker-compose exec backend php artisan migrate

# Access services
# - Frontend: http://localhost:3000
# - Backend API: http://localhost:8000/api
# - Database: localhost:5432
\`\`\`

## Development

### Backend (Laravel)
\`\`\`bash
cd backend
composer install
php artisan key:generate
php artisan migrate
\`\`\`

### Frontend (Next.js)
\`\`\`bash
cd frontend
npm install
npm run dev
\`\`\`

## Database Credentials

- **Database:** ${PROJECT_NAME//-/_}_db
- **User:** orbit_user
- **Password:** orbit_password
- **Port:** 5432

---
Generated by ORBIT - AI Prompt Architecture System
EOF

echo ""
echo "✅ Docker configuration provisioned successfully!"
echo ""
echo "Project Structure Created:"
echo "  ├── backend/           (Laravel)"
echo "  ├── frontend/          (Next.js + Tailwind)"
echo "  ├── database/          (PostgreSQL init scripts)"
echo "  ├── devops/            (Docker configs)"
echo "  └── docker-compose.yml (Main orchestration)"
echo ""
echo "Services Configuration:"
echo "  - Frontend: http://localhost:3000"
echo "  - Backend API: http://localhost:8000/api"
echo "  - Database: localhost:5432"
echo ""
echo "Database:"
echo "  Database: ${PROJECT_NAME//-/_}_db"
echo "  Username: orbit_user"
echo "  Password: orbit_password"
echo ""
echo "Next Steps:"
echo "  1. cd projects/$PROJECT_NAME"
echo "  2. docker-compose up -d"
echo "  3. docker-compose exec backend php artisan migrate"
echo ""

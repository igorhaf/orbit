#!/bin/bash
# Laravel + PostgreSQL + Tailwind CSS Provisioning Script
# Creates a complete Laravel project with Docker Compose

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() { echo -e "${BLUE}ℹ ${NC}$1"; }
print_success() { echo -e "${GREEN}✓${NC} $1"; }
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
print_error() { echo -e "${RED}✗${NC} $1"; }

# ============================================================================
# CONFIGURATION
# ============================================================================

PROJECT_NAME="$1"
PROJECT_DIR="/projects/${PROJECT_NAME}"
DB_NAME=$(echo "$PROJECT_NAME" | tr '[:upper:]' '[:lower:]' | tr '-' '_')
DB_USER="${DB_NAME}_user"
DB_PASSWORD=$(openssl rand -base64 12)

# Port allocation (avoiding conflicts with ORBIT)
# ORBIT uses: 3000, 3001, 5432, 6379, 6831, 8000, 9090, 14268, 16686
NGINX_PORT=8080
POSTGRES_PORT=5433
ADMINER_PORT=8081

# ============================================================================
# VALIDATION
# ============================================================================

if [ -z "$PROJECT_NAME" ]; then
    print_error "Usage: $0 <project-name>"
    exit 1
fi

if [ -d "$PROJECT_DIR" ]; then
    print_error "Project directory already exists: $PROJECT_DIR"
    exit 1
fi

print_info "Starting Laravel project provisioning..."
print_info "Project: ${PROJECT_NAME}"
print_info "Location: ${PROJECT_DIR}"
echo ""

# ============================================================================
# CREATE PROJECT STRUCTURE
# ============================================================================

print_info "Creating project directory..."
mkdir -p "$PROJECT_DIR"
cd "$PROJECT_DIR"
print_success "Project directory created"

# ============================================================================
# GENERATE DOCKER COMPOSE
# ============================================================================

print_info "Generating docker-compose.yml..."

cat > docker-compose.yml <<EOF
version: '3.8'

services:
  # ============================================================================
  # Laravel Application (PHP-FPM + Nginx)
  # ============================================================================
  app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: ${PROJECT_NAME}-app
    restart: unless-stopped
    working_dir: /var/www
    volumes:
      - ./:/var/www
      - ./docker/php/local.ini:/usr/local/etc/php/conf.d/local.ini
    networks:
      - ${PROJECT_NAME}-network
    depends_on:
      - db

  # ============================================================================
  # Nginx Web Server
  # ============================================================================
  nginx:
    image: nginx:alpine
    container_name: ${PROJECT_NAME}-nginx
    restart: unless-stopped
    ports:
      - "${NGINX_PORT}:80"
    volumes:
      - ./:/var/www
      - ./docker/nginx/default.conf:/etc/nginx/conf.d/default.conf
    networks:
      - ${PROJECT_NAME}-network
    depends_on:
      - app

  # ============================================================================
  # PostgreSQL Database
  # ============================================================================
  db:
    image: postgres:15-alpine
    container_name: ${PROJECT_NAME}-db
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${DB_NAME}
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      PGDATA: /var/lib/postgresql/data/pgdata
    volumes:
      - postgres-data:/var/lib/postgresql/data
    ports:
      - "${POSTGRES_PORT}:5432"
    networks:
      - ${PROJECT_NAME}-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER} -d ${DB_NAME}"]
      interval: 10s
      timeout: 5s
      retries: 5

  # ============================================================================
  # Adminer (Database Management UI)
  # ============================================================================
  adminer:
    image: adminer:latest
    container_name: ${PROJECT_NAME}-adminer
    restart: unless-stopped
    ports:
      - "${ADMINER_PORT}:8080"
    environment:
      ADMINER_DEFAULT_SERVER: db
    networks:
      - ${PROJECT_NAME}-network
    depends_on:
      - db

networks:
  ${PROJECT_NAME}-network:
    driver: bridge

volumes:
  postgres-data:
    driver: local
EOF

print_success "docker-compose.yml created"

# ============================================================================
# GENERATE DOCKERFILE
# ============================================================================

print_info "Generating Dockerfile..."

cat > Dockerfile <<'EOF'
FROM php:8.2-fpm

# Set working directory
WORKDIR /var/www

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    libpng-dev \
    libonig-dev \
    libxml2-dev \
    libpq-dev \
    zip \
    unzip \
    nodejs \
    npm

# Clear cache
RUN apt-get clean && rm -rf /var/lib/apt/lists/*

# Install PHP extensions
RUN docker-php-ext-install pdo pdo_pgsql pgsql mbstring exif pcntl bcmath gd

# Install Composer
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

# Create system user
RUN useradd -G www-data,root -u 1000 -d /home/laravel laravel
RUN mkdir -p /home/laravel/.composer && \
    chown -R laravel:laravel /home/laravel

# Set user
USER laravel

# Expose port 9000 and start php-fpm server
EXPOSE 9000
CMD ["php-fpm"]
EOF

print_success "Dockerfile created"

# ============================================================================
# GENERATE NGINX CONFIGURATION
# ============================================================================

print_info "Generating Nginx configuration..."

mkdir -p docker/nginx

cat > docker/nginx/default.conf <<'EOF'
server {
    listen 80;
    server_name localhost;
    root /var/www/public;
    index index.php index.html;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        try_files $uri =404;
        fastcgi_split_path_info ^(.+\.php)(/.+)$;
        fastcgi_pass app:9000;
        fastcgi_index index.php;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        fastcgi_param PATH_INFO $fastcgi_path_info;
    }

    location ~ /\.(?!well-known).* {
        deny all;
    }
}
EOF

print_success "Nginx configuration created"

# ============================================================================
# GENERATE PHP CONFIGURATION
# ============================================================================

print_info "Generating PHP configuration..."

mkdir -p docker/php

cat > docker/php/local.ini <<EOF
upload_max_filesize=40M
post_max_size=40M
memory_limit=256M
max_execution_time=600
EOF

print_success "PHP configuration created"

# ============================================================================
# GENERATE .ENV FILE
# ============================================================================

print_info "Generating .env file..."

cat > .env <<EOF
# Application
APP_NAME="${PROJECT_NAME}"
APP_ENV=local
APP_KEY=
APP_DEBUG=true
APP_URL=http://localhost:${NGINX_PORT}

# Database
DB_CONNECTION=pgsql
DB_HOST=db
DB_PORT=5432
DB_DATABASE=${DB_NAME}
DB_USERNAME=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}

# Cache & Session
CACHE_DRIVER=file
SESSION_DRIVER=file
QUEUE_CONNECTION=sync

# Mail
MAIL_MAILER=smtp
MAIL_HOST=mailhog
MAIL_PORT=1025
MAIL_USERNAME=null
MAIL_PASSWORD=null
MAIL_ENCRYPTION=null
MAIL_FROM_ADDRESS="hello@example.com"
MAIL_FROM_NAME="\${APP_NAME}"
EOF

print_success ".env file created"

# ============================================================================
# GENERATE SETUP SCRIPT
# ============================================================================

print_info "Generating setup script..."

cat > setup.sh <<'EOF'
#!/bin/bash
# Laravel project setup script

set -e

echo "🚀 Setting up Laravel project..."

# Build and start containers
echo "📦 Building Docker containers..."
docker-compose build

echo "🔄 Starting containers..."
docker-compose up -d

# Wait for database to be ready
echo "⏳ Waiting for database to be ready..."
sleep 10

# Install Laravel
echo "📥 Installing Laravel..."
docker-compose exec -u laravel app composer create-project --prefer-dist laravel/laravel:^10.0 temp
docker-compose exec -u laravel app sh -c "shopt -s dotglob && mv temp/* ./ && rmdir temp"

# Copy environment file
echo "📝 Configuring environment..."
docker-compose exec -u laravel app cp .env.example .env
docker-compose exec -u laravel app sh -c "cat ../.env >> .env"

# Generate application key
echo "🔑 Generating application key..."
docker-compose exec -u laravel app php artisan key:generate

# Install Tailwind CSS
echo "🎨 Installing Tailwind CSS..."
docker-compose exec -u laravel app npm install -D tailwindcss postcss autoprefixer
docker-compose exec -u laravel app npx tailwindcss init -p

# Configure Tailwind
docker-compose exec -u laravel app sh -c "cat > tailwind.config.js <<'TAILWIND'
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './resources/**/*.blade.php',
    './resources/**/*.js',
    './resources/**/*.vue',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
TAILWIND"

# Add Tailwind directives to CSS
docker-compose exec -u laravel app sh -c "cat > resources/css/app.css <<'CSS'
@tailwind base;
@tailwind components;
@tailwind utilities;
CSS"

# Build assets
echo "🏗️ Building frontend assets..."
docker-compose exec -u laravel app npm install
docker-compose exec -u laravel app npm run build

# Run migrations
echo "🗄️ Running database migrations..."
docker-compose exec -u laravel app php artisan migrate --force

# Set permissions
echo "🔐 Setting permissions..."
docker-compose exec app chown -R laravel:www-data /var/www/storage /var/www/bootstrap/cache
docker-compose exec app chmod -R 775 /var/www/storage /var/www/bootstrap/cache

echo ""
echo "✅ Laravel project setup complete!"
echo ""
echo "📍 Access your application:"
echo "   - Web: http://localhost:${NGINX_PORT}"
echo "   - Adminer: http://localhost:${ADMINER_PORT}"
echo ""
echo "🗄️ Database credentials:"
echo "   - Host: localhost:${POSTGRES_PORT}"
echo "   - Database: ${DB_NAME}"
echo "   - Username: ${DB_USER}"
echo "   - Password: ${DB_PASSWORD}"
echo ""
echo "🛠️ Useful commands:"
echo "   - Start: docker-compose up -d"
echo "   - Stop: docker-compose down"
echo "   - Logs: docker-compose logs -f"
echo "   - Artisan: docker-compose exec app php artisan"
echo "   - Composer: docker-compose exec app composer"
echo "   - NPM: docker-compose exec app npm"
echo ""
EOF

chmod +x setup.sh

print_success "Setup script created"

# ============================================================================
# GENERATE README
# ============================================================================

print_info "Generating README..."

cat > README.md <<EOF
# ${PROJECT_NAME}

Laravel application with PostgreSQL and Tailwind CSS.

## 🚀 Quick Start

\`\`\`bash
# Run setup (first time only)
./setup.sh

# Start the application
docker-compose up -d

# View logs
docker-compose logs -f
\`\`\`

## 📍 Access Points

- **Application**: http://localhost:${NGINX_PORT}
- **Adminer (DB UI)**: http://localhost:${ADMINER_PORT}

## 🗄️ Database

- **Host**: localhost:${POSTGRES_PORT}
- **Database**: ${DB_NAME}
- **Username**: ${DB_USER}
- **Password**: ${DB_PASSWORD}

## 🛠️ Development Commands

\`\`\`bash
# Artisan commands
docker-compose exec app php artisan migrate
docker-compose exec app php artisan make:controller UserController
docker-compose exec app php artisan tinker

# Composer
docker-compose exec app composer install
docker-compose exec app composer require vendor/package

# NPM
docker-compose exec app npm install
docker-compose exec app npm run dev
docker-compose exec app npm run build

# Database
docker-compose exec db psql -U ${DB_USER} -d ${DB_NAME}
\`\`\`

## 📦 Tech Stack

- **Backend**: Laravel 10.x
- **Database**: PostgreSQL 15
- **Frontend**: Blade + Tailwind CSS 3.x
- **Web Server**: Nginx
- **Runtime**: PHP 8.2

## 🔧 Project Structure

\`\`\`
.
├── app/                 # Application code
├── resources/           # Views, CSS, JS
├── routes/              # Route definitions
├── database/            # Migrations, seeders
├── public/              # Public assets
├── docker/              # Docker configurations
├── docker-compose.yml   # Docker Compose config
└── Dockerfile           # PHP-FPM image
\`\`\`

## 📝 Notes

- This project was generated by ORBIT
- Tailwind CSS is configured and ready to use
- PostgreSQL is used instead of MySQL
- Adminer provides a web interface for database management

## 🐛 Troubleshooting

**Permission issues:**
\`\`\`bash
docker-compose exec app chown -R laravel:www-data /var/www/storage /var/www/bootstrap/cache
docker-compose exec app chmod -R 775 /var/www/storage /var/www/bootstrap/cache
\`\`\`

**Clear cache:**
\`\`\`bash
docker-compose exec app php artisan cache:clear
docker-compose exec app php artisan config:clear
docker-compose exec app php artisan view:clear
\`\`\`

**Rebuild containers:**
\`\`\`bash
docker-compose down
docker-compose build --no-cache
docker-compose up -d
\`\`\`
EOF

print_success "README.md created"

# ============================================================================
# GENERATE .GITIGNORE
# ============================================================================

print_info "Generating .gitignore..."

cat > .gitignore <<EOF
# Laravel
/node_modules
/public/hot
/public/storage
/storage/*.key
/vendor
.env
.env.backup
.phpunit.result.cache
docker-compose.override.yml
Homestead.json
Homestead.yaml
npm-debug.log
yarn-error.log
/.idea
/.vscode

# OS
.DS_Store
Thumbs.db
EOF

print_success ".gitignore created"

# ============================================================================
# SUMMARY
# ============================================================================

echo ""
print_success "=========================================="
print_success "Laravel project provisioned successfully!"
print_success "=========================================="
echo ""
print_info "Project: ${PROJECT_NAME}"
print_info "Location: ${PROJECT_DIR}"
echo ""
print_info "Next steps:"
echo "  1. cd ${PROJECT_DIR}"
echo "  2. ./setup.sh"
echo ""
print_info "Ports allocated:"
echo "  - Application: ${NGINX_PORT}"
echo "  - Database: ${POSTGRES_PORT}"
echo "  - Adminer: ${ADMINER_PORT}"
echo ""
print_info "Database credentials:"
echo "  - Database: ${DB_NAME}"
echo "  - User: ${DB_USER}"
echo "  - Password: ${DB_PASSWORD}"
echo ""
print_warning "IMPORTANT: Save these credentials! They are stored in .env file."
echo ""

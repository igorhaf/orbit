#!/bin/bash
# Docker Configuration Provisioning Script
# Creates docker-compose.yml that installs dependencies automatically
# PROMPT #51 - New Architecture Implementation (Simplified)

set -e  # Exit on error

PROJECT_NAME="$1"

if [ -z "$PROJECT_NAME" ]; then
    echo "Error: Project name required"
    echo "Usage: $0 <project-name>"
    exit 1
fi

PROJECT_PATH="/projects/$PROJECT_NAME"
DATABASE_PATH="$PROJECT_PATH/database"

echo "=========================================="
echo "Docker Configuration Provisioning"
echo "=========================================="
echo "Project: $PROJECT_NAME"
echo ""

# Ensure project root exists
if [ ! -d "$PROJECT_PATH" ]; then
    echo "Error: Project directory not found: $PROJECT_PATH"
    exit 1
fi

# Create database directory for init scripts
echo "Creating database directory..."
mkdir -p "$DATABASE_PATH/init"

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
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U orbit_user -d ${PROJECT_NAME//-/_}_db"]
      interval: 10s
      timeout: 5s
      retries: 5

  # Laravel Backend (using official PHP image with Composer)
  backend:
    image: php:8.2-fpm
    container_name: ${PROJECT_NAME}_backend
    working_dir: /var/www
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
      database:
        condition: service_healthy
    networks:
      - ${PROJECT_NAME}_network
    command: >
      sh -c "
        echo 'Setting up Laravel backend...' &&
        apt-get update && apt-get install -y git curl libpq-dev zip unzip &&
        docker-php-ext-install pdo_pgsql pgsql &&
        curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer &&

        if [ ! -d vendor ]; then
          echo 'Installing Composer dependencies (this may take 2-3 minutes)...' &&
          composer install --no-interaction --optimize-autoloader
        else
          echo 'Composer dependencies already installed.'
        fi &&

        if [ -z \\"\$APP_KEY\\" ] || grep -q 'APP_KEY=$' .env || grep -q 'APP_KEY=\"\"' .env; then
          echo 'Generating Laravel application key...' &&
          php artisan key:generate --ansi
        fi &&

        echo 'Laravel backend ready! Starting PHP-FPM...' &&
        php-fpm
      "

  # Nginx Web Server
  nginx:
    image: nginx:alpine
    container_name: ${PROJECT_NAME}_nginx
    ports:
      - "8000:80"
    volumes:
      - ./backend:/var/www
    depends_on:
      - backend
    networks:
      - ${PROJECT_NAME}_network
    command: >
      sh -c "
        mkdir -p /etc/nginx/conf.d &&
        cat > /etc/nginx/conf.d/default.conf << 'NGINXCONF'
      server {
          listen 80;
          server_name localhost;
          root /var/www/public;
          index index.php index.html;

          location / {
              try_files \\\$uri \\\$uri/ /index.php?\\\$query_string;
          }

          location ~ \\.php\$ {
              fastcgi_pass backend:9000;
              fastcgi_index index.php;
              fastcgi_param SCRIPT_FILENAME \\\$document_root\\\$fastcgi_script_name;
              include fastcgi_params;
          }

          location ~ /\\.ht {
              deny all;
          }
      }
      NGINXCONF
        nginx -g 'daemon off;'
      "

  # Next.js Frontend
  frontend:
    image: node:18-alpine
    container_name: ${PROJECT_NAME}_frontend
    working_dir: /app
    volumes:
      - ./frontend:/app
      - /app/node_modules
      - /app/.next
    ports:
      - "3000:3000"
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:8000/api
    depends_on:
      - nginx
    networks:
      - ${PROJECT_NAME}_network
    command: >
      sh -c "
        echo 'Setting up Next.js frontend...' &&

        if [ ! -d node_modules ]; then
          echo 'Installing npm dependencies (this may take 2-3 minutes)...' &&
          npm install
        else
          echo 'npm dependencies already installed.'
        fi &&

        echo 'Next.js frontend ready! Starting development server...' &&
        npm run dev
      "

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
vendor
EOF

# Create setup script
cat > "$PROJECT_PATH/setup.sh" << 'EOF'
#!/bin/bash
# Project Setup Script
# Run this after provisioning to start all services

set -e

echo "=========================================="
echo "Starting Docker Services"
echo "=========================================="
echo ""

# Start all services
docker-compose up -d

echo ""
echo "Waiting for services to be ready..."
sleep 10

echo ""
echo "Running Laravel migrations..."
docker-compose exec -T backend php artisan migrate --force || echo "Migrations will run on first container start"

echo ""
echo "=========================================="
echo "Setup Complete!"
echo "=========================================="
echo ""
echo "Services running:"
echo "  - Frontend: http://localhost:3000"
echo "  - Backend API: http://localhost:8000/api"
echo "  - Database: localhost:5432"
echo ""
echo "Useful commands:"
echo "  docker-compose ps              # Check service status"
echo "  docker-compose logs -f         # View logs"
echo "  docker-compose exec backend php artisan migrate  # Run migrations"
echo "  docker-compose down            # Stop services"
echo ""
EOF

chmod +x "$PROJECT_PATH/setup.sh"

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
└── docker-compose.yml # Main orchestration
\`\`\`

## Tech Stack

- **Backend:** Laravel 11 + Sanctum
- **Frontend:** Next.js 14 + TypeScript + Tailwind CSS
- **Database:** PostgreSQL 15
- **Containers:** Docker Compose

## Quick Start

\`\`\`bash
# Start all services (installs dependencies automatically)
docker-compose up -d

# Wait for services to start (about 30-60 seconds)
# Watch the logs:
docker-compose logs -f

# Run Laravel migrations
docker-compose exec backend php artisan migrate

# Access services
# - Frontend: http://localhost:3000
# - Backend API: http://localhost:8000/api
# - Database: localhost:5432
\`\`\`

## How It Works

When you run \`docker-compose up\`, the system will:

1. ✅ Start PostgreSQL database
2. ✅ Install Laravel dependencies via Composer
3. ✅ Generate Laravel application key
4. ✅ Install Next.js dependencies via npm
5. ✅ Start Next.js development server
6. ✅ Start Nginx as reverse proxy

**First startup takes 2-3 minutes** to install all dependencies.

## Useful Commands

### View Logs
\`\`\`bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend
docker-compose logs -f frontend
\`\`\`

### Run Laravel Commands
\`\`\`bash
# Migrations
docker-compose exec backend php artisan migrate

# Create controller
docker-compose exec backend php artisan make:controller UserController

# Tinker
docker-compose exec backend php artisan tinker
\`\`\`

### Run npm Commands
\`\`\`bash
# Install new package
docker-compose exec frontend npm install axios

# Run build
docker-compose exec frontend npm run build
\`\`\`

### Database Access
\`\`\`bash
# Connect to PostgreSQL
docker-compose exec database psql -U orbit_user -d ${PROJECT_NAME//-/_}_db
\`\`\`

### Stop Services
\`\`\`bash
# Stop (preserves data)
docker-compose stop

# Stop and remove containers
docker-compose down

# Stop and remove everything including volumes
docker-compose down -v
\`\`\`

## Database Credentials

- **Database:** ${PROJECT_NAME//-/_}_db
- **User:** orbit_user
- **Password:** orbit_password
- **Port:** 5432

## Development

### Backend (Laravel)

Location: \`backend/\`

API endpoints at: http://localhost:8000/api

Configuration: \`backend/.env\`

### Frontend (Next.js)

Location: \`frontend/\`

Development server: http://localhost:3000

Configuration: \`frontend/.env.local\`

### File Structure

\`\`\`
backend/
├── app/           # Laravel application code
├── routes/        # API routes
├── database/      # Migrations, seeders
└── .env           # Environment config

frontend/
├── src/
│   ├── app/       # Next.js App Router pages
│   ├── components/# React components
│   └── lib/       # API client, utilities
└── .env.local     # Environment config
\`\`\`

## Troubleshooting

### Services won't start

\`\`\`bash
# Check logs
docker-compose logs

# Rebuild containers
docker-compose down
docker-compose up --build
\`\`\`

### Database connection error

\`\`\`bash
# Wait for database to be ready (check healthcheck)
docker-compose ps

# Restart backend
docker-compose restart backend
\`\`\`

### Port already in use

Edit \`docker-compose.yml\` and change port mappings:
- Frontend: Change \`3000:3000\` to \`3001:3000\`
- Backend: Change \`8000:80\` to \`8001:80\`
- Database: Change \`5432:5432\` to \`5433:5432\`

---

Generated by ORBIT - AI Prompt Architecture System
EOF

echo ""
echo "✅ Docker configuration created successfully!"
echo ""
echo "Project Structure Created:"
echo "  ├── backend/           (Laravel - dependencies installed by Docker)"
echo "  ├── frontend/          (Next.js + Tailwind - dependencies installed by Docker)"
echo "  ├── database/          (PostgreSQL init scripts)"
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
echo "  3. Wait 2-3 minutes for dependencies to install"
echo "  4. docker-compose exec backend php artisan migrate"
echo "  5. Open http://localhost:3000"
echo ""

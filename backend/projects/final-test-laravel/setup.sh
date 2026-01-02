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

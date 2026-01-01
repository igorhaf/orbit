#!/bin/bash
# Next.js + PostgreSQL + Tailwind CSS Provisioning Script
# Creates a complete Next.js project with Docker Compose

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
PROJECT_DIR="./projects/${PROJECT_NAME}"
DB_NAME=$(echo "$PROJECT_NAME" | tr '[:upper:]' '[:lower:]' | tr '-' '_')
DB_USER="${DB_NAME}_user"
DB_PASSWORD=$(openssl rand -base64 12)

# Port allocation (avoiding conflicts with ORBIT)
# ORBIT uses: 3000, 3001, 5432, 6379, 6831, 8000, 9090, 14268, 16686
NEXTJS_PORT=3002
POSTGRES_PORT=5434
ADMINER_PORT=8082

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

print_info "Starting Next.js project provisioning..."
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
  # Next.js Application
  # ============================================================================
  app:
    build:
      context: .
      dockerfile: Dockerfile
      target: development
    container_name: ${PROJECT_NAME}-app
    restart: unless-stopped
    ports:
      - "${NEXTJS_PORT}:3000"
    environment:
      - NODE_ENV=development
      - DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@db:5432/${DB_NAME}
      - NEXT_PUBLIC_API_URL=http://localhost:${NEXTJS_PORT}
    volumes:
      - ./:/app
      - /app/node_modules
      - /app/.next
    networks:
      - ${PROJECT_NAME}-network
    depends_on:
      db:
        condition: service_healthy
    command: npm run dev

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
# ============================================================================
# Base Stage
# ============================================================================
FROM node:20-alpine AS base

WORKDIR /app

# Install dependencies only when needed
FROM base AS deps
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json* ./
RUN npm ci

# ============================================================================
# Development Stage
# ============================================================================
FROM base AS development

COPY --from=deps /app/node_modules ./node_modules
COPY . .

EXPOSE 3000

ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

CMD ["npm", "run", "dev"]

# ============================================================================
# Builder Stage
# ============================================================================
FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Disable telemetry during build
ENV NEXT_TELEMETRY_DISABLED 1

RUN npm run build

# ============================================================================
# Production Stage
# ============================================================================
FROM base AS production

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

CMD ["node", "server.js"]
EOF

print_success "Dockerfile created"

# ============================================================================
# GENERATE .ENV FILE
# ============================================================================

print_info "Generating .env file..."

cat > .env.local <<EOF
# Application
NEXT_PUBLIC_APP_NAME="${PROJECT_NAME}"
NEXT_PUBLIC_API_URL=http://localhost:${NEXTJS_PORT}

# Database
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@localhost:${POSTGRES_PORT}/${DB_NAME}

# Database (Docker internal)
DATABASE_URL_DOCKER=postgresql://${DB_USER}:${DB_PASSWORD}@db:5432/${DB_NAME}
EOF

print_success ".env.local file created"

# ============================================================================
# GENERATE SETUP SCRIPT
# ============================================================================

print_info "Generating setup script..."

cat > setup.sh <<'EOF'
#!/bin/bash
# Next.js project setup script

set -e

echo "🚀 Setting up Next.js project..."

# Create Next.js app
echo "📥 Creating Next.js application..."
npx create-next-app@latest . --typescript --tailwind --app --src-dir --import-alias "@/*" --use-npm --no-git

# Install additional dependencies
echo "📦 Installing additional dependencies..."
npm install --save prisma @prisma/client
npm install --save-dev @types/node

# Initialize Prisma
echo "🗄️ Initializing Prisma..."
npx prisma init --datasource-provider postgresql

# Update Prisma schema
cat > prisma/schema.prisma <<'PRISMA'
// This is your Prisma schema file,
// learn more about it in the docs: https://pris.ly/d/prisma-schema

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// Example model
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
PRISMA

# Create lib directory for Prisma client
mkdir -p src/lib

cat > src/lib/prisma.ts <<'PRISMA_CLIENT'
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
PRISMA_CLIENT

# Update package.json with useful scripts
echo "📝 Adding useful scripts to package.json..."
npm pkg set scripts.db:generate="prisma generate"
npm pkg set scripts.db:migrate="prisma migrate dev"
npm pkg set scripts.db:push="prisma db push"
npm pkg set scripts.db:studio="prisma studio"
npm pkg set scripts.db:seed="prisma db seed"

# Build Docker containers
echo "🐳 Building Docker containers..."
docker-compose build

# Start containers
echo "🔄 Starting containers..."
docker-compose up -d

# Wait for database
echo "⏳ Waiting for database to be ready..."
sleep 10

# Generate Prisma client
echo "🔨 Generating Prisma client..."
docker-compose exec app npx prisma generate

# Run initial migration
echo "🗄️ Running database migration..."
docker-compose exec app npx prisma migrate dev --name init

echo ""
echo "✅ Next.js project setup complete!"
echo ""
echo "📍 Access your application:"
echo "   - Web: http://localhost:${NEXTJS_PORT}"
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
echo "   - Logs: docker-compose logs -f app"
echo "   - Prisma Studio: docker-compose exec app npm run db:studio"
echo "   - Generate Prisma: docker-compose exec app npm run db:generate"
echo "   - Migrate: docker-compose exec app npm run db:migrate"
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

Next.js application with PostgreSQL, Prisma ORM, and Tailwind CSS.

## 🚀 Quick Start

\`\`\`bash
# Run setup (first time only)
./setup.sh

# Start the application
docker-compose up -d

# View logs
docker-compose logs -f app
\`\`\`

## 📍 Access Points

- **Application**: http://localhost:${NEXTJS_PORT}
- **Adminer (DB UI)**: http://localhost:${ADMINER_PORT}
- **Prisma Studio**: Run \`docker-compose exec app npm run db:studio\` then visit http://localhost:5555

## 🗄️ Database

- **Host**: localhost:${POSTGRES_PORT}
- **Database**: ${DB_NAME}
- **Username**: ${DB_USER}
- **Password**: ${DB_PASSWORD}

## 🛠️ Development Commands

\`\`\`bash
# Next.js dev server
docker-compose up -d

# Install packages
docker-compose exec app npm install <package>

# Prisma commands
docker-compose exec app npm run db:generate    # Generate Prisma Client
docker-compose exec app npm run db:migrate     # Create migration
docker-compose exec app npm run db:push        # Push schema changes
docker-compose exec app npm run db:studio      # Open Prisma Studio

# Database access
docker-compose exec db psql -U ${DB_USER} -d ${DB_NAME}

# Build for production
docker-compose exec app npm run build
\`\`\`

## 📦 Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Database**: PostgreSQL 15
- **ORM**: Prisma
- **Styling**: Tailwind CSS 3.x
- **Language**: TypeScript
- **Runtime**: Node.js 20

## 🔧 Project Structure

\`\`\`
.
├── src/
│   ├── app/              # App Router pages
│   ├── components/       # React components
│   ├── lib/              # Utilities (Prisma client, etc.)
│   └── styles/           # Global styles
├── prisma/
│   └── schema.prisma     # Database schema
├── public/               # Static assets
├── docker-compose.yml    # Docker Compose config
└── Dockerfile            # Multi-stage Dockerfile
\`\`\`

## 🗄️ Database Schema

Edit \`prisma/schema.prisma\` to define your database models.

Example:
\`\`\`prisma
model Post {
  id        String   @id @default(cuid())
  title     String
  content   String?
  published Boolean  @default(false)
  author    User     @relation(fields: [authorId], references: [id])
  authorId  String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
\`\`\`

After editing, run:
\`\`\`bash
docker-compose exec app npm run db:migrate
\`\`\`

## 📝 Environment Variables

See \`.env.local\` for available environment variables.

Important variables:
- \`DATABASE_URL\`: PostgreSQL connection string
- \`NEXT_PUBLIC_API_URL\`: Public API URL

## 🐛 Troubleshooting

**Database connection issues:**
\`\`\`bash
# Check if database is running
docker-compose ps db

# Restart database
docker-compose restart db

# Check database logs
docker-compose logs db
\`\`\`

**Prisma issues:**
\`\`\`bash
# Regenerate Prisma client
docker-compose exec app npx prisma generate

# Reset database (WARNING: deletes all data)
docker-compose exec app npx prisma migrate reset
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
# Next.js
/.next/
/out/
/build
.next

# Dependencies
/node_modules
/.pnp
.pnp.js

# Testing
/coverage

# Environment
.env
.env*.local

# Production
/dist

# Misc
.DS_Store
*.pem
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Debug
.vscode/
.idea/

# Vercel
.vercel

# Typescript
*.tsbuildinfo
next-env.d.ts
EOF

print_success ".gitignore created"

# ============================================================================
# SUMMARY
# ============================================================================

echo ""
print_success "==========================================="
print_success "Next.js project provisioned successfully!"
print_success "==========================================="
echo ""
print_info "Project: ${PROJECT_NAME}"
print_info "Location: ${PROJECT_DIR}"
echo ""
print_info "Next steps:"
echo "  1. cd ${PROJECT_DIR}"
echo "  2. ./setup.sh"
echo ""
print_info "Ports allocated:"
echo "  - Application: ${NEXTJS_PORT}"
echo "  - Database: ${POSTGRES_PORT}"
echo "  - Adminer: ${ADMINER_PORT}"
echo ""
print_info "Database credentials:"
echo "  - Database: ${DB_NAME}"
echo "  - User: ${DB_USER}"
echo "  - Password: ${DB_PASSWORD}"
echo ""
print_warning "IMPORTANT: Save these credentials! They are stored in .env.local file."
echo ""

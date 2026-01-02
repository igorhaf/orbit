#!/bin/bash
# FastAPI + React + PostgreSQL Provisioning Script
# Creates a complete full-stack project with Docker Compose

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
SECRET_KEY=$(openssl rand -base64 32)

# Port allocation (avoiding conflicts with ORBIT)
# ORBIT uses: 3000, 3001, 5432, 6379, 6831, 8000, 9090, 14268, 16686
BACKEND_PORT=8001
FRONTEND_PORT=3003
POSTGRES_PORT=5435
ADMINER_PORT=8083

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

print_info "Starting FastAPI + React project provisioning..."
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
  # FastAPI Backend
  # ============================================================================
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: ${PROJECT_NAME}-backend
    restart: unless-stopped
    ports:
      - "${BACKEND_PORT}:8000"
    environment:
      - DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@db:5432/${DB_NAME}
      - SECRET_KEY=${SECRET_KEY}
      - CORS_ORIGINS=http://localhost:${FRONTEND_PORT}
    volumes:
      - ./backend:/app
    networks:
      - ${PROJECT_NAME}-network
    depends_on:
      db:
        condition: service_healthy
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

  # ============================================================================
  # React Frontend
  # ============================================================================
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
      target: development
    container_name: ${PROJECT_NAME}-frontend
    restart: unless-stopped
    ports:
      - "${FRONTEND_PORT}:3000"
    environment:
      - REACT_APP_API_URL=http://localhost:${BACKEND_PORT}
      - CHOKIDAR_USEPOLLING=true
    volumes:
      - ./frontend:/app
      - /app/node_modules
    networks:
      - ${PROJECT_NAME}-network
    depends_on:
      - backend
    command: npm start

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
# BACKEND STRUCTURE
# ============================================================================

print_info "Creating backend structure..."
mkdir -p backend/app/{api,models,schemas,db}

# Backend Dockerfile
cat > backend/Dockerfile <<'EOF'
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
EOF

# Backend requirements.txt
cat > backend/requirements.txt <<EOF
fastapi==0.104.1
uvicorn[standard]==0.24.0
sqlalchemy==2.0.23
psycopg2-binary==2.9.9
alembic==1.12.1
pydantic==2.5.0
pydantic-settings==2.1.0
python-dotenv==1.0.0
python-multipart==0.0.6
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4
EOF

# Backend .env
cat > backend/.env <<EOF
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@db:5432/${DB_NAME}
SECRET_KEY=${SECRET_KEY}
CORS_ORIGINS=http://localhost:${FRONTEND_PORT}
EOF

# Backend main.py
cat > backend/app/main.py <<'EOF'
"""
FastAPI application entry point
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os

app = FastAPI(
    title="API",
    description="FastAPI backend",
    version="1.0.0"
)

# CORS
origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {"message": "Welcome to the API"}

@app.get("/health")
async def health():
    return {"status": "ok"}

# Import routers here
# from app.api import users
# app.include_router(users.router, prefix="/api/users", tags=["users"])
EOF

# Backend database.py
cat > backend/app/db/database.py <<'EOF'
"""
Database configuration
"""
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os

DATABASE_URL = os.getenv("DATABASE_URL")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
EOF

# Backend example model
cat > backend/app/models/user.py <<'EOF'
"""
User model
"""
from sqlalchemy import Column, String, Boolean, DateTime
from sqlalchemy.sql import func
from app.db.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
EOF

# Backend example schema
cat > backend/app/schemas/user.py <<'EOF'
"""
User schemas
"""
from pydantic import BaseModel, EmailStr
from datetime import datetime
from typing import Optional

class UserBase(BaseModel):
    email: EmailStr
    name: Optional[str] = None

class UserCreate(UserBase):
    pass

class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    name: Optional[str] = None
    is_active: Optional[bool] = None

class UserResponse(UserBase):
    id: str
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
EOF

print_success "Backend structure created"

# ============================================================================
# FRONTEND STRUCTURE
# ============================================================================

print_info "Creating frontend structure..."
mkdir -p frontend

# Frontend Dockerfile
cat > frontend/Dockerfile <<'EOF'
# Development stage
FROM node:20-alpine AS development

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "start"]

# Build stage
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production stage
FROM nginx:alpine AS production

COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
EOF

# Frontend nginx config
cat > frontend/nginx.conf <<'EOF'
server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://backend:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

print_success "Frontend structure created"

# ============================================================================
# GENERATE SETUP SCRIPT
# ============================================================================

print_info "Generating setup script..."

cat > setup.sh <<'EOF'
#!/bin/bash
# FastAPI + React project setup script

set -e

echo "🚀 Setting up FastAPI + React project..."

# Setup backend
echo "📦 Setting up backend..."
cd backend
python3 -m venv venv 2>/dev/null || true
cd ..

# Setup frontend
echo "📦 Setting up frontend (React)..."
cd frontend
npx create-react-app . --template typescript 2>/dev/null || npx create-react-app .

# Install additional frontend dependencies
echo "📦 Installing additional frontend packages..."
npm install --save axios react-router-dom
npm install --save-dev @types/react-router-dom tailwindcss postcss autoprefixer

# Initialize Tailwind
echo "🎨 Setting up Tailwind CSS..."
npx tailwindcss init -p

# Configure Tailwind
cat > tailwind.config.js <<'TAILWIND'
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
TAILWIND

# Add Tailwind directives
cat > src/index.css <<'CSS'
@tailwind base;
@tailwind components;
@tailwind utilities;
CSS

# Create API client
mkdir -p src/services

cat > src/services/api.ts <<'API'
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor
api.interceptors.request.use(
  (config) => {
    // Add auth token here if needed
    // const token = localStorage.getItem('token');
    // if (token) {
    //   config.headers.Authorization = `Bearer ${token}`;
    // }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Handle errors globally
    console.error('API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

export default api;
API

cd ..

# Build and start containers
echo "🐳 Building Docker containers..."
docker-compose build

echo "🔄 Starting containers..."
docker-compose up -d

# Wait for database
echo "⏳ Waiting for database to be ready..."
sleep 10

# Run Alembic migrations
echo "🗄️ Setting up database..."
docker-compose exec backend alembic init alembic 2>/dev/null || true
docker-compose exec backend alembic revision --autogenerate -m "Initial migration" 2>/dev/null || true
docker-compose exec backend alembic upgrade head 2>/dev/null || true

echo ""
echo "✅ FastAPI + React project setup complete!"
echo ""
echo "📍 Access your application:"
echo "   - Frontend: http://localhost:${FRONTEND_PORT}"
echo "   - Backend API: http://localhost:${BACKEND_PORT}"
echo "   - API Docs: http://localhost:${BACKEND_PORT}/docs"
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
echo "   - Backend logs: docker-compose logs -f backend"
echo "   - Frontend logs: docker-compose logs -f frontend"
echo "   - Backend shell: docker-compose exec backend bash"
echo "   - Frontend shell: docker-compose exec frontend sh"
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

Full-stack application with FastAPI backend, React frontend, and PostgreSQL database.

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

- **Frontend**: http://localhost:${FRONTEND_PORT}
- **Backend API**: http://localhost:${BACKEND_PORT}
- **API Documentation**: http://localhost:${BACKEND_PORT}/docs
- **Adminer (DB UI)**: http://localhost:${ADMINER_PORT}

## 🗄️ Database

- **Host**: localhost:${POSTGRES_PORT}
- **Database**: ${DB_NAME}
- **Username**: ${DB_USER}
- **Password**: ${DB_PASSWORD}

## 🛠️ Development Commands

### Backend (FastAPI)

\`\`\`bash
# Install packages
docker-compose exec backend pip install <package>

# Run migrations
docker-compose exec backend alembic revision --autogenerate -m "description"
docker-compose exec backend alembic upgrade head

# Python shell
docker-compose exec backend python

# Access container
docker-compose exec backend bash
\`\`\`

### Frontend (React)

\`\`\`bash
# Install packages
docker-compose exec frontend npm install <package>

# Build for production
docker-compose exec frontend npm run build

# Run tests
docker-compose exec frontend npm test

# Access container
docker-compose exec frontend sh
\`\`\`

### Database

\`\`\`bash
# Access PostgreSQL
docker-compose exec db psql -U ${DB_USER} -d ${DB_NAME}

# Backup database
docker-compose exec db pg_dump -U ${DB_USER} ${DB_NAME} > backup.sql

# Restore database
docker-compose exec -T db psql -U ${DB_USER} ${DB_NAME} < backup.sql
\`\`\`

## 📦 Tech Stack

### Backend
- **Framework**: FastAPI
- **ORM**: SQLAlchemy
- **Migrations**: Alembic
- **Database**: PostgreSQL 15
- **Language**: Python 3.11

### Frontend
- **Framework**: React 18
- **Language**: TypeScript
- **Styling**: Tailwind CSS 3.x
- **HTTP Client**: Axios
- **Routing**: React Router

## 🔧 Project Structure

\`\`\`
.
├── backend/
│   ├── app/
│   │   ├── api/          # API routes
│   │   ├── models/       # SQLAlchemy models
│   │   ├── schemas/      # Pydantic schemas
│   │   ├── db/           # Database config
│   │   └── main.py       # FastAPI app
│   ├── alembic/          # Database migrations
│   ├── requirements.txt  # Python dependencies
│   └── Dockerfile
│
├── frontend/
│   ├── public/           # Static files
│   ├── src/
│   │   ├── components/   # React components
│   │   ├── services/     # API client
│   │   ├── App.tsx       # Main component
│   │   └── index.tsx     # Entry point
│   ├── package.json      # Node dependencies
│   └── Dockerfile
│
└── docker-compose.yml    # Docker Compose config
\`\`\`

## 📝 Environment Variables

### Backend (\`backend/.env\`)
- \`DATABASE_URL\`: PostgreSQL connection string
- \`SECRET_KEY\`: Secret key for JWT tokens
- \`CORS_ORIGINS\`: Allowed CORS origins

### Frontend
- \`REACT_APP_API_URL\`: Backend API URL

## 🐛 Troubleshooting

**CORS issues:**
- Check \`CORS_ORIGINS\` in backend/.env
- Ensure frontend URL matches

**Database connection:**
\`\`\`bash
# Check if database is running
docker-compose ps db

# View database logs
docker-compose logs db
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
# Backend
backend/__pycache__/
backend/*.py[cod]
backend/.env
backend/venv/
backend/.pytest_cache/
backend/alembic/versions/*.pyc

# Frontend
frontend/node_modules/
frontend/build/
frontend/.env
frontend/.env.local
frontend/npm-debug.log*
frontend/yarn-debug.log*
frontend/yarn-error.log*

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Docker
*.log
EOF

print_success ".gitignore created"

# ============================================================================
# SUMMARY
# ============================================================================

echo ""
print_success "================================================="
print_success "FastAPI + React project provisioned successfully!"
print_success "================================================="
echo ""
print_info "Project: ${PROJECT_NAME}"
print_info "Location: ${PROJECT_DIR}"
echo ""
print_info "Next steps:"
echo "  1. cd ${PROJECT_DIR}"
echo "  2. ./setup.sh"
echo ""
print_info "Ports allocated:"
echo "  - Frontend: ${FRONTEND_PORT}"
echo "  - Backend: ${BACKEND_PORT}"
echo "  - Database: ${POSTGRES_PORT}"
echo "  - Adminer: ${ADMINER_PORT}"
echo ""
print_info "Database credentials:"
echo "  - Database: ${DB_NAME}"
echo "  - User: ${DB_USER}"
echo "  - Password: ${DB_PASSWORD}"
echo ""
print_warning "IMPORTANT: Save these credentials! They are stored in backend/.env file."
echo ""

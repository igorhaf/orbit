# Orbit - AI Orchestration System

Complete SPA system for creating and orchestrating applications using AI, focused on Claude Code API and multiple AI models.

## Project Description

Orbit is a platform that allows:
- Conversational interviews with AI to capture requirements
- Generate composable prompts using Prompter architecture
- Manage tasks in an interactive Kanban Board
- Integrate with Claude Code API for task execution
- Support multiple configurable AI models
- Automatic versioning with AI-generated commits

## Tech Stack

### Frontend
- **Next.js** 14+ with App Router
- **TypeScript** for type safety
- **Tailwind CSS** for styling
- **React** 18+

### Backend
- **FastAPI** (Python 3.11+)
- **PostgreSQL** with pgvector for vector embeddings
- **SQLAlchemy** as ORM
- **Alembic** for migrations
- **Poetry** for dependency management
- **Redis** for caching

### DevOps
- **Docker** and **Docker Compose** for containerization
- **Monorepo** architecture

---

## Quick Start (Installation)

### Prerequisites

Before starting, make sure you have installed:

- [Docker](https://www.docker.com/get-started) (version 20.10+)
- [Docker Compose](https://docs.docker.com/compose/install/) (version 2.0+)
- Git

### Step 1: Clone the Repository

```bash
git clone https://github.com/igorhaf/orbit.git
cd orbit
```

### Step 2: Create Environment File (Optional)

The project works with default values, but you can customize:

```bash
# Create .env file in project root (optional)
cat > .env << EOF
# Database
POSTGRES_USER=orbit
POSTGRES_PASSWORD=orbit_password
POSTGRES_DB=orbit

# Backend
SECRET_KEY=your-secret-key-change-in-production
ENVIRONMENT=development

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_APP_NAME=Orbit
EOF
```

### Step 3: Start All Services

```bash
# Clean any previous containers (recommended for first install)
docker rm -f $(docker ps -aq --filter "name=orbit") 2>/dev/null || true

# Start all services with project name 'orbit'
docker-compose -p orbit up -d
```

### Step 4: Wait for Services to Initialize

```bash
# Check status (wait until all services are "healthy" or "Up")
docker-compose -p orbit ps

# Expected output:
# NAME             STATUS
# orbit-backend    Up (healthy)
# orbit-db         Up (healthy)
# orbit-frontend   Up
# orbit-redis      Up (healthy)
```

### Step 5: Access the Application

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **API Documentation**: http://localhost:8000/docs
- **Health Check**: http://localhost:8000/health

---

## Configure AI Models

The system requires AI model API keys to function. API keys are managed **exclusively via the database** (not .env files).

### Step 1: Initialize Models

Create default AI models with placeholders:

```bash
docker-compose -p orbit exec backend python scripts/init_ai_models.py
```

This creates 9 AI models (inactive):
- **Anthropic:** Claude Sonnet 4.5, Opus 4.5, Haiku 4
- **OpenAI:** GPT-4o, GPT-4 Turbo, GPT-3.5 Turbo
- **Google:** Gemini 1.5 Pro, 2.0 Flash, 1.5 Flash

### Step 2: Configure API Keys

**Via Web Interface (Recommended):**

1. Go to http://localhost:3000/ai-models
2. Click "Edit" on each model you want to use
3. Add your API key and toggle "Active"

**Via Backend API:**

```bash
# Example: Configure Claude Sonnet 4.5
curl -X PATCH http://localhost:8000/api/v1/ai-models/{model_id} \
  -H "Content-Type: application/json" \
  -d '{"api_key": "sk-ant-...", "is_active": true}'
```

> **Why Database-Only?**
> - ✅ Granular control per model (CRUD operations)
> - ✅ Business logic and validations
> - ✅ Audit trail and versioning
> - ✅ Dynamic configuration without redeployment
> - ✅ Multiple keys per provider with different configs

---

## Common Commands

### Start Services
```bash
docker-compose -p orbit up -d
```

### Stop Services
```bash
docker-compose -p orbit down
```

### View Logs
```bash
# All services
docker-compose -p orbit logs -f

# Specific service
docker-compose -p orbit logs -f backend
docker-compose -p orbit logs -f frontend
```

### Restart a Service
```bash
docker-compose -p orbit restart backend
```

### Rebuild After Code Changes
```bash
docker-compose -p orbit build backend
docker-compose -p orbit up -d backend
```

### Full Rebuild (Clean Start)
```bash
docker-compose -p orbit down --volumes --remove-orphans
docker rm -f $(docker ps -aq --filter "name=orbit") 2>/dev/null || true
docker-compose -p orbit up -d --build
```

---

## Troubleshooting

### Error: "container name already in use"

```bash
# Remove conflicting containers
docker rm -f $(docker ps -aq --filter "name=orbit") 2>/dev/null
docker-compose -p orbit up -d
```

### Error: "No such container"

```bash
# Clean Docker state and restart
docker-compose -p orbit down --volumes --remove-orphans
docker container prune -f
docker network prune -f
docker-compose -p orbit up -d
```

### Error: "relation does not exist" (Database)

Migrations need to be applied:

```bash
# Restart backend (migrations run automatically on startup)
docker-compose -p orbit restart backend

# Or run manually
docker-compose -p orbit exec backend poetry run alembic upgrade head
```

### Backend Not Starting

Check logs for errors:

```bash
docker-compose -p orbit logs backend --tail 100
```

### Frontend Build Issues

```bash
# Rebuild frontend
docker-compose -p orbit build frontend --no-cache
docker-compose -p orbit up -d frontend
```

---

## Project Structure

```
orbit/
├── README.md                 # This file
├── docker-compose.yml        # Container orchestration
├── docker/
│   ├── backend.Dockerfile    # Backend Docker image
│   ├── frontend.Dockerfile   # Frontend Docker image
│   └── init-db.sh           # Database initialization script
├── backend/                  # FastAPI API
│   ├── app/
│   │   ├── main.py          # Application entry point
│   │   ├── config.py        # Environment configuration
│   │   ├── database.py      # Database setup
│   │   ├── models/          # SQLAlchemy models
│   │   ├── schemas/         # Pydantic schemas
│   │   ├── api/             # API routes
│   │   └── services/        # Business logic
│   └── alembic/             # Database migrations
└── frontend/                # Next.js application
    ├── src/
    │   ├── app/             # Next.js App Router
    │   ├── components/      # React components
    │   └── lib/             # Utilities and helpers
    └── public/              # Static files
```

---

## Development

### Local Development (Without Docker)

#### Backend

```bash
cd backend
poetry install
poetry run alembic upgrade head
poetry run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

#### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Database Migrations

```bash
# Create new migration
docker-compose -p orbit exec backend poetry run alembic revision --autogenerate -m "description"

# Apply migrations
docker-compose -p orbit exec backend poetry run alembic upgrade head

# Check current version
docker-compose -p orbit exec backend poetry run alembic current

# Rollback one migration
docker-compose -p orbit exec backend poetry run alembic downgrade -1
```

---

## Main Features

1. **Interview System**: Conversational chat with AI for requirements capture
2. **Prompt Generation**: Automatic creation using Prompter architecture
3. **Kanban Board**: Visual task management with drag-and-drop
4. **Claude Code Integration**: Task execution via API
5. **Multi-Model Support**: Support for various AI models (Claude, GPT, Gemini)
6. **Smart Versioning**: Automatic AI-generated commits
7. **RAG System**: Semantic search with pgvector for context retrieval

---

## Environment Variables

### Backend (docker-compose.yml)
| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection URL | `postgresql://orbit:orbit_password@postgres:5432/orbit` |
| `SECRET_KEY` | Secret key for JWT | `dev-secret-key-change-in-production` |
| `ENVIRONMENT` | Execution environment | `development` |
| `REDIS_HOST` | Redis host | `redis` |
| `REDIS_PORT` | Redis port | `6379` |

### Frontend (docker-compose.yml)
| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_API_URL` | Backend API URL | `http://localhost:8000` |
| `NEXT_PUBLIC_APP_NAME` | Application name | `Orbit` |

---

## Services and Ports

| Service | Port | Description |
|---------|------|-------------|
| Frontend | 3000 | Next.js application |
| Backend | 8000 | FastAPI API |
| PostgreSQL | 5432 | Database with pgvector |
| Redis | 6379 | Cache server |

---

## License

[Define license]

## Support

For questions and support, check the documentation or open an issue in the repository.

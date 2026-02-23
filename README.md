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

### Infrastructure
- **Native Linux/WSL2** services (PostgreSQL, Redis, Ollama)
- **Monorepo** architecture

---

## Quick Start (Installation)

### Prerequisites

Before starting, make sure you have installed:

- **Linux / WSL2** environment
- **Python 3.11+** with Poetry
- **Node.js 18+** with npm
- **PostgreSQL 15+** with pgvector extension
- **Redis**
- **Ollama** (for local AI models)
- Git

### Step 1: Clone the Repository

```bash
git clone https://github.com/igorhaf/orbit.git
cd orbit
```

### Step 2: Install and Setup

```bash
# Install all dependencies and configure services
./scripts/orbit install
./scripts/orbit setup
```

### Step 3: Start All Services

```bash
orbit start
```

### Step 4: Check Status

```bash
orbit status
```

### Step 5: Access the Application

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **API Documentation**: http://localhost:8000/docs
- **Health Check**: http://localhost:8000/health

---

## Configure AI Models

The system requires AI model API keys to function. API keys are stored in the **database** (not .env).

### Via Web Interface (Recommended)

1. Go to http://localhost:3000/ai-models
2. Click "Edit" on each model you want to use
3. Add your API key and toggle "Active"

### Via Backend API

```bash
# Example: Configure Claude Sonnet 4.5
curl -X PATCH http://localhost:8000/api/v1/ai-models/{model_id} \
  -H "Content-Type: application/json" \
  -d '{"api_key": "sk-ant-...", "is_active": true}'
```

---

## Common Commands

### Start Services
```bash
orbit start
```

### Stop Services
```bash
orbit stop
```

### View Logs
```bash
# All services
orbit logs

# Specific service
orbit logs backend
orbit logs frontend
orbit logs backend -f  # Follow mode
```

### Restart a Service
```bash
orbit restart backend
```

---

## Troubleshooting

### Error: "relation does not exist" (Database)

Migrations need to be applied:

```bash
cd backend && alembic upgrade head
```

### Backend Not Starting

Check logs for errors:

```bash
orbit logs backend
```

---

## Project Structure

```
orbit/
├── README.md                 # This file
├── CLAUDE.md                 # AI assistant instructions
├── scripts/
│   └── orbit                 # Service manager CLI
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
├── frontend/                # Next.js application
│   ├── src/
│   │   ├── app/             # Next.js App Router
│   │   ├── components/      # React components
│   │   └── lib/             # Utilities and helpers
│   └── public/              # Static files
└── satellite/               # Knowledge base and AI memory
    ├── memory/              # AI execution logs
    ├── docs/                # External documents (RAG-indexed)
    └── knowledge/           # Structured knowledge base
```

---

## Development

### Backend

```bash
cd backend
poetry install
poetry run alembic upgrade head
poetry run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Database Migrations

```bash
# Create new migration
cd backend && alembic revision --autogenerate -m "description"

# Apply migrations
cd backend && alembic upgrade head

# Check current version
cd backend && alembic current

# Rollback one migration
cd backend && alembic downgrade -1
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

### Backend (.env)
| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection URL | `postgresql://orbit:orbit_password@localhost:5432/orbit` |
| `SECRET_KEY` | Secret key for JWT | `dev-secret-key-change-in-production` |
| `ENVIRONMENT` | Execution environment | `development` |
| `REDIS_HOST` | Redis host | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `OLLAMA_HOST` | Ollama API URL | `http://localhost:11434` |

### Frontend
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
| PostgreSQL | 5432 | Database with pgvector (supports RAG) |
| Redis | 6379 | Cache server |
| Ollama | 11434 | Local LLM Server |

---

## RAG / Local AI Services

Orbit includes Ollama for local AI and RAG (Retrieval-Augmented Generation).

### Installing Models in Ollama

```bash
# Pull a model
ollama pull qwen3:8b
ollama pull nomic-embed-text

# List installed models
ollama list

# Or via API
curl http://localhost:11434/api/pull -d '{"name": "qwen3:8b"}'
```

### Quick Tests

```bash
# Test Ollama (list installed models)
curl http://localhost:11434/api/tags

# Test pgvector extension
psql -U orbit -d orbit -c "SELECT * FROM pg_extension WHERE extname = 'vector';"
```

---

## License

[Define license]

## Support

For questions and support, check the documentation or open an issue in the repository.

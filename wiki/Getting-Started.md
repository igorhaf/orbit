# Getting Started

## Prerequisites

- Linux/WSL2
- Python 3.11+ with Poetry
- Node.js 18+ with npm
- PostgreSQL 15+ with pgvector extension
- Redis 7+
- Ollama (optional, for local models)

## Installation

### 1. Clone and setup backend
```bash
cd backend
poetry install
```

### 2. Setup frontend
```bash
cd frontend
npm install
```

### 3. Configure environment
```bash
cp backend/.env.example backend/.env
# Edit .env with your database credentials
```

Required `.env` variables:
```
DATABASE_URL=postgresql://orbit:orbit_password@localhost:5432/orbit
SECRET_KEY=your-secret-key
REDIS_HOST=redis
REDIS_PORT=6379
```

### 4. Initialize database
```bash
cd backend
poetry run alembic upgrade head
poetry run python scripts/seed_pipeline_profiles.py
poetry run python scripts/seed_ai_models.py
```

### 5. Start services
```bash
./scripts/orbit start
```

This starts PostgreSQL, Redis, Backend (port 8000), and Frontend (port 3000).

### 6. Stop services
```bash
./scripts/orbit stop
```

## First Steps

1. Open `http://localhost:3000`
2. Create a new project with a path to your codebase
3. Configure AI models at `/ai-models` (add API keys)
4. Run the Deep Pipeline to analyze your codebase
5. Explore generated cards, wiki, and business rules

## AI Model Configuration

AI API keys are stored in the database (not `.env`). Configure them via the web interface at `/ai-models`:

- **Anthropic**: Claude Sonnet, Haiku models
- **OpenAI**: GPT-4o, GPT-4 Turbo
- **Google**: Gemini models
- **Ollama**: Local models (no API key needed)

Each model is assigned to a `usage_type` (interview, prompt_generation, task_execution, etc.).

# PROMPT #104 - RAG/Local AI Services Setup
## Docker Compose with Ollama, Qdrant, and PostgreSQL for RAG

**Date:** January 25, 2026
**Status:** COMPLETED
**Priority:** MEDIUM
**Type:** Infrastructure / DevOps
**Impact:** Enables local AI and RAG capabilities with persistent storage

---

## Objective

Add Ollama, Qdrant, and a separate PostgreSQL for RAG to the existing docker-compose.yml with the following requirements:

1. **NO named Docker volumes** - Use bind mounts only
2. **Explicit persistence paths** in `./data/` folder
3. **Minimal impact** on existing services
4. **GPU support documentation** for Ollama (disabled by default)

**Key Requirements:**
1. Ollama service with bind mount `./data/ollama -> /root/.ollama`
2. Qdrant service with bind mount `./data/qdrant -> /qdrant/storage`
3. PostgreSQL RAG service (separate from main) with bind mount `./data/postgres-rag`
4. Port conflict resolution (main postgres on 5432, RAG postgres on 5433)
5. Documentation for `./data/` folder structure

---

## What Was Implemented

### 1. Docker Compose Modifications

Added 3 new services to `docker-compose.yml`:

#### Ollama Service
```yaml
ollama:
  image: ollama/ollama:latest
  container_name: ollama
  restart: unless-stopped
  ports:
    - "11434:11434"
  volumes:
    - ./data/ollama:/root/.ollama
```

- Includes commented GPU NVIDIA support instructions
- Full documentation for enabling NVIDIA Container Toolkit

#### Qdrant Service
```yaml
qdrant:
  image: qdrant/qdrant:latest
  container_name: qdrant
  restart: unless-stopped
  ports:
    - "6333:6333"  # REST API
    - "6334:6334"  # gRPC API
  volumes:
    - ./data/qdrant:/qdrant/storage
```

#### PostgreSQL RAG Service
```yaml
postgres-rag:
  image: postgres:16
  container_name: postgres-rag
  restart: unless-stopped
  ports:
    - "5433:5432"  # Avoids conflict with main postgres
  environment:
    POSTGRES_USER: rag
    POSTGRES_PASSWORD: rag
    POSTGRES_DB: rag
  volumes:
    - ./data/postgres-rag:/var/lib/postgresql/data
```

### 2. Data Folder Structure

Created `./data/` with bind mount directories:

```
data/
├── .gitkeep              # Documentation file
├── ollama/.gitkeep       # Ollama models storage
├── qdrant/.gitkeep       # Vector database storage
└── postgres-rag/.gitkeep # RAG database storage
```

### 3. README.md Updates

Added comprehensive documentation section including:
- Updated services/ports table
- Data persistence explanation
- Commands for starting/viewing logs
- Quick tests with curl
- Model installation instructions
- GPU support documentation
- Service credentials
- Qdrant API examples

### 4. .gitignore Updates

Added rules to ignore data contents but keep .gitkeep files:
```gitignore
data/ollama/*
data/qdrant/*
data/postgres-rag/*
!data/.gitkeep
!data/**/.gitkeep
```

---

## Files Modified/Created

### Created:
1. **[data/.gitkeep](data/.gitkeep)** - Documentation for data folder
2. **[data/ollama/.gitkeep](data/ollama/.gitkeep)** - Placeholder
3. **[data/qdrant/.gitkeep](data/qdrant/.gitkeep)** - Placeholder
4. **[data/postgres-rag/.gitkeep](data/postgres-rag/.gitkeep)** - Placeholder

### Modified:
1. **[docker-compose.yml](docker-compose.yml)** - Added 3 new services with bind mounts
   - Lines added: ~85
   - Added section headers for organization
2. **[README.md](README.md)** - Added RAG services documentation
   - Lines added: ~90
3. **[.gitignore](.gitignore)** - Added data folder exclusions
   - Lines added: 7

---

## Testing

### Verification Commands:

```bash
# Validate docker-compose syntax
docker compose config --quiet

# Start RAG services
docker compose up -d ollama qdrant postgres-rag

# Test Ollama
curl http://localhost:11434/api/tags

# Test Qdrant
curl http://localhost:6333/collections

# Test PostgreSQL RAG
docker compose exec postgres-rag psql -U rag -d rag -c "SELECT version();"
```

---

## Port Mapping Summary

| Service | Host Port | Container Port | Description |
|---------|-----------|----------------|-------------|
| PostgreSQL (main) | 5432 | 5432 | Main Orbit database (pgvector) |
| PostgreSQL (RAG) | 5433 | 5432 | RAG-specific database |
| Ollama | 11434 | 11434 | Local LLM API |
| Qdrant REST | 6333 | 6333 | Vector DB REST API |
| Qdrant gRPC | 6334 | 6334 | Vector DB gRPC API |

---

## Success Metrics

- No named Docker volumes used for new services
- All persistence via explicit bind mounts in `./data/`
- Existing services unchanged
- GPU documentation included
- No port conflicts
- `.gitignore` properly configured

---

## Key Decisions

1. **Separate PostgreSQL for RAG**: Instead of reusing the main pgvector database, created a dedicated `postgres-rag` service. This allows independent scaling and different configurations.

2. **Port 5433 for RAG PostgreSQL**: Since main postgres uses 5432, RAG postgres maps to 5433 on host.

3. **NVIDIA GPU Disabled by Default**: GPU support is documented but commented out to ensure compatibility with systems without GPU.

4. **All services on `orbit-network`**: Enables inter-service communication between Orbit and RAG services.

---

## Status: COMPLETE

All requested services have been added with bind mount persistence.

**Key Achievements:**
- Ollama service with `./data/ollama` persistence
- Qdrant service with `./data/qdrant` persistence
- PostgreSQL RAG service with `./data/postgres-rag` persistence
- Complete GPU documentation for Ollama
- README updated with usage instructions
- .gitignore configured to exclude data but keep .gitkeep files

**Quick Start:**
```bash
# Start all services
docker compose up -d

# Or start only RAG services
docker compose up -d ollama qdrant postgres-rag

# View logs
docker compose logs -f ollama
```

---

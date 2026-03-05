---
title: "Infraestrutura e Deploy"
slug: "infraestrutura"
source: "generated"
order_index: 22
created_at: "2026-03-05T04:46:26.167130"
updated_at: "2026-03-05T04:46:26.167130"
---

# Infraestrutura e Deploy

## Serviços Nativos (Sem Docker)

| Serviço | Porta | Tipo |
|---------|-------|------|
| PostgreSQL | 5432 | Nativo Linux |
| Redis | 6379 | Nativo Linux |
| Ollama | 11434 | Windows host, proxy WSL2 |
| Backend | 8000 | Poetry + uvicorn |
| Frontend | 3000 | npm run dev |

### Gerenciamento
```bash
scripts/orbit start    # Inicia todos os serviços
scripts/orbit stop     # Para todos
scripts/orbit status   # Verifica status
```

## PostgreSQL
- Versão: 15 com pgvector extension
- Database: orbit
- User: orbit / orbit_password
- Extensions: pgvector (768d vectors), uuid-ossp

## Redis
- Versão: 7
- Usado para: Cache L1/L2/L3, rate limiting
- Port: 6379 (sem senha)

## Ollama
- Rodando no Windows host
- Proxy via WSL2: 172.27.144.1:11434
- Modelo principal: Nomic Embed Text (embeddings)
- Timeout: 30s para embedding requests

## Alembic Migrations
- 91 migrations em `backend/alembic/versions/`
- Disciplina: sempre testar upgrade + downgrade
- Antes de criar: `alembic heads` para verificar


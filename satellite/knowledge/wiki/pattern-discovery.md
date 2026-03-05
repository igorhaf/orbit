---
title: "Pattern Discovery"
slug: "pattern-discovery"
source: "generated"
order_index: 16
created_at: "2026-03-05T04:46:25.715805"
updated_at: "2026-03-05T04:46:25.715805"
---

# Pattern Discovery & Tech Stack Detection

## Tech Stack Detector

### Detecção por Arquivo
| Arquivo | O que Detecta |
|---------|--------------|
| package.json | Frontend framework, libraries |
| requirements.txt | Python backend, frameworks |
| pyproject.toml | Python packages, build tools |
| docker-compose.yml | Infrastructure services |
| Dockerfile | Base images, runtime |

### Detecção por Import
Analisa imports em .py e .ts/.tsx para detectar:
- Frameworks (FastAPI, Django, Express, React, Vue)
- Patterns (Repository, Service Layer, MVC, Event-driven)
- Libraries (SQLAlchemy, Prisma, TypeORM)

### Confidence Score
Cada detecção tem score 0-1:
- 1.0: arquivo de configuração explícito
- 0.8: múltiplos imports detectados
- 0.5: poucos imports, inferência

## AI-Assisted Pattern Discovery
- Usado no Deep Pipeline Phase 2
- AI analisa code samples para patterns não-óbvios
- CQRS, Event Sourcing, Saga, DDD


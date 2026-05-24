# ORBIT - AI Orchestration System

**ORBIT** is a full-stack AI orchestration platform that manages multiple AI providers (Anthropic, OpenAI, Google, Ollama) to automate software project analysis, requirements gathering, backlog generation, and documentation.

## Quick Links

| Section | Description |
|---------|-------------|
| [Architecture](Architecture) | System architecture and tech stack |
| [Getting Started](Getting-Started) | Installation and setup |
| [Backend API](Backend-API) | REST API reference |
| [Frontend](Frontend) | UI pages and components |
| [Pipeline](Pipeline) | Deep analysis pipeline (7 phases) |
| [Interviews](Interviews) | AI-driven requirements gathering |
| [Backlog & Cards](Backlog-and-Cards) | Epic/Story/Task generation |
| [RAG System](RAG-System) | Retrieval-Augmented Generation |
| [Wiki System](Wiki-System) | Auto-generated documentation |
| [AI Orchestration](AI-Orchestration) | Multi-provider AI management |
| [Jobs & Queue](Jobs-and-Queue) | Async background processing |
| [Analytics](Analytics) | Cost tracking and metrics |
| [Database Models](Database-Models) | Data model reference |
| [Configuration](Configuration) | Settings and profiles |

## Key Features

- **Deep Pipeline**: 7-phase codebase analysis (scan, file analysis, rule synthesis, architecture map, card generation, wiki generation, QA)
- **Multi-Provider AI**: Anthropic, OpenAI, Google, Ollama, and Claudius proxy with automatic fallback
- **Interview System**: Conversational AI for requirements capture with context-aware questions
- **Backlog Generation**: Automatic Epic > Story > Task hierarchy from interviews or codebase analysis
- **RAG Knowledge Base**: Semantic search with pgvector embeddings for context-enriched AI responses
- **Living Wiki**: Auto-generated and continuously updated project documentation
- **Resume on Failure**: Pipeline checkpoints after each phase, resume from where it stopped
- **Cost Analytics**: Real-time tracking of AI token usage, costs, and cache efficiency

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | FastAPI, SQLAlchemy, PostgreSQL, Alembic |
| Frontend | Next.js 14, React, TypeScript, Tailwind CSS |
| AI | Anthropic API, OpenAI API, Google AI, Ollama |
| Search | pgvector (Nomic Embed Text 768-dim) |
| Cache | Redis (3-level: exact, semantic, template) |
| Queue | Priority job executor with async workers |
| Real-time | WebSocket for live updates |

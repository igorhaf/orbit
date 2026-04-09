# AI Orchestration

ORBIT manages multiple AI providers through a centralized orchestrator that handles model selection, caching, rate limiting, and cost tracking.

## Supported Providers

| Provider | Models | Use Case |
|----------|--------|----------|
| Anthropic | Claude Sonnet, Haiku | Primary for all operations |
| OpenAI | GPT-4o, GPT-4 Turbo | Alternative provider |
| Google | Gemini 1.5 Pro, Flash | Alternative provider |
| Ollama | Local models | Free, offline usage |
| Claudio | Proxy to Anthropic | Pipeline operations |

## Usage Types

Each AI operation has a `usage_type` that determines which model is used:

| Usage Type | Purpose |
|------------|---------|
| `interview` | Question generation and responses |
| `prompt_generation` | Card description and prompt creation |
| `task_execution` | Code generation and execution |
| `commit_generation` | Git commit messages |
| `content_generation` | Wiki, descriptions, enrichment |
| `rag_extraction` | Business rule extraction |
| `memory` | Codebase analysis and memory |
| `general` | Fallback for unclassified usage |

## Message Format

All providers use standardized messages:
```python
messages = [
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "..."},
]
system_prompt = "..."  # Sent separately, not as a message
```

The orchestrator converts to provider-specific formats internally.

## Cache System (3 Levels)

| Level | Strategy | TTL | Expected Hit Rate |
|-------|----------|-----|-------------------|
| L1 | Exact SHA256 match | 7 days | ~20% |
| L2 | Semantic similarity >95% | 1 day | ~10% |
| L3 | Template cache (temperature=0) | 30 days | ~5% |

Cache is automatic via Redis. Total expected savings: 30-35%.

## Configuration

Models are configured in the `ai_models` database table via `/ai-models` web interface:
- API keys stored in database (never in `.env`)
- Model assigned to usage types
- Rate limits per model
- Timeout configuration

## AI Flow Chains

Visual editor for configuring fallback chains:
- Define primary → fallback → fallback model sequence
- Configure per usage type
- Versioned profiles for A/B testing
- Accessible at `/ai-flow`

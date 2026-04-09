# Configuration

## Environment Variables (`.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `SECRET_KEY` | — | Application secret |
| `REDIS_HOST` | `redis` | Redis hostname |
| `REDIS_PORT` | `6379` | Redis port |
| `CLAUDIO_BASE_URL` | `http://localhost:8001` | Claudio proxy URL |
| `CLAUDIO_API_KEY` | `123456789` | Claudio API key |

**Important**: AI provider API keys are stored in the database (`ai_models` table), never in `.env`.

## Pipeline Profiles

Configure per-phase settings in the `pipeline_profiles` table:

```json
{
  "phase_1": {
    "model": "claude-sonnet-4-6",
    "max_tokens": 1500,
    "concurrency": 5,
    "enabled": true,
    "provider": "claudio"
  },
  "phase_2": {
    "model": "claude-sonnet-4-6",
    "max_tokens": 4000,
    "concurrency": 5,
    "multi_turn_threshold": 30
  }
}
```

Manage profiles via AI Studio (`/ai-flow` → Pipeline tab).

## AI Model Configuration

Configure at `/ai-models`:
1. Add provider (Anthropic, OpenAI, Google, Ollama)
2. Set API key
3. Assign to usage types (interview, prompt_generation, etc.)
4. Test connection

## System Settings

Key-value pairs in `system_settings` table, managed via `/settings`:
- Feature flags
- Default values
- System-wide configuration

## Project Configuration

Each project has:
- `code_path`: Path to source code directory
- `stack`: Detected technology stack (auto or manual)
- `pipeline_version`: Last pipeline version used
- `.satellite` file: Marker for ORBIT-managed project
- `.orbit/` directory: Local AI logs and uploaded docs

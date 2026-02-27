"""
Seed 3 pipeline profiles: economy, balanced, quality.

Usage:
    cd backend && poetry run python scripts/seed_pipeline_profiles.py
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from uuid import uuid4
from app.database import SessionLocal
from app.models.pipeline_profile import PipelineProfile

# ── Shared base config (quality profile = exact v2 hardcoded values) ──────────

QUALITY_CONFIGS = {
    "phase_0": {
        "enabled": True,
    },
    "phase_1": {
        "model": "claude-haiku-4-5",
        "max_tokens": 4000,
        "concurrency": 10,
        "contract": "deep_file_analysis",
        "enabled": True,
    },
    "phase_2": {
        "model": "claude-sonnet-4-6",
        "max_tokens": 16000,
        "concurrency": 3,
        "contract": "deep_rule_synthesis",
        "thinking_budget": None,
        "multi_turn_threshold": 30,
        "enabled": True,
    },
    "phase_3": {
        "model": "claude-sonnet-4-6",
        "max_tokens": 32000,
        "concurrency": 1,
        "contract": "deep_architectural_map",
        "thinking_budget": 10000,
        "enabled": True,
    },
    "phase_4a": {
        "model": "claude-opus-4-6",
        "max_tokens": 64000,
        "concurrency": 1,
        "contract": "deep_epic_generation",
        "enabled": True,
    },
    "phase_4b": {
        "model": "claude-opus-4-6",
        "max_tokens": 32000,
        "concurrency": 3,
        "contract": "deep_story_decomposition",
        "enabled": True,
    },
    "phase_4c": {
        "model": "claude-sonnet-4-6",
        "max_tokens": 8000,
        "concurrency": 5,
        "contract": "deep_task_decomposition",
        "enabled": True,
    },
    "phase_4d": {
        "model": "claude-haiku-4-5",
        "max_tokens": 2000,
        "concurrency": 10,
        "contract": "deep_subtask_decomposition",
        "enabled": True,
    },
    "phase_5a": {
        "model": "claude-sonnet-4-6",
        "max_tokens": 8000,
        "concurrency": 1,
        "contract": "deep_wiki_structure",
        "enabled": True,
    },
    "phase_5b": {
        "model": "claude-opus-4-6",
        "max_tokens": 64000,
        "concurrency": 1,
        "contract": "deep_wiki_overview",
        "enabled": True,
    },
    "phase_5c": {
        "model": "claude-opus-4-6",
        "max_tokens": 32000,
        "concurrency": 3,
        "contract": "deep_wiki_domain",
        "enabled": True,
    },
    "phase_5d": {
        "model": "claude-sonnet-4-6",
        "max_tokens": 16000,
        "concurrency": 1,
        "contract": None,
        "enabled": True,
    },
    "phase_6": {
        "model": "claude-sonnet-4-6",
        "max_tokens": 16000,
        "concurrency": 1,
        "contract": "deep_quality_review",
        "thinking_budget": 10000,
        "enabled": True,
    },
}


def _derive(base: dict, overrides: dict) -> dict:
    """Deep-copy base and apply per-phase overrides."""
    import copy
    result = copy.deepcopy(base)
    for phase_key, phase_overrides in overrides.items():
        if phase_key in result:
            result[phase_key].update(phase_overrides)
    return result


ECONOMY_CONFIGS = _derive(QUALITY_CONFIGS, {
    "phase_1":  {"model": "claude-haiku-4-5", "max_tokens": 2000, "concurrency": 15},
    "phase_2":  {"model": "claude-haiku-4-5", "max_tokens": 8000, "concurrency": 10},
    "phase_3":  {"model": "claude-sonnet-4-6", "max_tokens": 16000, "thinking_budget": 5000},
    "phase_4a": {"model": "claude-sonnet-4-6", "max_tokens": 32000},
    "phase_4b": {"model": "claude-sonnet-4-6", "max_tokens": 16000, "concurrency": 5},
    "phase_4c": {"model": "claude-haiku-4-5", "max_tokens": 4000, "concurrency": 10},
    "phase_4d": {"model": "claude-haiku-4-5", "max_tokens": 1000, "concurrency": 15},
    "phase_5a": {"model": "claude-haiku-4-5", "max_tokens": 4000},
    "phase_5b": {"model": "claude-sonnet-4-6", "max_tokens": 32000},
    "phase_5c": {"model": "claude-sonnet-4-6", "max_tokens": 16000, "concurrency": 5},
    "phase_5d": {"model": "claude-haiku-4-5", "max_tokens": 8000},
    "phase_6":  {"model": "claude-sonnet-4-6", "max_tokens": 8000, "thinking_budget": 5000},
})

BALANCED_CONFIGS = _derive(QUALITY_CONFIGS, {
    "phase_2":  {"concurrency": 5},
    "phase_4b": {"model": "claude-sonnet-4-6", "max_tokens": 16000, "concurrency": 5},
    "phase_4c": {"model": "claude-haiku-4-5", "max_tokens": 4000, "concurrency": 10},
    "phase_5b": {"model": "claude-sonnet-4-6", "max_tokens": 32000},
    "phase_5c": {"model": "claude-sonnet-4-6", "max_tokens": 16000, "concurrency": 5},
})

PROFILES = [
    {
        "name": "economy",
        "description": "Custo minimo: Haiku e Sonnet em todas as fases. ~30% do custo do quality. Bom para projetos pequenos ou testes rapidos.",
        "phase_configs": ECONOMY_CONFIGS,
        "quality_threshold": 50,
        "is_default": False,
    },
    {
        "name": "balanced",
        "description": "Equilibrio custo/qualidade: Opus para epics, Sonnet para stories e wiki. ~60% do custo do quality.",
        "phase_configs": BALANCED_CONFIGS,
        "quality_threshold": 60,
        "is_default": True,
    },
    {
        "name": "quality",
        "description": "Qualidade maxima: Opus para epics, stories e wiki. Configuracao identica ao Deep Pipeline v2 original. 100% do custo baseline.",
        "phase_configs": QUALITY_CONFIGS,
        "quality_threshold": 60,
        "is_default": False,
    },
]


def seed():
    db = SessionLocal()
    try:
        created = 0
        updated = 0
        for p in PROFILES:
            existing = db.query(PipelineProfile).filter(PipelineProfile.name == p["name"]).first()
            if existing:
                existing.description = p["description"]
                existing.phase_configs = p["phase_configs"]
                existing.quality_threshold = p["quality_threshold"]
                existing.is_default = p["is_default"]
                updated += 1
            else:
                profile = PipelineProfile(
                    id=uuid4(),
                    name=p["name"],
                    description=p["description"],
                    phase_configs=p["phase_configs"],
                    quality_threshold=p["quality_threshold"],
                    is_default=p["is_default"],
                )
                db.add(profile)
                created += 1
        db.commit()
        print(f"Pipeline profiles seeded: {created} created, {updated} updated")
    finally:
        db.close()


if __name__ == "__main__":
    seed()

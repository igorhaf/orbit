"""
Seed pipeline profiles: economy (v2) and economy-v3 (optimized).

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

# ── v3 Economy: optimized pipeline (-37% tokens) ────────────────────────────
# Disables: Phase 3 (arch map → local), Phase 4d (subtasks), Phase 5d (flows),
#           Phase 6 (QA → local heuristics)
# Keeps full richness: Phase 2 (rules), Phase 4a/4b (epics+stories),
#                       Phase 5a/5b/5c (wiki)

ECONOMY_V3_CONFIGS = _derive(ECONOMY_CONFIGS, {
    "phase_3":  {"enabled": False},                    # Arch map built locally
    "phase_4d": {"enabled": False},                    # No subtasks (mechanical, no rules)
    "phase_5d": {"enabled": False},                    # No flow pages (redundant with 5c)
    "phase_6":  {"enabled": False, "thinking_budget": None},  # QA local (heuristic)
})

PROFILES = [
    {
        "name": "economy",
        "description": "Custo minimo: Haiku e Sonnet em todas as fases. Pipeline v2 completo.",
        "phase_configs": ECONOMY_CONFIGS,
        "quality_threshold": 50,
        "is_default": False,
    },
    {
        "name": "economy-v3",
        "description": "Pipeline v3 otimizado: -37% tokens sem perda de regras. "
                       "Desabilita subtasks, flow pages, arch map (local) e QA (local).",
        "phase_configs": ECONOMY_V3_CONFIGS,
        "quality_threshold": 50,
        "is_default": True,
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
        # Remove deprecated profiles (balanced, quality)
        removed = db.query(PipelineProfile).filter(
            PipelineProfile.name.in_(["balanced", "quality"])
        ).delete(synchronize_session="fetch")
        db.commit()
        print(f"Pipeline profiles seeded: {created} created, {updated} updated")
        if removed:
            print(f"  Removed {removed} deprecated profile(s) (balanced/quality)")
    finally:
        db.close()


if __name__ == "__main__":
    seed()

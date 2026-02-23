"""
Seed Contracts - Migrate YAML contracts to database

PROMPT #257 - Contracts in Database + Visual Nodes in AI Flow

Reads all YAML files from backend/app/contracts/ and inserts them
into the contracts table. Existing contracts are updated (upsert by name).

Usage:
    python scripts/seed_contracts.py
"""

import sys
import logging
from pathlib import Path
from uuid import uuid4
from datetime import datetime

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import yaml
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.models.contract import Contract

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# Base directory for YAML contracts
CONTRACTS_DIR = Path(__file__).resolve().parent.parent / "app" / "contracts"

# Domain mapping from folder names
DOMAIN_MAP = {
    "business": "business",
    "generation": "generation",
    "interviews": "interview",
    "memory": "memory",
    "commits": "generation",
    "components": "component",
    "discovery": "memory",
    "backlog": "generation",
    "context": "generation",
    "execution": "business",
    "validation": "business",
    "pipeline": "generation",
}


def parse_yaml_to_contract_data(yaml_path: Path, contracts_dir: Path) -> dict:
    """Parse a YAML contract file into a dict suitable for the Contract model."""
    content = yaml_path.read_text(encoding="utf-8")
    data = yaml.safe_load(content) or {}

    # Determine contract name from relative path (e.g., "generation/epic_from_interview")
    rel_path = yaml_path.relative_to(contracts_dir)
    contract_name = str(rel_path.with_suffix(""))

    # Determine domain from path or data
    parts = contract_name.split("/")
    inferred_domain = parts[0] if len(parts) > 1 else "generation"
    domain = data.get("domain", DOMAIN_MAP.get(inferred_domain, "generation"))

    # Category from first folder
    category = data.get("category", inferred_domain)

    # Parse variables
    variables_raw = data.get("variables", {})
    variables = {}
    if isinstance(variables_raw, dict):
        variables = variables_raw
    elif isinstance(variables_raw, list):
        variables = {"required": variables_raw, "optional": []}

    # Parse governance
    governance = data.get("governance", {})
    if not isinstance(governance, dict):
        governance = {}

    # Parse rules
    rules = data.get("rules", {})
    if not isinstance(rules, dict):
        rules = {}

    # Parse execution config
    execution = data.get("execution", {})
    if not isinstance(execution, dict):
        execution = {}
    # Backward compatibility: estimated_tokens at root level
    if "estimated_tokens" in data and "estimated_tokens" not in execution:
        execution["estimated_tokens"] = data["estimated_tokens"]

    # Parse validators
    validators = data.get("validators", [])
    if not isinstance(validators, list):
        validators = []

    # Parse data section
    data_section = data.get("data", {})
    if not isinstance(data_section, dict):
        data_section = {}

    # Parse components
    components = data.get("components", [])
    if not isinstance(components, list):
        components = []

    # Parse tags
    tags = data.get("tags", [])
    if not isinstance(tags, list):
        tags = []

    return {
        "name": contract_name,
        "version": data.get("version", 1),
        "domain": domain,
        "category": category,
        "usage_type": data.get("usage_type", "general"),
        "description": data.get("description", ""),
        "system_prompt": data.get("system_prompt", "") or "",
        "user_prompt": data.get("user_prompt", "") or "",
        "semantic_map": data.get("semantic_map", {}) or {},
        "variables": variables,
        "governance": governance,
        "rules": rules,
        "validators": validators,
        "execution": execution,
        "data": data_section,
        "components": components,
        "tags": tags,
        "is_active": True,
    }


def seed_contracts():
    """Seed all YAML contracts into the database."""
    engine = create_engine(settings.database_url)
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()

    try:
        # Find all YAML files (excluding schema, __pycache__, .backups)
        yaml_files = sorted(
            p
            for p in CONTRACTS_DIR.rglob("*.yaml")
            if "__pycache__" not in str(p)
            and ".backups" not in str(p)
            and "schema" not in p.parts
        )

        logger.info(f"Found {len(yaml_files)} YAML contract files")

        created = 0
        updated = 0
        errors = 0

        for yaml_path in yaml_files:
            try:
                contract_data = parse_yaml_to_contract_data(yaml_path, CONTRACTS_DIR)
                contract_name = contract_data["name"]

                # Check if contract already exists (upsert)
                existing = db.query(Contract).filter_by(name=contract_name).first()

                if existing:
                    # Update existing contract
                    for key, value in contract_data.items():
                        if key != "name":
                            setattr(existing, key, value)
                    existing.updated_at = datetime.utcnow()
                    updated += 1
                    logger.info(f"  Updated: {contract_name}")
                else:
                    # Create new contract
                    contract = Contract(id=uuid4(), **contract_data)
                    db.add(contract)
                    created += 1
                    logger.info(f"  Created: {contract_name}")

            except Exception as e:
                errors += 1
                logger.error(f"  Error processing {yaml_path}: {e}")
                continue

        db.commit()

        logger.info(f"\nSeed complete: {created} created, {updated} updated, {errors} errors")
        logger.info(f"Total contracts in database: {db.query(Contract).count()}")

    except Exception as e:
        db.rollback()
        logger.error(f"Seed failed: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_contracts()

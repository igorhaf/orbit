"""
Contract Migrator - Migrates prompts from prompts/ to contracts/

PROMPT #164 - Contracts Architecture: Unification and Governance

This script migrates existing YAML prompts from the prompts/ folder to the
new contracts/ folder structure, enriching them with governance metadata.

Usage:
    from app.contracts.migrator import ContractMigrator

    migrator = ContractMigrator()

    # Dry run (preview changes)
    result = migrator.migrate(dry_run=True)

    # Actual migration
    result = migrator.migrate(dry_run=False)

    # Migrate specific category
    result = migrator.migrate_category("backlog", dry_run=False)
"""

import os
import logging
import shutil
from pathlib import Path
from typing import Dict, List, Any, Optional
from datetime import date

import yaml

logger = logging.getLogger(__name__)

# Directories
PROMPTS_DIR = Path(__file__).parent.parent / "prompts"
CONTRACTS_DIR = Path(__file__).parent


class ContractMigrator:
    """
    Migrates YAML prompts from prompts/ to contracts/ folder.

    Migration mapping:
    - prompts/backlog/     -> contracts/generation/
    - prompts/context/     -> contracts/generation/
    - prompts/interviews/  -> contracts/interviews/
    - prompts/memory/      -> contracts/memory/
    - prompts/commits/     -> contracts/commits/
    - prompts/discovery/   -> contracts/memory/
    - prompts/components/  -> contracts/components/
    """

    # Category to target directory mapping
    CATEGORY_MAPPING = {
        "backlog": "generation",
        "context": "generation",
        "interviews": "interviews",
        "memory": "memory",
        "commits": "commits",
        "discovery": "memory",
        "components": "components",
    }

    # Category to domain mapping
    DOMAIN_MAPPING = {
        "backlog": "generation",
        "context": "generation",
        "interviews": "interview",
        "memory": "memory",
        "commits": "generation",
        "discovery": "memory",
        "components": "component",
    }

    def __init__(self, prompts_dir: Path = None, contracts_dir: Path = None):
        """
        Initialize migrator.

        Args:
            prompts_dir: Source directory (defaults to app/prompts/)
            contracts_dir: Target directory (defaults to app/contracts/)
        """
        self.prompts_dir = prompts_dir or PROMPTS_DIR
        self.contracts_dir = contracts_dir or CONTRACTS_DIR

    def _get_category_from_path(self, file_path: Path) -> str:
        """Extract category from file path."""
        rel_path = file_path.relative_to(self.prompts_dir)
        parts = rel_path.parts
        return parts[0] if parts else "unknown"

    def _get_target_path(self, source_path: Path) -> Path:
        """
        Get target path for a source file.

        Maps source category to target directory.
        """
        rel_path = source_path.relative_to(self.prompts_dir)
        parts = list(rel_path.parts)

        if not parts:
            return None

        # Get source category
        source_category = parts[0]

        # Map to target category
        target_category = self.CATEGORY_MAPPING.get(source_category, source_category)

        # Replace first part with target category
        parts[0] = target_category

        return self.contracts_dir / Path(*parts)

    def _enrich_yaml(self, content: str, source_path: Path) -> str:
        """
        Enrich YAML content with governance and domain fields.
        """
        try:
            data = yaml.safe_load(content)
            if data is None:
                return content

            # Add domain if not present
            source_category = self._get_category_from_path(source_path)
            if 'domain' not in data:
                data['domain'] = self.DOMAIN_MAPPING.get(source_category, 'generation')

            # Add governance if not present
            if 'governance' not in data:
                data['governance'] = {
                    'status': 'active',
                    'owner': 'ORBIT Team',
                    'effective_date': date.today().isoformat(),
                    'change_log': [
                        {
                            'version': data.get('version', 1),
                            'date': date.today().isoformat(),
                            'author': 'Migration Script',
                            'changes': 'Migrated from prompts/ to contracts/'
                        }
                    ]
                }

            # Add execution config from root-level estimated_tokens if present
            if 'estimated_tokens' in data and 'execution' not in data:
                data['execution'] = {
                    'estimated_tokens': data['estimated_tokens'],
                    'cache_enabled': True
                }

            # Convert to YAML with nice formatting
            return yaml.dump(data, default_flow_style=False, allow_unicode=True, sort_keys=False)

        except yaml.YAMLError as e:
            logger.warning(f"Could not parse YAML for {source_path}: {e}")
            return content

    def migrate_file(self, source_path: Path, dry_run: bool = True) -> Dict[str, Any]:
        """
        Migrate a single file.

        Args:
            source_path: Source file path
            dry_run: If True, don't actually write files

        Returns:
            Dict with migration result
        """
        result = {
            "source": str(source_path.relative_to(self.prompts_dir)),
            "target": None,
            "status": "pending",
            "error": None
        }

        try:
            # Get target path
            target_path = self._get_target_path(source_path)
            if target_path is None:
                result["status"] = "skipped"
                result["error"] = "Nao foi possivel determinar o caminho destino"
                return result

            result["target"] = str(target_path.relative_to(self.contracts_dir))

            # Check if target already exists
            if target_path.exists():
                result["status"] = "skipped"
                result["error"] = "Target already exists"
                return result

            # Read source content
            content = source_path.read_text(encoding='utf-8')

            # Enrich YAML
            enriched_content = self._enrich_yaml(content, source_path)

            if dry_run:
                result["status"] = "would_migrate"
            else:
                # Create parent directories
                target_path.parent.mkdir(parents=True, exist_ok=True)

                # Write file
                target_path.write_text(enriched_content, encoding='utf-8')

                result["status"] = "migrated"
                logger.info(f"Migrated: {result['source']} -> {result['target']}")

        except Exception as e:
            result["status"] = "error"
            result["error"] = str(e)
            logger.error(f"Error migrating {source_path}: {e}")

        return result

    def migrate_category(self, category: str, dry_run: bool = True) -> Dict[str, Any]:
        """
        Migrate all files in a category.

        Args:
            category: Category name (e.g., "backlog", "context")
            dry_run: If True, don't actually write files

        Returns:
            Dict with migration summary
        """
        category_dir = self.prompts_dir / category

        if not category_dir.exists():
            return {
                "category": category,
                "status": "error",
                "error": f"Category directory not found: {category}",
                "files": []
            }

        results = []
        for yaml_file in category_dir.rglob("*.yaml"):
            result = self.migrate_file(yaml_file, dry_run)
            results.append(result)

        return {
            "category": category,
            "status": "completed",
            "total": len(results),
            "migrated": sum(1 for r in results if r["status"] == "migrated"),
            "would_migrate": sum(1 for r in results if r["status"] == "would_migrate"),
            "skipped": sum(1 for r in results if r["status"] == "skipped"),
            "errors": sum(1 for r in results if r["status"] == "error"),
            "files": results
        }

    def migrate(self, dry_run: bool = True) -> Dict[str, Any]:
        """
        Migrate all prompts to contracts.

        Args:
            dry_run: If True, preview changes without writing

        Returns:
            Dict with full migration summary
        """
        logger.info(f"Starting migration (dry_run={dry_run})")
        logger.info(f"Source: {self.prompts_dir}")
        logger.info(f"Target: {self.contracts_dir}")

        category_results = []
        total_migrated = 0
        total_skipped = 0
        total_errors = 0

        # Migrate each category
        for category in self.CATEGORY_MAPPING.keys():
            result = self.migrate_category(category, dry_run)
            category_results.append(result)

            if result["status"] == "completed":
                total_migrated += result.get("migrated", 0) + result.get("would_migrate", 0)
                total_skipped += result.get("skipped", 0)
                total_errors += result.get("errors", 0)

        summary = {
            "dry_run": dry_run,
            "source_dir": str(self.prompts_dir),
            "target_dir": str(self.contracts_dir),
            "total_files": total_migrated + total_skipped + total_errors,
            "migrated": total_migrated if not dry_run else 0,
            "would_migrate": total_migrated if dry_run else 0,
            "skipped": total_skipped,
            "errors": total_errors,
            "categories": category_results
        }

        logger.info(f"Migration complete. Total: {summary['total_files']}, "
                    f"{'Would migrate' if dry_run else 'Migrated'}: {total_migrated}, "
                    f"Skipped: {total_skipped}, Errors: {total_errors}")

        return summary

    def get_migration_preview(self) -> List[Dict[str, str]]:
        """
        Get a preview of all files that would be migrated.

        Returns:
            List of {source, target, category} dicts
        """
        preview = []

        for yaml_file in self.prompts_dir.rglob("*.yaml"):
            # Skip __pycache__ and hidden files
            if "__pycache__" in str(yaml_file) or yaml_file.name.startswith('.'):
                continue

            # Skip non-category files (like loader.py level files)
            rel_path = yaml_file.relative_to(self.prompts_dir)
            if len(rel_path.parts) < 2:
                continue

            target_path = self._get_target_path(yaml_file)
            if target_path:
                source_category = self._get_category_from_path(yaml_file)
                preview.append({
                    "source": str(rel_path),
                    "target": str(target_path.relative_to(self.contracts_dir)),
                    "category": source_category,
                    "target_category": self.CATEGORY_MAPPING.get(source_category, source_category)
                })

        return sorted(preview, key=lambda x: x["source"])


# CLI helper functions
def run_migration(dry_run: bool = True):
    """Run migration from command line."""
    migrator = ContractMigrator()
    result = migrator.migrate(dry_run=dry_run)

    print(f"\n{'DRY RUN - ' if dry_run else ''}Migration Summary:")
    print(f"  Total files: {result['total_files']}")
    print(f"  {'Would migrate' if dry_run else 'Migrated'}: {result['would_migrate'] if dry_run else result['migrated']}")
    print(f"  Skipped: {result['skipped']}")
    print(f"  Errors: {result['errors']}")

    print("\nBy Category:")
    for cat in result['categories']:
        print(f"  {cat['category']}: {cat.get('migrated', 0) + cat.get('would_migrate', 0)} files")

    return result


def preview_migration():
    """Preview migration mapping."""
    migrator = ContractMigrator()
    preview = migrator.get_migration_preview()

    print(f"Migration Preview ({len(preview)} files):\n")
    for item in preview:
        print(f"  {item['source']}")
        print(f"    -> {item['target']}")
        print()

    return preview


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "--execute":
        run_migration(dry_run=False)
    elif len(sys.argv) > 1 and sys.argv[1] == "--preview":
        preview_migration()
    else:
        run_migration(dry_run=True)

"""
Export Specs from Database to JSON Files
One-time migration script to convert database-stored specs to JSON files
"""
import json
import sys
from pathlib import Path
from sqlalchemy.orm import Session

# Add parent directory to path to import from app
sys.path.append(str(Path(__file__).parent.parent))

from app.database import SessionLocal
from app.models.spec import Spec
import logging

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)


def get_display_name(framework: str) -> str:
    """Get display name for framework"""
    names = {
        "laravel": "Laravel (PHP)",
        "nextjs": "Next.js (React)",
        "postgresql": "PostgreSQL",
        "tailwind": "Tailwind CSS"
    }
    return names.get(framework, framework.title())


def get_description(framework: str) -> str:
    """Get description for framework"""
    descriptions = {
        "laravel": "PHP framework for web artisans",
        "nextjs": "React framework for production",
        "postgresql": "Advanced open source database",
        "tailwind": "Utility-first CSS framework"
    }
    return descriptions.get(framework, f"{framework} framework")


def get_icon(category: str) -> str:
    """Get icon for category"""
    icons = {
        "backend": "database",
        "frontend": "layout",
        "database": "database",
        "css": "palette"
    }
    return icons.get(category, "file-code")


def export_specs_to_json():
    """Export all database specs to JSON files"""
    db = SessionLocal()
    specs_dir = Path(__file__).parent.parent / "specs"

    try:
        # Create base directories (already created but ensure they exist)
        (specs_dir / "_meta").mkdir(parents=True, exist_ok=True)

        logger.info("🔄 Starting specs export from database to JSON...")

        # Export specs
        all_specs = db.query(Spec).filter(Spec.is_active == True).all()

        if not all_specs:
            logger.warning("⚠️  No active specs found in database!")
            return

        frameworks_meta = {
            "frameworks": []
        }
        framework_counts = {}
        exported_count = 0

        for spec in all_specs:
            # Create framework directory
            spec_dir = specs_dir / spec.category / spec.name
            spec_dir.mkdir(parents=True, exist_ok=True)

            # Build spec JSON
            spec_data = {
                "id": f"{spec.name}-{spec.spec_type}",
                "category": spec.category,
                "name": spec.name,
                "spec_type": spec.spec_type,
                "title": spec.title,
                "description": spec.description,
                "content": spec.content,
                "language": spec.language,
                "framework_version": spec.framework_version,
                "ignore_patterns": spec.ignore_patterns or [],
                "file_extensions": spec.file_extensions or [],
                "is_active": spec.is_active,
                "metadata": {
                    "created_at": spec.created_at.isoformat() + "Z" if spec.created_at else None,
                    "updated_at": spec.updated_at.isoformat() + "Z" if spec.updated_at else None
                }
            }

            # Write JSON file
            spec_file = spec_dir / f"{spec.spec_type}.json"
            with open(spec_file, 'w', encoding='utf-8') as f:
                json.dump(spec_data, f, indent=2, ensure_ascii=False)

            logger.info(f"  ✅ Exported: {spec.category}/{spec.name}/{spec.spec_type}")
            exported_count += 1

            # Count frameworks
            fw_key = (spec.category, spec.name)
            framework_counts[fw_key] = framework_counts.get(fw_key, 0) + 1

        # Build frameworks metadata
        for (category, name), count in framework_counts.items():
            # Get one spec for metadata
            sample_spec = db.query(Spec).filter(
                Spec.category == category,
                Spec.name == name,
                Spec.is_active == True
            ).first()

            frameworks_meta["frameworks"].append({
                "category": category,
                "name": name,
                "display_name": get_display_name(name),
                "description": get_description(name),
                "language": sample_spec.language if sample_spec else None,
                "default_version": sample_spec.framework_version if sample_spec else None,
                "is_active": True,
                "spec_count": count,
                "icon": get_icon(category)
            })

        # Write frameworks metadata
        meta_file = specs_dir / "_meta" / "frameworks.json"
        with open(meta_file, 'w', encoding='utf-8') as f:
            json.dump(frameworks_meta, f, indent=2, ensure_ascii=False)

        logger.info("")
        logger.info(f"✅ Export completed successfully!")
        logger.info(f"   📦 Exported {exported_count} specs to JSON files")
        logger.info(f"   🎯 Created {len(frameworks_meta['frameworks'])} framework definitions")
        logger.info(f"   📁 Location: {specs_dir}")
        logger.info("")
        logger.info("Next steps:")
        logger.info("  1. Review the generated JSON files")
        logger.info("  2. git add backend/specs/")
        logger.info("  3. git commit -m 'feat(specs): export specs from database to JSON'")

    except Exception as e:
        logger.error(f"❌ Export failed: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    export_specs_to_json()

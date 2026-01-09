"""
Validate Specs JSON Files Against Schema
Ensures all spec JSON files conform to the defined schema
"""
import json
import sys
from pathlib import Path
from jsonschema import validate, ValidationError, Draft7Validator
import logging

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

def load_json_file(file_path: Path) -> dict:
    """Load and parse JSON file"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        logger.error(f"❌ JSON decode error in {file_path}: {e}")
        return None
    except Exception as e:
        logger.error(f"❌ Error reading {file_path}: {e}")
        return None

def validate_spec_file(spec_file: Path, schema: dict) -> bool:
    """Validate a single spec file against schema"""
    spec_data = load_json_file(spec_file)
    if spec_data is None:
        return False

    try:
        validate(instance=spec_data, schema=schema)
        return True
    except ValidationError as e:
        logger.error(f"❌ Validation error in {spec_file.relative_to(Path(__file__).parent.parent)}:")
        logger.error(f"   {e.message}")
        if e.path:
            logger.error(f"   Path: {' -> '.join(str(p) for p in e.path)}")
        return False

def validate_frameworks_file(frameworks_file: Path, schema: dict) -> bool:
    """Validate frameworks.json against schema"""
    frameworks_data = load_json_file(frameworks_file)
    if frameworks_data is None:
        return False

    try:
        validate(instance=frameworks_data, schema=schema)
        return True
    except ValidationError as e:
        logger.error(f"❌ Validation error in frameworks.json:")
        logger.error(f"   {e.message}")
        if e.path:
            logger.error(f"   Path: {' -> '.join(str(p) for p in e.path)}")
        return False

def validate_all_specs():
    """Validate all spec JSON files and frameworks metadata"""
    specs_dir = Path(__file__).parent.parent / "specs"
    meta_dir = specs_dir / "_meta"

    # Load schemas
    spec_schema_file = meta_dir / "schema.json"
    frameworks_schema_file = meta_dir / "frameworks-schema.json"

    if not spec_schema_file.exists():
        logger.error(f"❌ Spec schema not found: {spec_schema_file}")
        return False

    if not frameworks_schema_file.exists():
        logger.error(f"❌ Frameworks schema not found: {frameworks_schema_file}")
        return False

    spec_schema = load_json_file(spec_schema_file)
    frameworks_schema = load_json_file(frameworks_schema_file)

    if spec_schema is None or frameworks_schema is None:
        logger.error("❌ Failed to load schemas")
        return False

    logger.info("🔍 Starting JSON schema validation...")
    logger.info("")

    # Validate frameworks.json
    logger.info("📋 Validating frameworks metadata...")
    frameworks_file = meta_dir / "frameworks.json"
    if frameworks_file.exists():
        if validate_frameworks_file(frameworks_file, frameworks_schema):
            logger.info("   ✅ frameworks.json is valid")
        else:
            logger.error("   ❌ frameworks.json validation failed")
            return False
    else:
        logger.error(f"❌ frameworks.json not found: {frameworks_file}")
        return False

    logger.info("")
    logger.info("📋 Validating spec files...")

    # Find all spec JSON files
    spec_files = []
    for category_dir in specs_dir.iterdir():
        if category_dir.is_dir() and category_dir.name != "_meta":
            for framework_dir in category_dir.iterdir():
                if framework_dir.is_dir():
                    for spec_file in framework_dir.glob("*.json"):
                        spec_files.append(spec_file)

    if not spec_files:
        logger.warning("⚠️  No spec files found")
        return True

    # Validate each spec file
    valid_count = 0
    invalid_count = 0

    for spec_file in sorted(spec_files):
        relative_path = spec_file.relative_to(specs_dir)
        if validate_spec_file(spec_file, spec_schema):
            logger.info(f"   ✅ {relative_path}")
            valid_count += 1
        else:
            invalid_count += 1

    logger.info("")
    logger.info("=" * 60)
    logger.info(f"Validation Summary:")
    logger.info(f"  ✅ Valid specs: {valid_count}")
    logger.info(f"  ❌ Invalid specs: {invalid_count}")
    logger.info(f"  📊 Total specs: {len(spec_files)}")
    logger.info("=" * 60)

    if invalid_count > 0:
        logger.error("")
        logger.error("❌ Validation failed! Please fix the errors above.")
        return False

    logger.info("")
    logger.info("✅ All spec files are valid!")
    return True

if __name__ == "__main__":
    success = validate_all_specs()
    sys.exit(0 if success else 1)

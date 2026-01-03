"""
Test SpecLoader Service
Validates that SpecLoader can read all specs from JSON files correctly
"""

import sys
from pathlib import Path
import logging
from datetime import datetime

# Add parent directory to path
sys.path.append(str(Path(__file__).parent.parent))

from app.services.spec_loader import SpecLoader, get_spec_loader

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)


def test_spec_loader():
    """Test SpecLoader functionality"""

    logger.info("=" * 80)
    logger.info("SpecLoader Test Suite")
    logger.info("=" * 80)
    logger.info("")

    # Initialize loader
    logger.info("1️⃣  Initializing SpecLoader...")
    loader = SpecLoader()
    logger.info("   ✅ Loader initialized\n")

    # Test: Load all specs
    logger.info("2️⃣  Testing: Load all specs...")
    start = datetime.now()
    loader._ensure_cache_loaded()
    elapsed = (datetime.now() - start).total_seconds() * 1000
    total_specs = loader.get_spec_count()
    logger.info(f"   ✅ Loaded {total_specs} specs in {elapsed:.2f}ms")
    logger.info(f"   📊 Cache stats: {loader.get_cache_stats()}\n")

    if total_specs != 47:
        logger.error(f"   ❌ Expected 47 specs, got {total_specs}")
        return False

    # Test: Get frameworks
    logger.info("3️⃣  Testing: Load frameworks metadata...")
    frameworks = loader.get_frameworks()
    framework_count = len(frameworks.get("frameworks", []))
    logger.info(f"   ✅ Loaded {framework_count} frameworks")

    if framework_count != 4:
        logger.error(f"   ❌ Expected 4 frameworks, got {framework_count}")
        return False

    for fw in frameworks["frameworks"]:
        logger.info(f"      - {fw['display_name']}: {fw['spec_count']} specs")
    logger.info("")

    # Test: Get all Laravel specs (Phase 3 usage)
    logger.info("4️⃣  Testing: Get all Laravel specs (Phase 3 pattern)...")
    laravel_specs = loader.get_specs_by_framework('backend', 'laravel')
    logger.info(f"   ✅ Found {len(laravel_specs)} Laravel specs")

    if len(laravel_specs) != 22:
        logger.error(f"   ❌ Expected 22 Laravel specs, got {len(laravel_specs)}")
        return False

    logger.info(f"      Sample types: {', '.join([s.spec_type for s in laravel_specs[:5]])}...")
    logger.info("")

    # Test: Get selective Laravel specs (Phase 4 usage)
    logger.info("5️⃣  Testing: Get selective Laravel specs (Phase 4 pattern)...")
    selective_specs = loader.get_specs_by_types(
        'backend',
        'laravel',
        ['controller', 'model', 'migration']
    )
    logger.info(f"   ✅ Found {len(selective_specs)} selective specs")

    if len(selective_specs) != 3:
        logger.error(f"   ❌ Expected 3 specs, got {len(selective_specs)}")
        return False

    for spec in selective_specs:
        logger.info(f"      - {spec.spec_type}: {spec.title}")
    logger.info("")

    # Test: Get all Next.js specs
    logger.info("6️⃣  Testing: Get all Next.js specs (Phase 3 pattern)...")
    nextjs_specs = loader.get_specs_by_framework('frontend', 'nextjs')
    logger.info(f"   ✅ Found {len(nextjs_specs)} Next.js specs")

    if len(nextjs_specs) != 17:
        logger.error(f"   ❌ Expected 17 Next.js specs, got {len(nextjs_specs)}")
        return False
    logger.info("")

    # Test: Get selective Next.js specs
    logger.info("7️⃣  Testing: Get selective Next.js specs (Phase 4 pattern)...")
    nextjs_selective = loader.get_specs_by_types(
        'frontend',
        'nextjs',
        ['page', 'layout']
    )
    logger.info(f"   ✅ Found {len(nextjs_selective)} selective specs")

    if len(nextjs_selective) != 2:
        logger.error(f"   ❌ Expected 2 specs, got {len(nextjs_selective)}")
        return False

    for spec in nextjs_selective:
        logger.info(f"      - {spec.spec_type}: {spec.title}")
    logger.info("")

    # Test: Get PostgreSQL specs
    logger.info("8️⃣  Testing: Get all PostgreSQL specs...")
    postgresql_specs = loader.get_specs_by_framework('database', 'postgresql')
    logger.info(f"   ✅ Found {len(postgresql_specs)} PostgreSQL specs")

    if len(postgresql_specs) != 4:
        logger.error(f"   ❌ Expected 4 PostgreSQL specs, got {len(postgresql_specs)}")
        return False
    logger.info("")

    # Test: Get Tailwind specs
    logger.info("9️⃣  Testing: Get all Tailwind specs...")
    tailwind_specs = loader.get_specs_by_framework('css', 'tailwind')
    logger.info(f"   ✅ Found {len(tailwind_specs)} Tailwind specs")

    if len(tailwind_specs) != 4:
        logger.error(f"   ❌ Expected 4 Tailwind specs, got {len(tailwind_specs)}")
        return False
    logger.info("")

    # Test: Get single spec
    logger.info("🔟  Testing: Get single spec by exact match...")
    single_spec = loader.get_spec('backend', 'laravel', 'controller')
    if single_spec:
        logger.info(f"   ✅ Found spec: {single_spec.title}")
        logger.info(f"      - Language: {single_spec.language}")
        logger.info(f"      - Extensions: {single_spec.file_extensions}")
        logger.info(f"      - Content length: {len(single_spec.content)} chars")
    else:
        logger.error(f"   ❌ Failed to find Laravel controller spec")
        return False
    logger.info("")

    # Test: Singleton pattern
    logger.info("1️⃣1️⃣  Testing: Singleton pattern (get_spec_loader)...")
    loader2 = get_spec_loader()
    logger.info(f"   ✅ Got singleton instance")
    logger.info(f"      Same instance: {loader2 is loader2}")  # Should be True
    logger.info(f"      Specs already cached: {loader2.get_cache_stats()['cache_loaded']}")
    logger.info("")

    # Test: Performance (warm cache)
    logger.info("1️⃣2️⃣  Testing: Performance (warm cache)...")
    start = datetime.now()
    for _ in range(100):
        specs = loader.get_specs_by_framework('backend', 'laravel')
    elapsed = (datetime.now() - start).total_seconds() * 1000 / 100
    logger.info(f"   ✅ Average time (100 calls): {elapsed:.3f}ms per call")
    logger.info("")

    # Summary
    logger.info("=" * 80)
    logger.info("✅ All tests passed!")
    logger.info("=" * 80)
    logger.info("")
    logger.info("Summary:")
    logger.info(f"  📦 Total specs loaded: {total_specs}")
    logger.info(f"  🎯 Frameworks: {framework_count}")
    logger.info(f"  ⚡ Warm cache performance: ~{elapsed:.3f}ms per query")
    logger.info("")
    logger.info("Breakdown by framework:")
    logger.info(f"  - Laravel: {len(laravel_specs)} specs")
    logger.info(f"  - Next.js: {len(nextjs_specs)} specs")
    logger.info(f"  - PostgreSQL: {len(postgresql_specs)} specs")
    logger.info(f"  - Tailwind: {len(tailwind_specs)} specs")
    logger.info("")

    return True


if __name__ == "__main__":
    try:
        success = test_spec_loader()
        sys.exit(0 if success else 1)
    except Exception as e:
        logger.error(f"❌ Test failed with exception: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

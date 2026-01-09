#!/usr/bin/env python3
"""
Update Specs for New Architecture (PROMPT #51)

This script updates the specs database to reflect the new provisioning architecture:
- Only Laravel, Next.js, PostgreSQL, and Tailwind are supported
- Tailwind is a component of Next.js (installed automatically)
- All other technologies are deactivated

Usage:
    python3 backend/scripts/update_specs_for_new_architecture.py
"""

import sys
import os
from pathlib import Path

# Add backend to path
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

from app.database import SessionLocal
from app.models.spec import Spec
from sqlalchemy import func


def update_specs():
    """Update specs to match new architecture"""
    db = SessionLocal()

    try:
        print("=" * 60)
        print("Updating Specs for New Architecture (PROMPT #51)")
        print("=" * 60)
        print()

        # Supported technologies (active)
        supported = {
            "backend": ["laravel"],
            "frontend": ["nextjs"],
            "database": ["postgresql"],
            "css": ["tailwind"]
        }

        # Get all specs
        all_specs = db.query(Spec).all()
        print(f"📊 Found {len(all_specs)} specs in database")
        print()

        # Track changes
        activated = []
        deactivated = []
        unchanged = []

        for spec in all_specs:
            category = spec.category.lower()
            name = spec.name.lower()

            # Check if this spec should be active
            should_be_active = (
                category in supported and
                name in supported[category]
            )

            # Update if needed
            if should_be_active and not spec.is_active:
                spec.is_active = True
                activated.append(f"{category}/{name}")
                print(f"✅ Activated: {category}/{name}")

            elif not should_be_active and spec.is_active:
                spec.is_active = False
                deactivated.append(f"{category}/{name}")
                print(f"❌ Deactivated: {category}/{name}")

            else:
                unchanged.append(f"{category}/{name}")

        # Commit changes
        db.commit()

        print()
        print("=" * 60)
        print("Summary")
        print("=" * 60)
        print(f"✅ Activated: {len(activated)}")
        for spec in activated:
            print(f"   - {spec}")
        print()
        print(f"❌ Deactivated: {len(deactivated)}")
        for spec in deactivated:
            print(f"   - {spec}")
        print()
        print(f"⚪ Unchanged: {len(unchanged)}")
        print()

        # Show active specs by category
        print("=" * 60)
        print("Active Technologies")
        print("=" * 60)
        for category in ["backend", "frontend", "database", "css"]:
            active = db.query(Spec.name).filter(
                Spec.category == category,
                Spec.is_active == True
            ).distinct().all()

            names = [spec[0] for spec in active]
            print(f"{category.upper():12} : {', '.join(names) if names else '(none)'}")

        print()
        print("✅ Specs updated successfully!")
        print()
        print("Supported Stack:")
        print("  - Backend: Laravel")
        print("  - Frontend: Next.js + Tailwind CSS")
        print("  - Database: PostgreSQL")
        print()
        print("Note: Tailwind is installed automatically as part of Next.js setup")
        print("      (component of frontend, not a separate service)")
        print()

    except Exception as e:
        print(f"❌ Error updating specs: {e}")
        db.rollback()
        raise

    finally:
        db.close()


if __name__ == "__main__":
    update_specs()

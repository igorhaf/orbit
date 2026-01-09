#!/usr/bin/env python
"""
Setup A/B Test Experiment

Creates a 50/50 experiment to test template v1 vs v2.

Run this script to initialize the experiment, then use the Prompter system
to see traffic split between variants.
"""

from app.prompter.observability import get_ab_testing_service


def main():
    print("="*60)
    print("A/B TEST SETUP: Template v1 vs v2")
    print("="*60)

    # Get A/B testing service
    ab_service = get_ab_testing_service()

    # Create experiment: 50% v1 (control), 50% v2 (variant)
    experiment = ab_service.create_experiment(
        experiment_id="template_v2_test",
        name="Task Generation v1 vs v2",
        description="Compare traditional prose templates (v1) vs structured ACTION/STEP templates (v2)",
        control_version=1,  # v1 = prose format
        variants=[
            {
                "name": "v2_structured",
                "weight": 0.5,  # 50% of traffic
                "template_version": 2,  # v2 = structured format
            }
        ]
    )

    print("\n✅ Experiment created successfully!")
    print(f"\nExperiment ID: {experiment.id}")
    print(f"Name: {experiment.name}")
    print(f"Description: {experiment.description}")
    print(f"Status: {experiment.status.value}")

    print("\n📊 Traffic Distribution:")
    print(f"   - Control (v1): {experiment.control.weight * 100:.0f}%")
    print(f"   - Variant (v2): {experiment.variants[0].weight * 100:.0f}%")

    print("\n🔬 How it works:")
    print("   1. Each project ID is deterministically assigned to a variant")
    print("   2. Same project always gets same variant (consistency)")
    print("   3. Overall traffic is split 50/50")

    print("\n📈 Metrics tracked:")
    print("   - Execution latency (seconds)")
    print("   - Token usage (input + output)")
    print("   - Cost per execution (USD)")
    print("   - Quality score (0-1)")
    print("   - Validation pass rate")

    print("\n📍 Next steps:")
    print("   1. Execute prompts normally using PrompterFacade")
    print("   2. Metrics are automatically collected per variant")
    print("   3. Run test_ab_testing.py to see results")

    # Test variant assignment with sample project IDs
    print("\n🧪 Sample Assignments:")
    sample_projects = ["proj-123", "proj-456", "proj-789", "proj-abc", "proj-def"]

    for project_id in sample_projects:
        variant = ab_service.get_variant("template_v2_test", project_id)
        version = f"v{variant.template_version}" if variant else "N/A"
        print(f"   - {project_id} → {variant.name} ({version})")

    print("\n✅ Setup complete!")
    print("\nExperiment is now ACTIVE and will be used for all prompt generations.")
    print("Use facade._get_template_version() with experiment_id='template_v2_test'")


if __name__ == "__main__":
    main()

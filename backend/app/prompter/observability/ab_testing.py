"""
A/B Testing Framework

Allows testing different template versions with controlled traffic splits.

Features:
- Deterministic variant assignment (consistent per user/project)
- Multiple variants with configurable weights
- Metrics collection per variant
- Statistical analysis of results
"""

from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field
import hashlib
import json
from datetime import datetime
from enum import Enum


class ExperimentStatus(Enum):
    """Experiment status"""
    DRAFT = "draft"
    ACTIVE = "active"
    PAUSED = "paused"
    COMPLETED = "completed"


@dataclass
class Variant:
    """A/B test variant"""
    name: str
    weight: float  # 0.0 to 1.0 (percentage of traffic)
    template_version: Optional[int] = None
    parameters: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return {
            "name": self.name,
            "weight": self.weight,
            "template_version": self.template_version,
            "parameters": self.parameters
        }


@dataclass
class Experiment:
    """A/B test experiment"""
    id: str
    name: str
    description: str
    status: ExperimentStatus
    control: Variant
    variants: List[Variant]
    created_at: datetime = field(default_factory=datetime.utcnow)

    def get_variant(self, assignment_key: str) -> Variant:
        """
        Deterministically assign variant based on assignment_key

        Uses hash-based assignment for consistency:
        - Same assignment_key always gets same variant
        - Distribution matches variant weights

        Args:
            assignment_key: Unique identifier for assignment (e.g., user_id, project_id)

        Returns:
            Assigned variant
        """
        # Hash assignment_key for deterministic assignment
        hash_value = int(hashlib.sha256(assignment_key.encode()).hexdigest(), 16)
        normalized = (hash_value % 10000) / 10000.0  # 0.0 to 1.0

        # Select variant based on weights
        all_variants = [self.control] + self.variants
        cumulative = 0.0

        for variant in all_variants:
            cumulative += variant.weight
            if normalized < cumulative:
                return variant

        # Fallback to control (should never happen if weights sum to 1.0)
        return self.control

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "status": self.status.value,
            "control": self.control.to_dict(),
            "variants": [v.to_dict() for v in self.variants],
            "created_at": self.created_at.isoformat()
        }


@dataclass
class OutcomeMetric:
    """Outcome metric for a variant"""
    variant_name: str
    metric_name: str
    values: List[float] = field(default_factory=list)

    @property
    def count(self) -> int:
        """Number of samples"""
        return len(self.values)

    @property
    def mean(self) -> float:
        """Mean value"""
        return sum(self.values) / len(self.values) if self.values else 0.0

    @property
    def min(self) -> float:
        """Minimum value"""
        return min(self.values) if self.values else 0.0

    @property
    def max(self) -> float:
        """Maximum value"""
        return max(self.values) if self.values else 0.0

    @property
    def std(self) -> float:
        """Standard deviation"""
        if not self.values or len(self.values) < 2:
            return 0.0
        mean_val = self.mean
        variance = sum((x - mean_val) ** 2 for x in self.values) / len(self.values)
        return variance ** 0.5

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return {
            "variant_name": self.variant_name,
            "metric_name": self.metric_name,
            "count": self.count,
            "mean": self.mean,
            "min": self.min,
            "max": self.max,
            "std": self.std
        }


class ABTestingService:
    """Service for managing A/B tests"""

    def __init__(self):
        self.experiments: Dict[str, Experiment] = {}
        self.metrics: Dict[str, Dict[str, Dict[str, OutcomeMetric]]] = {}
        # Structure: metrics[experiment_id][variant_name][metric_name] = OutcomeMetric

    def create_experiment(
        self,
        experiment_id: str,
        name: str,
        description: str,
        control_version: int,
        variants: List[Dict[str, Any]],
        control_weight: Optional[float] = None
    ) -> Experiment:
        """
        Create new A/B test experiment

        Args:
            experiment_id: Unique experiment identifier
            name: Human-readable name
            description: Experiment description
            control_version: Template version for control group
            variants: List of variant configurations, each with:
                - name: Variant name
                - weight: Traffic percentage (0.0-1.0)
                - template_version: Template version to use
                - parameters: Optional variant-specific parameters
            control_weight: Optional control weight (defaults to remaining after variants)

        Returns:
            Created Experiment object

        Example:
            ab_service.create_experiment(
                "template_v2_test",
                "Task Generation v1 vs v2",
                "Compare structured vs prose templates",
                control_version=1,
                variants=[
                    {"name": "v2_structured", "weight": 0.5, "template_version": 2}
                ]
            )
        """
        variant_objects = [
            Variant(
                name=v["name"],
                weight=v["weight"],
                template_version=v.get("template_version"),
                parameters=v.get("parameters", {})
            )
            for v in variants
        ]

        # Calculate control weight
        total_variant_weight = sum(v.weight for v in variant_objects)
        if control_weight is None:
            control_weight = 1.0 - total_variant_weight

        if control_weight < 0 or control_weight > 1.0:
            raise ValueError(f"Invalid control weight: {control_weight}")

        if abs((control_weight + total_variant_weight) - 1.0) > 0.001:
            raise ValueError(
                f"Weights must sum to 1.0, got {control_weight + total_variant_weight}"
            )

        control = Variant(
            name="control",
            weight=control_weight,
            template_version=control_version
        )

        experiment = Experiment(
            id=experiment_id,
            name=name,
            description=description,
            status=ExperimentStatus.ACTIVE,
            control=control,
            variants=variant_objects
        )

        self.experiments[experiment_id] = experiment

        # Initialize metrics storage
        if experiment_id not in self.metrics:
            self.metrics[experiment_id] = {}

        return experiment

    def get_experiment(self, experiment_id: str) -> Optional[Experiment]:
        """Get experiment by ID"""
        return self.experiments.get(experiment_id)

    def get_variant(
        self,
        experiment_id: str,
        assignment_key: str
    ) -> Optional[Variant]:
        """
        Get assigned variant for assignment_key

        Args:
            experiment_id: Experiment identifier
            assignment_key: Unique identifier for assignment (user_id, project_id, etc.)

        Returns:
            Assigned variant, or None if experiment not found or not active
        """
        experiment = self.experiments.get(experiment_id)
        if not experiment or experiment.status != ExperimentStatus.ACTIVE:
            return None

        return experiment.get_variant(assignment_key)

    def record_metric(
        self,
        experiment_id: str,
        variant_name: str,
        metric_name: str,
        value: float
    ):
        """
        Record metric value for variant

        Args:
            experiment_id: Experiment identifier
            variant_name: Variant name
            metric_name: Metric name (e.g., "latency", "cost", "quality_score")
            value: Metric value
        """
        if experiment_id not in self.metrics:
            self.metrics[experiment_id] = {}

        if variant_name not in self.metrics[experiment_id]:
            self.metrics[experiment_id][variant_name] = {}

        if metric_name not in self.metrics[experiment_id][variant_name]:
            self.metrics[experiment_id][variant_name][metric_name] = OutcomeMetric(
                variant_name=variant_name,
                metric_name=metric_name
            )

        self.metrics[experiment_id][variant_name][metric_name].values.append(value)

    def get_results(self, experiment_id: str) -> Dict[str, Any]:
        """
        Get experiment results with statistical analysis

        Args:
            experiment_id: Experiment identifier

        Returns:
            Results dictionary with:
            - experiment: Experiment metadata
            - variants: List of variant results with metrics
            - summary: Overall summary statistics
        """
        experiment = self.experiments.get(experiment_id)
        if not experiment:
            return {}

        if experiment_id not in self.metrics:
            return {"experiment": experiment.to_dict(), "variants": []}

        variant_results = []

        for variant_name, metrics in self.metrics[experiment_id].items():
            variant_data = {
                "variant_name": variant_name,
                "metrics": {}
            }

            for metric_name, metric in metrics.items():
                variant_data["metrics"][metric_name] = metric.to_dict()

            variant_results.append(variant_data)

        # Calculate summary statistics
        summary = self._calculate_summary(experiment_id)

        return {
            "experiment": experiment.to_dict(),
            "variants": variant_results,
            "summary": summary
        }

    def _calculate_summary(self, experiment_id: str) -> Dict[str, Any]:
        """Calculate summary statistics comparing variants to control"""
        if experiment_id not in self.metrics:
            return {}

        metrics_data = self.metrics[experiment_id]
        control_data = metrics_data.get("control", {})

        summary = {
            "total_samples": sum(
                sum(m.count for m in variant_metrics.values())
                for variant_metrics in metrics_data.values()
            ),
            "comparisons": []
        }

        # Compare each variant to control
        for variant_name, variant_metrics in metrics_data.items():
            if variant_name == "control":
                continue

            comparison = {
                "variant": variant_name,
                "metrics": {}
            }

            for metric_name, metric in variant_metrics.items():
                control_metric = control_data.get(metric_name)

                if control_metric and control_metric.count > 0:
                    # Calculate percentage difference
                    control_mean = control_metric.mean
                    variant_mean = metric.mean

                    if control_mean != 0:
                        pct_diff = ((variant_mean - control_mean) / control_mean) * 100
                    else:
                        pct_diff = 0.0

                    comparison["metrics"][metric_name] = {
                        "control_mean": control_mean,
                        "variant_mean": variant_mean,
                        "difference": variant_mean - control_mean,
                        "pct_difference": pct_diff,
                        "samples": metric.count
                    }

            summary["comparisons"].append(comparison)

        return summary

    def pause_experiment(self, experiment_id: str):
        """Pause an active experiment"""
        if experiment_id in self.experiments:
            self.experiments[experiment_id].status = ExperimentStatus.PAUSED

    def resume_experiment(self, experiment_id: str):
        """Resume a paused experiment"""
        if experiment_id in self.experiments:
            self.experiments[experiment_id].status = ExperimentStatus.ACTIVE

    def complete_experiment(self, experiment_id: str):
        """Mark experiment as completed"""
        if experiment_id in self.experiments:
            self.experiments[experiment_id].status = ExperimentStatus.COMPLETED

    def list_experiments(self) -> List[Dict[str, Any]]:
        """List all experiments"""
        return [exp.to_dict() for exp in self.experiments.values()]


# Global instance
_ab_testing_service: Optional[ABTestingService] = None


def get_ab_testing_service() -> ABTestingService:
    """Get global A/B testing service instance"""
    global _ab_testing_service
    if _ab_testing_service is None:
        _ab_testing_service = ABTestingService()
    return _ab_testing_service

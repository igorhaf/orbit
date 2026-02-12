"""
PROMPT #234 - Knowledge Graph Builder
Builds in-memory dependency graph from symbol data.
Detects recurring structures, dependency patterns, and anti-patterns.
No AI calls - pure graph analysis.
"""

import re
import os
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple
from collections import defaultdict, Counter

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Thresholds
# ---------------------------------------------------------------------------

GOD_OBJECT_LINE_THRESHOLD = 500
GOD_OBJECT_METHOD_THRESHOLD = 20
MASSIVE_FILE_LINE_THRESHOLD = 800
MIN_RECURRING_OCCURRENCES = 3
HUB_TOP_N = 10

# Layer detection keywords
LAYER_KEYWORDS = {
    "route": {"route", "router", "endpoint", "api", "controller", "handler", "view"},
    "service": {"service", "usecase", "interactor", "manager", "orchestrator"},
    "model": {"model", "entity", "schema", "orm", "table", "migration"},
    "repository": {"repository", "repo", "dao", "store", "adapter"},
}


@dataclass
class GraphNode:
    """A node in the knowledge graph."""
    id: str
    node_type: str  # "file"
    language: str = ""
    line_count: int = 0
    function_count: int = 0
    class_count: int = 0


@dataclass
class GraphEdge:
    """An edge in the knowledge graph."""
    source: str
    target: str
    edge_type: str  # "imports" | "extends"
    weight: float = 1.0


@dataclass
class RecurringStructure:
    """A recurring structural pattern across the graph."""
    name: str
    description: str
    structure_type: str  # "paired_imports" | "layered_dependency" | "hub_spoke"
    files_involved: List[str] = field(default_factory=list)
    confidence: float = 0.0
    occurrences: int = 0


@dataclass
class AntiPattern:
    """A detected anti-pattern in the codebase."""
    name: str
    severity: str  # "info" | "warning" | "critical"
    description: str
    files_involved: List[str] = field(default_factory=list)
    metrics: Dict = field(default_factory=dict)


@dataclass
class GraphSummary:
    """Complete summary of the knowledge graph analysis."""
    total_nodes: int = 0
    total_edges: int = 0
    recurring_structures: List[RecurringStructure] = field(default_factory=list)
    anti_patterns: List[AntiPattern] = field(default_factory=list)
    hub_nodes: List[str] = field(default_factory=list)
    layered_architecture: Optional[Dict] = None


class KnowledgeGraphBuilder:
    """
    Builds in-memory dependency graph and detects structural patterns.
    No AI calls. Uses symbol_extractor data.
    """

    def __init__(self):
        self.nodes: Dict[str, GraphNode] = {}
        self.edges: List[GraphEdge] = []
        self.adjacency: Dict[str, Set[str]] = defaultdict(set)
        self.reverse_adjacency: Dict[str, Set[str]] = defaultdict(set)

    def build_graph(
        self,
        symbols_by_file: Dict[str, Dict],
        project_path: Path,
    ) -> GraphSummary:
        """Main entry. Build graph from extracted symbols and analyze it."""
        if not symbols_by_file:
            return GraphSummary()

        # Reset state
        self.nodes = {}
        self.edges = []
        self.adjacency = defaultdict(set)
        self.reverse_adjacency = defaultdict(set)

        # Build graph
        self._add_file_nodes(symbols_by_file)
        self._add_import_edges(symbols_by_file, project_path)

        # Analyze
        recurring = self._detect_recurring_structures()
        layered = self._detect_layered_architecture()
        circular = self._detect_circular_dependencies()
        god_objects = self._detect_god_objects(symbols_by_file)
        massive = self._detect_massive_files(symbols_by_file)
        hubs = self._find_hub_nodes()

        anti_patterns = circular + god_objects + massive

        summary = GraphSummary(
            total_nodes=len(self.nodes),
            total_edges=len(self.edges),
            recurring_structures=recurring,
            anti_patterns=anti_patterns,
            hub_nodes=hubs,
            layered_architecture=layered,
        )

        logger.info(
            f"Knowledge graph: {summary.total_nodes} nodes, {summary.total_edges} edges, "
            f"{len(recurring)} structures, {len(anti_patterns)} anti-patterns, "
            f"{len(hubs)} hub nodes"
        )
        return summary

    # ------------------------------------------------------------------
    # Graph construction
    # ------------------------------------------------------------------

    def _add_file_nodes(self, symbols_by_file: Dict[str, Dict]) -> None:
        """Create graph nodes for all files."""
        for fpath, symbols in symbols_by_file.items():
            funcs = symbols.get("functions", [])
            self.nodes[fpath] = GraphNode(
                id=fpath,
                node_type="file",
                language=symbols.get("language", ""),
                line_count=symbols.get("lines", 0),
                function_count=len(funcs),
                class_count=len(symbols.get("classes", [])),
            )

    def _add_import_edges(
        self, symbols_by_file: Dict[str, Dict], project_path: Path
    ) -> None:
        """Create edges from import statements, resolving to project files."""
        known_files = set(symbols_by_file.keys())

        for fpath, symbols in symbols_by_file.items():
            for imp in symbols.get("imports", []):
                resolved = self._resolve_import(imp, fpath, known_files, project_path)
                if resolved and resolved != fpath:
                    edge = GraphEdge(
                        source=fpath, target=resolved, edge_type="imports"
                    )
                    self.edges.append(edge)
                    self.adjacency[fpath].add(resolved)
                    self.reverse_adjacency[resolved].add(fpath)

    def _resolve_import(
        self, import_str: str, source_file: str,
        known_files: Set[str], project_path: Path,
    ) -> Optional[str]:
        """
        Best-effort import resolution.
        Tries to match import statement to a known project file.
        """
        # Normalize import string
        imp = import_str.strip()

        # Python: from app.services.x import Y -> app/services/x.py
        if "." in imp:
            # Try direct dot-to-path conversion
            candidates = [
                imp.replace(".", "/") + ".py",
                imp.replace(".", "/") + ".ts",
                imp.replace(".", "/") + ".js",
                imp.replace(".", "/") + ".tsx",
                imp.replace(".", "/") + ".jsx",
            ]
            for cand in candidates:
                if cand in known_files:
                    return cand
                # Try with leading segments removed
                parts = cand.split("/")
                for i in range(1, len(parts)):
                    sub = "/".join(parts[i:])
                    if sub in known_files:
                        return sub

        # PHP: use App\Models\User -> app/Models/User.php
        if "\\" in imp:
            php_path = imp.replace("\\", "/") + ".php"
            candidates_php = [php_path, php_path.lower()]
            for cand in candidates_php:
                if cand in known_files:
                    return cand
                parts = cand.split("/")
                for i in range(1, len(parts)):
                    sub = "/".join(parts[i:])
                    if sub in known_files:
                        return sub

        # JS/TS: relative path ./services/auth -> services/auth.ts
        if imp.startswith("./") or imp.startswith("../"):
            source_dir = str(Path(source_file).parent)
            rel_path = os.path.normpath(os.path.join(source_dir, imp))
            for ext in ("", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.js"):
                candidate = rel_path + ext
                if candidate in known_files:
                    return candidate

        # Fallback: try matching the last segment
        last_part = imp.split(".")[-1].split("/")[-1].split("\\")[-1]
        if last_part:
            for known in known_files:
                basename = Path(known).stem
                if basename == last_part:
                    return known

        return None

    # ------------------------------------------------------------------
    # Structural detection
    # ------------------------------------------------------------------

    def _detect_recurring_structures(self) -> List[RecurringStructure]:
        """Detect recurring import patterns across the graph."""
        structures: List[RecurringStructure] = []

        # Paired imports: files that always import the same companion
        # e.g., every *_controller imports a corresponding *_service
        import_targets_by_source: Dict[str, Set[str]] = {}
        for fpath in self.nodes:
            targets = self.adjacency.get(fpath, set())
            if targets:
                import_targets_by_source[fpath] = targets

        # Find files that import similar sets of targets
        target_signature: Counter = Counter()
        for fpath, targets in import_targets_by_source.items():
            sig = frozenset(targets)
            target_signature[sig] += 1

        for sig, count in target_signature.most_common():
            if count >= MIN_RECURRING_OCCURRENCES and len(sig) >= 1:
                files = [
                    f for f, t in import_targets_by_source.items()
                    if frozenset(t) == sig
                ]
                target_names = [Path(t).stem for t in sig]
                structures.append(RecurringStructure(
                    name=f"Shared dependency set: {', '.join(target_names[:3])}",
                    description=(
                        f"{count} files share the exact same import set: "
                        f"{', '.join(target_names[:5])}"
                    ),
                    structure_type="paired_imports",
                    files_involved=files[:10],
                    confidence=min(count / 10.0, 1.0),
                    occurrences=count,
                ))

        # Hub-spoke: files imported by many others
        for hub in self._find_hub_nodes(top_n=5):
            importers = list(self.reverse_adjacency.get(hub, set()))
            if len(importers) >= MIN_RECURRING_OCCURRENCES:
                structures.append(RecurringStructure(
                    name=f"Hub: {Path(hub).stem}",
                    description=(
                        f"{Path(hub).stem} is imported by {len(importers)} files, "
                        f"acting as architectural hub"
                    ),
                    structure_type="hub_spoke",
                    files_involved=[hub] + importers[:9],
                    confidence=min(len(importers) / 15.0, 1.0),
                    occurrences=len(importers),
                ))

        return structures

    def _detect_layered_architecture(self) -> Optional[Dict]:
        """Detect if codebase follows layered architecture."""
        layers: Dict[str, List[str]] = defaultdict(list)

        for fpath in self.nodes:
            fpath_lower = fpath.lower()
            for layer_name, keywords in LAYER_KEYWORDS.items():
                if any(kw in fpath_lower for kw in keywords):
                    layers[layer_name].append(fpath)
                    break

        # Need at least 2 layers with files
        populated = {k: v for k, v in layers.items() if len(v) >= 2}
        if len(populated) < 2:
            return None

        # Check directional flow: routes->services->models
        layer_order = ["route", "service", "repository", "model"]
        flow_violations = 0
        flow_correct = 0

        for i, upper_layer in enumerate(layer_order[:-1]):
            for lower_layer in layer_order[i + 1:]:
                upper_files = set(populated.get(upper_layer, []))
                lower_files = set(populated.get(lower_layer, []))
                if not upper_files or not lower_files:
                    continue

                # Check if upper imports lower (correct)
                for uf in upper_files:
                    targets = self.adjacency.get(uf, set())
                    if targets & lower_files:
                        flow_correct += 1

                # Check if lower imports upper (violation)
                for lf in lower_files:
                    targets = self.adjacency.get(lf, set())
                    if targets & upper_files:
                        flow_violations += 1

        result = {
            "layers": {k: v for k, v in populated.items()},
            "layer_count": len(populated),
            "flow_correct": flow_correct,
            "flow_violations": flow_violations,
            "is_clean": flow_violations == 0 and flow_correct > 0,
        }

        logger.info(
            f"Layered architecture: {len(populated)} layers, "
            f"{flow_correct} correct flows, {flow_violations} violations"
        )
        return result

    def _detect_circular_dependencies(self) -> List[AntiPattern]:
        """DFS-based cycle detection in the import graph."""
        anti_patterns: List[AntiPattern] = []
        visited: Set[str] = set()
        in_stack: Set[str] = set()
        cycles_found: List[List[str]] = []

        def dfs(node: str, path: List[str]) -> None:
            if len(cycles_found) >= 5:  # Cap at 5 cycles
                return
            if node in in_stack:
                # Found cycle
                cycle_start = path.index(node)
                cycle = path[cycle_start:] + [node]
                cycles_found.append(cycle)
                return
            if node in visited:
                return

            visited.add(node)
            in_stack.add(node)
            path.append(node)

            for neighbor in self.adjacency.get(node, set()):
                dfs(neighbor, path)

            path.pop()
            in_stack.remove(node)

        for node in self.nodes:
            if node not in visited:
                dfs(node, [])

        for cycle in cycles_found:
            cycle_names = [Path(f).stem for f in cycle]
            anti_patterns.append(AntiPattern(
                name="circular_dependency",
                severity="warning",
                description=f"Circular import: {' -> '.join(cycle_names)}",
                files_involved=cycle,
                metrics={"cycle_length": len(cycle) - 1},
            ))

        return anti_patterns

    def _detect_god_objects(
        self, symbols_by_file: Dict[str, Dict]
    ) -> List[AntiPattern]:
        """Files/classes with too many methods or lines."""
        anti_patterns: List[AntiPattern] = []

        for fpath, symbols in symbols_by_file.items():
            lines = symbols.get("lines", 0)
            func_count = len(symbols.get("functions", []))

            if lines >= GOD_OBJECT_LINE_THRESHOLD and func_count >= GOD_OBJECT_METHOD_THRESHOLD:
                anti_patterns.append(AntiPattern(
                    name="god_object",
                    severity="warning",
                    description=(
                        f"{Path(fpath).name}: {lines} lines, {func_count} functions "
                        f"(thresholds: {GOD_OBJECT_LINE_THRESHOLD} lines, "
                        f"{GOD_OBJECT_METHOD_THRESHOLD} functions)"
                    ),
                    files_involved=[fpath],
                    metrics={"line_count": lines, "function_count": func_count},
                ))

        return anti_patterns

    def _detect_massive_files(
        self, symbols_by_file: Dict[str, Dict]
    ) -> List[AntiPattern]:
        """Files exceeding line count threshold."""
        anti_patterns: List[AntiPattern] = []

        for fpath, symbols in symbols_by_file.items():
            lines = symbols.get("lines", 0)
            func_count = len(symbols.get("functions", []))

            # Only flag as massive if not already a god object
            if lines >= MASSIVE_FILE_LINE_THRESHOLD and func_count < GOD_OBJECT_METHOD_THRESHOLD:
                anti_patterns.append(AntiPattern(
                    name="massive_file",
                    severity="info",
                    description=f"{Path(fpath).name}: {lines} lines (threshold: {MASSIVE_FILE_LINE_THRESHOLD})",
                    files_involved=[fpath],
                    metrics={"line_count": lines},
                ))

        return anti_patterns

    def _find_hub_nodes(self, top_n: int = HUB_TOP_N) -> List[str]:
        """Most-imported files (highest in-degree)."""
        in_degree: Counter = Counter()
        for target, sources in self.reverse_adjacency.items():
            in_degree[target] = len(sources)

        return [node for node, _ in in_degree.most_common(top_n) if in_degree[node] >= 2]

    # ------------------------------------------------------------------
    # Conversion to StaticPattern for integration
    # ------------------------------------------------------------------

    def convert_to_patterns(
        self,
        summary: GraphSummary,
    ) -> List:
        """Convert graph findings into StaticPattern-compatible objects."""
        from app.services.static_pattern_extractor import StaticPattern

        patterns: List[StaticPattern] = []

        # Recurring structures -> patterns
        for structure in summary.recurring_structures:
            patterns.append(StaticPattern(
                group_key=f"graph:{structure.structure_type}",
                pattern_type=f"graph_{structure.structure_type}",
                title=structure.name,
                description=structure.description,
                template_content=f"// {structure.structure_type}: {structure.name}",
                language="",
                confidence_score=structure.confidence,
                evidence=structure.files_involved[:5],
                occurrences=structure.occurrences,
                key_characteristics=[structure.structure_type],
                detection_method="knowledge_graph",
                is_high_confidence=structure.confidence >= 0.75,
            ))

        # Anti-patterns -> patterns (low confidence, informational)
        for ap in summary.anti_patterns:
            patterns.append(StaticPattern(
                group_key=f"graph:anti_pattern",
                pattern_type=f"anti_pattern_{ap.name}",
                title=f"Anti-pattern: {ap.name.replace('_', ' ').title()}",
                description=ap.description,
                template_content=f"// Anti-pattern: {ap.description}",
                language="",
                confidence_score=0.9 if ap.severity == "critical" else 0.7,
                evidence=ap.files_involved[:5],
                occurrences=len(ap.files_involved),
                key_characteristics=[ap.name, ap.severity],
                detection_method="knowledge_graph",
                is_high_confidence=True,
            ))

        # Layered architecture -> pattern
        if summary.layered_architecture and summary.layered_architecture.get("layer_count", 0) >= 2:
            layer_info = summary.layered_architecture
            layer_names = list(layer_info.get("layers", {}).keys())
            patterns.append(StaticPattern(
                group_key="graph:architecture",
                pattern_type="layered_architecture",
                title=f"Layered Architecture ({' -> '.join(layer_names)})",
                description=(
                    f"{layer_info['layer_count']} layers detected: {', '.join(layer_names)}. "
                    f"{'Clean' if layer_info.get('is_clean') else 'Has violations'} "
                    f"({layer_info.get('flow_correct', 0)} correct, "
                    f"{layer_info.get('flow_violations', 0)} violations)"
                ),
                template_content=f"// Architecture: {' -> '.join(layer_names)}",
                language="",
                confidence_score=0.85 if layer_info.get("is_clean") else 0.65,
                evidence=[f for files in layer_info.get("layers", {}).values() for f in files[:2]],
                occurrences=sum(len(v) for v in layer_info.get("layers", {}).values()),
                key_characteristics=layer_names + (["clean_layers"] if layer_info.get("is_clean") else ["layer_violations"]),
                detection_method="knowledge_graph",
                is_high_confidence=True,
            ))

        return patterns

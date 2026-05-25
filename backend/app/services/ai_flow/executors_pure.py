"""Pure node executors — sem side-effects, sem chamadas AI, sem DB writes.

São funções puras de transformação de dados: input → output, sempre o
mesmo resultado pros mesmos inputs+config. Ideais pra começar o engine
porque são seguros (não consomem tokens, não escrevem em lugar nenhum)
e fáceis de testar.

Executors aqui:
  - json_compactor:        dict/list → compact JSON string
  - json_extractor:        text → parsed JSON (auto-repair opcional)
  - content_truncator:     text → head+tail truncated
  - json_schema_validator: data + schema → {valid, errors}
  - error_classifier:      exception → kind (transient/permanent/quota/oom)
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from .executor import NodeExecutor, NodeExecutionError, ExecutionContext, registry

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# JSONCompactor
# ─────────────────────────────────────────────────────────────────────────────

@registry.register("json_compactor")
class JSONCompactorExecutor(NodeExecutor):
    """Serialize dict/list to compact JSON (no indent, tight separators).

    Output handle: `compact` (string).
    """

    async def execute(
        self,
        inputs: dict[str, Any],
        config: dict[str, Any],
        ctx: ExecutionContext,
    ) -> dict[str, Any]:
        data = inputs.get("data") if "data" in inputs else (
            next(iter(inputs.values())) if inputs else None
        )
        if data is None:
            return {"compact": "null"}
        ensure_ascii = bool(config.get("ensure_ascii", False))
        try:
            compact = json.dumps(data, ensure_ascii=ensure_ascii, separators=(",", ":"))
        except (TypeError, ValueError) as e:
            raise NodeExecutionError(
                "?", "json_compactor",
                f"failed to serialize input: {e}",
                cause=e,
            )
        return {"compact": compact}


# ─────────────────────────────────────────────────────────────────────────────
# JSONExtractor
# ─────────────────────────────────────────────────────────────────────────────

@registry.register("json_extractor")
class JSONExtractorExecutor(NodeExecutor):
    """Parse JSON from a text blob. Optional auto-repair: tries to slice out the
    first { … } or [ … ] when surrounded by markdown/extra text.

    Inputs: `text` (string).
    Outputs:
      - `data`: parsed JSON (dict/list) on success
      - `error`: error message string on failure (other branch can pick it up)
    """

    _FENCE_RE = re.compile(r"```(?:json)?\s*\n([\s\S]*?)\n```", re.MULTILINE)

    async def execute(
        self,
        inputs: dict[str, Any],
        config: dict[str, Any],
        ctx: ExecutionContext,
    ) -> dict[str, Any]:
        text = inputs.get("text") if "text" in inputs else (
            next(iter(inputs.values())) if inputs else None
        )
        if not isinstance(text, str):
            return {"data": None, "error": f"expected text input, got {type(text).__name__}"}

        strict = bool(config.get("strict", False))
        auto_repair = bool(config.get("auto_repair", True))

        # Try direct parse first
        try:
            return {"data": json.loads(text), "error": None}
        except json.JSONDecodeError:
            pass

        if strict:
            return {"data": None, "error": "json parse failed in strict mode"}

        if not auto_repair:
            return {"data": None, "error": "json parse failed (auto_repair disabled)"}

        # Strip markdown fences
        fence_match = self._FENCE_RE.search(text)
        if fence_match:
            try:
                return {"data": json.loads(fence_match.group(1).strip()), "error": None}
            except json.JSONDecodeError:
                pass

        # Slice first { ... last } (or [ ... ])
        for open_ch, close_ch in (("{", "}"), ("[", "]")):
            first = text.find(open_ch)
            last = text.rfind(close_ch)
            if first >= 0 and last > first:
                try:
                    return {"data": json.loads(text[first:last + 1]), "error": None}
                except json.JSONDecodeError:
                    continue

        return {"data": None, "error": "json parse failed even with auto_repair"}


# ─────────────────────────────────────────────────────────────────────────────
# ContentTruncator
# ─────────────────────────────────────────────────────────────────────────────

@registry.register("content_truncator")
class ContentTruncatorExecutor(NodeExecutor):
    """Truncate text to max_chars (head + ellipsis + tail).

    Inputs: `text` (string).
    Outputs: `truncated` (string).
    """

    async def execute(
        self,
        inputs: dict[str, Any],
        config: dict[str, Any],
        ctx: ExecutionContext,
    ) -> dict[str, Any]:
        text = inputs.get("text") if "text" in inputs else (
            next(iter(inputs.values())) if inputs else ""
        )
        if not isinstance(text, str):
            text = str(text)

        max_chars = int(config.get("max_chars", 8000))
        head_ratio = float(config.get("head_ratio", 0.75))

        if len(text) <= max_chars:
            return {"truncated": text}

        head_len = int(max_chars * head_ratio)
        tail_len = max_chars - head_len
        head = text[:head_len]
        tail = text[-tail_len:] if tail_len > 0 else ""
        omitted = len(text) - head_len - tail_len
        marker = f"\n\n# ... [truncated {omitted} chars] ...\n\n"
        return {"truncated": f"{head}{marker}{tail}"}


# ─────────────────────────────────────────────────────────────────────────────
# JSONSchemaValidator
# ─────────────────────────────────────────────────────────────────────────────

# Schemas conhecidos (minimal — apenas required keys). Em produção real,
# usar jsonschema lib; aqui priorizo simplicidade pra primeira versão.
_KNOWN_SCHEMAS: dict[str, dict[str, Any]] = {
    "stories": {
        "type": "list_of_dict",
        "required_keys": ["title", "description"],
    },
    "cards": {
        "type": "list_of_dict",
        "required_keys": ["title"],
    },
    "wiki": {
        "type": "dict",
        "required_keys": ["pages"],
    },
    "context": {
        "type": "dict",
        "required_keys": [],
    },
    "architectural_map": {
        "type": "dict",
        "required_keys": ["domains"],
    },
}


@registry.register("json_schema_validator")
class JSONSchemaValidatorExecutor(NodeExecutor):
    """Validate a parsed JSON object against a named schema.

    Inputs: `data` (dict/list).
    Outputs:
      - `valid`: bool
      - `errors`: list[string] (empty if valid)
    """

    async def execute(
        self,
        inputs: dict[str, Any],
        config: dict[str, Any],
        ctx: ExecutionContext,
    ) -> dict[str, Any]:
        data = inputs.get("data") if "data" in inputs else (
            next(iter(inputs.values())) if inputs else None
        )
        schema_name = (config.get("schema") or "context").strip()
        schema = _KNOWN_SCHEMAS.get(schema_name)
        if schema is None:
            return {"valid": False, "errors": [f"unknown schema {schema_name!r}"]}

        errors: list[str] = []

        # Type check
        expected = schema["type"]
        if expected == "list_of_dict":
            if not isinstance(data, list):
                errors.append(f"expected list, got {type(data).__name__}")
            else:
                for i, item in enumerate(data):
                    if not isinstance(item, dict):
                        errors.append(f"item[{i}]: expected dict, got {type(item).__name__}")
                        continue
                    for key in schema["required_keys"]:
                        if key not in item:
                            errors.append(f"item[{i}]: missing required key {key!r}")
        elif expected == "dict":
            if not isinstance(data, dict):
                errors.append(f"expected dict, got {type(data).__name__}")
            else:
                for key in schema["required_keys"]:
                    if key not in data:
                        errors.append(f"missing required key {key!r}")
        else:
            errors.append(f"unknown schema type {expected!r}")

        return {"valid": len(errors) == 0, "errors": errors}


# ─────────────────────────────────────────────────────────────────────────────
# ErrorClassifier
# ─────────────────────────────────────────────────────────────────────────────

# Padrões pra cada categoria. Ordem importa (mais específicos primeiro).
_ERROR_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("quota",     re.compile(r"\b(quota|rate.?limit|session.?limit|429|too many requests)\b", re.I)),
    ("oom",       re.compile(r"\b(out of memory|oom|memory.?error|killed.*oom)\b", re.I)),
    ("transient", re.compile(r"\b(timeout|connection|temporarily|503|504|retry)\b", re.I)),
    ("permanent", re.compile(r"\b(401|403|404|400|invalid|forbidden|unauthorized|not found|bad request)\b", re.I)),
    ("schema",    re.compile(r"\b(schema|validation|json.?parse|expected.*got)\b", re.I)),
]


@registry.register("error_classifier")
class ErrorClassifierExecutor(NodeExecutor):
    """Classify an error message into a category.

    Inputs: `error` (string message or dict with 'message' key).
    Outputs: `kind` (string: 'quota'|'oom'|'transient'|'permanent'|'schema'|'unknown').
    """

    async def execute(
        self,
        inputs: dict[str, Any],
        config: dict[str, Any],
        ctx: ExecutionContext,
    ) -> dict[str, Any]:
        err = inputs.get("error") if "error" in inputs else (
            next(iter(inputs.values())) if inputs else None
        )
        if isinstance(err, dict):
            msg = err.get("message") or err.get("error") or str(err)
        elif err is None:
            msg = ""
        else:
            msg = str(err)

        for kind, pattern in _ERROR_PATTERNS:
            if pattern.search(msg):
                return {"kind": kind}
        return {"kind": "unknown"}


# ─────────────────────────────────────────────────────────────────────────────
# Module-level eager loading — importing this module registers all executors.
# ─────────────────────────────────────────────────────────────────────────────
__all__ = [
    "JSONCompactorExecutor",
    "JSONExtractorExecutor",
    "ContentTruncatorExecutor",
    "JSONSchemaValidatorExecutor",
    "ErrorClassifierExecutor",
]

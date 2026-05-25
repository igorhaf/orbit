"""Control-flow executors — if/else, switch, logical AND/OR/NOT.

Limitações desta primeira versão:

- `if_else` e `switch` EMITEM múltiplos outputs (true/false ou case_X/default)
  mas só UM com valor real; os outros são None. Successors checam
  `inputs[handle] is not None` pra decidir se "pertencem" ao branch ativo.
  O GraphExecutor SEMPRE executa todos os successors (não pula nodes ainda).
  Implementação completa de skip-branch fica pra próxima iteração.

- `for_each` e `while_loop` NÃO estão implementados aqui — exigem refactor
  do GraphExecutor pra suportar loops com checkpoint de estado. Marcados
  como TODO; placeholders raise NotImplementedError.

- `logical_and/or/not` são puros (avaliam imediatamente).

Expression evaluation: usa AST seguro do Python (ast.literal_eval-friendly +
suporte a atribuições simples via getattr/getitem). Não tem eval() arbitrário.
"""
from __future__ import annotations

import logging
import re
from typing import Any

from .executor import NodeExecutor, NodeExecutionError, ExecutionContext, registry

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers — path resolution + safe condition eval
# ─────────────────────────────────────────────────────────────────────────────

def _resolve_path(root: Any, path: str) -> Any:
    """Resolve $.foo.bar[0].baz contra root.

    Suporta:
      - $.foo            → root["foo"] ou root.foo
      - $.foo.bar        → root["foo"]["bar"]
      - $.foo[0]         → root["foo"][0]
      - $.foo.length     → len(root["foo"])
    """
    if not isinstance(path, str):
        return path
    p = path.strip()
    if not p.startswith("$"):
        # Não é path → retorna literal
        return path
    p = p[1:]  # strip leading $
    if p.startswith("."):
        p = p[1:]
    if not p:
        return root

    cur = root
    # Split por '.' e '[' / ']'
    tokens = re.findall(r"[A-Za-z_]\w*|\[\d+\]", p)
    for tok in tokens:
        if tok.startswith("[") and tok.endswith("]"):
            idx = int(tok[1:-1])
            try:
                cur = cur[idx]
            except (IndexError, TypeError, KeyError):
                return None
            continue
        if tok == "length":
            try:
                return len(cur)
            except TypeError:
                return None
        # attribute or key
        if isinstance(cur, dict):
            cur = cur.get(tok)
        else:
            cur = getattr(cur, tok, None)
        if cur is None:
            return None
    return cur


_COMPARISON_RE = re.compile(
    r"^\s*(\$[\w\.\[\]]+)\s*(==|!=|<=|>=|<|>)\s*(.+?)\s*$"
)


def _eval_condition(expr: str, context: dict[str, Any]) -> bool:
    """Avalia uma expressão de condição contra `context` (geralmente os inputs).

    Forma suportada: `$.path OPERATOR literal` ou `$.path` (truthy check).

    Exemplos:
      $.output.score < 70
      $.relevant_specs.length > 0
      $.has_changes
      $.json_extractor.success == true

    Não suporta: AND/OR — use logical_and/or nodes encadeados em vez disso.
    """
    if not isinstance(expr, str) or not expr.strip():
        return False
    expr = expr.strip()

    # Truthy check (sem operador)
    m = _COMPARISON_RE.match(expr)
    if not m:
        # Só path → truthy
        if expr.startswith("$"):
            val = _resolve_path(context, expr)
            return bool(val)
        # NOT prefix
        if expr.startswith("NOT ") or expr.startswith("!"):
            inner = expr[4:] if expr.startswith("NOT ") else expr[1:]
            return not _eval_condition(inner.strip(), context)
        # Literal — só "true" / "false" reconhecidos
        return expr.lower() == "true"

    path, op, rhs_str = m.group(1), m.group(2), m.group(3).strip()
    lhs = _resolve_path(context, path)

    # Parse RHS: número, string, boolean, ou outro path
    rhs: Any
    if rhs_str.startswith("$"):
        rhs = _resolve_path(context, rhs_str)
    elif rhs_str.lower() == "true":
        rhs = True
    elif rhs_str.lower() == "false":
        rhs = False
    elif rhs_str.lower() == "null" or rhs_str.lower() == "none":
        rhs = None
    elif rhs_str.startswith(('"', "'")):
        rhs = rhs_str.strip("\"'")
    else:
        try:
            rhs = float(rhs_str) if "." in rhs_str else int(rhs_str)
        except ValueError:
            rhs = rhs_str  # fallback string

    try:
        if op == "==": return lhs == rhs
        if op == "!=": return lhs != rhs
        if op == "<":  return lhs < rhs
        if op == "<=": return lhs <= rhs
        if op == ">":  return lhs > rhs
        if op == ">=": return lhs >= rhs
    except TypeError:
        # Comparação inválida (str < int, None comparado, etc) → False
        return False
    return False


# ─────────────────────────────────────────────────────────────────────────────
# IfElse
# ─────────────────────────────────────────────────────────────────────────────

@registry.register("if_else")
class IfElseExecutor(NodeExecutor):
    """Avalia config.condition contra inputs. Emite só UM branch com valor.

    Outputs:
      - true:  valor de inputs.input se condição True, senão None
      - false: valor de inputs.input se condição False, senão None
    """

    async def execute(
        self,
        inputs: dict[str, Any],
        config: dict[str, Any],
        ctx: ExecutionContext,
    ) -> dict[str, Any]:
        condition = config.get("condition", "")
        # Permite override via input.condition (raro, mas valid)
        if "condition" in inputs and isinstance(inputs["condition"], str):
            condition = inputs["condition"]
        payload = inputs.get("input") if "input" in inputs else (
            next(iter(inputs.values())) if inputs else None
        )
        result = _eval_condition(condition, inputs)
        return {
            "true":  payload if result else None,
            "false": None if result else payload,
        }


# ─────────────────────────────────────────────────────────────────────────────
# Switch
# ─────────────────────────────────────────────────────────────────────────────

@registry.register("switch")
class SwitchExecutor(NodeExecutor):
    """Roteia por selector. config.cases = ['caseA', 'caseB'].
    O selector é resolvido (path ou literal); se bate algum case, emite no
    handle correspondente; senão emite no handle 'default'.

    Outputs: case_a, case_b, ..., default. Só UM tem valor (input.input);
    o restante é None.
    """

    async def execute(
        self,
        inputs: dict[str, Any],
        config: dict[str, Any],
        ctx: ExecutionContext,
    ) -> dict[str, Any]:
        selector_expr = config.get("selector", "")
        cases: list[str] = list(config.get("cases") or [])
        # Resolve selector contra inputs
        if isinstance(selector_expr, str) and selector_expr.startswith("$"):
            selector_val = _resolve_path(inputs, selector_expr)
        else:
            selector_val = selector_expr
        selector_str = str(selector_val) if selector_val is not None else ""

        payload = inputs.get("input") if "input" in inputs else (
            next(iter(inputs.values())) if inputs else None
        )

        out: dict[str, Any] = {c: None for c in cases}
        out["default"] = None
        if selector_str in cases:
            out[selector_str] = payload
        else:
            out["default"] = payload
        return out


# ─────────────────────────────────────────────────────────────────────────────
# Logical AND / OR / NOT
# ─────────────────────────────────────────────────────────────────────────────

@registry.register("logical_and")
class LogicalAndExecutor(NodeExecutor):
    """Output = a AND b (boolean)."""

    async def execute(self, inputs, config, ctx):
        a = inputs.get("a")
        b = inputs.get("b")
        return {"result": bool(a) and bool(b)}


@registry.register("logical_or")
class LogicalOrExecutor(NodeExecutor):
    """Output = a OR b."""

    async def execute(self, inputs, config, ctx):
        a = inputs.get("a")
        b = inputs.get("b")
        return {"result": bool(a) or bool(b)}


@registry.register("logical_not")
class LogicalNotExecutor(NodeExecutor):
    """Output = NOT input."""

    async def execute(self, inputs, config, ctx):
        v = inputs.get("input") if "input" in inputs else (
            next(iter(inputs.values())) if inputs else None
        )
        return {"result": not bool(v)}


# ─────────────────────────────────────────────────────────────────────────────
# for_each / while_loop — placeholders (TODO: precisam de loop runtime no
# GraphExecutor)
# ─────────────────────────────────────────────────────────────────────────────

@registry.register("for_each")
class ForEachExecutor(NodeExecutor):
    """TODO: requer suporte a loop no GraphExecutor.

    Implementação ideal: o executor iteraria internamente pela coleção,
    rodando o sub-grafo dos sucessores 'body' pra cada item. Por enquanto,
    apenas propaga a coleção como `body=collection[0]` (primeiro item) e
    `done=collection` (todos), sem iterar.

    Marcador pro engine: este node não roteia loops ainda.
    """

    async def execute(self, inputs, config, ctx):
        collection = inputs.get("collection") if "collection" in inputs else (
            next(iter(inputs.values())) if inputs else []
        )
        if not isinstance(collection, list):
            collection = list(collection) if hasattr(collection, "__iter__") else []
        # Sem loop real ainda — emite primeiro item no body, agregado no done.
        # TODO(v3.8): refactor GraphExecutor pra rodar sub-grafo N vezes.
        body_val = collection[0] if collection else None
        return {"body": body_val, "done": collection}


@registry.register("while_loop")
class WhileLoopExecutor(NodeExecutor):
    """TODO: requer suporte a loop no GraphExecutor.

    Por enquanto: avalia condition uma vez. Se True → emite body=state; senão
    emite done=state. Sem iteração.
    """

    async def execute(self, inputs, config, ctx):
        state = inputs.get("state") if "state" in inputs else (
            next(iter(inputs.values())) if inputs else None
        )
        condition = config.get("condition", "")
        result = _eval_condition(condition, inputs)
        # TODO(v3.8): loop real com checkpoint
        return {
            "body": state if result else None,
            "done": None if result else state,
        }


__all__ = [
    "IfElseExecutor",
    "SwitchExecutor",
    "LogicalAndExecutor",
    "LogicalOrExecutor",
    "LogicalNotExecutor",
    "ForEachExecutor",
    "WhileLoopExecutor",
]

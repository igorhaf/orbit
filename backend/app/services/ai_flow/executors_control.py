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
    """Itera coleção, executando o sub-grafo dos sucessores 'body' por item.

    Comportamento:
    1. Descobre body_nodes via ctx.executor.body_subgraph_node_ids(self_id)
    2. Pra cada item: registra `self_id` output = {body: item, done: None}
       então sub-grafo lê esse value como input. Roda run_subgraph.
       Coleta outputs dos last-nodes do body como resultado da iteração.
    3. Após loop: emite `done` = lista de resultados agregados.

    Sem ctx.executor (smoke test, etc): cai pro modo placeholder antigo.

    Inputs: `collection` (list).
    Outputs:
      - `body`: último item iterado (pra successors imediatos)
      - `done`: lista de outputs do final do body por iteração
    """

    async def execute(self, inputs, config, ctx):
        collection = inputs.get("collection") if "collection" in inputs else (
            next(iter(inputs.values())) if inputs else []
        )
        if not isinstance(collection, list):
            try:
                collection = list(collection)
            except TypeError:
                collection = []

        if not collection:
            return {"body": None, "done": []}

        # Sem GraphExecutor backref (smoke isolado): comportamento placeholder
        if ctx is None or ctx.executor is None:
            return {"body": collection[0], "done": collection}

        # Descobre o node_id de SI MESMO: olha o último node executado no ctx
        # cujo kind é for_each. Mais robusto: ctx.executor procura por self
        # via call site. Aqui usamos heurística: o ctx.outputs ainda não tem
        # entry pra mim (já que ainda estou executando), então procuro o
        # for_each que está no order atual e não tem output ainda.
        my_id = None
        for nid, node in ctx.executor.nodes_by_id.items():
            if node.get("data", {}).get("kind") == "for_each" and nid not in ctx.outputs:
                my_id = nid
                break
        if not my_id:
            # Fallback: roda só uma iteração
            return {"body": collection[0], "done": [collection[0]]}

        body_nodes = ctx.executor.body_subgraph_node_ids(my_id)
        if not body_nodes:
            return {"body": collection[0], "done": collection}

        results: list[Any] = []
        # Loop
        ctx.loop_stack.append({"node_id": my_id, "collection_len": len(collection)})
        await ctx.emit("loop_started", {
            "run_id": str(ctx.run_id),
            "node_id": my_id,
            "total_items": len(collection),
        })
        try:
            for idx, item in enumerate(collection):
                await ctx.emit("loop_iter_started", {
                    "run_id": str(ctx.run_id),
                    "node_id": my_id,
                    "iter": idx,
                    "total": len(collection),
                })
                # Override do output deste for_each na iteração:
                # body recebe o item atual, done fica None (loop ainda rolando).
                # Inputs do sub-grafo (que leem do source=my_id, handle=body)
                # vão pegar `item`.
                iter_outputs = {my_id: {"body": item, "done": None}}
                produced = await ctx.executor.run_subgraph(body_nodes, iter_outputs)
                # Coleta o output do ÚLTIMO node do body (resultado da iteração)
                if body_nodes:
                    last_id = body_nodes[-1]
                    last_out = produced.get(last_id) or {}
                    # Se output dict tem 1 chave, usa o valor direto
                    if len(last_out) == 1:
                        results.append(next(iter(last_out.values())))
                    else:
                        results.append(last_out)
                else:
                    results.append(None)
        finally:
            if ctx.loop_stack:
                ctx.loop_stack.pop()
            await ctx.emit("loop_completed", {
                "run_id": str(ctx.run_id),
                "node_id": my_id,
                "items_processed": len(results),
            })

        return {"body": collection[-1] if collection else None, "done": results}


@registry.register("while_loop")
class WhileLoopExecutor(NodeExecutor):
    """Loop while: avalia condition, executa body, repete até False ou max_iter.

    Comportamento similar ao for_each, mas com condição em vez de coleção.
    Cada iteração:
      1. Roda body sub-grafo com state atual
      2. Coleta output do último body node como new_state
      3. Avalia condition contra {state: new_state, iter: N}
      4. Repete enquanto condition true E iter < max_iter

    Inputs: `state` (any — propagated and possibly mutated by body).
    Outputs:
      - `body`: state em cada iteração (durante o loop)
      - `done`: state final após loop terminar
    """

    async def execute(self, inputs, config, ctx):
        state = inputs.get("state") if "state" in inputs else (
            next(iter(inputs.values())) if inputs else None
        )
        condition = config.get("condition", "")
        max_iter = int(config.get("max_iter", 10))

        # Sem ctx.executor: comportamento placeholder
        if ctx is None or ctx.executor is None:
            result = _eval_condition(condition, inputs)
            return {
                "body": state if result else None,
                "done": None if result else state,
            }

        # Descobre meu node_id
        my_id = None
        for nid, node in ctx.executor.nodes_by_id.items():
            if node.get("data", {}).get("kind") == "while_loop" and nid not in ctx.outputs:
                my_id = nid
                break
        if not my_id:
            return {"body": None, "done": state}

        body_nodes = ctx.executor.body_subgraph_node_ids(my_id)
        if not body_nodes:
            return {"body": None, "done": state}

        ctx.loop_stack.append({"node_id": my_id, "kind": "while_loop"})
        await ctx.emit("loop_started", {
            "run_id": str(ctx.run_id),
            "node_id": my_id,
            "max_iter": max_iter,
        })

        iter_count = 0
        cur_state = state
        try:
            while iter_count < max_iter:
                # Avalia condition com cur_state + iter_count
                eval_ctx = {"state": cur_state, "iter": iter_count, **(inputs or {})}
                should_continue = _eval_condition(condition, eval_ctx)
                if not should_continue:
                    break
                await ctx.emit("loop_iter_started", {
                    "run_id": str(ctx.run_id),
                    "node_id": my_id,
                    "iter": iter_count,
                })
                iter_outputs = {my_id: {"body": cur_state, "done": None}}
                produced = await ctx.executor.run_subgraph(body_nodes, iter_outputs)
                last_id = body_nodes[-1]
                last_out = produced.get(last_id) or {}
                if last_out:
                    cur_state = next(iter(last_out.values())) if len(last_out) == 1 else last_out
                iter_count += 1
        finally:
            if ctx.loop_stack:
                ctx.loop_stack.pop()
            await ctx.emit("loop_completed", {
                "run_id": str(ctx.run_id),
                "node_id": my_id,
                "iterations": iter_count,
                "hit_max": iter_count >= max_iter,
            })

        return {"body": None, "done": cur_state}


__all__ = [
    "IfElseExecutor",
    "SwitchExecutor",
    "LogicalAndExecutor",
    "LogicalOrExecutor",
    "LogicalNotExecutor",
    "ForEachExecutor",
    "WhileLoopExecutor",
]

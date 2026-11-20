#!/usr/bin/env python3
"""Summarize sequential dev-memory benchmarks without reading application data."""

from __future__ import annotations

import argparse
from collections import defaultdict
import datetime as dt
import json
from pathlib import Path
import statistics


PROFILES = (
    ("safdoulas-v2-", "containers", "orbit-safdoulas-v2-web"),
    ("suinda-", "containers", "suinda-web"),
    ("dev-", "containers", "orbit-dev"),
    ("adope-", "services", "adope-web.service"),
)
CAUTIONS = [
    "working_set_bytes is memory.current minus inactive_file; it is not the JavaScript heap.",
    "memory.peak is the raw cgroup lifetime resident peak, including cache; it is not a working-set peak and may predate this benchmark.",
    "max_sampled_working_set_bytes is the largest observed sample, not a guaranteed instantaneous peak.",
    "The first HTTP pass is only the first pass in this invocation; caches are not necessarily physically cold.",
    "Reload verification uses server HTTP after a source edit; browser Fast Refresh was not tested.",
    "Observed policy differences also depend on process age, loaded routes, cache warmth and other host activity; they do not alone prove policy causality.",
    "Warm median includes only HTTP 200 responses. Reload-v2 duration is the successful HTTP request duration, excluding earlier attempts and sampling/retry time.",
    "Events are final absolute cgroup counters; they are not attributed to this run without comparison against earlier counters.",
]


def input_paths(state_dir: Path, name: str) -> list[Path]:
    path = state_dir / name
    rotated = [candidate for candidate in state_dir.glob(name + ".*") if candidate.name.rsplit(".", 1)[-1].isdigit()]
    rotated.sort(key=lambda item: -int(item.name.rsplit(".", 1)[-1]))
    return rotated + ([path] if path.exists() else [])


def read_jsonl(state_dir: Path, name: str, warnings: list) -> list[dict]:
    result = []
    paths = input_paths(state_dir, name)
    if not paths:
        warnings.append({"source": name, "kind": "missing_input"})
    for path in paths:
        try:
            with path.open(encoding="utf-8") as stream:
                for number, line in enumerate(stream, 1):
                    if not line.strip():
                        continue
                    try:
                        record = json.loads(line)
                        if not isinstance(record, dict):
                            raise ValueError("Expected object")
                        result.append(record)
                    except (ValueError, UnicodeError):
                        warnings.append({"source": path.name, "line": number, "kind": "invalid_or_incomplete_json"})
        except OSError as exc:
            warnings.append({"source": path.name, "kind": type(exc).__name__, "errno": exc.errno})
    return result


def profile(label: str):
    for prefix, kind, target in PROFILES:
        if label.startswith(prefix):
            return kind, target
    return None


def snapshots(rows: list[dict]) -> list[dict]:
    result = []
    for row in rows:
        for key in ("memory", "before", "after", "final_memory"):
            value = row.get(key)
            if isinstance(value, dict):
                result.append(value)
    return result


def selected_summary(snapshot: dict, kind: str, target: str) -> dict:
    return (snapshot.get(kind) or {}).get(target) or {}


def selected_full(sample: dict, kind: str, target: str) -> dict:
    identity = "name" if kind == "containers" else "Id"
    for row in sample.get(kind, []):
        if row.get(identity) == target:
            return row.get("cgroup") or {}
    return {}


def maximum(values):
    values = [value for value in values if isinstance(value, (int, float))]
    return max(values) if values else None


def target_metrics(rows: list[dict], full: list[dict], kind: str, target: str) -> dict:
    brief = snapshots(rows)
    observed = [selected_summary(snapshot, kind, target) for snapshot in brief]
    observed.extend(selected_full(sample, kind, target) for sample in full)
    completed = [row for row in rows if row.get("kind") == "summary"]
    final_snapshot = completed[-1].get("final_memory") if completed else None
    if not final_snapshot and brief:
        final_snapshot = brief[-1]
    final = selected_summary(final_snapshot or {}, kind, target)
    # Full samples carry memory.stat and can fill gaps in an interrupted run.
    if not final and full:
        final = selected_full(full[-1], kind, target)
    raw_peaks = [sample.get("memory.peak") for sample in observed]
    working_sets = [sample.get("working_set_bytes") for sample in observed]
    anon = [selected_full(sample, kind, target).get("memory.stat", {}).get("anon") for sample in full]
    return {
        "kind": kind, "target": target,
        "final_working_set_bytes": final.get("working_set_bytes"),
        "final_memory_current_bytes": final.get("memory.current"),
        "final_swap_bytes": final.get("memory.swap.current"),
        "raw_memory_peak_bytes": maximum(raw_peaks),
        "max_sampled_working_set_bytes": maximum(working_sets),
        "max_sampled_anon_bytes": maximum(anon),
        "final_memory_events": final.get("memory.events"),
        "brief_snapshots_with_target": sum(bool(selected_summary(snapshot, kind, target)) for snapshot in brief),
        "full_samples_with_target": sum(bool(selected_full(sample, kind, target)) for sample in full),
    }


def summarize_label(label: str, rows: list[dict], full: list[dict]) -> dict:
    summaries = [row for row in rows if row.get("kind") == "summary"]
    last = summaries[-1] if summaries else {}
    requests = [row for row in rows if row.get("kind") == "http_stage"]
    warm = [row["request"]["duration_seconds"] * 1000 for row in requests
            if row.get("stage", "").startswith(("warm_1_", "warm_2_"))
            and row.get("request", {}).get("status") == 200
            and isinstance(row.get("request", {}).get("duration_seconds"), (int, float))]
    reload_v2 = [row for row in requests if row.get("stage", "").startswith("hot_reload_v2_")]
    successful_reload = [row for row in reload_v2 if row.get("request", {}).get("status") == 200
                         and row.get("request", {}).get("expected_marker_found")]
    reload_duration = successful_reload[-1]["request"].get("duration_seconds") if successful_reload else None
    selected = profile(label)
    result = {
        "label": label,
        "success": last.get("success"),
        "hot_reload_verified": last.get("hot_reload_verified"),
        "completed_runs": len(summaries),
        "started_runs": sum(row.get("kind") == "start" for row in rows),
        "http_request_count": len(requests),
        "http_non_200_count": sum(row.get("request", {}).get("status") != 200 for row in requests),
        "warm_http_median_ms": round(statistics.median(warm), 3) if warm else None,
        "warm_http_200_count": len(warm),
        "reload_v2_http_ms": round(reload_duration * 1000, 3) if isinstance(reload_duration, (int, float)) else None,
        "reload_v2_attempt_count": len(reload_v2),
        "target_metrics": target_metrics(rows, full, *selected) if selected else None,
    }
    if label.startswith("adope-"):
        result["api_metrics"] = target_metrics(rows, full, "services", "adope-api.service")
    if label.startswith("dev-"):
        result["target_scope_note"] = "orbit-dev includes the frontend, API and child processes in the same container."
    if result["started_runs"] > 1:
        result["multiple_runs_note"] = "Repeated label: final state is from the latest summary; sampled maxima and request metrics aggregate this label."
    return result


def mib(value) -> str:
    return f"{value / 1024 / 1024:.1f}" if isinstance(value, (int, float)) else "—"


def milliseconds(value) -> str:
    return f"{value:.1f}" if isinstance(value, (int, float)) else "—"


def yesno(value) -> str:
    return "sim" if value is True else "não" if value is False else "—"


def md_escape(text: str) -> str:
    return str(text).replace("|", "\\|").replace("\n", " ").replace("\r", " ")


def markdown(document: dict) -> str:
    lines = [
        "# Medições dos ambientes de desenvolvimento", "",
        "Valores de memória em MiB. `WS` = memória residente menos `inactive_file`. Tempos HTTP em milissegundos.", "",
        "| Cenário | Sucesso / reload | WS final | Swap final | WS máximo amostrado | Pico bruto cgroup | Anon máx. amostrada | HTTP warm mediano | HTTP reload v2 | Requests | Eventos max / oom / oom_kill |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ]
    for row in document["labels"]:
        metric = row.get("target_metrics") or {}
        events = metric.get("final_memory_events") or {}
        event_text = " / ".join(str(events.get(key, "—")) for key in ("max", "oom", "oom_kill"))
        values = [
            md_escape(row["label"]), f"{yesno(row['success'])} / {yesno(row['hot_reload_verified'])}",
            mib(metric.get("final_working_set_bytes")), mib(metric.get("final_swap_bytes")),
            mib(metric.get("max_sampled_working_set_bytes")), mib(metric.get("raw_memory_peak_bytes")),
            mib(metric.get("max_sampled_anon_bytes")), milliseconds(row.get("warm_http_median_ms")),
            milliseconds(row.get("reload_v2_http_ms")), str(row["http_request_count"]), event_text,
        ]
        lines.append("| " + " | ".join(values) + " |")
    lines.extend(["", "## Escopo e interpretação", ""])
    cautions_pt = [
        "Pico bruto é `memory.peak` do cgroup desde sua criação, incluindo cache e possíveis picos anteriores ao benchmark. Não equivale ao pico de WS ou ao heap JavaScript.",
        "O maior WS amostrado pode perder picos entre amostras. Memória anônima vem de `memory.stat.anon` nas amostras completas.",
        "A primeira passagem HTTP não implica cache fisicamente frio. O teste de reload confirma a atualização do servidor por HTTP; não foi usado navegador.",
        "A mediana warm inclui somente respostas 200. O tempo reload v2 mede a requisição HTTP bem-sucedida, excluindo tentativas anteriores, coleta de memória e espera entre tentativas.",
        "Diferenças também dependem de idade do processo, rotas compiladas, caches e atividade concorrente do host. Não atribuir toda redução à política de memória.",
        "Eventos são contadores absolutos finais; não representam necessariamente eventos ocorridos durante o cenário.",
        "Orbit Dev é medido pelo contêiner inteiro, incluindo API e filhos; os demais alvos principais são somente seus frontends.",
    ]
    lines.extend("- " + item for item in cautions_pt)
    for row in document["labels"]:
        if row.get("multiple_runs_note"):
            lines.append(f"- `{md_escape(row['label'])}` foi repetido: estado final da última conclusão; máximos e tempos agregam as execuções com esse rótulo.")
    api_rows = [row for row in document["labels"] if row.get("api_metrics")]
    if api_rows:
        lines.extend(["", "## API Adope separada", "", "| Cenário | WS final MiB | Swap final MiB | Anon máx. MiB |", "|---|---:|---:|---:|"])
        for row in api_rows:
            metric = row["api_metrics"]
            lines.append(f"| {md_escape(row['label'])} | {mib(metric.get('final_working_set_bytes'))} | {mib(metric.get('final_swap_bytes'))} | {mib(metric.get('max_sampled_anon_bytes'))} |")
    if document["warnings"]:
        lines.extend(["", f"Leitura registrou {len(document['warnings'])} aviso(s); detalhes estruturais no JSON, sem conteúdo das linhas inválidas."])
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", type=Path, default=Path.cwd())
    parser.add_argument("--output-prefix", type=Path, required=True, help="Relative to state-dir unless absolute; writes .json and .md")
    args = parser.parse_args()
    state_dir = args.state_dir.resolve()
    warnings = []
    stages = read_jsonl(state_dir, "benchmarks.jsonl", warnings)
    samples = read_jsonl(state_dir, "benchmark-samples.jsonl", warnings)
    grouped = defaultdict(list)
    full = defaultdict(list)
    for record in stages:
        if isinstance(record.get("label"), str):
            grouped[record["label"]].append(record)
    for sample in samples:
        if isinstance(sample.get("label"), str):
            full[sample["label"]].append(sample)
    document = {
        "schema_version": 1,
        "generated_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "input_stage_records": len(stages), "input_full_sample_records": len(samples),
        "labels": [summarize_label(label, rows, full[label]) for label, rows in grouped.items()],
        "cautions": CAUTIONS, "warnings": warnings,
    }
    prefix = args.output_prefix if args.output_prefix.is_absolute() else state_dir / args.output_prefix
    prefix.parent.mkdir(parents=True, exist_ok=True)
    json_path, markdown_path = Path(str(prefix) + ".json"), Path(str(prefix) + ".md")
    json_path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    markdown_path.write_text(markdown(document), encoding="utf-8")
    print(json.dumps({"labels": len(document["labels"]), "warnings": len(warnings), "json": str(json_path), "markdown": str(markdown_path)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

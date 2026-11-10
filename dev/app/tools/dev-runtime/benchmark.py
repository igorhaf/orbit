#!/usr/bin/env python3
"""Sequential HTTP/source-reload benchmark. 'cold' means first pass, not cleared caches."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import signal
import sys
import time
from urllib.error import HTTPError
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen
from uuid import uuid4


MAX_RESPONSE_BYTES = 8 * 1024 * 1024
REQUEST_TIMEOUT_SECONDS = 60
PROBE_ROUTE = "/dev-memory-probe"


def load_monitor():
    path = Path(__file__).resolve().with_name("monitor.py")
    spec = importlib.util.spec_from_file_location("dev_memory_monitor", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Cannot load sibling monitor.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def memory_summary(sample: dict) -> dict:
    meminfo = sample.get("host", {}).get("meminfo_bytes", {})
    result = {
        "timestamp_utc": sample.get("timestamp_utc"),
        "host_available_bytes": meminfo.get("MemAvailable"),
        "host_swap_used_bytes": meminfo.get("SwapTotal", 0) - meminfo.get("SwapFree", 0),
        "host_memory_pressure": sample.get("host", {}).get("memory_pressure"),
        "containers": {}, "services": {}, "errors": sample.get("errors", []),
    }
    for kind, identity in (("containers", "name"), ("services", "Id")):
        for item in sample.get(kind, []):
            cgroup = item.get("cgroup") or {}
            result[kind][item.get(identity, "unknown")] = {
                key: cgroup.get(key) for key in (
                    "memory.current", "memory.swap.current", "working_set_bytes",
                    "memory.peak", "memory.events", "cpu.stat", "pids.current",
                )
            }
    return result


def fetch(url: str) -> tuple[dict, bytes]:
    started = time.monotonic()
    response = None
    result = {"url": url, "timeout_seconds": REQUEST_TIMEOUT_SECONDS}
    body = b""
    try:
        try:
            response = urlopen(Request(url, headers={"User-Agent": "local-dev-memory-benchmark/1"}), timeout=REQUEST_TIMEOUT_SECONDS)
        except HTTPError as exc:
            response = exc
        result["status"] = response.status
        body = response.read(MAX_RESPONSE_BYTES + 1)
        result["response_truncated"] = len(body) > MAX_RESPONSE_BYTES
        body = body[:MAX_RESPONSE_BYTES]
        result["sampled_response_bytes"] = len(body)
        result["sha256"] = hashlib.sha256(body).hexdigest()
    except Exception as exc:
        result["status"] = None
        result["error"] = {"kind": type(exc).__name__}
    finally:
        if response is not None:
            response.close()
    result["duration_seconds"] = round(time.monotonic() - started, 6)
    return result, body


class Benchmark:
    def __init__(self, args, monitor):
        self.args = args
        self.monitor = monitor
        self.sequence = 0
        self.results = []

    def snapshot(self, stage: str, phase: str) -> dict:
        sample = self.monitor.collect(self.sequence)
        self.sequence += 1
        sample.update({"kind": "memory_sample", "label": self.args.label, "stage": stage, "phase": phase})
        if self.args.samples_output:
            self.monitor.append_record(self.args.samples_output, sample)
        return memory_summary(sample)

    def record(self, value: dict) -> None:
        value.update({"schema_version": 1, "label": self.args.label})
        self.monitor.append_record(self.args.output, value)
        self.results.append(value)

    def request(self, stage: str, route: str, expected_marker: str | None = None) -> dict:
        before = self.snapshot(stage, "before")
        request, body = fetch(urljoin(self.args.url, route))
        if expected_marker is not None:
            request["expected_marker_found"] = expected_marker.encode("ascii") in body
        del body
        after = self.snapshot(stage, "after")
        record = {"kind": "http_stage", "stage": stage, "request": request, "before": before, "after": after}
        self.record(record)
        return request

    def probe_request(self, version: int, marker: str) -> bool:
        for attempt in range(1, 11):
            result = self.request(f"hot_reload_v{version}_attempt_{attempt}", PROBE_ROUTE, marker)
            if result.get("status") == 200 and result.get("expected_marker_found"):
                return True
            if attempt < 10:
                time.sleep(1)
        return False

    def source_probe(self) -> bool:
        directory = self.args.probe_root / PROBE_ROUTE.lstrip("/")
        page = directory / "page.tsx"
        directory_created = False
        page_created = False
        try:
            # mkdir is intentionally exclusive: never replace an existing route.
            directory.mkdir()
            directory_created = True
            markers = [f"dev-memory-probe-{uuid4().hex}-v{version}" for version in (1, 2)]
            source = lambda marker: f'export default function MemoryProbe() {{ return <main>{marker}</main>; }}\n'
            with page.open("x", encoding="utf-8") as stream:
                page_created = True
                stream.write(source(markers[0]))
            if not self.probe_request(1, markers[0]):
                return False
            page.write_text(source(markers[1]), encoding="utf-8")
            return self.probe_request(2, markers[1])
        except (OSError, ValueError) as exc:
            self.record({"kind": "probe_error", "stage": "hot_reload", "error": {"kind": type(exc).__name__}})
            return False
        finally:
            cleanup = {"kind": "probe_cleanup", "stage": "hot_reload_cleanup", "removed_file": False, "removed_directory": False, "errors": []}
            if page_created:
                try:
                    page.unlink(missing_ok=True)
                    cleanup["removed_file"] = True
                except OSError as exc:
                    cleanup["errors"].append({"target": "created_page", "kind": type(exc).__name__})
            if directory_created:
                try:
                    # rmdir preserves unexpected files; never remove another tree.
                    directory.rmdir()
                    cleanup["removed_directory"] = True
                except OSError as exc:
                    cleanup["errors"].append({"target": "created_directory", "kind": type(exc).__name__})
            self.record(cleanup)

    def run(self) -> bool:
        self.record({"kind": "start", "stage": "initial", "memory": self.snapshot("initial", "initial"), "routes": self.args.routes})
        success = True
        for round_name in ("cold", "warm_1", "warm_2"):
            for index, route in enumerate(self.args.routes):
                result = self.request(f"{round_name}_route_{index}", route)
                success = success and result.get("status") == 200
        hot_reload = None
        if self.args.probe_root is not None:
            hot_reload = self.source_probe()
            success = success and hot_reload
        before = self.snapshot("idle", "before")
        time.sleep(self.args.idle_seconds)
        after = self.snapshot("idle", "after")
        self.record({"kind": "idle_stage", "stage": "idle", "duration_seconds": self.args.idle_seconds, "before": before, "after": after})
        cleanup_ok = all(not row.get("errors") for row in self.results if row["kind"] == "probe_cleanup")
        success = success and cleanup_ok
        summary = {
            "kind": "summary", "stage": "complete", "success": success,
            "hot_reload_verified": hot_reload,
            "http_requests": sum(row["kind"] == "http_stage" for row in self.results),
            "final_memory": self.snapshot("complete", "final"),
        }
        self.record(summary)
        print(json.dumps({key: value for key, value in summary.items() if key != "final_memory"}, ensure_ascii=False))
        return success


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True, help="Origin/base URL, without credentials or query")
    parser.add_argument("--routes", nargs="+", default=["/"], help="Root-relative paths, requested in order")
    parser.add_argument("--label", required=True)
    parser.add_argument("--output", type=Path, required=True, help="Stage summaries as JSONL")
    parser.add_argument("--samples-output", type=Path, help="Optional complete memory samples as JSONL")
    parser.add_argument("--probe-root", type=Path, help="Optional existing apps/web/app directory; temporary route is removed")
    parser.add_argument("--idle-seconds", type=float, default=20)
    args = parser.parse_args()
    parsed = urlsplit(args.url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        parser.error("--url must be an HTTP origin/base without credentials, query or fragment")
    if not math.isfinite(args.idle_seconds) or args.idle_seconds < 0:
        parser.error("--idle-seconds must be finite and non-negative")
    for route in args.routes:
        parsed_route = urlsplit(route)
        if not route.startswith("/") or parsed_route.netloc or parsed_route.query or parsed_route.fragment:
            parser.error("--routes must contain root-relative paths without query or fragment")
    if args.probe_root:
        args.probe_root = args.probe_root.resolve()
        if not args.probe_root.is_dir():
            parser.error("--probe-root must be an existing app directory")
        probe_directory = args.probe_root / PROBE_ROUTE.lstrip("/")
        if probe_directory.exists() or probe_directory.is_symlink():
            parser.error("Probe route already exists; refusing to change it")
    args.output = args.output.resolve()
    if args.samples_output:
        args.samples_output = args.samples_output.resolve()
        if args.samples_output == args.output:
            parser.error("Stage and sample output files must be different")
    for output in (args.output, args.samples_output):
        if output:
            output.parent.mkdir(parents=True, exist_ok=True)

    def interrupt(_signum, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupt)
    try:
        return 0 if Benchmark(args, load_monitor()).run() else 1
    except KeyboardInterrupt:
        print(json.dumps({"label": args.label, "interrupted": True}), file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())

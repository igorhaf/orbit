#!/usr/bin/env python3
"""Bounded, metadata-only Linux/cgroup v2 memory sampler. Durations are seconds."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time


CGROUP_ROOT = Path("/sys/fs/cgroup")
MAX_BYTES = 32 * 1024 * 1024
BACKUPS = 3
STOP = threading.Event()


def duration_clock() -> float:
    # Linux BOOTTIME includes suspend; MONOTONIC is kept for sample spacing.
    if hasattr(time, "CLOCK_BOOTTIME"):
        return time.clock_gettime(time.CLOCK_BOOTTIME)
    return time.monotonic()


DOCKER_TEMPLATE = (
    '{"id":{{json .Id}},"name":{{json .Name}},'
    '"pid":{{.State.Pid}},"status":{{json .State.Status}},'
    '"restart_count":{{.RestartCount}},"oom_killed":{{.State.OOMKilled}},'
    '"memory_limit_bytes":{{.HostConfig.Memory}},'
    '"memory_swap_limit_bytes":{{.HostConfig.MemorySwap}},'
    '"health":{{with index .State "Health"}}{{json .Status}}{{else}}null{{end}}}'
)
VMSTAT_KEYS = {
    "pswpin", "pswpout", "pgfault", "pgmajfault", "oom_kill",
    "pgscan_kswapd", "pgscan_direct", "pgsteal_kswapd", "pgsteal_direct",
    "pgpgin", "pgpgout", "allocstall_normal", "allocstall_movable",
}
SYSTEMD_KEYS = (
    "Id", "ControlGroup", "ActiveState", "SubState", "MainPID", "NRestarts",
    "MemoryCurrent", "MemoryPeak",
)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def counters(path: Path) -> dict[str, int]:
    result = {}
    for line in read_text(path).splitlines():
        key, value = line.split(maxsplit=1)
        result[key] = int(value)
    return result


def pressure(path: Path) -> dict:
    result = {}
    for line in read_text(path).splitlines():
        fields = line.split()
        result[fields[0]] = {
            key: int(value) if key == "total" else float(value)
            for key, value in (field.split("=", 1) for field in fields[1:])
        }
    return result


def error(errors: list, source: str, exc: Exception) -> None:
    # Do not copy arbitrary command output or environment into diagnostic logs.
    item = {"source": source, "kind": type(exc).__name__}
    if isinstance(exc, OSError):
        item["errno"] = exc.errno
    if isinstance(exc, subprocess.CalledProcessError):
        item["returncode"] = exc.returncode
    errors.append(item)


def attempt(errors: list, source: str, function, default=None):
    try:
        return function()
    except (OSError, ValueError, KeyError, IndexError, subprocess.SubprocessError) as exc:
        error(errors, source, exc)
        return default


def command(args: list[str], timeout: float = 8) -> str:
    completed = subprocess.run(
        args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL, text=True, check=True, timeout=timeout,
    )
    return completed.stdout


def cgroup_path(relative: str) -> Path:
    path = (CGROUP_ROOT / relative.lstrip("/")).resolve()
    if not path.is_relative_to(CGROUP_ROOT):
        raise ValueError("Invalid cgroup path")
    return path


def pid_cgroup(pid: int) -> str:
    if pid <= 0:
        raise ValueError("Process is not running")
    for line in read_text(Path(f"/proc/{pid}/cgroup")).splitlines():
        if line.startswith("0::"):
            return line[3:]
    raise ValueError("Unified cgroup unavailable")


def sample_cgroup(relative: str, errors: list, source: str) -> dict:
    root = cgroup_path(relative)
    result = {"path": relative}
    for filename in (
        "memory.current", "memory.swap.current", "memory.peak", "pids.current",
        "memory.max", "memory.swap.max", "memory.high",
    ):
        value = attempt(errors, f"{source}:{filename}", lambda f=filename: read_text(root / f).strip())
        if value is not None:
            result[filename] = value if value == "max" else int(value)
    for filename in ("memory.stat", "memory.events", "cpu.stat"):
        value = attempt(errors, f"{source}:{filename}", lambda f=filename: counters(root / f))
        if value is not None:
            result[filename] = value
    result["memory.pressure"] = attempt(
        errors, f"{source}:memory.pressure", lambda: pressure(root / "memory.pressure")
    )
    if "memory.current" in result and "memory.stat" in result:
        result["working_set_bytes"] = max(
            0, result["memory.current"] - result["memory.stat"].get("inactive_file", 0)
        )
    return result


def sample_host(errors: list) -> dict:
    def meminfo():
        result = {}
        for line in read_text(Path("/proc/meminfo")).splitlines():
            key, value = line.split(":", 1)
            fields = value.split()
            result[key] = int(fields[0]) * (1024 if len(fields) > 1 and fields[1] == "kB" else 1)
        return result

    return {
        "meminfo_bytes": attempt(errors, "host:meminfo", meminfo, {}),
        "memory_pressure": attempt(errors, "host:memory_pressure", lambda: pressure(Path("/proc/pressure/memory"))),
        "io_pressure": attempt(errors, "host:io_pressure", lambda: pressure(Path("/proc/pressure/io"))),
        "vmstat": attempt(errors, "host:vmstat", lambda: {
            key: value for key, value in counters(Path("/proc/vmstat")).items() if key in VMSTAT_KEYS
        }, {}),
        "page_size_bytes": os.sysconf("SC_PAGE_SIZE"),
    }


def sample_docker(errors: list) -> list[dict]:
    ids = attempt(errors, "docker:ps", lambda: command(["docker", "ps", "--quiet", "--no-trunc"]), "").split()
    if not ids:
        return []
    # A single inspect call; the template excludes environment, labels and commands.
    def inspect():
        try:
            return command(["docker", "inspect", "--format", DOCKER_TEMPLATE, *ids], timeout=12)
        except subprocess.CalledProcessError as exc:
            # A container may disappear between ps and inspect; keep the other rows.
            error(errors, "docker:inspect", exc)
            return exc.stdout or ""

    output = attempt(errors, "docker:inspect", inspect, "")
    results = []
    for line in output.splitlines():
        item = attempt(errors, "docker:inspect-json", lambda line=line: json.loads(line))
        if item is None:
            continue
        item["name"] = item["name"].lstrip("/")
        source = f"docker:{item['name']}"
        relative = attempt(errors, f"{source}:cgroup", lambda: pid_cgroup(item["pid"]))
        if relative is not None:
            item["cgroup"] = attempt(errors, source, lambda: sample_cgroup(relative, errors, source))
        results.append(item)
    return results


def sample_services(errors: list) -> list[dict]:
    args = ["systemctl", "--user", "show", "adope-api.service", "adope-web.service"]
    args.extend(f"--property={key}" for key in SYSTEMD_KEYS)
    output = attempt(errors, "systemd:show", lambda: command(args), "")
    results = []
    for block in output.strip().split("\n\n"):
        if not block:
            continue
        fields = dict(line.split("=", 1) for line in block.splitlines() if "=" in line)
        item = {}
        for key in SYSTEMD_KEYS:
            if key in fields:
                value = fields[key]
                item[key] = int(value) if value.isdigit() else value
        if fields.get("ControlGroup"):
            source = f"systemd:{fields.get('Id', 'unknown')}"
            item["cgroup"] = attempt(errors, source, lambda: sample_cgroup(fields["ControlGroup"], errors, source))
        results.append(item)
    return results


def collect(sequence: int) -> dict:
    started = time.monotonic()
    errors = []
    result = {
        "schema_version": 1,
        "timestamp_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "monotonic_seconds": started,
        "duration_clock_seconds": duration_clock(),
        "sequence": sequence,
        "host": sample_host(errors),
        "containers": sample_docker(errors),
        "services": sample_services(errors),
    }
    result["collection_seconds"] = round(time.monotonic() - started, 3)
    result["errors"] = errors
    return result


def append_record(output: Path, record: dict) -> None:
    encoded = json.dumps(record, separators=(",", ":"), ensure_ascii=False) + "\n"
    size = len(encoded.encode("utf-8"))
    if output.exists() and output.stat().st_size + size > MAX_BYTES:
        oldest = output.with_name(output.name + f".{BACKUPS}")
        oldest.unlink(missing_ok=True)
        for index in range(BACKUPS - 1, 0, -1):
            source = output.with_name(output.name + f".{index}")
            if source.exists():
                source.replace(output.with_name(output.name + f".{index + 1}"))
        output.replace(output.with_name(output.name + ".1"))
    descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(descriptor, "a", encoding="utf-8") as stream:
        stream.write(encoded)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="JSONL file; rotates at 32 MiB with 3 backups")
    parser.add_argument("--interval", type=float, default=60, help="Seconds between samples (default: 60)")
    parser.add_argument("--duration", type=float, default=48 * 60 * 60, help="Total seconds to run (default: 172800)")
    parser.add_argument("--once", action="store_true", help="Write one sample and exit")
    args = parser.parse_args()
    if not math.isfinite(args.interval) or not math.isfinite(args.duration) or args.interval < 1 or args.duration <= 0:
        parser.error("--interval must be at least 1 and --duration must be positive")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, lambda _signum, _frame: STOP.set())
    deadline = duration_clock() + args.duration
    next_sample = time.monotonic()
    sequence = 0
    while not STOP.is_set() and duration_clock() < deadline:
        try:
            record = collect(sequence)
        except Exception as exc:  # A transient unexpected parser error must not kill 48h collection.
            record = {
                "schema_version": 1, "sequence": sequence,
                "timestamp_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
                "errors": [{"source": "collector", "kind": type(exc).__name__}],
            }
        try:
            append_record(args.output, record)
        except OSError as exc:
            print(json.dumps({"source": "output", "kind": type(exc).__name__, "errno": exc.errno}), file=sys.stderr, flush=True)
        sequence += 1
        if args.once:
            return 0
        next_sample += args.interval
        if next_sample < time.monotonic():
            next_sample = time.monotonic() + args.interval
        STOP.wait(max(0, min(next_sample - time.monotonic(), deadline - duration_clock())))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Summarize sampled memory without loading an entire JSONL file into RAM."""
import argparse
import datetime as dt
import json
from pathlib import Path


def summarize(source, since=None):
    count = invalid = errors = gaps = 0
    first_time = last_time = previous_time = None
    previous_mono = None
    awake_seconds = largest_gap = 0.0
    host = {}
    entities = {}
    instances = {}
    with source.open() as stream:
        for line in stream:
            try:
                row = json.loads(line)
                timestamp = dt.datetime.fromisoformat(row['timestamp_utc'])
            except (ValueError, KeyError):
                invalid += 1
                continue
            if since and timestamp < since:
                continue
            count += 1
            errors += len(row.get('errors', []))
            if first_time is None:
                first_time = timestamp
            if previous_time is not None:
                gap = (timestamp - previous_time).total_seconds()
                largest_gap = max(largest_gap, gap)
                gaps += gap > 180
            mono = row.get('monotonic_seconds')
            if mono is not None and previous_mono is not None:
                awake_seconds += max(0, mono - previous_mono)
            previous_mono = mono
            previous_time = last_time = timestamp
            info = row.get('host', {}).get('meminfo_bytes', {})
            if 'MemAvailable' in info:
                available = info['MemAvailable']
                swap = info.get('SwapTotal', 0) - info.get('SwapFree', 0)
                host['available_min_bytes'] = min(host.get('available_min_bytes', available), available)
                host['available_last_bytes'] = available
                host['swap_used_last_bytes'] = swap
                host['swap_used_max_bytes'] = max(host.get('swap_used_max_bytes', swap), swap)
            for kind, key in [('containers', 'name'), ('services', 'Id')]:
                for item in row.get(kind, []):
                    cg = item.get('cgroup') or {}
                    ws = cg.get('working_set_bytes')
                    if ws is None:
                        continue
                    name = item[key]
                    usage = {'working_set_bytes': ws, 'swap_bytes': cg.get('memory.swap.current', 0)}
                    entry = entities.setdefault(name, {'first': usage, 'max_working_set_bytes': ws,
                        'max_swap_bytes': usage['swap_bytes'], 'unhealthy_samples': 0})
                    entry['last'] = usage
                    entry['max_working_set_bytes'] = max(entry['max_working_set_bytes'], ws)
                    entry['max_swap_bytes'] = max(entry['max_swap_bytes'], usage['swap_bytes'])
                    entry['unhealthy_samples'] += item.get('health') == 'unhealthy'
                    identity = (name, item.get('id', item.get('MainPID')))
                    events = cg.get('memory.events', {})
                    counters = {'oom': events.get('oom', 0), 'oom_kill': events.get('oom_kill', 0),
                        'restarts': item.get('restart_count', item.get('NRestarts', 0))}
                    inst = instances.setdefault(identity, {'first': counters, 'name': name})
                    inst['last'] = counters
    for name, entry in entities.items():
        groups = [x for x in instances.values() if x['name'] == name]
        entry['observed_instances'] = len(groups)
        entry['counter_increases'] = {key: sum(max(0, x['last'][key] - x['first'][key])
            for x in groups) for key in ['oom', 'oom_kill', 'restarts']}
    return {'source': str(source), 'since': since.isoformat() if since else None,
        'sample_count': count, 'invalid_lines': invalid, 'collection_errors': errors,
        'first_utc': first_time.isoformat() if first_time else None,
        'last_utc': last_time.isoformat() if last_time else None,
        'wall_span_hours': (last_time - first_time).total_seconds() / 3600 if first_time else 0,
        'awake_clock_hours': awake_seconds / 3600, 'gaps_over_180_seconds': gaps,
        'largest_gap_hours': largest_gap / 3600, 'host': host, 'entities': entities}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output-prefix', type=Path, required=True)
    parser.add_argument('--since', help='Timezone-aware ISO timestamp; omit to use the entire file')
    args = parser.parse_args()
    since = dt.datetime.fromisoformat(args.since) if args.since else None
    if since and since.tzinfo is None:
        parser.error('--since must include its timezone')
    result = summarize(args.input, since)
    args.output_prefix.parent.mkdir(parents=True, exist_ok=True)
    args.output_prefix.with_suffix('.json').write_text(json.dumps(result, indent=2) + '\n')
    lines = ['# Observação de memória', '',
        f"Amostras: {result['sample_count']}; relógio acordado: {result['awake_clock_hours']:.2f} h; intervalo calendário: {result['wall_span_hours']:.2f} h.",
        f"Lacunas acima de três minutos: {result['gaps_over_180_seconds']}; maior lacuna: {result['largest_gap_hours']:.2f} h.",
        f"Erros de coleta: {result['collection_errors']}; linhas inválidas: {result['invalid_lines']}.", '',
        '| Serviço | WS inicial MiB | WS final MiB | WS máximo amostrado MiB | Swap final MiB | Aumentos OOM / kills / reinícios |',
        '|---|---:|---:|---:|---:|---|']
    for name, entry in result['entities'].items():
        c = entry['counter_increases']
        lines.append(f"| {name} | {entry['first']['working_set_bytes']/2**20:.1f} | {entry['last']['working_set_bytes']/2**20:.1f} | {entry['max_working_set_bytes']/2**20:.1f} | {entry['last']['swap_bytes']/2**20:.1f} | {c['oom']} / {c['oom_kill']} / {c['restarts']} |")
    lines.extend(['', 'WS desconta inactive_file e não equivale ao heap JavaScript. A amostragem pode perder picos e falhas entre leituras. As diferenças de contadores são calculadas por identidade observada; não comprovam ausência de falhas antes da primeira amostra de cada processo. Lacunas e suspensão impedem tratar o intervalo calendário como uso contínuo. Tendências precisam ser comparadas sob carga equivalente.', ''])
    args.output_prefix.with_suffix('.md').write_text('\n'.join(lines))
    print(json.dumps({'samples': result['sample_count'], 'awake_hours': round(result['awake_clock_hours'], 2),
        'wall_hours': round(result['wall_span_hours'], 2), 'output_prefix': str(args.output_prefix)}))


if __name__ == '__main__':
    main()

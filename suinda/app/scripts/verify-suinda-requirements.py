#!/usr/bin/env python3
"""Check that the Suindá requirement inventory and status tables reconcile."""

from __future__ import annotations

import re
import sys
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / "docs/suinda/ESPECIFICACAO.md"
AUDIT = ROOT / "docs/suinda/AUDITORIA-BULLETS-2026-10-25.md"
EXTERNAL = ROOT / "docs/suinda/PRE-REQUISITOS-EXTERNOS.md"
RANGE = re.compile(r"(\d+)\.(\d+)(?:[–-](?:(\d+)\.)?(\d+))?")


class AuditError(Exception):
    pass


def expand_ids(value: str, source: str) -> list[str]:
    expanded: list[str] = []
    for part in value.split(","):
        part = part.strip().strip("`")
        match = RANGE.fullmatch(part)
        if not match:
            raise AuditError(f"{source}: ID ou intervalo inválido: {part!r}")
        area, first, last_area, last = match.groups()
        area_number, first_number = int(area), int(first)
        last_area_number = int(last_area) if last_area else area_number
        last_number = int(last) if last else first_number
        if last_area_number != area_number or last_number < first_number:
            raise AuditError(f"{source}: intervalo inválido: {part!r}")
        expanded.extend(f"{area_number}.{number}" for number in range(first_number, last_number + 1))
    return expanded


def parse_specification() -> dict[int, int]:
    counts: dict[int, int] = {}
    current_area: int | None = None
    for line in SPEC.read_text(encoding="utf-8").splitlines():
        heading = re.match(r"^(\d+)\.\s+", line)
        if heading:
            current_area = int(heading.group(1))
            if current_area in counts:
                raise AuditError(f"A especificação repete a área {current_area}.")
            counts[current_area] = 0
        elif current_area is not None and re.match(r"^-\s+", line):
            counts[current_area] += 1
    if not counts:
        raise AuditError("Nenhuma área numerada foi encontrada na especificação.")
    if set(counts) != set(range(1, len(counts) + 1)):
        raise AuditError("A numeração das áreas da especificação tem lacunas.")
    return counts


def parse_area_table(spec_counts: dict[int, int]) -> tuple[dict[str, int], dict[str, set[str]]]:
    audit_text = AUDIT.read_text(encoding="utf-8")
    area_counts: dict[int, list[int]] = {}
    status_ids = {status: set() for status in "PCN"}
    for line in audit_text.splitlines():
        if not re.match(r"^\|\s*\d+\.", line):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        area = int(cells[0].split(".", 1)[0])
        if area in area_counts:
            raise AuditError(f"A tabela de auditoria repete a área {area}.")
        values = [int(value) for value in cells[1:5]]
        if len(values) != 4:
            raise AuditError(f"Área {area}: esperadas quatro contagens I/P/C/N.")
        area_counts[area] = values
        if area not in spec_counts or sum(values) != spec_counts[area]:
            raise AuditError(f"Área {area}: contagem {values} não corresponde a {spec_counts.get(area)} bullets.")
        local_status_ids = {status: set() for status in "PCN"}
        for segment in cells[5].split(";"):
            if ":" not in segment:
                continue
            status, listed = segment.split(":", 1)
            status = status.strip()
            if status not in status_ids or listed.strip() == "—":
                continue
            for requirement_id in expand_ids(listed, f"Área {area} / {status}"):
                if not requirement_id.startswith(f"{area}."):
                    raise AuditError(f"Área {area}: ID de outra área {requirement_id}.")
                if requirement_id in status_ids[status]:
                    raise AuditError(f"ID {requirement_id} repetido na classificação {status}.")
                status_ids[status].add(requirement_id)
                local_status_ids[status].add(requirement_id)
        for status, column in (("P", 1), ("C", 2), ("N", 3)):
            if len(local_status_ids[status]) != values[column]:
                raise AuditError(
                    f"Área {area}: a tabela declara {values[column]} itens {status}, "
                    f"mas lista {len(local_status_ids[status])} IDs."
                )
    if set(area_counts) != set(spec_counts):
        raise AuditError("As áreas da tabela de auditoria não correspondem às áreas da especificação.")

    totals = {status: sum(values[index] for values in area_counts.values()) for status, index in zip("IPCN", range(4))}
    allowed_ids = {f"{area}.{number}" for area, count in spec_counts.items() for number in range(1, count + 1)}
    all_nonimplemented = status_ids["P"] | status_ids["C"] | status_ids["N"]
    invalid_ids = all_nonimplemented - allowed_ids
    if invalid_ids:
        raise AuditError(f"IDs fora da especificação: {', '.join(sorted(invalid_ids))}.")
    overlaps = (status_ids["P"] & status_ids["C"]) | (status_ids["P"] & status_ids["N"]) | (status_ids["C"] & status_ids["N"])
    if overlaps:
        raise AuditError(f"IDs com classificações sobrepostas: {', '.join(sorted(overlaps))}.")
    expected = {"I": totals["I"], "P": totals["P"], "C": totals["C"], "N": totals["N"]}
    for status in "PCN":
        if len(status_ids[status]) != expected[status]:
            raise AuditError(f"A tabela declara {expected[status]} itens {status}, mas lista {len(status_ids[status])} IDs.")
    return expected, status_ids


def parse_external_ids() -> set[str]:
    ids: list[str] = []
    for line in EXTERNAL.read_text(encoding="utf-8").splitlines():
        if not line.startswith("|"):
            continue
        first_cell = line.split("|")[1]
        for span in re.findall(r"`([^`]+)`", first_cell):
            ids.extend(expand_ids(span, "Checklist externa"))
    duplicate_ids = sorted(requirement_id for requirement_id, count in Counter(ids).items() if count > 1)
    if duplicate_ids:
        raise AuditError(f"IDs externos repetidos: {', '.join(duplicate_ids)}.")
    return set(ids)


def main() -> int:
    spec_counts = parse_specification()
    totals, status_ids = parse_area_table(spec_counts)
    external_ids = parse_external_ids()
    if external_ids != status_ids["C"]:
        missing = sorted(status_ids["C"] - external_ids)
        extra = sorted(external_ids - status_ids["C"])
        raise AuditError(f"Checklist externa divergente; ausentes={missing}, extras={extra}.")

    audit = AUDIT.read_text(encoding="utf-8")
    for label, value in (("Implementado", totals["I"]), ("Parcial", totals["P"]),
                         ("Configuração/provedor externo", totals["C"]), ("Sem implementação localizada", totals["N"])):
        if not re.search(rf"\|\s*{re.escape(label)}\s*\|\s*{value}\s*\|", audit):
            raise AuditError(f"Resumo da auditoria não informa {label}={value}.")
    total = sum(totals.values())
    if total != sum(spec_counts.values()):
        raise AuditError(f"Total classificado {total} difere dos {sum(spec_counts.values())} bullets da especificação.")

    print(f"OK: {len(spec_counts)} áreas, {total} bullets; I={totals['I']}, P={totals['P']}, C={totals['C']}, N={totals['N']}.")
    print(f"OK: checklist externa cobre os {len(external_ids)} IDs C exatamente uma vez; sem IDs ausentes, extras ou sobrepostos.")
    print("Observação: esta verificação confere a consistência do inventário, não prova implementação ou validação funcional.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AuditError, OSError) as error:
        print(f"ERRO: {error}", file=sys.stderr)
        raise SystemExit(1)

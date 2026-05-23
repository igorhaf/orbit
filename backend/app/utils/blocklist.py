"""Helpers para aplicar a blocklist global aos projetos."""
import logging
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def get_global_blocklist(db: Session) -> dict:
    """Lê system_settings.global_blocklist. Retorna dict vazio se ausente."""
    from app.models.system_settings import SystemSettings
    try:
        setting = db.query(SystemSettings).filter(SystemSettings.key == "global_blocklist").first()
        if setting and setting.value:
            return setting.value
    except Exception as exc:
        logger.warning(f"global_blocklist leitura falhou: {exc}")
    return {}


def apply_global_blocklist_to_project_payload(
    db: Session,
    existing: dict | None = None,
) -> dict:
    """Mescla `existing` com a blocklist global, sem duplicar entradas."""
    blocklist = get_global_blocklist(db)
    gl_dirs = blocklist.get("directories", [])
    gl_patterns = blocklist.get("file_patterns", [])

    cur = existing or {}
    cur_dirs = list(cur.get("directories", []))
    cur_patterns = list(cur.get("file_patterns", []))

    merged_dirs = cur_dirs + [d for d in gl_dirs if d not in cur_dirs]
    merged_patterns = cur_patterns + [p for p in gl_patterns if p not in cur_patterns]

    return {"directories": merged_dirs, "file_patterns": merged_patterns}


def apply_global_blocklist_as_ignore_paths(
    db: Session,
    existing: list | None = None,
) -> list:
    """Retorna ignore_paths (lista plana) com os diretorios da blocklist global."""
    blocklist = get_global_blocklist(db)
    gl_dirs = blocklist.get("directories", [])
    cur = list(existing or [])
    merged = cur + [d for d in gl_dirs if d not in cur]
    return merged

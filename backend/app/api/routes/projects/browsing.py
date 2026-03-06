"""
Projects API - Browsing endpoints.
Browse folders and files on the server filesystem.
"""

from fastapi import APIRouter, HTTPException, Query, status
from pathlib import Path

from app.config import settings as app_settings

router = APIRouter()

# PROMPT #111 - Base path for projects folder (configurable via PROJECTS_BASE_PATH env var)
PROJECTS_BASE_PATH = Path(app_settings.projects_base_path)


@router.get("/browse-folders")
async def browse_folders(
    path: str = Query("", description="Relative path within /projects to browse")
):
    """
    Browse folders starting from PROJECTS_BASE_PATH (default: user home).

    PROMPT #111 - Folder picker for project creation

    Returns a list of directories at the specified path.
    Path is relative to PROJECTS_BASE_PATH.

    Example:
    - GET /browse-folders?path= -> lists PROJECTS_BASE_PATH/*
    - GET /browse-folders?path=my-app -> lists PROJECTS_BASE_PATH/my-app/*
    """
    # Ensure base path exists
    if not PROJECTS_BASE_PATH.exists():
        return {
            "current_path": str(PROJECTS_BASE_PATH),
            "parent_path": None,
            "folders": [],
            "error": f"Pasta base nao encontrada: {PROJECTS_BASE_PATH}"
        }

    # Build full path (sanitize to prevent directory traversal)
    if path:
        # Remove leading slashes and normalize
        clean_path = path.lstrip("/").replace("..", "")
        full_path = PROJECTS_BASE_PATH / clean_path
    else:
        full_path = PROJECTS_BASE_PATH

    # Verify path is within PROJECTS_BASE_PATH (prevent directory traversal)
    try:
        full_path = full_path.resolve()
        if not str(full_path).startswith(str(PROJECTS_BASE_PATH.resolve())):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Caminho invalido: deve estar dentro de {PROJECTS_BASE_PATH}"
            )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Caminho invalido"
        )

    if not full_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Caminho nao encontrado: {path}"
        )

    if not full_path.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Caminho nao e um diretorio"
        )

    # List directories only (not files)
    folders = []
    try:
        for item in sorted(full_path.iterdir()):
            if item.is_dir() and not item.name.startswith("."):
                # Check if it looks like a code project (has common project files)
                is_project = any(
                    (item / f).exists()
                    for f in ["package.json", "composer.json", "requirements.txt",
                              "Cargo.toml", "go.mod", "pom.xml", "build.gradle",
                              ".git", "src", "app", "lib"]
                )
                folders.append({
                    "name": item.name,
                    "path": str(item.relative_to(PROJECTS_BASE_PATH)),
                    "full_path": str(item),
                    "is_project": is_project
                })
    except PermissionError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permissao negada para ler diretorio"
        )

    # Calculate parent path
    if full_path == PROJECTS_BASE_PATH:
        parent_path = None
    else:
        parent_rel = full_path.parent.relative_to(PROJECTS_BASE_PATH)
        parent_path = str(parent_rel) if str(parent_rel) != "." else ""

    return {
        "current_path": str(full_path),
        "relative_path": str(full_path.relative_to(PROJECTS_BASE_PATH)) if full_path != PROJECTS_BASE_PATH else "",
        "parent_path": parent_path,
        "folders": folders,
        "can_select": True  # This folder can be selected as project root
    }


@router.get("/browse-files")
async def browse_files(
    path: str = Query("", description="Relative path within /projects to browse")
):
    """
    Browse files and folders starting from PROJECTS_BASE_PATH (default: user home).

    Returns folders (for navigation) and files (for selection).
    Path is relative to PROJECTS_BASE_PATH.
    """
    if not PROJECTS_BASE_PATH.exists():
        return {
            "current_path": str(PROJECTS_BASE_PATH),
            "parent_path": None,
            "folders": [],
            "files": [],
            "error": f"Pasta base nao encontrada: {PROJECTS_BASE_PATH}"
        }

    if path:
        clean_path = path.lstrip("/").replace("..", "")
        full_path = PROJECTS_BASE_PATH / clean_path
    else:
        full_path = PROJECTS_BASE_PATH

    try:
        full_path = full_path.resolve()
        if not str(full_path).startswith(str(PROJECTS_BASE_PATH.resolve())):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Caminho invalido: deve estar dentro de {PROJECTS_BASE_PATH}"
            )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Caminho invalido"
        )

    if not full_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Caminho nao encontrado: {path}"
        )

    if not full_path.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Caminho nao e um diretorio"
        )

    folders = []
    files = []
    try:
        for item in sorted(full_path.iterdir()):
            if item.name.startswith("."):
                continue
            if item.is_dir():
                folders.append({
                    "name": item.name,
                    "path": str(item.relative_to(PROJECTS_BASE_PATH)),
                    "full_path": str(item),
                })
            elif item.is_file():
                files.append({
                    "name": item.name,
                    "path": str(item.relative_to(PROJECTS_BASE_PATH)),
                    "full_path": str(item),
                    "extension": item.suffix,
                    "size": item.stat().st_size,
                })
    except PermissionError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permissao negada para ler diretorio"
        )

    if full_path == PROJECTS_BASE_PATH:
        parent_path = None
    else:
        parent_rel = full_path.parent.relative_to(PROJECTS_BASE_PATH)
        parent_path = str(parent_rel) if str(parent_rel) != "." else ""

    return {
        "current_path": str(full_path),
        "relative_path": str(full_path.relative_to(PROJECTS_BASE_PATH)) if full_path != PROJECTS_BASE_PATH else "",
        "parent_path": parent_path,
        "folders": folders,
        "files": files,
    }

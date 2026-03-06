"""
Projects API Router Package.

Aggregates all project-related sub-routers into a single router
that is mounted by main.py at /api/v1/projects.

Route registration order matters: static-path routes (browse-folders,
scan-memory, cleanup/incomplete, etc.) are included BEFORE routes with
path parameters (/{project_id}) so that FastAPI does not attempt to
interpret literal segments as UUID path parameters.
"""

from fastapi import APIRouter

from app.api.routes.projects.browsing import router as browsing_router
from app.api.routes.projects.scanning import router as scanning_router
from app.api.routes.projects.descriptions import router as descriptions_router
from app.api.routes.projects.context import router as context_router
from app.api.routes.projects.crud import router as crud_router
from app.api.routes.projects.generation import router as generation_router
from app.api.routes.projects.specs import router as specs_router

router = APIRouter()

# 1. Browsing (top-level static paths: /browse-folders, /browse-files)
router.include_router(browsing_router)

# 2. Scanning (top-level static: /scan-memory, /quick-create, /create-and-process
#              + /{project_id}/index-code, /{project_id}/code-stats)
router.include_router(scanning_router)

# 3. Descriptions (top-level static: /generate-title, /generate-description, etc.)
router.include_router(descriptions_router)

# 4. Context (/{project_id}/summary, /context, /lock-context
#             + static: /cleanup/incomplete)
router.include_router(context_router)

# 5. CRUD (/, /{project_id} GET/PATCH/DELETE) -- after static paths
router.include_router(crud_router)

# 6. Generation (/{project_id}/enrich-wiki, /generate-cards, /generate-hierarchy)
router.include_router(generation_router)

# 7. Specs (/{project_id}/discover-specs, /specs, /specs/{id}/toggle)
router.include_router(specs_router)

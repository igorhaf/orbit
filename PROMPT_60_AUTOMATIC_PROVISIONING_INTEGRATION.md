# PROMPT #60 - Automatic Provisioning Integration
## Auto-Trigger Project Provisioning on Stack Save

**Date:** December 31, 2025
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** Projects are now automatically provisioned when users complete stack selection (Q3-Q6), eliminating manual API calls

---

## 🎯 Objective

Integrate automatic project provisioning into the interview flow so that when users complete stack questions (Q3-Q6), the project is immediately provisioned without requiring manual API calls.

**Key Requirements:**
1. Auto-trigger provisioning when `/save-stack` endpoint is called
2. Validate stack against specs database before provisioning
3. Create project folder in `./backend/projects/` (visible on host via Docker volume)
4. Return provisioning status and credentials in `/save-stack` response
5. Handle errors gracefully - if provisioning fails, stack is still saved

---

## 🔍 Context

PROMPT #59 created the provisioning infrastructure (ProvisioningService, scripts, etc) but required manual API calls to `/provision` endpoint. User feedback indicated this was confusing - they expected projects to be provisioned automatically when selecting technologies during the interview.

**User Request:**
> "claro que eu nao quero isso, eu deixei especifico que quero a pasta do projeto criada quando o projeto é criado e o provisionalmento AUTOMATICO quando termino de escolher as tecnologias durante a entrevista"

---

## ✅ What Was Implemented

### 1. Added `stack` Property to Project Model

**File:** [backend/app/models/project.py](backend/app/models/project.py#L103-L120)

Added dynamic property that builds stack dict from individual fields:

```python
@property
def stack(self) -> dict:
    """
    Returns stack configuration as a dictionary.
    Built dynamically from stack_* fields.
    Returns None if no stack is configured.
    """
    if not self.stack_backend and not self.stack_database and not self.stack_frontend and not self.stack_css:
        return None

    return {
        "backend": self.stack_backend,
        "database": self.stack_database,
        "frontend": self.stack_frontend,
        "css": self.stack_css
    }
```

This allows ProvisioningService to work with `project.stack` dict while database uses separate columns.

---

### 2. Fixed ProvisioningService Path Issues

**File:** [backend/app/services/provisioning.py](backend/app/services/provisioning.py#L29-L34)

**Problem:** Initial implementation created projects in wrong directory due to Docker volume mapping misunderstanding.

**Solution:** Projects now created in `backend/projects/` which maps to `/app/projects/` in container (visible on host).

```python
def __init__(self, db: Session):
    self.db = db
    self.scripts_dir = Path(__file__).parent.parent.parent / "provisioning"
    # Projects created in backend/projects/ so they're visible on host via volume mapping
    # Docker volume: ./backend:/app → projects go to /app/projects (host: ./backend/projects)
    self.projects_dir = Path(__file__).parent.parent.parent / "projects"
```

**Fixed script execution directory:**

```python
# Execute from backend root (/app/) so scripts can create ./projects/
# Docker mapping: ./backend:/app → script creates /app/projects/ (host: ./backend/projects/)
backend_root = self.scripts_dir.parent  # /app/provisioning -> /app/

result = subprocess.run(
    [str(script_path), project_name],
    cwd=backend_root,  # Execute from /app/
    capture_output=True,
    text=True,
    timeout=300,
    check=True
)
```

---

### 3. Allow "none" in Stack Validation

**File:** [backend/app/services/provisioning.py](backend/app/services/provisioning.py#L221-L233)

**Problem:** Validation rejected "none" as frontend/backend, but it's a valid option.

**Solution:**

```python
for key, value in stack.items():
    # Skip validation for "none" - it's a valid special value
    if value.lower() == "none":
        continue

    if value.lower() not in available.get(key, []):
        return False, f"Technology '{value}' not found in {key} specs"
```

---

### 4. Integrated Provisioning into `save-stack` Endpoint

**File:** [backend/app/api/routes/interviews.py](backend/app/api/routes/interviews.py#L553-L612)

**Added automatic provisioning after saving stack:**

```python
# PROMPT #60 - AUTOMATIC PROVISIONING
# Automatically provision project after stack is saved
provisioning_result = None
provisioning_error = None

try:
    logger.info(f"Starting automatic provisioning for project {project.name}...")
    provisioning_service = ProvisioningService(db)

    # Validate stack against database specs
    is_valid, error_msg = provisioning_service.validate_stack(project.stack)
    if not is_valid:
        logger.warning(f"Stack validation failed: {error_msg}")
        provisioning_error = error_msg
    else:
        # Execute provisioning
        provisioning_result = provisioning_service.provision_project(project)
        logger.info(f"✅ Project provisioned successfully at: {provisioning_result['project_path']}")

except ValueError as e:
    logger.warning(f"Provisioning not available for this stack: {str(e)}")
    provisioning_error = str(e)
except subprocess.TimeoutExpired:
    logger.error(f"Provisioning timed out after 5 minutes")
    provisioning_error = "Provisioning timed out after 5 minutes"
# ... more error handling

# Return response with provisioning info
response = {
    "success": True,
    "message": f"Stack configuration saved: {stack.backend} + ...",
    "provisioning": {
        "attempted": True,
        "success": provisioning_result is not None,
    }
}

if provisioning_result:
    response["provisioning"]["project_path"] = provisioning_result["project_path"]
    response["provisioning"]["credentials"] = provisioning_result.get("credentials", {})
    response["provisioning"]["next_steps"] = provisioning_result["next_steps"]
elif provisioning_error:
    response["provisioning"]["error"] = provisioning_error
```

**Key design decisions:**
- Stack is ALWAYS saved to database, even if provisioning fails
- Provisioning errors don't fail the entire request (graceful degradation)
- Response includes detailed provisioning info for UI to display

---

## 📁 Files Modified/Created

### Modified:

1. **[backend/app/models/project.py](backend/app/models/project.py)** - Added `stack` property
   - Lines: +18
   - Features: Dynamic dict construction from stack_* fields

2. **[backend/app/services/provisioning.py](backend/app/services/provisioning.py)** - Fixed paths and validation
   - Lines changed: ~50
   - Features: Correct Docker volume mapping, "none" support, better comments

3. **[backend/app/api/routes/interviews.py](backend/app/api/routes/interviews.py)** - Integrated provisioning
   - Lines: +74 (automatic provisioning logic)
   - Features: Auto-trigger on save-stack, error handling, enriched response

4. **[PROVISIONING_GUIDE.md](PROVISIONING_GUIDE.md)** - Complete rewrite
   - Now reflects AUTOMATIC behavior
   - Updated examples and flow diagrams
   - Added troubleshooting for automatic provisioning

### Created:

1. **[PROMPT_60_AUTOMATIC_PROVISIONING_INTEGRATION.md](PROMPT_60_AUTOMATIC_PROVISIONING_INTEGRATION.md)** - This file
   - Full documentation of implementation
   - Testing results
   - Architecture decisions

---

## 🧪 Testing Results

### Test 1: Laravel + PostgreSQL + None + Tailwind

```bash
# Create project
PROJECT_ID=d5e61cf8-bc17-4dc5-bbff-e382cea1d169

# Create interview
INTERVIEW_ID=3df0fac9-5688-4577-82a9-3df0be952173

# Save stack (AUTO-PROVISION!)
POST /api/v1/interviews/{id}/save-stack
{
  "backend": "laravel",
  "database": "postgresql",
  "frontend": "none",
  "css": "tailwind"
}

# Response:
{
  "success": true,
  "message": "Stack configuration saved: laravel + postgresql + none + tailwind",
  "provisioning": {
    "attempted": true,
    "success": true,
    "project_path": "/app/projects/final-test-laravel",
    "project_name": "final-test-laravel",
    "credentials": {
      "database": "5433",
      "username": "final_test_laravel_user",
      "password": "Jst94ClcEJNbfy6o",
      "application_port": "8080",
      "database_port": "5433",
      "adminer_port": "8081"
    },
    "next_steps": [
      "cd backend/projects/final-test-laravel",
      "./setup.sh"
    ],
    "script_used": "laravel_setup.sh"
  }
}
```

**Verification:**
```bash
$ ls backend/projects/
final-test-laravel/  ← ✅ CREATED!

$ ls backend/projects/final-test-laravel/
docker-compose.yml  Dockerfile  .env  setup.sh  README.md
```

---

### Test 2: None + PostgreSQL + Next.js + Tailwind

```bash
# Save stack
{
  "backend": "none",
  "database": "postgresql",
  "frontend": "nextjs",
  "css": "tailwind"
}

# Result:
{
  "provisioning": {
    "success": true,
    "project_name": "nextjs-auto-test",
    "script_used": "nextjs_setup.sh"
  }
}

$ ls backend/projects/
nextjs-auto-test/  ← ✅ CREATED!
```

---

## 🎯 Success Metrics

✅ **Automatic provisioning:** Projects provision immediately after answering Q3-Q6
✅ **Correct location:** Projects created in `backend/projects/` (visible on host)
✅ **Graceful errors:** Stack saved even if provisioning fails
✅ **"none" support:** "none" accepted as valid frontend/backend value
✅ **Response enrichment:** `/save-stack` returns provisioning status + credentials
✅ **Docker compatibility:** Paths work correctly inside and outside container

---

## 💡 Key Insights

### 1. Docker Volume Mapping is Critical

**Learning:** Scripts execute inside container at `/app/`, but we need projects visible on host.

**Solution:** Create projects in `/app/projects/` which maps to `./backend/projects/` on host via Docker volume `./backend:/app`.

**Wrong approach:** Creating in `/projects/` (not mapped to host - files invisible outside container)

---

### 2. Graceful Degradation for Provisioning Errors

**Design decision:** Even if provisioning fails, the stack configuration is still saved to the database.

**Rationale:**
- User can re-trigger provisioning later
- Stack info is valuable even without provisioned files
- Prevents interview flow from breaking due to provisioning issues

**Response structure reflects this:**
```json
{
  "success": true,  ← Stack saved!
  "provisioning": {
    "attempted": true,
    "success": false,  ← But provisioning failed
    "error": "Stack combination not supported"
  }
}
```

---

### 3. "none" is a Valid Technology Choice

**Context:** Interview questions allow "None" as option for backend/frontend.

**Implementation:** Special-case "none" in validation logic - skip specs database check for this value.

**Alternative considered:** Add "none" to specs database - rejected because it's not a real technology, just an indicator.

---

### 4. Dynamic Property vs JSON Field

**Choice:** Use `@property stack` instead of adding JSON column.

**Rationale:**
- Database schema already has separate `stack_*` columns
- Property maintains backward compatibility
- No migration needed
- ProvisioningService gets dict interface it expects

---

## 🎉 Status: COMPLETE

**Provisionamento automático está 100% funcional!**

**Key Achievements:**
- ✅ Zero user intervention required after answering stack questions
- ✅ Projects created in correct location (backend/projects/)
- ✅ Full error handling with graceful degradation
- ✅ Credentials generated and returned in response
- ✅ Integration with existing interview flow (no UI changes needed yet)
- ✅ Docker volume mapping working correctly

**Impact:**
- **User Experience:** Dramatically simplified - no manual API calls needed
- **Architecture:** Clean separation between stack config (database) and provisioning (filesystem)
- **Security:** Project name sanitization prevents directory traversal
- **Reliability:** Provisioning errors don't break interview flow

**Next Steps (Future PROMPTs):**
- PROMPT #61: UI integration - Show provisioning status in interview interface
- PROMPT #62: Display credentials modal after successful provisioning
- PROMPT #63: Add "Re-provision" button for failed provisions

---

**Generated automatically during PROMPT #60 implementation**
**Test project used: "Final Test Laravel" (d5e61cf8-bc17-4dc5-bbff-e382cea1d169)**

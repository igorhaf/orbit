# PROMPT #118 - Codebase Memory Scan
## Initial AI-powered codebase analysis during project creation

**Date:** January 28, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** Enhanced project onboarding with automatic codebase understanding

---

## Objective

Implement an AI-powered codebase memory scan that automatically analyzes a project's code when the folder is selected during project creation. The scan extracts business rules, detects the technology stack, and prepares relevant context for the AI interview.

**Key Requirements:**
1. Create new AI usage_type "memory" for codebase analysis
2. Scan codebase when folder is selected (before project creation)
3. Extract business rules and key features from code
4. Suggest project title based on analysis
5. Store findings in RAG for future reference
6. Show loading state and results in the wizard

---

## What Was Implemented

### 1. New AI Usage Type: Memory

**Backend - AIModelUsageType enum:**
```python
class AIModelUsageType(str, enum.Enum):
    # ...existing types...
    MEMORY = "memory"  # PROMPT #118 - Codebase memory scan
```

**Backend - AIOrchestrator:**
```python
UsageType = Literal[
    # ...existing types...
    "memory",  # PROMPT #118 - Codebase memory scan
]
```

**Frontend - types.ts:**
```typescript
export enum AIModelUsageType {
  // ...existing types...
  MEMORY = 'memory',
}
```

### 2. CodebaseMemoryService

New service at `backend/app/services/codebase_memory.py`:

**Features:**
- Detects technology stack using StackDetector
- Scans codebase structure and statistics
- Extracts code samples from key files (models, controllers, services)
- Uses AI to analyze code and extract:
  - Suggested project title
  - Business rules
  - Key features
  - Interview context
- Stores business rules in RAG

**API Response:**
```json
{
  "suggested_title": "E-commerce Platform",
  "stack_info": {
    "detected_stack": "laravel",
    "confidence": 85,
    "description": "Laravel (PHP MVC Framework)"
  },
  "business_rules": [
    "Users must verify email before posting",
    "Orders over $100 get free shipping"
  ],
  "key_features": [
    "User authentication and registration",
    "Product catalog with categories"
  ],
  "interview_context": "This is an e-commerce platform...",
  "files_indexed": 145,
  "scan_summary": {
    "total_files": 200,
    "code_files": 150,
    "languages": {"PHP": 100, "JavaScript": 50}
  }
}
```

### 3. API Endpoint

**POST** `/api/v1/projects/scan-memory`

Query Parameters:
- `code_path` (required): Absolute path to codebase folder
- `project_id` (optional): Project UUID for RAG storage

### 4. Frontend Integration

**New Project Wizard (`/projects/new`):**

1. **Folder Selection Triggers Scan:**
   - When user selects folder via FolderPicker
   - Automatically calls `/scan-memory` endpoint

2. **Loading State:**
   - Blue overlay with spinner during scan
   - Message: "Analyzing codebase..."

3. **Results Display:**
   - Green success card showing:
     - Files scanned count
     - Detected stack (with confidence)
     - Languages breakdown
     - Key features (collapsible)
     - Business rules (collapsible)

4. **Title Suggestion:**
   - Automatically fills project name input
   - Shows "(AI suggested)" indicator

### 5. AI Models Config Page

Added Memory option to usage_type dropdown:
- Pink badge color for Memory type
- Available in both Create and Edit dialogs

---

## Files Modified/Created

### Created:
1. **[codebase_memory.py](backend/app/services/codebase_memory.py)**
   - New service for codebase analysis
   - ~400 lines

### Modified:
1. **[ai_model.py](backend/app/models/ai_model.py)**
   - Added MEMORY to AIModelUsageType enum

2. **[ai_orchestrator.py](backend/app/services/ai_orchestrator.py)**
   - Added "memory" to UsageType literal

3. **[projects.py](backend/app/api/routes/projects.py)**
   - Added `/scan-memory` endpoint

4. **[page.tsx](frontend/src/app/projects/new/page.tsx)**
   - Added scanning state and handleFolderSelect
   - Added MemoryScanResult interface
   - Added loading overlay and results display

5. **[page.tsx](frontend/src/app/ai-models/page.tsx)**
   - Added Memory option to dropdowns
   - Added pink badge color for memory type

6. **[types.ts](frontend/src/lib/types.ts)**
   - Added MEMORY to AIModelUsageType enum

---

## Testing

### Manual Testing:

1. **Configure Memory AI Model:**
   - Go to `/ai-models`
   - Create new model with usage_type "Memory"
   - Or use "general" as fallback

2. **Create New Project:**
   - Go to `/projects/new`
   - Click folder picker button
   - Select a code folder
   - Observe:
     - Loading spinner appears
     - Results display after scan
     - Title field auto-populated

3. **Verify RAG Storage:**
   - Check that business rules are stored in RAG
   - Query via `/api/v1/rag/search`

---

## Business Rules Stored

This feature itself stores the following business rules:
- All code analyzed must have its business rules stored
- Project creation includes initial codebase memory scan
- Memory usage_type is dedicated for codebase analysis
- Suggested title should be based on detected features

---

## Success Metrics

- Memory usage_type added to all relevant enums
- Codebase scan triggers on folder selection
- AI extracts meaningful business rules
- Project title suggestion works
- Results display correctly in wizard
- Business rules stored in RAG

---

## Key Insights

### 1. Multi-Language Support
The service supports analysis of multiple programming languages:
PHP, TypeScript, JavaScript, Python, Java, Ruby, Go, C#, Swift, Kotlin, Vue, Svelte

### 2. Smart File Selection
Key files are prioritized for AI analysis:
- README and documentation
- Configuration files (package.json, etc.)
- Models, Controllers, Services
- Entry points (main.py, index.ts, etc.)

### 3. Token Optimization
Limited to 20 files and 3000 chars per file to optimize AI token usage while maintaining quality analysis.

### 4. Graceful Degradation
If AI analysis fails, system falls back to stack detection only and allows manual project creation.

---

## Status: COMPLETE

**Key Achievements:**
- New "memory" AI usage_type across backend and frontend
- CodebaseMemoryService for intelligent codebase analysis
- Automatic title suggestion from AI
- Business rules extraction and RAG storage
- Beautiful loading and results UI in project wizard

**Impact:**
- Faster project onboarding
- Better AI understanding of codebase
- Automatic documentation of business rules
- Intelligent context for future AI interviews

---

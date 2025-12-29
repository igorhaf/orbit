# Project Analyzer - Usage Guide

## 📋 Overview

The **Project Analyzer** is a revolutionary feature that allows ORBIT to analyze existing codebases, extract their patterns and conventions, and automatically generate custom orchestrators.

This transforms ORBIT from a "greenfield-only" tool into a comprehensive platform that can extend any existing project.

## 🚀 Quick Start

### 1. Upload a Project

Upload your existing project as a .zip or .tar.gz file:

```bash
curl -X POST "http://localhost:8000/api/v1/analyzers/" \
  -F "file=@my-laravel-project.zip" \
  | jq
```

**Response:**
```json
{
  "id": "a1b2c3d4-...",
  "status": "uploaded",
  "original_filename": "my-laravel-project.zip",
  "file_size_bytes": 12345678,
  "created_at": "2025-12-27T21:00:00Z"
}
```

Processing happens in the background. The analysis will:
- Extract the archive
- Detect the technology stack
- Extract naming conventions using AI
- Recognize code patterns using AI
- Generate a comprehensive analysis report

### 2. Check Analysis Status

Poll the analysis endpoint to check progress:

```bash
curl "http://localhost:8000/api/v1/analyzers/a1b2c3d4-..." | jq
```

**Response (when completed):**
```json
{
  "id": "a1b2c3d4-...",
  "status": "completed",
  "detected_stack": "laravel",
  "confidence_score": 92,
  "conventions": {
    "naming": {
      "classes": "PascalCase",
      "methods": "camelCase",
      "database": {"tables": "snake_case_plural"}
    }
  },
  "patterns": {
    "controller": "<?php\nnamespace App\\Controllers;...",
    "model": "<?php\nnamespace App\\Models;..."
  },
  "completed_at": "2025-12-27T21:02:15Z"
}
```

### 3. Generate Orchestrator

Once analysis is complete, generate the orchestrator:

```bash
curl -X POST "http://localhost:8000/api/v1/analyzers/a1b2c3d4-.../generate-orchestrator" \
  -H "Content-Type: application/json" \
  -d '{"orchestrator_key": "my_custom_laravel"}' \
  | jq
```

**Response:**
```json
{
  "success": true,
  "orchestrator_key": "my_custom_laravel",
  "class_name": "MyCustomLaravelOrchestrator",
  "message": "Orchestrator generated successfully"
}
```

### 4. Register Orchestrator

Make the orchestrator available for use:

```bash
curl -X POST "http://localhost:8000/api/v1/analyzers/a1b2c3d4-.../register-orchestrator" | jq
```

**Response:**
```json
{
  "success": true,
  "orchestrator_key": "my_custom_laravel",
  "message": "Orchestrator registered successfully"
}
```

### 5. Use Orchestrator with Tasks

Now you can create tasks using your custom orchestrator!

```bash
curl -X POST "http://localhost:8000/api/v1/tasks/" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "project-uuid",
    "title": "Create User CRUD",
    "description": "Implement CRUD operations for User entity",
    "stack": "my_custom_laravel"
  }' \
  | jq
```

The generated code will follow YOUR project's conventions!

## 📊 API Endpoints

### Upload & List

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/analyzers/` | Upload project for analysis |
| `GET` | `/api/v1/analyzers/` | List all analyses (with pagination) |
| `GET` | `/api/v1/analyzers/{id}` | Get specific analysis details |
| `GET` | `/api/v1/analyzers/stats/summary` | Get statistics about all analyses |

### Orchestrator Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/analyzers/{id}/generate-orchestrator` | Generate orchestrator from analysis |
| `POST` | `/api/v1/analyzers/{id}/register-orchestrator` | Register orchestrator in system |
| `GET` | `/api/v1/analyzers/{id}/orchestrator-code` | View generated orchestrator code |
| `DELETE` | `/api/v1/analyzers/{id}` | Delete analysis and cleanup files |

## 🎯 Supported Stacks

The analyzer can detect and work with:

- **Laravel** (PHP MVC Framework)
- **Next.js** (React Framework)
- **Django** (Python Web Framework)
- **Ruby on Rails**
- **Express.js** (Node.js)
- **FastAPI** (Python)
- **Vue.js**
- **Angular**
- **Spring Boot** (Java)

## 🔒 Security Features

- **File Type Validation**: Only .zip and .tar.gz allowed
- **MIME Type Checking**: Verifies actual file type (magic bytes)
- **Size Limits**: 100MB upload, 500MB extracted
- **Path Traversal Protection**: Blocks malicious archive paths
- **Zip Bomb Prevention**: Extraction size limits
- **Isolated Processing**: Each analysis in separate directory

## 💰 Cost Estimation

The analyzer uses Claude Haiku (the cheapest model) for AI analysis:

- **Convention Extraction**: ~$0.001 per analysis
- **Pattern Recognition**: ~$0.002 per analysis
- **Total**: ~$0.003-0.005 per project

**100 analyses/month: ~$0.50**

Very cost-effective!

## 📈 Usage Examples

### Link Analysis to Existing Project

```bash
curl -X POST "http://localhost:8000/api/v1/analyzers/?project_id=existing-project-uuid" \
  -F "file=@project.zip"
```

### Filter Analyses by Status

```bash
# Get only completed analyses
curl "http://localhost:8000/api/v1/analyzers/?status=completed"

# Get failed analyses
curl "http://localhost:8000/api/v1/analyzers/?status=failed"
```

### Review Generated Code

```bash
curl "http://localhost:8000/api/v1/analyzers/a1b2c3d4-.../orchestrator-code" | jq -r '.orchestrator_code'
```

This shows the complete Python orchestrator class that was generated.

## 🐛 Troubleshooting

### Analysis Stuck in "analyzing" Status

If an analysis doesn't complete after a few minutes:

1. Check the backend logs for errors
2. Verify the archive is valid (can extract manually)
3. Check file size limits in settings

### Stack Detection Failed (confidence < 50)

This happens when:
- Project structure is non-standard
- Mixed technologies in one archive
- Missing key files (composer.json, package.json, etc.)

**Solution**: Ensure you're uploading the complete project root directory.

### Orchestrator Generation Failed

Common causes:
- Analysis not completed yet
- Empty conventions/patterns
- Syntax errors in templates

**Solution**: Check analysis detail endpoint for error messages.

## 🔄 Workflow Integration

### Typical Workflow

```
1. Upload existing project
   ↓
2. Wait for analysis to complete (2-5 minutes)
   ↓
3. Review detected conventions
   ↓
4. Generate orchestrator
   ↓
5. Register orchestrator
   ↓
6. Create tasks using custom orchestrator
   ↓
7. Generated code matches YOUR project style!
```

### Continuous Integration

You can automate this in CI/CD:

```bash
#!/bin/bash

# Upload and wait for completion
ANALYSIS_ID=$(curl -X POST "$API/analyzers/" -F "file=@project.zip" | jq -r '.id')

# Poll until completed
while true; do
  STATUS=$(curl "$API/analyzers/$ANALYSIS_ID" | jq -r '.status')
  if [ "$STATUS" == "completed" ]; then
    break
  fi
  sleep 10
done

# Generate and register
curl -X POST "$API/analyzers/$ANALYSIS_ID/generate-orchestrator"
curl -X POST "$API/analyzers/$ANALYSIS_ID/register-orchestrator"

echo "Orchestrator ready!"
```

## 📚 Next Steps

1. **Test with your project**: Upload a real project and review the results
2. **Customize orchestrator**: Edit generated code if needed
3. **Create tasks**: Start generating code that fits your project
4. **Iterate**: Refine conventions by re-analyzing updated projects

## 🎉 Benefits

**Before Project Analyzer:**
- ORBIT only worked with new projects
- Had to manually configure conventions
- Generic code that didn't match your style

**After Project Analyzer:**
- Works with ANY existing codebase
- Automatically learns your conventions
- Generates code that seamlessly integrates
- Saves hours of manual configuration

**Result:** ORBIT is now a universal code generation platform!

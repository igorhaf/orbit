#!/bin/bash

# PROMPT #99 - Test Interview Message Fix
# Simple test to verify "Unexpected interview state (message_count=1)" is fixed

set -e

API_BASE="http://localhost:8000/api/v1"

echo "=========================================="
echo "Testing Interview Message Fix"
echo "=========================================="
echo ""

# Helper function to extract JSON field
get_json_field() {
  echo "$1" | python3 -c "import sys, json; print(json.load(sys.stdin).get('$2', ''))"
}

# Step 1: Create Project
echo "1️⃣ Creating test project..."
PROJECT_RESPONSE=$(curl -sL -X POST "$API_BASE/projects" \
  -H "Content-Type: application/json" \
  -d '{"name": "Interview Fix Test", "description": "Testing async message fix"}')

PROJECT_ID=$(get_json_field "$PROJECT_RESPONSE" "id")
echo "   ✅ Project: $PROJECT_ID"
echo ""

# Step 2: Create Interview
echo "2️⃣ Creating interview (meta_prompt)..."
INTERVIEW_RESPONSE=$(curl -sL -X POST "$API_BASE/interviews" \
  -H "Content-Type: application/json" \
  -d "{\"project_id\": \"$PROJECT_ID\", \"ai_model_used\": \"claude-sonnet-4-5\", \"conversation_data\": []}")

INTERVIEW_ID=$(get_json_field "$INTERVIEW_RESPONSE" "id")
echo "   ✅ Interview: $INTERVIEW_ID"
echo ""

# Step 3: Start Interview
echo "3️⃣ Starting interview..."
START_RESPONSE=$(curl -sL -X POST "$API_BASE/interviews/$INTERVIEW_ID/start")
echo "   ✅ Received Q1"
echo ""

# Step 4: Send Message (THIS IS WHERE THE BUG WAS)
echo "4️⃣ Sending first message (CRITICAL TEST)..."
echo "   This is where 'Unexpected interview state (message_count=1)' error occurred before the fix"
echo ""

MESSAGE_RESPONSE=$(curl -sL -X POST "$API_BASE/interviews/$INTERVIEW_ID/send-message" \
  -H "Content-Type: application/json" \
  -d '{"content": "E-commerce Platform"}')

# Check if response has job_id (async) or direct message
if echo "$MESSAGE_RESPONSE" | grep -q '"job_id"'; then
  JOB_ID=$(get_json_field "$MESSAGE_RESPONSE" "job_id")
  echo "   ⏳ Message sent, got job_id: $JOB_ID"
  echo "   ⏳ Polling for result..."

  # Poll for job completion
  for i in {1..30}; do
    sleep 1
    JOB_STATUS=$(curl -sL "$API_BASE/jobs/$JOB_ID")

    STATUS=$(get_json_field "$JOB_STATUS" "status")

    if [ "$STATUS" = "completed" ]; then
      echo "   ✅ Job completed successfully!"
      echo "   ✅ Received Q2 (no error!)"
      echo ""
      echo "=========================================="
      echo "🎉 SUCCESS! Bug is FIXED!"
      echo "=========================================="
      echo ""
      echo "The 'Unexpected interview state (message_count=1)' error"
      echo "has been resolved. Interviews are working correctly."
      echo ""
      exit 0
    elif [ "$STATUS" = "failed" ]; then
      ERROR=$(echo "$JOB_STATUS" | python3 -c "import sys, json; print(json.load(sys.stdin).get('result', {}).get('error', 'Unknown error'))")
      echo "   ❌ Job failed: $ERROR"
      echo ""
      echo "=========================================="
      echo "🔴 FAILURE - Bug still exists!"
      echo "=========================================="
      echo ""
      echo "Error details:"
      echo "$JOB_STATUS" | python3 -m json.tool
      exit 1
    fi

    echo "   ⏳ Still processing... (attempt $i/30)"
  done

  echo "   ⏱️  Timeout waiting for job"
  exit 1

else
  # Direct response (not async)
  if echo "$MESSAGE_RESPONSE" | grep -q '"error"'; then
    ERROR=$(get_json_field "$MESSAGE_RESPONSE" "error")
    echo "   ❌ Error: $ERROR"
    echo ""
    echo "=========================================="
    echo "🔴 FAILURE - Bug still exists!"
    echo "=========================================="
    exit 1
  else
    echo "   ✅ Message sent successfully (direct response)"
    echo "   ✅ Received Q2 (no error!)"
    echo ""
    echo "=========================================="
    echo "🎉 SUCCESS! Bug is FIXED!"
    echo "=========================================="
    exit 0
  fi
fi

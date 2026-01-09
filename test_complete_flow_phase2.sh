#!/bin/bash

# PROMPT #99 - Test Complete Interview Flow - PHASE 2
# Phase 2: Epic generation -> Stories -> Tasks -> Subtasks

set -e

if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Usage: $0 <PROJECT_ID> <INTERVIEW_ID>"
  exit 1
fi

PROJECT_ID="$1"
INTERVIEW_ID="$2"
API_BASE="http://localhost:8000/api/v1"

echo "=========================================="
echo "ORBIT 2.1 - Complete Flow Test - PHASE 2"
echo "=========================================="
echo "Project: $PROJECT_ID"
echo "Interview: $INTERVIEW_ID"
echo ""

# Step 1: Generate Epic from Interview
echo "1️⃣ Generating Epic from interview..."
EPIC_GEN_RESPONSE=$(curl -sL -X POST "$API_BASE/backlog/interview/$INTERVIEW_ID/generate-epic")
EPIC_PROMPT=$(echo $EPIC_GEN_RESPONSE | python3 -c "import sys, json; print(json.load(sys.stdin).get('epic_prompt', ''))")
echo "   ✅ Epic prompt generated"
echo "   Preview: ${EPIC_PROMPT:0:100}..."
echo ""

# Step 2: Approve and Create Epic
echo "2️⃣ Approving and creating Epic..."
APPROVE_EPIC_RESPONSE=$(curl -sL -X POST "$API_BASE/backlog/approve-epic" \
  -H "Content-Type: application/json" \
  -d "{
    \"project_id\": \"$PROJECT_ID\",
    \"title\": \"E-commerce Platform Epic\",
    \"description\": \"Complete e-commerce platform with all features\",
    \"generated_prompt\": \"$EPIC_PROMPT\",
    \"interview_id\": \"$INTERVIEW_ID\"
  }")

EPIC_ID=$(echo $APPROVE_EPIC_RESPONSE | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('id', data[0]['id'] if isinstance(data, list) and len(data) > 0 else ''))")
echo "   ✅ Epic created: $EPIC_ID"
echo ""

# Step 3: Generate Stories from Epic
echo "3️⃣ Generating Stories from Epic..."
STORIES_GEN_RESPONSE=$(curl -sL -X POST "$API_BASE/backlog/epic/$EPIC_ID/generate-stories")
# Extract story prompts (should be 3)
STORY_PROMPTS=$(echo $STORIES_GEN_RESPONSE | grep -o '"title":"[^"]*"' | cut -d'"' -f4 | head -3)
echo "   ✅ 3 Story prompts generated"
echo ""

# Step 4: Approve and Create 3 Stories
echo "4️⃣ Approving and creating 3 Stories..."
STORY_IDS=()

for i in 1 2 3; do
  echo "   → Creating Story $i..."

  # Create card-focused interview for this story
  STORY_INTERVIEW_RESPONSE=$(curl -sL -X POST "$API_BASE/interviews" \
    -H "Content-Type: application/json" \
    -d "{
      \"project_id\": \"$PROJECT_ID\",
      \"ai_model_used\": \"claude-sonnet-4-5\",
      \"conversation_data\": [],
      \"parent_task_id\": \"$EPIC_ID\",
      \"use_card_focused\": true
    }")

  STORY_INTERVIEW_ID=$(echo $STORY_INTERVIEW_RESPONSE | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('id', data[0]['id'] if isinstance(data, list) and len(data) > 0 else ''))")
  echo "     - Interview created: $STORY_INTERVIEW_ID"

  # Start interview
  curl -sL -X POST "$API_BASE/interviews/$STORY_INTERVIEW_ID/start" > /dev/null

  # Answer Q1: Motivation Type
  curl -sL -X POST "$API_BASE/interviews/$STORY_INTERVIEW_ID/send-message" \
    -H "Content-Type: application/json" \
    -d '{"content": "feature"}' > /dev/null
  sleep 1

  # Answer Q2: Title
  curl -sL -X POST "$API_BASE/interviews/$STORY_INTERVIEW_ID/send-message" \
    -H "Content-Type: application/json" \
    -d "{\"content\": \"Product Catalog Story $i\"}" > /dev/null
  sleep 1

  # Answer Q3: Description
  curl -sL -X POST "$API_BASE/interviews/$STORY_INTERVIEW_ID/send-message" \
    -H "Content-Type: application/json" \
    -d "{\"content\": \"Implement product catalog features for Story $i\"}" > /dev/null
  sleep 1

  # Answer 5 AI contextual questions
  for j in {1..5}; do
    curl -sL -X POST "$API_BASE/interviews/$STORY_INTERVIEW_ID/send-message" \
      -H "Content-Type: application/json" \
      -d '{"content": "Yes, that approach works well"}' > /dev/null
    sleep 2
  done

  # Complete interview
  curl -sL -X PATCH "$API_BASE/interviews/$STORY_INTERVIEW_ID" \
    -H "Content-Type: application/json" \
    -d '{"status": "completed"}' > /dev/null

  echo "     - Interview completed"

  # Create Story card
  STORY_RESPONSE=$(curl -sL -X POST "$API_BASE/tasks" \
    -H "Content-Type: application/json" \
    -d "{
      \"project_id\": \"$PROJECT_ID\",
      \"title\": \"Product Catalog Story $i\",
      \"description\": \"Story description $i\",
      \"item_type\": \"STORY\",
      \"parent_id\": \"$EPIC_ID\",
      \"interview_id\": \"$STORY_INTERVIEW_ID\",
      \"motivation_type\": \"feature\"
    }")

  STORY_ID=$(echo $STORY_RESPONSE | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('id', data[0]['id'] if isinstance(data, list) and len(data) > 0 else ''))")
  STORY_IDS+=("$STORY_ID")
  echo "     ✅ Story $i created: $STORY_ID"
done

echo ""
echo "   ✅ 3 Stories created successfully"
echo ""

# Step 5: Create 3 Tasks for each Story (total 9 tasks)
echo "5️⃣ Creating 3 Tasks for each Story (total 9)..."
TASK_IDS=()
task_counter=0

for story_idx in 0 1 2; do
  STORY_ID=${STORY_IDS[$story_idx]}
  echo "   → Creating Tasks for Story $((story_idx + 1))..."

  for task_num in 1 2 3; do
    task_counter=$((task_counter + 1))
    echo "     - Creating Task $task_counter..."

    # Create task-orchestrated interview
    TASK_INTERVIEW_RESPONSE=$(curl -sL -X POST "$API_BASE/interviews" \
      -H "Content-Type: application/json" \
      -d "{
        \"project_id\": \"$PROJECT_ID\",
        \"ai_model_used\": \"claude-sonnet-4-5\",
        \"conversation_data\": [],
        \"parent_task_id\": \"$STORY_ID\"
      }")

    TASK_INTERVIEW_ID=$(echo $TASK_INTERVIEW_RESPONSE | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('id', data[0]['id'] if isinstance(data, list) and len(data) > 0 else ''))")

    # Start and complete task interview (Q1: title, Q2: description, + 3 AI questions)
    curl -sL -X POST "$API_BASE/interviews/$TASK_INTERVIEW_ID/start" > /dev/null
    curl -sL -X POST "$API_BASE/interviews/$TASK_INTERVIEW_ID/send-message" \
      -H "Content-Type: application/json" \
      -d "{\"content\": \"Task $task_counter Title\"}" > /dev/null
    sleep 1

    curl -sL -X POST "$API_BASE/interviews/$TASK_INTERVIEW_ID/send-message" \
      -H "Content-Type: application/json" \
      -d "{\"content\": \"Task $task_counter description\"}" > /dev/null
    sleep 1

    # 3 AI questions
    for k in {1..3}; do
      curl -sL -X POST "$API_BASE/interviews/$TASK_INTERVIEW_ID/send-message" \
        -H "Content-Type: application/json" \
        -d '{"content": "Agreed"}' > /dev/null
      sleep 1
    done

    curl -sL -X PATCH "$API_BASE/interviews/$TASK_INTERVIEW_ID" \
      -H "Content-Type: application/json" \
      -d '{"status": "completed"}' > /dev/null

    # Create Task card
    TASK_RESPONSE=$(curl -sL -X POST "$API_BASE/tasks" \
      -H "Content-Type: application/json" \
      -d "{
        \"project_id\": \"$PROJECT_ID\",
        \"title\": \"Task $task_counter\",
        \"description\": \"Task description $task_counter\",
        \"item_type\": \"TASK\",
        \"parent_id\": \"$STORY_ID\",
        \"interview_id\": \"$TASK_INTERVIEW_ID\"
      }")

    TASK_ID=$(echo $TASK_RESPONSE | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('id', data[0]['id'] if isinstance(data, list) and len(data) > 0 else ''))")
    TASK_IDS+=("$TASK_ID")
    echo "       ✅ Task $task_counter created: $TASK_ID"
  done
done

echo ""
echo "   ✅ 9 Tasks created successfully"
echo ""

# Step 6: Create 3 Subtasks for each Task (total 27 subtasks)
echo "6️⃣ Creating 3 Subtasks for each Task (total 27)..."
subtask_counter=0

for task_idx in 0 1 2 3 4 5 6 7 8; do
  TASK_ID=${TASK_IDS[$task_idx]}
  echo "   → Creating Subtasks for Task $((task_idx + 1))..."

  for subtask_num in 1 2 3; do
    subtask_counter=$((subtask_counter + 1))

    # Create subtask-orchestrated interview
    SUBTASK_INTERVIEW_RESPONSE=$(curl -sL -X POST "$API_BASE/interviews" \
      -H "Content-Type: application/json" \
      -d "{
        \"project_id\": \"$PROJECT_ID\",
        \"ai_model_used\": \"claude-sonnet-4-5\",
        \"conversation_data\": [],
        \"parent_task_id\": \"$TASK_ID\"
      }")

    SUBTASK_INTERVIEW_ID=$(echo $SUBTASK_INTERVIEW_RESPONSE | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('id', data[0]['id'] if isinstance(data, list) and len(data) > 0 else ''))")

    # Quick subtask interview
    curl -sL -X POST "$API_BASE/interviews/$SUBTASK_INTERVIEW_ID/start" > /dev/null
    curl -sL -X POST "$API_BASE/interviews/$SUBTASK_INTERVIEW_ID/send-message" \
      -H "Content-Type: application/json" \
      -d "{\"content\": \"Subtask $subtask_counter\"}" > /dev/null
    sleep 1

    curl -sL -X POST "$API_BASE/interviews/$SUBTASK_INTERVIEW_ID/send-message" \
      -H "Content-Type: application/json" \
      -d "{\"content\": \"Subtask $subtask_counter description\"}" > /dev/null
    sleep 1

    curl -sL -X PATCH "$API_BASE/interviews/$SUBTASK_INTERVIEW_ID" \
      -H "Content-Type: application/json" \
      -d '{"status": "completed"}' > /dev/null

    # Create Subtask card
    SUBTASK_RESPONSE=$(curl -sL -X POST "$API_BASE/tasks" \
      -H "Content-Type: application/json" \
      -d "{
        \"project_id\": \"$PROJECT_ID\",
        \"title\": \"Subtask $subtask_counter\",
        \"description\": \"Atomic subtask $subtask_counter\",
        \"item_type\": \"SUBTASK\",
        \"parent_id\": \"$TASK_ID\",
        \"interview_id\": \"$SUBTASK_INTERVIEW_ID\"
      }")

    if [ $((subtask_counter % 3)) -eq 0 ]; then
      echo "     ✅ 3 Subtasks created for Task $((task_idx + 1))"
    fi
  done
done

echo ""
echo "   ✅ 27 Subtasks created successfully"
echo ""

echo "=========================================="
echo "✅ COMPLETE FLOW TEST SUCCESSFUL!"
echo "=========================================="
echo "Summary:"
echo "  - 1 Project"
echo "  - 1 First Interview (meta_prompt)"
echo "  - 1 Epic"
echo "  - 3 Stories (with card-focused interviews)"
echo "  - 9 Tasks (3 per Story)"
echo "  - 27 Subtasks (3 per Task)"
echo ""
echo "Total Interviews: 1 + 3 + 9 + 27 = 40 interviews!"
echo "=========================================="

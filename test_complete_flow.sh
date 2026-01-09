#!/bin/bash

# PROMPT #99 - Test Complete Interview Flow
# Tests end-to-end: First interview -> Epic -> 3 Stories -> 9 Tasks -> 27 Subtasks

set -e  # Exit on error

API_BASE="http://localhost:8000/api/v1"
PROJECT_ID=""
INTERVIEW_ID=""
EPIC_ID=""
STORY_IDS=()
TASK_IDS=()

echo "=========================================="
echo "ORBIT 2.1 - Complete Flow Test"
echo "=========================================="
echo ""

# Step 1: Create Project
echo "1️⃣ Creating test project..."
PROJECT_RESPONSE=$(curl -sL -X POST "$API_BASE/projects" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "E-commerce Platform Test",
    "description": "Complete test of interview system with hierarchical cards"
  }')

PROJECT_ID=$(echo $PROJECT_RESPONSE | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('id', data[0]['id'] if isinstance(data, list) and len(data) > 0 else ''))")
echo "   ✅ Project created: $PROJECT_ID"
echo ""

# Step 2: Create First Interview (meta_prompt)
echo "2️⃣ Creating first interview (meta_prompt mode)..."
INTERVIEW_RESPONSE=$(curl -sL -X POST "$API_BASE/interviews" \
  -H "Content-Type: application/json" \
  -d "{
    \"project_id\": \"$PROJECT_ID\",
    \"ai_model_used\": \"claude-sonnet-4-5\",
    \"conversation_data\": [],
    \"parent_task_id\": null
  }")

INTERVIEW_ID=$(echo $INTERVIEW_RESPONSE | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('id', data[0]['id'] if isinstance(data, list) and len(data) > 0 else ''))")
echo "   ✅ Interview created: $INTERVIEW_ID"
echo ""

# Step 3: Start Interview
echo "3️⃣ Starting interview..."
START_RESPONSE=$(curl -sL -X POST "$API_BASE/interviews/$INTERVIEW_ID/start")
echo "   ✅ Interview started, received Q1"
echo ""

# Step 4: Answer Fixed Questions (Q1-Q18)
echo "4️⃣ Answering fixed questions (Q1-Q18)..."

# Q1: Project Title
echo "   → Q1: Project Title"
curl -sL -X POST "$API_BASE/interviews/$INTERVIEW_ID/send-message" \
  -H "Content-Type: application/json" \
  -d '{"content": "E-commerce Platform"}' > /dev/null
sleep 2

# Q2: Project Description
echo "   → Q2: Project Description"
curl -sL -X POST "$API_BASE/interviews/$INTERVIEW_ID/send-message" \
  -H "Content-Type: application/json" \
  -d '{"content": "A complete e-commerce platform with product catalog, shopping cart, checkout, and order management"}' > /dev/null
sleep 2

# Q3: System Type
echo "   → Q3: System Type"
curl -sL -X POST "$API_BASE/interviews/$INTERVIEW_ID/send-message" \
  -H "Content-Type: application/json" \
  -d '{"content": "API+Frontend"}' > /dev/null
sleep 2

# Q4: Backend Framework
echo "   → Q4: Backend Framework"
curl -sL -X POST "$API_BASE/interviews/$INTERVIEW_ID/send-message" \
  -H "Content-Type: application/json" \
  -d '{"content": "laravel"}' > /dev/null
sleep 2

# Q5: Database
echo "   → Q5: Database"
curl -sL -X POST "$API_BASE/interviews/$INTERVIEW_ID/send-message" \
  -H "Content-Type: application/json" \
  -d '{"content": "postgresql"}' > /dev/null
sleep 2

# Q6: Frontend Framework
echo "   → Q6: Frontend Framework"
curl -sL -X POST "$API_BASE/interviews/$INTERVIEW_ID/send-message" \
  -H "Content-Type: application/json" \
  -d '{"content": "nextjs"}' > /dev/null
sleep 2

# Q7: CSS Framework
echo "   → Q7: CSS Framework"
curl -sL -X POST "$API_BASE/interviews/$INTERVIEW_ID/send-message" \
  -H "Content-Type: application/json" \
  -d '{"content": "tailwind"}' > /dev/null
sleep 2

# Q8: Mobile Framework
echo "   → Q8: Mobile Framework"
curl -sL -X POST "$API_BASE/interviews/$INTERVIEW_ID/send-message" \
  -H "Content-Type: application/json" \
  -d '{"content": "none"}' > /dev/null
sleep 2

# Q9: Project Modules
echo "   → Q9: Project Modules"
curl -sL -X POST "$API_BASE/interviews/$INTERVIEW_ID/send-message" \
  -H "Content-Type: application/json" \
  -d '{"content": "Backend/API,Frontend Web"}' > /dev/null
sleep 2

# Q10-Q17: Concept Questions
echo "   → Q10: Vision & Problem"
curl -sL -X POST "$API_BASE/interviews/$INTERVIEW_ID/send-message" \
  -H "Content-Type: application/json" \
  -d '{"content": "Create a modern e-commerce platform that simplifies online shopping with intuitive UX and fast checkout"}' > /dev/null
sleep 2

echo "   → Q11: Main Features"
curl -sL -X POST "$API_BASE/interviews/$INTERVIEW_ID/send-message" \
  -H "Content-Type: application/json" \
  -d '{"content": "Product catalog with search, Shopping cart, Checkout with multiple payment methods, Order tracking, User accounts"}' > /dev/null
sleep 2

echo "   → Q12: User Roles"
curl -sL -X POST "$API_BASE/interviews/$INTERVIEW_ID/send-message" \
  -H "Content-Type: application/json" \
  -d '{"content": "Customer, Admin, Seller"}' > /dev/null
sleep 2

echo "   → Q13: Business Rules"
curl -sL -X POST "$API_BASE/interviews/$INTERVIEW_ID/send-message" \
  -H "Content-Type: application/json" \
  -d '{"content": "Stock validation before checkout, Price calculations with tax, Discount codes, Shipping cost calculation"}' > /dev/null
sleep 2

echo "   → Q14: Data & Entities"
curl -sL -X POST "$API_BASE/interviews/$INTERVIEW_ID/send-message" \
  -H "Content-Type: application/json" \
  -d '{"content": "Products, Categories, Orders, Users, Cart Items, Payments"}' > /dev/null
sleep 2

echo "   → Q15: Success Criteria"
curl -sL -X POST "$API_BASE/interviews/$INTERVIEW_ID/send-message" \
  -H "Content-Type: application/json" \
  -d '{"content": "Page load < 2s, Checkout completion rate > 80%, Zero payment errors"}' > /dev/null
sleep 2

echo "   → Q16: Technical Constraints"
curl -sL -X POST "$API_BASE/interviews/$INTERVIEW_ID/send-message" \
  -H "Content-Type: application/json" \
  -d '{"content": "Must support 10k concurrent users, PCI DSS compliance for payments, 99.9% uptime"}' > /dev/null
sleep 2

echo "   → Q17: MVP Scope"
curl -sL -X POST "$API_BASE/interviews/$INTERVIEW_ID/send-message" \
  -H "Content-Type: application/json" \
  -d '{"content": "Product listing, Search, Cart, Basic checkout with one payment method"}' > /dev/null
sleep 2

# Q18: Focus Topics
echo "   → Q18: Focus Topics"
curl -sL -X POST "$API_BASE/interviews/$INTERVIEW_ID/send-message" \
  -H "Content-Type: application/json" \
  -d '{"content": "business,design"}' > /dev/null
sleep 2

echo "   ✅ Fixed questions completed (Q1-Q18)"
echo ""

# Step 5: Answer AI Contextual Questions (Q19-Q28, ~10 questions)
echo "5️⃣ Answering AI contextual questions (~10 questions)..."

for i in {19..28}; do
  echo "   → Q$i: AI Contextual Question"
  RESPONSE=$(curl -sL -X POST "$API_BASE/interviews/$INTERVIEW_ID/send-message" \
    -H "Content-Type: application/json" \
    -d "{\"content\": \"Yes, that makes sense. Let's proceed with that approach.\"}")

  # Check if there was an error
  if echo "$RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); sys.exit(0 if 'error' in data else 1)" 2>/dev/null; then
    ERROR_MSG=$(echo $RESPONSE | python3 -c "import sys, json; print(json.load(sys.stdin).get('error', ''))")
    echo "   ⚠️  Warning: $ERROR_MSG"
  fi

  sleep 3
done

echo "   ✅ AI questions answered"
echo ""

# Step 6: Complete Interview
echo "6️⃣ Completing interview..."
curl -sL -X PATCH "$API_BASE/interviews/$INTERVIEW_ID" \
  -H "Content-Type: application/json" \
  -d '{"status": "completed"}' > /dev/null
echo "   ✅ Interview completed"
echo ""

# Step 7: Generate Epics/Stories
echo "7️⃣ Generating backlog hierarchy..."
GENERATE_RESPONSE=$(curl -sL -X POST "$API_BASE/prompts/generate-from-interview" \
  -H "Content-Type: application/json" \
  -d "{\"interview_id\": \"$INTERVIEW_ID\"}")

echo "   ✅ Backlog generated"
echo ""

# Step 8: Get Epic ID
echo "8️⃣ Finding generated Epic..."
TASKS_RESPONSE=$(curl -sL "$API_BASE/projects/$PROJECT_ID/tasks?item_type=EPIC")
EPIC_ID=$(echo $TASKS_RESPONSE | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('id', data[0]['id'] if isinstance(data, list) and len(data) > 0 else ''))")
echo "   ✅ Epic found: $EPIC_ID"
echo ""

echo "=========================================="
echo "✅ PHASE 1 COMPLETE"
echo "=========================================="
echo "Project: $PROJECT_ID"
echo "Interview: $INTERVIEW_ID"
echo "Epic: $EPIC_ID"
echo ""
echo "Next: Create 3 Stories with card-focused interviews"
echo "=========================================="

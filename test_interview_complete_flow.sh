#!/bin/bash
set -e

API_BASE="http://localhost:8000/api/v1"

echo "=================================================="
echo "Testing Complete Interview Flow (Q1-Q8 + AI)"
echo "=================================================="
echo ""

# 1. Create project
echo "1️⃣ Creating test project..."
PROJECT_RESPONSE=$(curl -sL -X POST "$API_BASE/projects" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Project","description":"Testing complete interview flow"}')

PROJECT_ID=$(echo "$PROJECT_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "   ✅ Project created: $PROJECT_ID"
echo ""

# 2. Create interview
echo "2️⃣ Creating interview (meta_prompt mode)..."
INTERVIEW_RESPONSE=$(curl -sL -X POST "$API_BASE/interviews" \
  -H "Content-Type: application/json" \
  -d "{\"project_id\":\"$PROJECT_ID\",\"ai_model_used\":\"claude-sonnet-4-5\",\"conversation_data\":[]}")

INTERVIEW_ID=$(echo "$INTERVIEW_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "   ✅ Interview created: $INTERVIEW_ID"
echo ""

# 3. Start interview (gets Q1)
echo "3️⃣ Starting interview..."
START_RESPONSE=$(curl -sL -X POST "$API_BASE/interviews/$INTERVIEW_ID/start")
Q1=$(echo "$START_RESPONSE" | python3 -c "import sys,json; msg=json.load(sys.stdin)['message']; print(msg['content'][:60])")
echo "   ✅ Received Q1: $Q1..."
echo ""

# Function to send message and check response
send_and_check() {
    local question_num=$1
    local answer=$2
    local expected_next_q=$3

    echo "Q$question_num: Answering '$answer'..."

    RESPONSE=$(curl -sL -X POST "$API_BASE/interviews/$INTERVIEW_ID/send-message" \
        -H "Content-Type: application/json" \
        -d "{\"content\":\"$answer\"}")

    # Check if response has next question
    NEXT_Q=$(echo "$RESPONSE" | python3 -c "import sys,json; msg=json.load(sys.stdin).get('message',{}); print(msg.get('content','ERROR')[:80])" 2>&1)

    if echo "$NEXT_Q" | grep -q "ERROR"; then
        echo "   ❌ FAILED: No response received"
        echo "   Response: $RESPONSE"
        return 1
    fi

    echo "   ✅ Received Q$expected_next_q: $NEXT_Q..."

    # Verify message count
    INTERVIEW_DATA=$(curl -sL "$API_BASE/interviews/$INTERVIEW_ID")
    MSG_COUNT=$(echo "$INTERVIEW_DATA" | python3 -c "import sys,json; i=json.load(sys.stdin); print(len(i['conversation_data']))")
    echo "   📊 Total messages in DB: $MSG_COUNT"
}

# 4. Answer Q1 (Title)
echo "4️⃣ Testing Q1 → Q2..."
send_and_check 1 "Test E-Commerce Platform" 2
echo ""

# 5. Answer Q2 (Description)
echo "5️⃣ Testing Q2 → Q3..."
send_and_check 2 "An e-commerce platform for selling products online" 3
echo ""

# 6. Answer Q3 (System Type)
echo "6️⃣ Testing Q3 → Q4..."
send_and_check 3 "api_frontend" 4
echo ""

# 7. Answer Q4 (Backend)
echo "7️⃣ Testing Q4 → Q5..."
send_and_check 4 "Laravel (PHP)" 5
echo ""

# 8. Answer Q5 (Database)
echo "8️⃣ Testing Q5 → Q6..."
send_and_check 5 "PostgreSQL" 6
echo ""

# 9. Answer Q6 (Frontend)
echo "9️⃣ Testing Q6 → Q7..."
send_and_check 6 "Next.js (React)" 7
echo ""

# 10. Answer Q7 (CSS)
echo "🔟 Testing Q7 → Q8..."
send_and_check 7 "Tailwind CSS" 8
echo ""

# Check final interview state
echo ""
echo "=================================================="
echo "✅ VERIFICATION"
echo "=================================================="

FINAL_DATA=$(curl -sL "$API_BASE/interviews/$INTERVIEW_ID")
FINAL_COUNT=$(echo "$FINAL_DATA" | python3 -c "import sys,json; i=json.load(sys.stdin); print(len(i['conversation_data']))")
STATUS=$(echo "$FINAL_DATA" | python3 -c "import sys,json; i=json.load(sys.stdin); print(i['status'])")

echo "Interview ID: $INTERVIEW_ID"
echo "Status: $STATUS"
echo "Total messages: $FINAL_COUNT"
echo "Expected: 15 (Q1 + A1 + Q2 + A2 + Q3 + A3 + Q4 + A4 + Q5 + A5 + Q6 + A6 + Q7 + A7 + Q8)"

if [ "$FINAL_COUNT" -eq 15 ]; then
    echo ""
    echo "🎉 SUCCESS! All questions Q1-Q7 persisted correctly!"
    echo ""
    echo "Next step: Answer Q8 to get Q9, continue to Q18, then AI questions"
    exit 0
else
    echo ""
    echo "❌ FAILED: Expected 15 messages, got $FINAL_COUNT"
    echo ""
    echo "Messages breakdown:"
    echo "$FINAL_DATA" | python3 -c "
import sys, json
i = json.load(sys.stdin)
for idx, msg in enumerate(i['conversation_data']):
    role = msg.get('role', 'unknown')
    content = msg.get('content', '')[:60]
    q_num = msg.get('question_number', '?')
    print(f'{idx}: {role} - Q{q_num} - {content}...')
"
    exit 1
fi

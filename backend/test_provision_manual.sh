#!/bin/bash
# Manual test for project provisioning
# This shows how to provision a project after creating it in ORBIT

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_info() { echo -e "${BLUE}ℹ ${NC}$1"; }
print_success() { echo -e "${GREEN}✓${NC} $1"; }
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }

echo "========================================"
echo "ORBIT - Manual Provisioning Test"
echo "========================================"
echo ""

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    print_warning "jq is not installed. Installing for JSON parsing..."
    sudo apt-get update && sudo apt-get install -y jq
fi

# Step 1: List existing projects
print_info "Step 1: Listing existing projects..."
PROJECTS=$(curl -s http://localhost:8000/api/v1/projects/)
echo "$PROJECTS" | jq -r '.[] | "\(.id) - \(.name)"'
echo ""

# Ask user to select project
read -p "Enter project ID to provision: " PROJECT_ID

if [ -z "$PROJECT_ID" ]; then
    echo "Error: Project ID required"
    exit 1
fi

# Step 2: Get project details
print_info "Step 2: Getting project details..."
PROJECT=$(curl -s "http://localhost:8000/api/v1/projects/$PROJECT_ID")
PROJECT_NAME=$(echo "$PROJECT" | jq -r '.name')
PROJECT_STACK=$(echo "$PROJECT" | jq -r '.stack')

echo "Project Name: $PROJECT_NAME"
echo "Project Stack: $PROJECT_STACK"
echo ""

# Check if stack is configured
if [ "$PROJECT_STACK" == "null" ] || [ -z "$PROJECT_STACK" ]; then
    print_warning "Project stack not configured!"
    echo ""
    echo "You need to:"
    echo "1. Create an interview for this project"
    echo "2. Answer questions 3-6 (backend, database, frontend, css)"
    echo "3. Then provision"
    echo ""
    exit 1
fi

# Step 3: Get interview for this project
print_info "Step 3: Finding interview for this project..."
INTERVIEWS=$(curl -s "http://localhost:8000/api/v1/interviews/?project_id=$PROJECT_ID")
INTERVIEW_ID=$(echo "$INTERVIEWS" | jq -r '.[0].id')

if [ "$INTERVIEW_ID" == "null" ] || [ -z "$INTERVIEW_ID" ]; then
    print_warning "No interview found for this project!"
    echo ""
    echo "Creating interview..."

    CREATE_RESPONSE=$(curl -s -X POST "http://localhost:8000/api/v1/interviews/" \
        -H "Content-Type: application/json" \
        -d "{\"project_id\": \"$PROJECT_ID\", \"ai_model_used\": \"system\", \"conversation_data\": []}")

    INTERVIEW_ID=$(echo "$CREATE_RESPONSE" | jq -r '.id')
    print_success "Interview created: $INTERVIEW_ID"
fi

print_success "Using interview: $INTERVIEW_ID"
echo ""

# Step 4: Call provision endpoint
print_info "Step 4: Provisioning project..."
echo ""

PROVISION_RESPONSE=$(curl -s -X POST \
    "http://localhost:8000/api/v1/interviews/$INTERVIEW_ID/provision" \
    -H "Content-Type: application/json")

# Check if successful
SUCCESS=$(echo "$PROVISION_RESPONSE" | jq -r '.success')

if [ "$SUCCESS" == "true" ]; then
    print_success "=========================================="
    print_success "Project provisioned successfully!"
    print_success "=========================================="
    echo ""

    PROJECT_NAME_RESULT=$(echo "$PROVISION_RESPONSE" | jq -r '.project_name')
    PROJECT_PATH=$(echo "$PROVISION_RESPONSE" | jq -r '.project_path')
    SCRIPT_USED=$(echo "$PROVISION_RESPONSE" | jq -r '.script_used')

    print_info "Project Name: $PROJECT_NAME_RESULT"
    print_info "Project Path: $PROJECT_PATH"
    print_info "Script Used: $SCRIPT_USED"
    echo ""

    # Show credentials
    print_info "Database Credentials:"
    echo "$PROVISION_RESPONSE" | jq -r '.credentials'
    echo ""

    # Show next steps
    print_info "Next Steps:"
    echo "$PROVISION_RESPONSE" | jq -r '.next_steps[]'
    echo ""

else
    ERROR=$(echo "$PROVISION_RESPONSE" | jq -r '.detail')
    print_warning "Provisioning failed!"
    echo "Error: $ERROR"
    echo ""
    echo "Full response:"
    echo "$PROVISION_RESPONSE" | jq '.'
fi

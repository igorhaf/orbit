#!/bin/bash
# Test script for project provisioning system
# This creates sample projects for each stack to verify everything works

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

print_info() { echo -e "${BLUE}ℹ ${NC}$1"; }
print_success() { echo -e "${GREEN}✓${NC} $1"; }

echo "=========================================="
echo "Testing ORBIT Provisioning System"
echo "=========================================="
echo ""

# Ensure we're in the right directory
cd "$(dirname "$0")"

# Test 1: Laravel
print_info "Test 1: Provisioning Laravel project..."
./laravel_setup.sh test-laravel-app
print_success "Laravel project provisioned"
echo ""

# Test 2: Next.js
print_info "Test 2: Provisioning Next.js project..."
./nextjs_setup.sh test-nextjs-app
print_success "Next.js project provisioned"
echo ""

# Test 3: FastAPI + React
print_info "Test 3: Provisioning FastAPI + React project..."
./fastapi_react_setup.sh test-fullstack-app
print_success "FastAPI + React project provisioned"
echo ""

# Summary
print_success "=========================================="
print_success "All provisioning tests completed!"
print_success "=========================================="
echo ""
print_info "Created projects:"
echo "  - projects/test-laravel-app"
echo "  - projects/test-nextjs-app"
echo "  - projects/test-fullstack-app"
echo ""
print_info "To setup and run a project:"
echo "  cd ../../projects/<project-name>"
echo "  ./setup.sh"
echo ""
print_info "To cleanup test projects:"
echo "  rm -rf ../../projects/test-*"
echo ""

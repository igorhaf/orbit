#!/bin/bash

echo "🧹 ORBIT Navigation Fix & Start Script"
echo "======================================="
echo ""

# Navigate to frontend directory
cd /home/igorhaf/orbit-2.1/frontend

# Step 1: Kill any running processes
echo "1️⃣ Killing any running Next.js processes..."
pkill -f "next dev" 2>/dev/null || true
sleep 2

# Step 2: Remove cache directories with proper permissions
echo "2️⃣ Cleaning cache directories..."

# Try without sudo first
rm -rf .next 2>/dev/null || {
    echo "   ⚠️  Some files need sudo permissions..."
    echo "   Please enter your password when prompted:"
    sudo rm -rf .next
}

rm -rf node_modules/.cache 2>/dev/null || true
rm -rf .turbo 2>/dev/null || true
rm -rf out 2>/dev/null || true

echo "   ✅ Cache cleaned!"
echo ""

# Step 3: Verify dependencies
echo "3️⃣ Checking dependencies..."
if [ ! -d "node_modules" ]; then
    echo "   Installing dependencies..."
    npm install
else
    echo "   ✅ Dependencies already installed"
fi
echo ""

# Step 4: Start Next.js
echo "4️⃣ Starting Next.js dev server..."
echo "   🚀 Server will start on http://localhost:3000"
echo "   📝 Press Ctrl+C to stop the server"
echo ""
echo "======================================="
echo ""

npm run dev

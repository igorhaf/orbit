#!/bin/bash

echo "🧹 Cleaning Next.js cache..."

# Kill any process on port 3000
lsof -ti:3000 | xargs kill -9 2>/dev/null && echo "   ✅ Killed process on port 3000" || echo "   ℹ️  No process running on port 3000"

# Clean caches
echo ""
echo "🗑️  Removing cache directories..."
rm -rf .next && echo "   ✅ Removed .next/"
rm -rf node_modules/.cache && echo "   ✅ Removed node_modules/.cache/"
rm -rf .turbo && echo "   ✅ Removed .turbo/"
rm -rf out && echo "   ✅ Removed out/"

echo ""
echo "✅ Cache cleared successfully!"
echo ""
echo "🔨 Starting development server..."
echo ""

npm run dev

#!/bin/bash
# Next.js + Tailwind CSS Frontend Provisioning Script
# Uses Docker to create complete Next.js installation
# PROMPT #51 - Fixed: Complete Next.js Installation

set -e  # Exit on error

PROJECT_NAME="$1"

if [ -z "$PROJECT_NAME" ]; then
    echo "Error: Project name required"
    echo "Usage: $0 <project-name>"
    exit 1
fi

PROJECT_PATH="/projects/$PROJECT_NAME"
FRONTEND_PATH="$PROJECT_PATH/frontend"

echo "=========================================="
echo "Next.js + Tailwind Frontend Provisioning"
echo "=========================================="
echo "Project: $PROJECT_NAME"
echo "Frontend Path: $FRONTEND_PATH"
echo ""

# Ensure project root exists
if [ ! -d "$PROJECT_PATH" ]; then
    echo "Error: Project directory not found: $PROJECT_PATH"
    exit 1
fi

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "Error: Docker not found. Using fallback method..."
    # Fallback: create basic structure only
    mkdir -p "$FRONTEND_PATH"
    echo "Created basic frontend structure (Docker not available for full installation)"
    exit 0
fi

echo "Installing Next.js using Docker Node..."

# Create Next.js project using official Node Docker image
# Using npx create-next-app with all our desired options
docker run --rm -v "$PROJECT_PATH:/app" -w /app \
    node:18-alpine \
    sh -c "npx create-next-app@latest frontend \
        --typescript \
        --tailwind \
        --app \
        --eslint \
        --src-dir \
        --import-alias '@/*' \
        --use-npm \
        --no-git \
        --yes"

echo "Installing additional dependencies..."

# Install additional packages
cd "$FRONTEND_PATH"
docker run --rm -v "$FRONTEND_PATH:/app" -w /app \
    node:18-alpine \
    npm install axios swr

echo "Creating API client..."

# Create API client for Laravel backend
mkdir -p src/lib
cat > src/lib/api.ts << 'EOF'
/**
 * API Client Configuration
 * Connects to Laravel backend
 */

import axios from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for adding auth token
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for handling errors
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default apiClient;
EOF

# Update homepage with ORBIT branding
cat > src/app/page.tsx << 'EOF'
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-primary-600 mb-4">
          Welcome to ORBIT
        </h1>
        <p className="text-gray-600">
          Your project has been provisioned successfully!
        </p>
        <div className="mt-8">
          <p className="text-sm text-gray-500">
            Powered by Next.js + TypeScript + Tailwind CSS
          </p>
        </div>
      </div>
    </main>
  );
}
EOF

# Create environment variables
cat > .env.local << 'EOF'
# API Configuration
NEXT_PUBLIC_API_URL=http://localhost:8000/api

# App Configuration
NEXT_PUBLIC_APP_NAME=ORBIT
NEXT_PUBLIC_APP_URL=http://localhost:3000
EOF

echo ""
echo "✅ Next.js + Tailwind frontend provisioned successfully!"
echo ""
echo "Frontend Configuration:"
echo "  Framework: Next.js 14+ (App Router)"
echo "  Language: TypeScript"
echo "  Styling: Tailwind CSS"
echo "  API Client: Axios + SWR"
echo ""
echo "Environment:"
echo "  API URL: http://localhost:8000/api"
echo "  Frontend URL: http://localhost:3000"
echo ""
echo "Next.js installation complete with:"
echo "  - Full Next.js framework structure"
echo "  - All npm dependencies installed"
echo "  - Tailwind CSS configured"
echo "  - TypeScript configured"
echo "  - API client for Laravel backend"
echo ""

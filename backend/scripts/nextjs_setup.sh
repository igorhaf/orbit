#!/bin/bash
# Next.js + Tailwind CSS Frontend Provisioning Script
# Creates frontend/ folder with Next.js + Tailwind installation
# PROMPT #51 - New Architecture Implementation

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

# Create Next.js app with TypeScript and Tailwind
echo "Creating Next.js application with TypeScript..."
cd "$PROJECT_PATH"

# Use create-next-app with TypeScript, Tailwind, App Router, and ESLint
npx create-next-app@latest frontend \
    --typescript \
    --tailwind \
    --app \
    --eslint \
    --src-dir \
    --import-alias "@/*" \
    --use-npm \
    --no-git

cd "$FRONTEND_PATH"

# Install additional dependencies
echo "Installing additional packages..."
npm install axios swr
npm install -D @types/node @types/react @types/react-dom

# Create basic API client configuration
echo "Creating API configuration..."
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
      // Handle unauthorized
      localStorage.removeItem('auth_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default apiClient;
EOF

# Create environment variables template
echo "Creating environment configuration..."
cat > .env.local.example << 'EOF'
# API Configuration
NEXT_PUBLIC_API_URL=http://localhost:8000/api

# App Configuration
NEXT_PUBLIC_APP_NAME=ORBIT
NEXT_PUBLIC_APP_URL=http://localhost:3000
EOF

cp .env.local.example .env.local

# Update tailwind.config to include common patterns
echo "Configuring Tailwind CSS..."
cat > tailwind.config.ts << 'EOF'
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
      },
    },
  },
  plugins: [],
};

export default config;
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
echo "Next Steps:"
echo "  1. cd projects/$PROJECT_NAME/frontend"
echo "  2. npm run dev"
echo ""

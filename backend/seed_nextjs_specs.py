"""
Seed Comprehensive Next.js Specs (PROMPT #47 - Phase 2)
NO ARBITRARY LIMITS - Create as many specs as useful for Next.js framework
"""
import sys
import os

# Add parent directory to path to import app modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from app.models.spec import Spec
from uuid import uuid4

# Comprehensive Next.js 14 Specs (App Router) - NO LIMITS!
NEXTJS_SPECS = [
    # PAGE - APP ROUTER
    {
        "category": "frontend",
        "name": "nextjs",
        "spec_type": "page",
        "title": "App Router Page",
        "description": "Next.js 14 App Router page component with metadata",
        "content": """import { Metadata } from 'next'

export const metadata: Metadata = {
  title: '{Page Title}',
  description: '{Page Description}',
}

interface PageProps {
  params: { slug: string }
  searchParams: { [key: string]: string | string[] | undefined }
}

export default async function Page({ params, searchParams }: PageProps) {
  // Server-side data fetching
  const data = await fetch(`${process.env.API_URL}/api/data/${params.slug}`)
  const result = await data.json()

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-6">{result.title}</h1>
      <div className="prose max-w-none">
        {/* Content */}
      </div>
    </div>
  )
}""",
        "language": "typescript",
        "file_extensions": ["tsx", "ts"],
        "ignore_patterns": ["node_modules/*", ".next/*", "out/*"]
    },

    # LAYOUT
    {
        "category": "frontend",
        "name": "nextjs",
        "spec_type": "layout",
        "title": "Layout Component",
        "description": "Next.js App Router layout with providers",
        "content": """import { Inter } from 'next/font/google'
import { Metadata } from 'next'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: {
    default: '{App Name}',
    template: '%s | {App Name}',
  },
  description: '{App Description}',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="min-h-screen flex flex-col">
          <header>{/* Header */}</header>
          <main className="flex-1">{children}</main>
          <footer>{/* Footer */}</footer>
        </div>
      </body>
    </html>
  )
}""",
        "language": "typescript",
        "file_extensions": ["tsx"],
        "ignore_patterns": ["node_modules/*", ".next/*"]
    },

    # API ROUTE HANDLER
    {
        "category": "frontend",
        "name": "nextjs",
        "spec_type": "api_route",
        "title": "API Route Handler",
        "description": "Next.js 14 App Router API route handler",
        "content": """import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    // Fetch data
    const data = await fetchData(id)

    return NextResponse.json(data, { status: 200 })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch data' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Validate body
    if (!body.name) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      )
    }

    // Process data
    const result = await createData(body)

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create data' },
      { status: 500 }
    )
  }
}

async function fetchData(id: string | null) {
  // Implementation
}

async function createData(data: any) {
  // Implementation
}""",
        "language": "typescript",
        "file_extensions": ["ts"],
        "ignore_patterns": ["node_modules/*", ".next/*"]
    },

    # SERVER COMPONENT
    {
        "category": "frontend",
        "name": "nextjs",
        "spec_type": "server_component",
        "title": "Server Component",
        "description": "Next.js Server Component with data fetching",
        "content": """import { Suspense } from 'react'
import { Skeleton } from '@/components/ui/skeleton'

interface ComponentProps {
  id: string
}

async function getData(id: string) {
  const res = await fetch(`${process.env.API_URL}/api/data/${id}`, {
    next: { revalidate: 3600 }, // Cache for 1 hour
  })

  if (!res.ok) {
    throw new Error('Failed to fetch data')
  }

  return res.json()
}

export default async function ServerComponent({ id }: ComponentProps) {
  const data = await getData(id)

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">{data.title}</h2>
      <p className="text-muted-foreground">{data.description}</p>

      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <NestedComponent data={data.nested} />
      </Suspense>
    </div>
  )
}

async function NestedComponent({ data }: { data: any }) {
  // Parallel data fetching in nested component
  return <div>{/* Nested content */}</div>
}""",
        "language": "typescript",
        "file_extensions": ["tsx"],
        "ignore_patterns": ["node_modules/*", ".next/*"]
    },

    # CLIENT COMPONENT
    {
        "category": "frontend",
        "name": "nextjs",
        "spec_type": "client_component",
        "title": "Client Component",
        "description": "Next.js Client Component with state management",
        "content": """'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

interface ComponentProps {
  initialData?: any
}

export default function ClientComponent({ initialData }: ComponentProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [data, setData] = useState(initialData)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    // Client-side effects
  }, [])

  const handleAction = async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      })

      const result = await response.json()
      setData(result)
    } catch (error) {
      console.error('Action failed:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <button
        onClick={handleAction}
        disabled={isLoading}
        className="px-4 py-2 bg-primary text-primary-foreground rounded-md"
      >
        {isLoading ? 'Loading...' : 'Submit'}
      </button>
    </div>
  )
}""",
        "language": "typescript",
        "file_extensions": ["tsx"],
        "ignore_patterns": ["node_modules/*", ".next/*"]
    },

    # SERVER ACTIONS
    {
        "category": "frontend",
        "name": "nextjs",
        "spec_type": "server_action",
        "title": "Server Action",
        "description": "Next.js Server Action for form handling",
        "content": """'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email'),
  message: z.string().min(10, 'Message must be at least 10 characters'),
})

export async function submitForm(prevState: any, formData: FormData) {
  try {
    // Validate form data
    const validatedFields = schema.safeParse({
      name: formData.get('name'),
      email: formData.get('email'),
      message: formData.get('message'),
    })

    if (!validatedFields.success) {
      return {
        errors: validatedFields.error.flatten().fieldErrors,
        message: 'Validation failed',
      }
    }

    const { name, email, message } = validatedFields.data

    // Save to database
    await saveToDatabase({ name, email, message })

    // Revalidate cache
    revalidatePath('/submissions')
    revalidateTag('submissions')

  } catch (error) {
    return {
      message: 'Failed to submit form',
    }
  }

  redirect('/submissions/success')
}

async function saveToDatabase(data: any) {
  // Database logic
}""",
        "language": "typescript",
        "file_extensions": ["ts"],
        "ignore_patterns": ["node_modules/*", ".next/*"]
    },

    # MIDDLEWARE
    {
        "category": "frontend",
        "name": "nextjs",
        "spec_type": "middleware",
        "title": "Middleware",
        "description": "Next.js middleware for route protection and rewrites",
        "content": """import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  // Check authentication
  const token = request.cookies.get('token')?.value

  // Redirect to login if not authenticated
  if (!token && !request.nextUrl.pathname.startsWith('/login')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Add custom headers
  const response = NextResponse.next()
  response.headers.set('x-custom-header', 'value')

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|public).*)',
  ],
}""",
        "language": "typescript",
        "file_extensions": ["ts"],
        "ignore_patterns": ["node_modules/*", ".next/*"]
    },

    # LOADING STATE
    {
        "category": "frontend",
        "name": "nextjs",
        "spec_type": "loading",
        "title": "Loading State",
        "description": "Next.js loading.tsx for Suspense boundaries",
        "content": """import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="container mx-auto py-8 space-y-6">
      <Skeleton className="h-12 w-64" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="space-y-3">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  )
}""",
        "language": "typescript",
        "file_extensions": ["tsx"],
        "ignore_patterns": ["node_modules/*", ".next/*"]
    },

    # ERROR STATE
    {
        "category": "frontend",
        "name": "nextjs",
        "spec_type": "error",
        "title": "Error Boundary",
        "description": "Next.js error.tsx for error handling",
        "content": """'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log error to error reporting service
    console.error('Error:', error)
  }, [error])

  return (
    <div className="container mx-auto py-24">
      <div className="max-w-md mx-auto text-center space-y-6">
        <h2 className="text-2xl font-bold">Something went wrong!</h2>
        <p className="text-muted-foreground">{error.message}</p>
        <Button onClick={reset}>Try again</Button>
      </div>
    </div>
  )
}""",
        "language": "typescript",
        "file_extensions": ["tsx"],
        "ignore_patterns": ["node_modules/*", ".next/*"]
    },

    # NOT FOUND
    {
        "category": "frontend",
        "name": "nextjs",
        "spec_type": "not_found",
        "title": "Not Found Page",
        "description": "Next.js not-found.tsx for 404 errors",
        "content": """import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="container mx-auto py-24">
      <div className="max-w-md mx-auto text-center space-y-6">
        <h2 className="text-6xl font-bold">404</h2>
        <h3 className="text-2xl font-semibold">Page Not Found</h3>
        <p className="text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Button asChild>
          <Link href="/">Return Home</Link>
        </Button>
      </div>
    </div>
  )
}""",
        "language": "typescript",
        "file_extensions": ["tsx"],
        "ignore_patterns": ["node_modules/*", ".next/*"]
    },

    # CONTEXT PROVIDER
    {
        "category": "frontend",
        "name": "nextjs",
        "spec_type": "context",
        "title": "Context Provider",
        "description": "React Context provider for state management",
        "content": """'use client'

import React, { createContext, useContext, useState, useCallback } from 'react'

interface ContextState {
  data: any
  isLoading: boolean
  error: Error | null
}

interface ContextValue extends ContextState {
  fetchData: () => Promise<void>
  updateData: (data: any) => void
  clearError: () => void
}

const Context = createContext<ContextValue | undefined>(undefined)

export function ContextProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ContextState>({
    data: null,
    isLoading: false,
    error: null,
  })

  const fetchData = useCallback(async () => {
    setState(prev => ({ ...prev, isLoading: true }))
    try {
      const response = await fetch('/api/data')
      const data = await response.json()
      setState({ data, isLoading: false, error: null })
    } catch (error) {
      setState(prev => ({ ...prev, isLoading: false, error: error as Error }))
    }
  }, [])

  const updateData = useCallback((data: any) => {
    setState(prev => ({ ...prev, data }))
  }, [])

  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }))
  }, [])

  return (
    <Context.Provider value={{ ...state, fetchData, updateData, clearError }}>
      {children}
    </Context.Provider>
  )
}

export function useContextValue() {
  const context = useContext(Context)
  if (!context) {
    throw new Error('useContextValue must be used within ContextProvider')
  }
  return context
}""",
        "language": "typescript",
        "file_extensions": ["tsx"],
        "ignore_patterns": ["node_modules/*", ".next/*"]
    },

    # CUSTOM HOOK
    {
        "category": "frontend",
        "name": "nextjs",
        "spec_type": "hook",
        "title": "Custom React Hook",
        "description": "Reusable React hook",
        "content": """'use client'

import { useState, useEffect, useCallback } from 'react'

interface UseDataOptions {
  initialData?: any
  autoFetch?: boolean
}

interface UseDataReturn {
  data: any
  isLoading: boolean
  error: Error | null
  refetch: () => Promise<void>
  mutate: (newData: any) => void
}

export function useData(
  url: string,
  options: UseDataOptions = {}
): UseDataReturn {
  const { initialData = null, autoFetch = true } = options

  const [data, setData] = useState(initialData)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      const result = await response.json()
      setData(result)
    } catch (err) {
      setError(err as Error)
    } finally {
      setIsLoading(false)
    }
  }, [url])

  const mutate = useCallback((newData: any) => {
    setData(newData)
  }, [])

  useEffect(() => {
    if (autoFetch) {
      fetchData()
    }
  }, [autoFetch, fetchData])

  return {
    data,
    isLoading,
    error,
    refetch: fetchData,
    mutate,
  }
}""",
        "language": "typescript",
        "file_extensions": ["ts"],
        "ignore_patterns": ["node_modules/*", ".next/*"]
    },

    # UTILITY FUNCTIONS
    {
        "category": "frontend",
        "name": "nextjs",
        "spec_type": "utils",
        "title": "Utility Functions",
        "description": "Utility helper functions",
        "content": """import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge Tailwind CSS classes with proper precedence
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format date to readable string
 */
export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(date))
}

/**
 * Truncate text to specified length
 */
export function truncate(text: string, length: number): string {
  if (text.length <= length) return text
  return text.slice(0, length) + '...'
}

/**
 * Sleep utility for async operations
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      timeout = null
      func(...args)
    }

    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }
}""",
        "language": "typescript",
        "file_extensions": ["ts"],
        "ignore_patterns": ["node_modules/*", ".next/*"]
    },

    # TYPE DEFINITIONS
    {
        "category": "frontend",
        "name": "nextjs",
        "spec_type": "types",
        "title": "TypeScript Type Definitions",
        "description": "TypeScript interfaces and types",
        "content": """/**
 * Base entity interface
 */
export interface BaseEntity {
  id: string
  createdAt: Date
  updatedAt: Date
}

/**
 * API response wrapper
 */
export interface ApiResponse<T> {
  data: T
  message?: string
  error?: string
}

/**
 * Paginated response
 */
export interface PaginatedResponse<T> {
  data: T[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

/**
 * Form field error
 */
export interface FieldError {
  field: string
  message: string
}

/**
 * Form state
 */
export interface FormState {
  errors?: FieldError[]
  message?: string
  success?: boolean
}

/**
 * User type
 */
export interface User extends BaseEntity {
  name: string
  email: string
  image?: string
  role: 'admin' | 'user'
}

/**
 * API error
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: any
  ) {
    super(message)
    this.name = 'ApiError'
  }
}""",
        "language": "typescript",
        "file_extensions": ["ts"],
        "ignore_patterns": ["node_modules/*", ".next/*"]
    },

    # CONFIG FILE
    {
        "category": "frontend",
        "name": "nextjs",
        "spec_type": "config",
        "title": "Next.js Configuration",
        "description": "next.config.js with common optimizations",
        "content": """/** @type {import('next').NextConfig} */
const nextConfig = {
  // Strict mode
  reactStrictMode: true,

  // Image optimization
  images: {
    domains: ['example.com', 'cdn.example.com'],
    formats: ['image/avif', 'image/webp'],
  },

  // Environment variables
  env: {
    CUSTOM_KEY: process.env.CUSTOM_KEY,
  },

  // Redirects
  async redirects() {
    return [
      {
        source: '/old-path',
        destination: '/new-path',
        permanent: true,
      },
    ]
  },

  // Rewrites
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'https://api.example.com/:path*',
      },
    ]
  },

  // Headers
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
        ],
      },
    ]
  },

  // Webpack config
  webpack: (config, { isServer }) => {
    // Custom webpack configuration
    return config
  },
}

module.exports = nextConfig""",
        "language": "javascript",
        "file_extensions": ["js", "mjs"],
        "ignore_patterns": ["node_modules/*", ".next/*"]
    },

    # ENVIRONMENT TYPES
    {
        "category": "frontend",
        "name": "nextjs",
        "spec_type": "env",
        "title": "Environment Variables Types",
        "description": "TypeScript types for environment variables",
        "content": """namespace NodeJS {
  interface ProcessEnv {
    // App
    NEXT_PUBLIC_APP_URL: string
    NEXT_PUBLIC_APP_NAME: string

    // API
    NEXT_PUBLIC_API_URL: string
    API_SECRET_KEY: string

    // Database
    DATABASE_URL: string

    // Authentication
    NEXTAUTH_URL: string
    NEXTAUTH_SECRET: string
    GITHUB_ID: string
    GITHUB_SECRET: string

    // Third-party services
    STRIPE_SECRET_KEY: string
    STRIPE_WEBHOOK_SECRET: string

    // Analytics
    NEXT_PUBLIC_GA_ID: string

    // Feature flags
    NEXT_PUBLIC_ENABLE_ANALYTICS: string
  }
}

export {}""",
        "language": "typescript",
        "file_extensions": ["d.ts"],
        "ignore_patterns": ["node_modules/*", ".next/*"]
    },

    # METADATA
    {
        "category": "frontend",
        "name": "nextjs",
        "spec_type": "metadata",
        "title": "Dynamic Metadata",
        "description": "Generate dynamic metadata for SEO",
        "content": """import { Metadata } from 'next'

interface GenerateMetadataProps {
  params: { id: string }
  searchParams: { [key: string]: string | string[] | undefined }
}

export async function generateMetadata(
  { params, searchParams }: GenerateMetadataProps
): Promise<Metadata> {
  // Fetch data
  const data = await fetch(`${process.env.API_URL}/api/data/${params.id}`)
  const item = await data.json()

  return {
    title: item.title,
    description: item.description,
    openGraph: {
      title: item.title,
      description: item.description,
      images: [
        {
          url: item.imageUrl,
          width: 1200,
          height: 630,
          alt: item.title,
        },
      ],
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title: item.title,
      description: item.description,
      images: [item.imageUrl],
    },
    alternates: {
      canonical: `${process.env.NEXT_PUBLIC_APP_URL}/${params.id}`,
    },
  }
}""",
        "language": "typescript",
        "file_extensions": ["ts", "tsx"],
        "ignore_patterns": ["node_modules/*", ".next/*"]
    },
]


def seed_specs():
    """Seed Next.js specs into database"""
    db = SessionLocal()

    try:
        print(f"🌱 Seeding {len(NEXTJS_SPECS)} Next.js specs...")

        created_count = 0
        updated_count = 0

        for spec_data in NEXTJS_SPECS:
            # Check if spec already exists
            existing = db.query(Spec).filter(
                Spec.category == spec_data["category"],
                Spec.name == spec_data["name"],
                Spec.spec_type == spec_data["spec_type"]
            ).first()

            if existing:
                # Update existing spec
                for key, value in spec_data.items():
                    setattr(existing, key, value)
                updated_count += 1
                print(f"   ↻ Updated: {spec_data['spec_type']} - {spec_data['title']}")
            else:
                # Create new spec
                spec = Spec(id=uuid4(), **spec_data)
                db.add(spec)
                created_count += 1
                print(f"   ✓ Created: {spec_data['spec_type']} - {spec_data['title']}")

        db.commit()
        print(f"\n✅ Next.js specs seeded successfully!")
        print(f"   📦 Created: {created_count}")
        print(f"   🔄 Updated: {updated_count}")
        print(f"   📊 Total: {len(NEXTJS_SPECS)} specs")

    except Exception as e:
        db.rollback()
        print(f"❌ Error seeding specs: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_specs()

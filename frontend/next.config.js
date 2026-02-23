/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable React strict mode for better development experience
  reactStrictMode: true,

  // Skip type checking during build (handled by IDE/CI)
  typescript: {
    ignoreBuildErrors: true,
  },

  // Skip ESLint during build (handled by IDE/CI)
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Output standalone for optimized production builds
  output: 'standalone',

  // Environment variables exposed to the browser
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME || 'Orbit',
  },

  // Experimental features
  experimental: {
    // Enable server actions
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },

  // Image optimization
  images: {
    domains: [],
    unoptimized: process.env.NODE_ENV === 'development',
  },

  // Disable x-powered-by header
  poweredByHeader: false,
}

module.exports = nextConfig

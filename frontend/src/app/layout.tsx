import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { ClientProviders } from '@/components/providers/ClientProviders'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: 'Orbit',
  description: 'AI-powered development orchestration system with dynamic prompting architecture',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body className="min-h-screen antialiased">
        <ClientProviders>
          <div className="flex min-h-screen flex-col">
            {/* Main content */}
            <main className="flex-1">{children}</main>
          </div>
        </ClientProviders>
      </body>
    </html>
  )
}

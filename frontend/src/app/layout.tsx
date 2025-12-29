import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: 'AI Orchestrator',
  description: 'Sistema de Orquestração de IA para criação e gerenciamento de aplicações',
  viewport: 'width=device-width, initial-scale=1',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body className="min-h-screen antialiased">
        <div className="flex min-h-screen flex-col">
          {/* Header/Navigation will go here */}
          <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/80 backdrop-blur-sm">
            <div className="container flex h-16 items-center justify-between">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-primary-600">
                  {process.env.NEXT_PUBLIC_APP_NAME || 'AI Orchestrator'}
                </h1>
              </div>
              <nav className="flex items-center gap-4">
                {/* Navigation items will be added here */}
              </nav>
            </div>
          </header>

          {/* Main content */}
          <main className="flex-1">{children}</main>

          {/* Footer */}
          <footer className="border-t border-gray-200 bg-gray-50">
            <div className="container py-6 text-center text-sm text-gray-600">
              <p>AI Orchestrator v0.1.0 - Sistema de Orquestração de IA</p>
            </div>
          </footer>
        </div>
      </body>
    </html>
  )
}

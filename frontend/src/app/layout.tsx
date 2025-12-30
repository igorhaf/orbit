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

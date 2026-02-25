/**
 * Navbar Component
 * Top navigation bar — logo, nav links, actions
 * PROMPT #128 - Added NotificationBell for background job notifications
 * PROMPT #265 - Migrated from sidebar to topbar navigation
 */

'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NotificationBell } from '@/components/ui/NotificationBell';

const navigation = [
  { name: 'Painel', href: '/' },
  { name: 'Projetos', href: '/projects' },
  { name: 'Prompts', href: '/prompts' },
  { name: 'Modelos IA', href: '/ai-models' },
  { name: 'AI Studio', href: '/ai-flow' },
  { name: 'RAG', href: '/rag' },
  { name: 'Jobs', href: '/jobs' },
];

export const Navbar: React.FC = () => {
  const appName = process.env.NEXT_PUBLIC_APP_NAME || 'Orbit';
  const pathname = usePathname();

  return (
    <nav className="bg-white border-b border-gray-200 fixed w-full z-30 top-0">
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex items-center h-[45px] gap-6">

          {/* Logo */}
          <Link href="/" className="flex items-center space-x-2 flex-shrink-0">
            <div className="w-7 h-7 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="3" strokeWidth="2" fill="currentColor" />
                <ellipse cx="12" cy="12" rx="9" ry="4" strokeWidth="1.5" fill="none" opacity="0.8" />
                <ellipse cx="12" cy="12" rx="9" ry="4" strokeWidth="1.5" fill="none" opacity="0.6" transform="rotate(60 12 12)" />
                <ellipse cx="12" cy="12" rx="9" ry="4" strokeWidth="1.5" fill="none" opacity="0.4" transform="rotate(-60 12 12)" />
              </svg>
            </div>
            <span className="text-lg font-bold text-gray-900">{appName}</span>
          </Link>

          {/* Divider */}
          <div className="h-5 w-px bg-gray-200 flex-shrink-0" />

          {/* Nav links — center */}
          <div className="flex items-center gap-1 flex-1">
            {navigation.map((item) => {
              const isActive = item.href === '/'
                ? pathname === '/'
                : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  {item.name}
                </Link>
              );
            })}
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <NotificationBell />

            {/* Settings */}
            <Link
              href="/settings"
              className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
              title="Configurações"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </Link>

            {/* Console — external */}
            <a
              href="/console"
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
              title="Console"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </a>
          </div>

        </div>
      </div>
    </nav>
  );
};

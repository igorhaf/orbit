/**
 * Navbar Component
 * Top navigation bar with app branding and user actions
 */

'use client';

import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui';

export const Navbar: React.FC = () => {
  const appName = process.env.NEXT_PUBLIC_APP_NAME || 'Orbit';

  return (
    <nav className="bg-white border-b border-gray-200 fixed w-full z-30 top-0">
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-[45px]">
          {/* Logo and Brand */}
          <div className="flex items-center">
            <Link href="/" className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
                <svg
                  className="w-5 h-5 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  {/* Planet/Core */}
                  <circle cx="12" cy="12" r="3" strokeWidth="2" fill="currentColor" />
                  {/* Orbital ring 1 */}
                  <ellipse
                    cx="12"
                    cy="12"
                    rx="9"
                    ry="4"
                    strokeWidth="1.5"
                    fill="none"
                    opacity="0.8"
                  />
                  {/* Orbital ring 2 */}
                  <ellipse
                    cx="12"
                    cy="12"
                    rx="9"
                    ry="4"
                    strokeWidth="1.5"
                    fill="none"
                    opacity="0.6"
                    transform="rotate(60 12 12)"
                  />
                  {/* Orbital ring 3 */}
                  <ellipse
                    cx="12"
                    cy="12"
                    rx="9"
                    ry="4"
                    strokeWidth="1.5"
                    fill="none"
                    opacity="0.4"
                    transform="rotate(-60 12 12)"
                  />
                </svg>
              </div>
              <span className="text-xl font-bold text-gray-900">
                {appName}
              </span>
            </Link>
          </div>

          {/* Right side actions */}
          <div className="flex items-center space-x-4">
            {/* Settings */}
            <Link href="/settings">
              <Button variant="ghost" size="sm">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
};

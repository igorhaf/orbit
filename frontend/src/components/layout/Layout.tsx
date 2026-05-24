/**
 * Main Layout Component
 * Combines Navbar with content area
 * PROMPT #265 - Removed sidebar, now using topbar navigation
 */

'use client';

import React from 'react';
import { Navbar } from './Navbar';
import { QuotaBanner } from '@/components/ui/QuotaBanner';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="pt-[45px]">
        <QuotaBanner />
        <div className="px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </div>
      </main>
    </div>
  );
};

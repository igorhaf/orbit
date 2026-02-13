/**
 * Main Layout Component
 * Combines Navbar and Sidebar with content area
 * PROMPT #250 - Collapsible sidebar with localStorage persistence
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Navbar } from './Navbar';
import { Sidebar } from './Sidebar';

const SIDEBAR_KEY = 'orbit-sidebar-collapsed';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    if (saved === 'true') setCollapsed(true);
  }, []);

  const handleToggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_KEY, String(next));
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <Sidebar collapsed={collapsed} onToggle={handleToggle} />
      <main
        className="pt-[45px] transition-all duration-200"
        style={{ paddingLeft: collapsed ? 56 : 180 }}
      >
        <div className="px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </div>
      </main>
    </div>
  );
};

/**
 * Breadcrumbs Component
 * Shows navigation path and allows quick navigation to parent pages
 */

'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface BreadcrumbItem {
  name: string;
  href: string;
}

export const Breadcrumbs: React.FC = () => {
  const pathname = usePathname();

  // Don't show breadcrumbs on home page
  if (pathname === '/') return null;

  // UUID regex pattern
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // Helper function to check if a segment is a UUID
  const isUUID = (segment: string): boolean => {
    return UUID_PATTERN.test(segment);
  };

  // Custom labels for specific routes
  const routeLabels: Record<string, string> = {
    'ai-models': 'AI Models',
    'ai-executions': 'AI Executions',
    'ai-config': 'AI Config',
    'specs': 'Specs',
    'prompts': 'Prompts',
    'projects': 'Projects',
    'interviews': 'Interviews',
    'commits': 'Commits',
    'settings': 'Settings',
    'debug': 'Debug',
    'new': 'New',
    'edit': 'Edit',
    'generate': 'Generate',
    'analyze': 'Analyze',
    'consistency': 'Consistency Check',
    'execute': 'Execute',
    'models': 'Models',
  };

  // Labels for UUID segments based on parent context
  const getUUIDLabel = (parentSegment: string | undefined): string => {
    if (!parentSegment) return 'Details';

    switch (parentSegment) {
      case 'interviews':
        return 'Interview';
      case 'projects':
        return 'Project';
      case 'tasks':
        return 'Task';
      case 'prompts':
        return 'Prompt';
      case 'ai-models':
        return 'Model';
      case 'commits':
        return 'Commit';
      default:
        return 'Details';
    }
  };

  // Build breadcrumb path
  const pathSegments = pathname.split('/').filter(Boolean);

  const breadcrumbs: BreadcrumbItem[] = [
    { name: 'Home', href: '/' },
    ...pathSegments.map((segment, index) => {
      const href = '/' + pathSegments.slice(0, index + 1).join('/');
      const parentSegment = index > 0 ? pathSegments[index - 1] : undefined;

      // Check if segment is a UUID
      if (isUUID(segment)) {
        const name = getUUIDLabel(parentSegment);
        return { name, href };
      }

      // Use custom label if available, otherwise capitalize
      const name = routeLabels[segment] || segment
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

      return { name, href };
    }),
  ];

  return (
    <nav className="flex mb-6" aria-label="Breadcrumb">
      <ol className="flex items-center space-x-2">
        {breadcrumbs.map((breadcrumb, index) => {
          const isLast = index === breadcrumbs.length - 1;

          return (
            <li key={breadcrumb.href} className="flex items-center">
              {index > 0 && (
                <svg
                  className="flex-shrink-0 mx-2 h-4 w-4 text-gray-400"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              )}

              {isLast ? (
                <span className="text-sm font-medium text-gray-900">
                  {breadcrumb.name}
                </span>
              ) : (
                <Link
                  href={breadcrumb.href}
                  className="text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
                >
                  {breadcrumb.name}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

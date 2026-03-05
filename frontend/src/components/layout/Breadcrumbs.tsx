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

  // Routes that don't have list pages (only detail pages)
  // These segments should be skipped in breadcrumbs
  // PROMPT #130 - 'interviews' is a tab inside project page, not a separate page
  const segmentsWithoutListPages = new Set<string>(['interviews']);

  // Custom labels for specific routes
  const routeLabels: Record<string, string> = {
    'ai-models': 'Modelos IA',
    'ai-executions': 'Execucoes IA',
    'ai-config': 'Config IA',
    'ai-flow': 'AI Studio',
    'contracts': 'Contratos',
    'prompts': 'Prompts',
    'projects': 'Projetos',
    'interviews': 'Entrevistas',
    'settings': 'Configurações',
    'debug': 'Debug',
    'new': 'Novo',
    'edit': 'Editar',
    'generate': 'Gerar',
    'analyze': 'Analisar',
    'consistency': 'Verificação de Consistencia',
    'wiki': 'Wiki',
    'execute': 'Executar',
    'models': 'Modelos',
    'analytics': 'Analytics',
    'tokens': 'Tokens & Desempenho',
    'costs': 'Custos Financeiros',
  };

  // Labels for UUID segments based on parent context
  const getUUIDLabel = (parentSegment: string | undefined): string => {
    if (!parentSegment) return 'Detalhes';

    switch (parentSegment) {
      case 'interviews':
        return 'Entrevista';
      case 'projects':
        return 'Projeto';
      case 'tasks':
        return 'Tarefa';
      case 'prompts':
        return 'Prompt';
      case 'ai-models':
        return 'Modelo';
      default:
        return 'Detalhes';
    }
  };

  // Build breadcrumb path
  const pathSegments = pathname.split('/').filter(Boolean);

  const breadcrumbs: BreadcrumbItem[] = [
    { name: 'Início', href: '/' },
    ...pathSegments
      .map((segment, index) => {
        const href = '/' + pathSegments.slice(0, index + 1).join('/');
        const parentSegment = index > 0 ? pathSegments[index - 1] : undefined;
        const nextSegment = index < pathSegments.length - 1 ? pathSegments[index + 1] : undefined;

        // Skip segments that don't have list pages if next segment is a UUID
        if (segmentsWithoutListPages.has(segment) && nextSegment && isUUID(nextSegment)) {
          return null;
        }

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
      })
      .filter((item): item is BreadcrumbItem => item !== null),
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

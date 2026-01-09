/**
 * SpecViewer Component
 * Display and navigate project specifications
 */

import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

interface Specification {
  id: string;
  project_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

interface Props {
  specification: Specification | null;
  onEdit?: () => void;
  readOnly?: boolean;
}

export function SpecViewer({ specification, onEdit, readOnly = false }: Props) {
  const [viewMode, setViewMode] = useState<'formatted' | 'raw'>('formatted');

  if (!specification) {
    return (
      <Card>
        <CardContent className="py-16">
          <div className="text-center text-gray-500">
            <svg
              className="w-16 h-16 mx-auto mb-4 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <p className="text-lg font-medium">No specification available</p>
            <p className="text-sm mt-2">
              Create a specification to define your project requirements
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Parse markdown-like content into sections
  const parseContent = (content: string) => {
    const lines = content.split('\n');
    const sections: Array<{ title: string; content: string; level: number }> = [];
    let currentSection: { title: string; content: string; level: number } | null = null;

    lines.forEach((line) => {
      const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headerMatch) {
        if (currentSection) {
          sections.push(currentSection);
        }
        currentSection = {
          title: headerMatch[2],
          content: '',
          level: headerMatch[1].length,
        };
      } else if (currentSection) {
        currentSection.content += line + '\n';
      }
    });

    if (currentSection) {
      sections.push(currentSection);
    }

    return sections;
  };

  const sections = parseContent(specification.content);

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Project Specification</CardTitle>
              <p className="text-sm text-gray-600 mt-1">
                Last updated: {new Date(specification.updated_at).toLocaleString()}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setViewMode('formatted')}
                  className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                    viewMode === 'formatted'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Formatted
                </button>
                <button
                  onClick={() => setViewMode('raw')}
                  className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                    viewMode === 'raw'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Raw
                </button>
              </div>
              {!readOnly && onEdit && (
                <Button variant="outline" size="sm" onClick={onEdit}>
                  <svg
                    className="w-4 h-4 mr-1"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                    />
                  </svg>
                  Edit
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Content */}
      {viewMode === 'formatted' ? (
        <div className="space-y-4">
          {sections.map((section, index) => (
            <Card key={index}>
              <CardHeader>
                <CardTitle
                  className={
                    section.level === 1
                      ? 'text-2xl'
                      : section.level === 2
                      ? 'text-xl'
                      : 'text-lg'
                  }
                >
                  {section.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="prose prose-sm max-w-none">
                  {section.content.split('\n').map((line, lineIndex) => {
                    // Parse lists
                    if (line.match(/^[-*]\s+/)) {
                      return (
                        <li key={lineIndex} className="ml-4">
                          {line.replace(/^[-*]\s+/, '')}
                        </li>
                      );
                    }
                    // Parse code blocks
                    if (line.match(/^```/)) {
                      return null;
                    }
                    // Parse inline code
                    const codeMatch = line.match(/`([^`]+)`/g);
                    if (codeMatch) {
                      const parts = line.split(/`([^`]+)`/);
                      return (
                        <p key={lineIndex} className="mb-2">
                          {parts.map((part, i) =>
                            i % 2 === 1 ? (
                              <code
                                key={i}
                                className="bg-gray-100 px-1 py-0.5 rounded text-sm font-mono"
                              >
                                {part}
                              </code>
                            ) : (
                              <span key={i}>{part}</span>
                            )
                          )}
                        </p>
                      );
                    }
                    // Regular paragraph
                    if (line.trim()) {
                      return (
                        <p key={lineIndex} className="mb-2 text-gray-700">
                          {line}
                        </p>
                      );
                    }
                    return null;
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="bg-gray-900 rounded-lg p-6 font-mono text-sm text-gray-100 overflow-auto max-h-[600px]">
              <pre className="whitespace-pre-wrap">{specification.content}</pre>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Table of Contents */}
      {viewMode === 'formatted' && sections.length > 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Table of Contents</CardTitle>
          </CardHeader>
          <CardContent>
            <nav className="space-y-1">
              {sections.map((section, index) => (
                <a
                  key={index}
                  href={`#section-${index}`}
                  className={`block py-1 text-sm hover:text-blue-600 transition-colors ${
                    section.level === 1
                      ? 'font-semibold text-gray-900'
                      : section.level === 2
                      ? 'pl-4 text-gray-700'
                      : 'pl-8 text-gray-600'
                  }`}
                >
                  {section.title}
                </a>
              ))}
            </nav>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * Code Files Browser
 * PROMPT #238 - Individual page showing all indexed code files
 *
 * Wiki-style layout with sidebar listing languages and main content
 * showing a table of all code files.
 */

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Layout, Breadcrumbs } from '@/components/layout';
import {  Card , Spinner } from '@/components/ui';
import { projectsApi, knowledgeApi } from '@/lib/api';

interface CodeFile {
  id: string;
  file_path: string;
  language: string;
  source: string;
  created_at: string | null;
}

const LANG_COLORS: Record<string, string> = {
  python: 'bg-yellow-100 text-yellow-800',
  javascript: 'bg-yellow-50 text-yellow-700',
  typescript: 'bg-blue-100 text-blue-800',
  php: 'bg-indigo-100 text-indigo-800',
  java: 'bg-red-100 text-red-800',
  ruby: 'bg-red-50 text-red-700',
  go: 'bg-cyan-100 text-cyan-800',
  rust: 'bg-orange-100 text-orange-800',
  css: 'bg-pink-100 text-pink-800',
  html: 'bg-orange-50 text-orange-700',
  sql: 'bg-green-100 text-green-800',
  shell: 'bg-gray-100 text-gray-800',
  yaml: 'bg-purple-50 text-purple-700',
  json: 'bg-green-50 text-green-700',
  markdown: 'bg-gray-50 text-gray-700',
  unknown: 'bg-gray-100 text-gray-600',
};

export default function CodeFilesPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [project, setProject] = useState<any>(null);
  const [files, setFiles] = useState<CodeFile[]>([]);
  const [byLanguage, setByLanguage] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeLanguage, setActiveLanguage] = useState<string | null>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [proj, codeFiles] = await Promise.all([
        projectsApi.get(projectId),
        knowledgeApi.getCodeFiles(projectId),
      ]);
      setProject(proj.data || proj);
      setFiles(codeFiles.files);
      setByLanguage(codeFiles.by_language);
      setTotal(codeFiles.total);
    } catch (error) {
      console.error('Failed to load code files:', error);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const scrollToLanguage = (lang: string) => {
    setActiveLanguage(lang);
    const el = sectionRefs.current[lang];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Group files by language
  const filesByLanguage: Record<string, CodeFile[]> = {};
  for (const file of files) {
    const lang = file.language || 'unknown';
    if (!filesByLanguage[lang]) filesByLanguage[lang] = [];
    filesByLanguage[lang].push(file);
  }

  // Sort languages by count desc
  const sortedLanguages = Object.entries(byLanguage)
    .sort(([, a], [, b]) => b - a)
    .map(([lang]) => lang);

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <Spinner size="xl" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <Breadcrumbs />

      <div className="flex gap-6">
        {/* Sidebar */}
        <div className="w-64 flex-shrink-0 hidden lg:block">
          <Card className="p-3 sticky top-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Linguagens</h2>
              <span className="text-xs text-gray-400">{total} arquivos</span>
            </div>
            <div className="space-y-0.5">
              {sortedLanguages.map((lang) => (
                <button
                  key={lang}
                  onClick={() => scrollToLanguage(lang)}
                  className={`w-full text-left px-3 py-1.5 rounded text-sm transition-colors flex items-center justify-between ${
                    activeLanguage === lang
                      ? 'bg-blue-100 text-blue-700 font-medium'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  <span className="truncate">{lang}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                    activeLanguage === lang ? 'bg-blue-200 text-blue-800' : 'bg-gray-200 text-gray-600'
                  }`}>
                    {byLanguage[lang]}
                  </span>
                </button>
              ))}
            </div>
          </Card>
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          {/* Page Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push(`/projects/${projectId}`)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <h1 className="text-2xl font-bold text-gray-900">Arquivos de Código</h1>
              <span className="px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700">{total} arquivos</span>
            </div>
          </div>

          {/* Metadata */}
          <div className="text-xs text-gray-400 mb-4">
            {project?.name} — {sortedLanguages.length} linguagens detectadas
          </div>

          {/* Content - sections by language */}
          {sortedLanguages.map((lang) => {
            const langFiles = filesByLanguage[lang] || [];
            return (
              <div
                key={lang}
                ref={(el) => { sectionRefs.current[lang] = el; }}
                className="mb-6"
              >
                <Card className="p-0 overflow-hidden">
                  <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${LANG_COLORS[lang] || LANG_COLORS.unknown}`}>
                        {lang}
                      </span>
                      <span className="text-sm font-medium text-gray-700">{langFiles.length} arquivos</span>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="text-left py-2 px-4 text-xs font-medium text-gray-500">Arquivo</th>
                          <th className="text-left py-2 px-4 text-xs font-medium text-gray-500 w-32">Fonte</th>
                          <th className="text-left py-2 px-4 text-xs font-medium text-gray-500 w-36">Data</th>
                        </tr>
                      </thead>
                      <tbody>
                        {langFiles.map((file) => (
                          <tr key={file.id} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="py-1.5 px-4">
                              <span className="font-mono text-xs text-gray-700">{file.file_path}</span>
                            </td>
                            <td className="py-1.5 px-4">
                              <span className="text-xs text-gray-500">{file.source.replace(/_/g, ' ')}</span>
                            </td>
                            <td className="py-1.5 px-4">
                              <span className="text-xs text-gray-400">
                                {file.created_at ? new Date(file.created_at).toLocaleDateString('pt-BR') : '-'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
            );
          })}
        </div>
      </div>
    </Layout>
  );
}

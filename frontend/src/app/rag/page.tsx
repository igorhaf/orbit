/**
 * RAG Analytics Dashboard Page
 *
 * PROMPT #117 - Project-specific RAG
 * PROMPT #172 - Projects Comparison Table
 *
 * Dedicated page for RAG (Retrieval-Augmented Generation) analytics:
 * - Projects comparison table showing RAG stats per project
 * - Global knowledge stats (framework specs, PROMPT docs)
 * - Navigate to individual project RAG details
 */

'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Layout, Breadcrumbs } from '@/components/layout';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
} from '@/components/ui';
import { knowledgeApi } from '@/lib/api';
import {
  Database,
  RefreshCw,
  FileText,
  FolderOpen,
  AlertCircle,
  MessageSquare,
  BookOpen,
  Code,
  Tags,
} from 'lucide-react';

// Types for the projects stats response
interface ProjectStats {
  project_id: string;
  project_name: string;
  total_documents: number;
  code_files: number;
  cards: number;
  business_rules: number;
  interview_answers: number;
  project_context: number;
  documents: number;
}

interface ProjectsStatsResponse {
  success: boolean;
  projects: ProjectStats[];
  totals: {
    total_documents: number;
    code_files: number;
    cards: number;
    business_rules: number;
    interview_answers: number;
    project_context: number;
    documents: number;
  };
}

export default function RagPage() {
  const router = useRouter();
  const [projectsStats, setProjectsStats] = useState<ProjectsStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch all projects stats
  const fetchProjectsStats = useCallback(async () => {
    setLoading(true);
    try {
      const response = await knowledgeApi.getProjectsStats();
      if (response.success) {
        setProjectsStats(response);
      }
    } catch (error) {
      console.error('Error fetching projects RAG stats:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjectsStats();
  }, [fetchProjectsStats]);

  // Navigate to project RAG tab
  const goToProjectRag = (projectId: string) => {
    router.push(`/projects/${projectId}?tab=rag`);
  };

  // Navigate to project knowledge page
  const goToProjectKnowledge = (projectId: string) => {
    router.push(`/projects/${projectId}/knowledge`);
  };

  if (loading) {
    return (
      <Layout>
        <Breadcrumbs />
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Carregando estatisticas RAG...</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <Breadcrumbs />
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-100 rounded-lg">
              <Database className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Analitico RAG</h1>
              <p className="text-gray-600 mt-1">
                Estatisticas da base de conhecimento para todos os projetos
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={fetchProjectsStats}
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>

        {/* Global Knowledge Section removed - specs are per-project only */}

        {/* Projects Comparison Table */}
        {!projectsStats || projectsStats.projects.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <AlertCircle className="w-16 h-16 mx-auto text-gray-300 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Nenhum Projeto Encontrado</h3>
              <p className="text-gray-600 mb-4">
                Crie um projeto para comecar a construir sua base de conhecimento.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-blue-600" />
                Comparação RAG dos Projetos
                <span className="text-sm font-normal text-gray-500 ml-2">({projectsStats.projects.length} projetos)</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-3 px-4 font-medium text-gray-700">Projeto</th>
                      <th className="text-center py-3 px-2 font-medium text-gray-700">
                        <div className="flex flex-col items-center">
                          <Package className="w-4 h-4 text-purple-600 mb-1" />
                          <span className="text-xs">Total</span>
                        </div>
                      </th>
                      <th className="text-center py-3 px-2 font-medium text-gray-700">
                        <div className="flex flex-col items-center">
                          <Code className="w-4 h-4 text-blue-600 mb-1" />
                          <span className="text-xs">Código</span>
                        </div>
                      </th>
                      <th className="text-center py-3 px-2 font-medium text-gray-700">
                        <div className="flex flex-col items-center">
                          <Tags className="w-4 h-4 text-green-600 mb-1" />
                          <span className="text-xs">Cards</span>
                        </div>
                      </th>
                      <th className="text-center py-3 px-2 font-medium text-gray-700">
                        <div className="flex flex-col items-center">
                          <BookOpen className="w-4 h-4 text-orange-600 mb-1" />
                          <span className="text-xs">Regras</span>
                        </div>
                      </th>
                      <th className="text-center py-3 px-2 font-medium text-gray-700">
                        <div className="flex flex-col items-center">
                          <MessageSquare className="w-4 h-4 text-yellow-600 mb-1" />
                          <span className="text-xs">Respostas</span>
                        </div>
                      </th>
                      <th className="text-center py-3 px-2 font-medium text-gray-700">
                        <div className="flex flex-col items-center">
                          <FileText className="w-4 h-4 text-gray-600 mb-1" />
                          <span className="text-xs">Docs</span>
                        </div>
                      </th>
                      <th className="text-center py-3 px-2 font-medium text-gray-700">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectsStats.projects.map((project) => (
                      <tr
                        key={project.project_id}
                        className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                      >
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <FolderOpen className="w-4 h-4 text-gray-400" />
                            <span className="font-medium text-gray-900">{project.project_name}</span>
                          </div>
                        </td>
                        <td className="text-center py-3 px-2">
                          <span className={`font-bold ${project.total_documents > 0 ? 'text-purple-700' : 'text-gray-400'}`}>
                            {project.total_documents}
                          </span>
                        </td>
                        <td className="text-center py-3 px-2">
                          <span className={`${project.code_files > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                            {project.code_files}
                          </span>
                        </td>
                        <td className="text-center py-3 px-2">
                          <span className={`${project.cards > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                            {project.cards}
                          </span>
                        </td>
                        <td className="text-center py-3 px-2">
                          <span className={`${project.business_rules > 0 ? 'text-orange-600' : 'text-gray-400'}`}>
                            {project.business_rules}
                          </span>
                        </td>
                        <td className="text-center py-3 px-2">
                          <span className={`${project.interview_answers > 0 ? 'text-yellow-600' : 'text-gray-400'}`}>
                            {project.interview_answers}
                          </span>
                        </td>
                        <td className="text-center py-3 px-2">
                          <span className={`${project.documents > 0 ? 'text-gray-600' : 'text-gray-400'}`}>
                            {project.documents}
                          </span>
                        </td>
                        <td className="text-center py-3 px-2">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => goToProjectRag(project.project_id)}
                              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title="Ver Analitico RAG"
                            >
                              <Database className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => goToProjectKnowledge(project.project_id)}
                              className="p-1.5 text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                              title="Gerenciar Base de Conhecimento"
                            >
                              <BookOpen className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {/* Totals Row */}
                    <tr className="bg-gray-50 font-semibold">
                      <td className="py-3 px-4 text-gray-900">
                        TOTAL ({projectsStats.projects.length} projetos)
                      </td>
                      <td className="text-center py-3 px-2 text-purple-700">
                        {projectsStats.totals.total_documents}
                      </td>
                      <td className="text-center py-3 px-2 text-blue-600">
                        {projectsStats.totals.code_files}
                      </td>
                      <td className="text-center py-3 px-2 text-green-600">
                        {projectsStats.totals.cards}
                      </td>
                      <td className="text-center py-3 px-2 text-orange-600">
                        {projectsStats.totals.business_rules}
                      </td>
                      <td className="text-center py-3 px-2 text-yellow-600">
                        {projectsStats.totals.interview_answers}
                      </td>
                      <td className="text-center py-3 px-2 text-gray-600">
                        {projectsStats.totals.documents}
                      </td>
                      <td className="text-center py-3 px-2">—</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Legend */}
              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                  <div className="flex items-center gap-1">
                    <Code className="w-3 h-3 text-blue-600" />
                    <span>Código = Arquivos de código indexados</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Tags className="w-3 h-3 text-green-600" />
                    <span>Cards = Epicos, Stories, Tasks, Subtasks</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <BookOpen className="w-3 h-3 text-orange-600" />
                    <span>Regras = Regras de negocio</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <MessageSquare className="w-3 h-3 text-yellow-600" />
                    <span>Respostas = Respostas de entrevista</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <FileText className="w-3 h-3 text-gray-600" />
                    <span>Docs = Documentos enviados</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Info Card */}
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <Database className="w-5 h-5 text-blue-600 mt-0.5" />
              <div>
                <h4 className="font-medium text-blue-900">Sobre RAG no ORBIT</h4>
                <p className="text-sm text-blue-700 mt-1">
                  Cada projeto tem sua própria base de conhecimento RAG (Retrieval-Augmented Generation) isolada.
                  O ORBIT orquestra esses RAGs por projeto para fornecer respostas de IA com contexto.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

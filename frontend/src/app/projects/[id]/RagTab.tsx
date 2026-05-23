'use client';

/**
 * RagTab - RAG Analytics Tab Component
 * Extracted from project detail page (PROMPT #232)
 * Shows RAG stats, document storage, continuous RAG, and code indexing panels
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, Button, ConfirmDialog } from '@/components/ui';
import { Spinner } from '@/components/ui';
import { RagStatsCard, RagUsageTypeTable, RagHitRatePieChart, CodeIndexingPanel, ContinuousRAGPanel } from '@/components/rag';
import { RagStats, CodeIndexingStats } from '@/lib/types';

interface KnowledgeStats {
  total_documents: number;
  business_rules_count: number;
  interview_answers_count: number;
  code_files_count: number;
  documents_count: number;
  by_category: Record<string, number>;
  by_source: Record<string, number>;
}

interface RagTabProps {
  projectId: string;
  loadingRag: boolean;
  ragStats: RagStats | null;
  knowledgeStats: KnowledgeStats | null;
  codeStats: CodeIndexingStats | null;
  loadRagStats: () => void;
}

export default function RagTab({
  projectId,
  loadingRag,
  ragStats,
  knowledgeStats,
  codeStats,
  loadRagStats,
}: RagTabProps) {
  const router = useRouter();
  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const [exportConfirmOpen, setExportConfirmOpen] = useState(false);
  const [exportPreview, setExportPreview] = useState<any | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<any | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const openExportPreview = async () => {
    setExportPreview(null);
    setExportError(null);
    setExportResult(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/projects/${projectId}/business-rules/export-as-tasks?dry_run=true`,
        { method: 'POST' }
      );
      const data = await res.json();
      if (!res.ok) {
        setExportError(data?.detail || 'Falha ao consultar regras');
        return;
      }
      setExportPreview(data);
      setExportConfirmOpen(true);
    } catch (e: any) {
      setExportError(e?.message || 'erro ao consultar regras');
    }
  };

  const confirmExport = async () => {
    setExporting(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/projects/${projectId}/business-rules/export-as-tasks`,
        { method: 'POST' }
      );
      const data = await res.json();
      if (!res.ok) {
        setExportError(data?.detail || 'Falha ao exportar');
        return;
      }
      setExportResult(data);
      setExportConfirmOpen(false);
    } catch (e: any) {
      setExportError(e?.message || 'erro ao exportar');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {loadingRag ? (
        <div className="flex items-center justify-center py-12">
          <svg className="animate-spin h-8 w-8 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
      ) : (
        <>
          {/* RAG Stats - only show if we have data */}
          {ragStats && ragStats.total_rag_enabled > 0 ? (
            <>
              {/* Stats Cards */}
              <RagStatsCard stats={ragStats} />

              {/* Charts and Table */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <RagHitRatePieChart usageTypes={ragStats.by_usage_type} />
                <RagUsageTypeTable usageTypes={ragStats.by_usage_type} />
              </div>
            </>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-gray-500">
                <p>Nenhum dado RAG disponível ainda</p>
                <p className="text-sm mt-2">Indexe seu código abaixo para habilitar operações de IA aprimoradas por RAG</p>
              </CardContent>
            </Card>
          )}

          {/* PROMPT #172 - Document Storage Stats */}
          {knowledgeStats && knowledgeStats.total_documents > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  Armazenamento de Documentos
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-purple-50 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-purple-700">{knowledgeStats.total_documents}</div>
                    <div className="text-xs text-purple-600">Total de Documentos</div>
                  </div>
                  <div
                    className="bg-blue-50 rounded-lg p-4 text-center cursor-pointer hover:ring-2 hover:ring-blue-300 transition-all"
                    onClick={() => router.push(`/projects/${projectId}/knowledge/code-files`)}
                    title="Ver todos os arquivos de código"
                  >
                    <div className="text-2xl font-bold text-blue-700">{knowledgeStats.code_files_count}</div>
                    <div className="text-xs text-blue-600">Arquivos de Código</div>
                  </div>
                  <div className="bg-yellow-50 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-yellow-700">{knowledgeStats.interview_answers_count}</div>
                    <div className="text-xs text-yellow-600">Respostas de Entrevista</div>
                  </div>
                  <div
                    className="bg-orange-50 rounded-lg p-4 text-center cursor-pointer hover:ring-2 hover:ring-orange-300 transition-all"
                    onClick={() => router.push(`/projects/${projectId}/knowledge/rules`)}
                    title="Ver todas as regras de negócio"
                  >
                    <div className="text-2xl font-bold text-orange-700">{knowledgeStats.business_rules_count}</div>
                    <div className="text-xs text-orange-600">Regras de Negocio</div>
                  </div>
                </div>

                {/* By Source breakdown */}
                {Object.keys(knowledgeStats.by_source).length > 0 && (
                  <div className="mt-4 pt-4 border-t">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Por Fonte</h4>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(knowledgeStats.by_source).map(([source, count]) => (
                        <span key={source} className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 text-sm px-3 py-1 rounded-full">
                          {source.replace(/_/g, ' ')}: <strong>{count}</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* By Category breakdown (for business rules) */}
                {Object.keys(knowledgeStats.by_category).length > 0 && (
                  <div className="mt-4 pt-4 border-t">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Regras de Negocio por Categoria</h4>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(knowledgeStats.by_category).map(([category, count]) => (
                        <span key={category} className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 text-sm px-3 py-1 rounded-full">
                          {category}: <strong>{count}</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Exportar regras → backlog */}
                <div className="mt-4 pt-4 border-t flex items-start justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-medium text-gray-700">Exportar regras para o Backlog</h4>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Cria Epics por dominio e Stories por gap detectado, sem precisar rodar a Fase 4 do Deep Pipeline.
                    </p>
                    {exportError && <p className="text-xs text-red-600 mt-1">{exportError}</p>}
                    {exportResult && (
                      <p className="text-xs text-green-700 mt-1">
                        Criados <strong>{exportResult.epics_created}</strong> Epics e <strong>{exportResult.stories_created}</strong> Stories no Backlog.
                      </p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={openExportPreview}
                    disabled={exporting}
                  >
                    Exportar regras
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <ConfirmDialog
            open={exportConfirmOpen}
            onClose={() => (exporting ? null : setExportConfirmOpen(false))}
            onConfirm={confirmExport}
            type="info"
            title="Exportar regras de negocio?"
            message={
              exportPreview
                ? `Vou criar ${exportPreview.epics_planned} Epics (1 por dominio) e ${exportPreview.stories_planned} Stories (1 por gap detectado) no Backlog. Itens podem ser editados ou removidos depois.`
                : 'Calculando...'
            }
            confirmLabel="Sim, criar no Backlog"
            cancelLabel="Cancelar"
            isLoading={exporting}
          />

          {/* PROMPT #218 - Continuous RAG Evolution Panel */}
          <ContinuousRAGPanel
            projectId={projectId}
            onScanComplete={loadRagStats}
          />

          {/* Code Indexing Panel - ALWAYS visible (PROMPT #136) */}
          <CodeIndexingPanel
            projectId={projectId}
            stats={codeStats}
            onIndexComplete={loadRagStats}
          />
        </>
      )}
    </div>
  );
}

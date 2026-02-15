/**
 * Continuous RAG Evolution Panel
 *
 * PROMPT #218 - Shows continuous RAG status, triggers manual scans,
 * and displays file processing statistics per project.
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '@/components/ui';
import { RefreshCw, Database, FileText, AlertCircle, CheckCircle, Clock, Trash2 } from 'lucide-react';
import { useNotification } from '@/hooks';
import { ragApi } from '@/lib/api';

interface ContinuousRAGStats {
  project_id: string;
  total_files_tracked: number;
  by_status: Record<string, number>;
  total_rules_extracted: number;
  last_processed_at: string | null;
  coverage_percent: number;
  is_scanning: boolean;
  active_job?: {
    id: string;
    status: string;
    progress_percent: number;
    progress_message: string;
  };
}

interface Props {
  projectId: string;
  onScanComplete?: () => void;
}

export function ContinuousRAGPanel({ projectId, onScanComplete }: Props) {
  const [stats, setStats] = useState<ContinuousRAGStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const { showError, showSuccess, NotificationComponent } = useNotification();

  const loadStats = useCallback(async () => {
    try {
      const data = await ragApi.continuousStatus(projectId);
      setStats(data);
    } catch (error: any) {
      console.error('Failed to load continuous RAG stats:', error);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Poll while scanning
  useEffect(() => {
    if (!stats?.is_scanning) return;
    const interval = setInterval(loadStats, 5000);
    return () => clearInterval(interval);
  }, [stats?.is_scanning, loadStats]);

  const handleScan = async () => {
    setIsScanning(true);
    try {
      const result = await ragApi.continuousScan(projectId);
      showSuccess(`Verificacao RAG iniciada (Job: ${result.job_id})`);
      // Start polling
      setTimeout(loadStats, 2000);
    } catch (error: any) {
      showError('Falha ao iniciar verificacao RAG: ' + (error.message || 'Erro desconhecido'));
    } finally {
      setIsScanning(false);
    }
  };

  const handleReset = async () => {
    if (!confirm('Isto ira limpar todo o estado de rastreamento de arquivos e documentos de RAG continuos. Continuar?')) return;
    setIsResetting(true);
    try {
      const result = await ragApi.continuousReset(projectId);
      showSuccess(`Reset concluido: ${result.files_cleared} arquivos, ${result.rag_docs_removed} docs removidos`);
      loadStats();
      onScanComplete?.();
    } catch (error: any) {
      showError('Falha ao resetar: ' + (error.message || 'Erro desconhecido'));
    } finally {
      setIsResetting(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto text-gray-400" />
          <p className="text-sm text-gray-500 mt-2">Carregando estatisticas de RAG continuo...</p>
        </CardContent>
      </Card>
    );
  }

  const hasData = stats && stats.total_files_tracked > 0;
  const completed = stats?.by_status?.completed || 0;
  const pending = stats?.by_status?.pending || 0;
  const failed = stats?.by_status?.failed || 0;
  const processing = stats?.by_status?.processing || 0;

  return (
    <Card>
      {NotificationComponent}
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 rounded-lg">
              <Database className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <CardTitle>Evolucao RAG Continua</CardTitle>
              <p className="text-xs text-gray-500 mt-0.5">
                Verifica automaticamente a cada 5 min via Redis
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={handleScan}
              disabled={isScanning || stats?.is_scanning}
              variant="outline"
              size="sm"
            >
              {isScanning || stats?.is_scanning ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Verificando...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Verificar Agora
                </>
              )}
            </Button>
            {hasData && (
              <Button
                onClick={handleReset}
                disabled={isResetting || stats?.is_scanning}
                variant="secondary"
                size="sm"
              >
                <Trash2 className="w-4 h-4 mr-1" />
                Reset
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <div className="space-y-4">
            {/* Stats grid */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-gray-700">{stats!.total_files_tracked}</div>
                <div className="text-xs text-gray-500">Arquivos Rastreados</div>
              </div>
              <div className="bg-emerald-50 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-emerald-700">{completed}</div>
                <div className="text-xs text-emerald-600 flex items-center justify-center gap-1">
                  <CheckCircle className="w-3 h-3" /> Concluidos
                </div>
              </div>
              <div className="bg-yellow-50 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-yellow-700">{pending + processing}</div>
                <div className="text-xs text-yellow-600 flex items-center justify-center gap-1">
                  <Clock className="w-3 h-3" /> Pendentes
                </div>
              </div>
              <div className="bg-red-50 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-red-700">{failed}</div>
                <div className="text-xs text-red-600 flex items-center justify-center gap-1">
                  <AlertCircle className="w-3 h-3" /> Falhou
                </div>
              </div>
              <div className="bg-blue-50 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-blue-700">{stats!.total_rules_extracted}</div>
                <div className="text-xs text-blue-600 flex items-center justify-center gap-1">
                  <FileText className="w-3 h-3" /> Regras
                </div>
              </div>
            </div>

            {/* Coverage bar */}
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-600">Cobertura</span>
                <span className="font-medium text-gray-900">{stats!.coverage_percent}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-emerald-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(stats!.coverage_percent, 100)}%` }}
                />
              </div>
            </div>

            {/* Last processed */}
            {stats!.last_processed_at && (
              <p className="text-xs text-gray-400">
                Ultimo processamento: {new Date(stats!.last_processed_at).toLocaleString()}
              </p>
            )}

            {/* Active job indicator */}
            {stats!.is_scanning && stats!.active_job && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-blue-600 animate-spin" />
                  <span className="text-sm font-medium text-blue-800">
                    Verificacao em andamento...
                  </span>
                  {stats!.active_job.progress_percent > 0 && (
                    <Badge variant="outline" className="ml-auto">
                      {stats!.active_job.progress_percent}%
                    </Badge>
                  )}
                </div>
                {stats!.active_job.progress_message && (
                  <p className="text-xs text-blue-600 mt-1">{stats!.active_job.progress_message}</p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <Database className="w-12 h-12 mx-auto mb-2 text-gray-300" />
            <p>Nenhum dado de RAG continuo ainda</p>
            <p className="text-sm mt-1">Clique em "Verificar Agora" para comecar a extrair regras de negocio do codigo</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

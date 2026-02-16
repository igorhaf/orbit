/**
 * Prompts List Page
 * Displays all prompts with filtering and search
 */

'use client';

import React, { useEffect, useState } from 'react';
import { Layout, Breadcrumbs } from '@/components/layout';
import { PromptsList } from '@/components/prompts';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { promptsApi } from '@/lib/api';
import { Prompt } from '@/lib/types';
import { FileText, Plus, RefreshCw, Trash2 } from 'lucide-react';
import Link from 'next/link';

export default function PromptsPage() {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const loadPrompts = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await promptsApi.list();
      setPrompts(data);
    } catch (err: any) {
      console.error('Failed to load prompts:', err);
      setError(err.message || 'Falha ao carregar prompts');
    } finally {
      setLoading(false);
    }
  };

  const handleClearAll = async () => {
    setIsClearing(true);
    try {
      await promptsApi.deleteAll();
      setShowClearConfirm(false);
      await loadPrompts();
    } catch (err: any) {
      console.error('Failed to clear prompts:', err);
      setError(err.message || 'Falha ao limpar prompts');
    } finally {
      setIsClearing(false);
    }
  };

  useEffect(() => {
    loadPrompts();
  }, []);

  return (
    <Layout>
      <Breadcrumbs />
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-100 rounded-lg">
              <FileText className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Prompts</h1>
              <p className="text-gray-600 mt-1">
                Prompts gerados por IA para seus projetos
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="danger"
              onClick={() => setShowClearConfirm(true)}
              disabled={loading || prompts.length === 0}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Limpar Todos os Logs
            </Button>
            <Button
              variant="outline"
              onClick={loadPrompts}
              disabled={loading}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
          </div>
        </div>

        {/* Info Card */}
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-blue-100 rounded">
                <FileText className="w-5 h-5 text-blue-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-blue-900 mb-1">
                  Sobre Prompts
                </h3>
                <p className="text-sm text-blue-800">
                  Prompts são gerados automaticamente apos entrevistas e contém
                  instruções estruturadas para a IA. Podem ser versionados,
                  marcados como reutilizaveis e organizados por tipo e componentes.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Error State */}
        {error && (
          <Card className="bg-red-50 border-red-200">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <div className="text-red-600"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg></div>
                <div>
                  <h3 className="font-semibold text-red-900 mb-1">Erro</h3>
                  <p className="text-sm text-red-800">{error}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={loadPrompts}
                    className="mt-3"
                  >
                    Tentar Novamente
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Prompts List */}
        {!error && <PromptsList prompts={prompts} loading={loading} />}

        {/* Clear All Confirmation Modal */}
        <Dialog
          open={showClearConfirm}
          onClose={() => setShowClearConfirm(false)}
          title="Limpar Todos os Logs de Prompts?"
          description="Esta ação excluira permanentemente todos os logs de prompts do sistema."
        >
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="text-red-600"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg></div>
                <div>
                  <h4 className="font-semibold text-red-900 mb-1">Atenção: Esta ação não pode ser desfeita!</h4>
                  <p className="text-sm text-red-800">
                    Todos os {prompts.length} prompt{prompts.length !== 1 ? 's' : ''} serao excluidos permanentemente, incluindo suas versoes e metadados.
                    Esta operação e irreversivel.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowClearConfirm(false)}
                disabled={isClearing}
              >
                Cancelar
              </Button>
              <Button
                variant="danger"
                onClick={handleClearAll}
                disabled={isClearing}
                isLoading={isClearing}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Sim, Limpar Todos os Logs
              </Button>
            </div>
          </div>
        </Dialog>
      </div>
    </Layout>
  );
}

/**
 * New Project Page
 * PROMPT #121 - Project Creation Redesign
 * PROMPT #301 - Non-blocking progressive creation: instant redirect to project page
 *
 * Simplified flow:
 * 1. Select code folder (FolderPicker)
 * 2. Choose scan depth (quick/normal/deep)
 * 3. Click "Gerar" → project created instantly, redirect to project page
 * 4. Background jobs enrich the project progressively
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Layout, Breadcrumbs } from '@/components/layout';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FolderPicker } from '@/components/ui/FolderPicker';
import { useNotification } from '@/hooks';
import { useNotifications } from '@/contexts/NotificationContext';

export default function NewProjectPage() {
  const router = useRouter();
  const { showError, showWarning, NotificationComponent } = useNotification();
  const { addJob } = useNotifications();

  // Form state
  const [codePath, setCodePath] = useState('');
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [scanDepth, setScanDepth] = useState<'quick' | 'normal' | 'deep'>('normal');
  const [submitting, setSubmitting] = useState(false);

  // Handle folder selection
  const handleFolderSelect = (path: string) => {
    setCodePath(path);
    setShowFolderPicker(false);
  };

  // PROMPT #301 - Create project and redirect immediately
  const handleGenerate = async () => {
    if (!codePath) {
      showWarning('Selecione uma pasta de codigo primeiro');
      return;
    }

    setSubmitting(true);

    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

      const response = await fetch(
        `${API_BASE}/api/v1/projects/create-and-process?code_path=${encodeURIComponent(codePath)}&scan_depth=${scanDepth}`,
        { method: 'POST' }
      );

      if (response.ok) {
        const data = await response.json();

        // Track scan job in notification bell
        const folderName = codePath.split('/').pop() || 'projeto';
        addJob(data.job_id, 'memory_scan', `Escaneando ${folderName}...`, `/projects/${data.project.id}`, true);

        // Redirect immediately to the project page (project is already active)
        router.push(`/projects/${data.project.id}`);
      } else {
        const error = await response.json();
        setSubmitting(false);
        showError(`Falha ao criar projeto: ${error.detail || 'Erro desconhecido'}`);
      }
    } catch (error) {
      console.error('Create and process failed:', error);
      setSubmitting(false);
      showError('Falha ao criar projeto. Tente novamente.');
    }
  };

  return (
    <Layout>
      <Breadcrumbs />
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Novo Projeto</h1>

        <Card>
          <CardHeader>
            <CardTitle>Selecionar Pasta de Codigo</CardTitle>
            <p className="text-sm text-gray-600 mt-1">
              Escolha sua pasta de codigo existente e a profundidade de analise. O ORBIT escaneara o codebase e expandira o projeto automaticamente em segundo plano.
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Folder Picker */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Caminho da Pasta de Codigo *</label>
              <div className="flex gap-2">
                <input
                  value={codePath}
                  onChange={(e) => setCodePath(e.target.value)}
                  placeholder="/projetos/meu-codigo-existente"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                  autoFocus
                  disabled={submitting}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowFolderPicker(true)}
                  title="Navegar pastas"
                  disabled={submitting}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                </Button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Selecione o caminho para sua pasta de codigo existente.
                <strong className="block text-gray-600 mt-1">Este caminho nao pode ser alterado apos a criacao do projeto.</strong>
              </p>

              <FolderPicker
                open={showFolderPicker}
                onClose={() => setShowFolderPicker(false)}
                onSelect={handleFolderSelect}
                title="Selecionar Pasta de Codigo"
              />
            </div>

            {/* Scan Depth Selector */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Profundidade de Analise</label>
              <p className="text-xs text-gray-500 mb-3">
                Escolha a profundidade com que a IA deve analisar seu codebase. Analise mais profunda fornece melhores resultados, mas demora mais.
              </p>
              <div className="grid grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => setScanDepth('quick')}
                  disabled={submitting}
                  className={`p-3 rounded-lg border-2 text-left transition-all ${
                    scanDepth === 'quick'
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="font-medium text-sm">Rapida</div>
                  <div className="text-xs text-gray-500 mt-1">30 arquivos, ~2 min</div>
                </button>

                <button
                  type="button"
                  onClick={() => setScanDepth('normal')}
                  disabled={submitting}
                  className={`p-3 rounded-lg border-2 text-left transition-all ${
                    scanDepth === 'normal'
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="font-medium text-sm">Normal</div>
                  <div className="text-xs text-gray-500 mt-1">100 arquivos, ~5-10 min</div>
                  <div className="text-xs text-blue-600 font-medium mt-1">Recomendado</div>
                </button>

                <button
                  type="button"
                  onClick={() => setScanDepth('deep')}
                  disabled={submitting}
                  className={`p-3 rounded-lg border-2 text-left transition-all ${
                    scanDepth === 'deep'
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="font-medium text-sm">Profunda</div>
                  <div className="text-xs text-gray-500 mt-1">TODOS os arquivos, ~15-30+ min</div>
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => router.push('/projects')}
                disabled={submitting}
              >
                Cancelar
              </Button>
              <Button
                variant="primary"
                onClick={handleGenerate}
                disabled={!codePath.trim() || submitting}
                isLoading={submitting}
              >
                Gerar Projeto
              </Button>
            </div>
          </CardContent>
        </Card>
        {NotificationComponent}
      </div>
    </Layout>
  );
}

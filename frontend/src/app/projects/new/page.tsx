/**
 * New Project Page
 * PROMPT #121 - Project Creation Redesign
 * PROMPT #301 - Non-blocking progressive creation: instant redirect to project page
 *
 * Simplified flow:
 * 1. Select code folder (FolderPicker)
 * 2. Title auto-fills from folder name (editable)
 * 3. Click "Gerar" → project created instantly, redirect to project page
 * 4. Background jobs enrich the project progressively (description, context, etc.)
 */

'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Layout, Breadcrumbs } from '@/components/layout';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FolderPicker } from '@/components/ui/FolderPicker';
import { useNotification } from '@/hooks';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

/** Derive a readable title from folder path */
function folderToTitle(codePath: string): string {
  const folder = codePath.split('/').pop() || '';
  return folder.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
}

export default function NewProjectPage() {
  const router = useRouter();
  const { showError, showWarning, NotificationComponent } = useNotification();
  // Form state
  const [codePath, setCodePath] = useState('');
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const scanDepth = 'normal';
  const [submitting, setSubmitting] = useState(false);

  // Title field
  const [projectName, setProjectName] = useState('');
  // Track if title was manually edited by the user (REGRA #0)
  const titleManuallyEdited = useRef(false);

  // Auto-fill title when code path changes
  useEffect(() => {
    if (!titleManuallyEdited.current && codePath.trim()) {
      setProjectName(folderToTitle(codePath));
    }
  }, [codePath]);

  // Handle folder selection
  const handleFolderSelect = (path: string) => {
    setCodePath(path);
    setShowFolderPicker(false);
  };

  // Handle title change — mark as manually edited
  const handleTitleChange = (value: string) => {
    setProjectName(value);
    titleManuallyEdited.current = true;
  };

  // PROMPT #301 - Create project and redirect immediately
  const handleGenerate = async () => {
    if (!codePath) {
      showWarning('Selecione uma pasta de código primeiro');
      return;
    }

    setSubmitting(true);

    try {
      const params = new URLSearchParams({
        code_path: codePath,
        scan_depth: scanDepth,
      });
      if (projectName.trim()) params.set('name', projectName.trim());

      const response = await fetch(
        `${API_BASE}/api/v1/projects/create-and-process?${params.toString()}`,
        { method: 'POST' }
      );

      if (response.ok) {
        const data = await response.json();

        // Redirect immediately to the project page (no scan job — user triggers Deep Pipeline)
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
            <CardTitle>Selecionar Pasta de Código</CardTitle>
            <p className="text-sm text-gray-600 mt-1">
              Escolha sua pasta de código existente. O ORBIT escaneará o codebase e gerará a descrição automaticamente em segundo plano.
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Folder Picker */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Caminho da Pasta de Código *</label>
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
                Selecione o caminho para sua pasta de código existente.
                <strong className="block text-gray-600 mt-1">Este caminho não pode ser alterado após a criação do projeto.</strong>
              </p>

              <FolderPicker
                open={showFolderPicker}
                onClose={() => setShowFolderPicker(false)}
                onSelect={handleFolderSelect}
                title="Selecionar Pasta de Código"
              />
            </div>

            {/* Project Title */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Título do Projeto</label>
              <input
                value={projectName}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="Nome do projeto (preenchido automaticamente pela pasta)"
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                disabled={submitting}
              />
              <p className="text-xs text-gray-500 mt-1">
                Preenchido automaticamente pelo nome da pasta. Você pode editar se desejar.
              </p>
            </div>

            {/* Scan Info */}
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm text-blue-800">O ORBIT analisará o codebase e gerará título, descrição e contexto automaticamente em segundo plano.</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => router.push('/')}
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
